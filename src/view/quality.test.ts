import { describe, expect, it } from 'vitest';
import { Governor, SCALE, TIERS, TOP, forcedTier, isSoftware, startTier } from './quality';

/** Feed `secs` seconds of frames at `fps`; returns the tier the governor moved to, each time it moved. */
function run(g: Governor, fps: number, secs: number, active = true): number[] {
  const seen: number[] = [];
  const ms = 1000 / fps;
  for (let t = 0; t < secs * 1000; t += ms) if (g.frame(ms, active) === 'tier') seen.push(g.tier);
  return seen;
}

/** The same, but reporting what the drawing buffer was scaled to, each time it changed. */
function runRes(g: Governor, fps: number, secs: number): number[] {
  const seen: number[] = [];
  const ms = 1000 / fps;
  for (let t = 0; t < secs * 1000; t += ms) if (g.frame(ms, true) === 'scale') seen.push(Number(g.scale.toFixed(2)));
  return seen;
}

/** Feed frames at `fps` until `done`, or give up after a minute; returns the seconds it took. */
function until(g: Governor, fps: number, done: () => boolean): number {
  const ms = 1000 / fps;
  let t = 0;
  for (; t < 60000 && !done(); t += ms) g.frame(ms, true);
  return Math.round(t / 1000);
}

/** Shrink the buffer all the way down and stop there, so the next slow spell has to move the tier. */
const floored = (g: Governor): Governor => (until(g, 30, () => g.scale <= SCALE.min), g);

describe('Governor', () => {
  it('holds steady at a good frame rate', () => {
    const g = new Governor(3);
    expect(run(g, 50, 60)).toEqual([]);
  });

  it('shrinks the drawing buffer before it touches the tier', () => {
    const g = new Governor(TOP);
    expect(runRes(g, 30, 2.5)).toEqual([]); // not yet: 3 s of it is a trend, less is a hiccup
    expect(runRes(g, 30, 2)).toEqual([0.9]);
    expect(g.tier).toBe(TOP); // nothing visible has been given up yet
    expect(runRes(g, 30, 11)).toEqual([0.8, 0.7, 0.6]);
    expect(g.tier).toBe(TOP); // fifteen seconds of 30 fps and the picture is whole, only smaller
  });

  it('steps down one tier once the buffer is at its smallest, and keeps stepping while it stays slow', () => {
    const g = floored(new Governor(TOP));
    expect(run(g, 30, 2.5)).toEqual([]);
    expect(run(g, 30, 2)).toEqual([TOP - 1]);
    expect(run(g, 30, 4)).toEqual([TOP - 2]);
    expect(g.scale).toBe(SCALE.min); // a step down does not hand the pixels back
  });

  it('gives the buffer back a notch at a time before trying a tier again', () => {
    const g = floored(new Governor(2));
    expect(runRes(g, 60, 4)).toEqual([]); // 5 s of headroom, not 3
    expect(runRes(g, 60, 2)).toEqual([0.65]); // and back in smaller steps than it went down
    expect(until(g, 60, () => g.scale >= 1)).toBeLessThan(45);
    expect(g.tier).toBe(2); // a whole buffer first; the tier comes after
    expect(run(g, 60, 31)).toEqual([3]);
  });

  it('is slower to give pixels back than to take them, so a machine on the edge does not flap', () => {
    expect(SCALE.up).toBeLessThan(SCALE.down);
  });

  it('drops straight to the bottom under 15 fps, buffer and tier together', () => {
    const g = new Governor(TOP);
    expect(run(g, 10, 4)).toEqual([0]);
    expect(g.scale).toBe(SCALE.min); // no notch-by-notch descent for a slide show
  });

  it('ignores one long frame and frames that are gaps or inactive', () => {
    const g = new Governor(TOP);
    for (let i = 0; i < 20; i++) {
      run(g, 60, 0.6);
      g.frame(400, true);
    }
    expect(g.tier).toBe(TOP);
    expect(run(g, 20, 10, false)).toEqual([]);
    for (let i = 0; i < 10; i++) g.frame(1500, true);
    expect(g.tier).toBe(TOP);
  });

  it('steps up after 30 s over 57 fps, once a race', () => {
    const g = new Governor(2);
    expect(run(g, 60, 29)).toEqual([]);
    expect(run(g, 60, 2)).toEqual([3]);
    expect(run(g, 60, 60)).toEqual([]);
    g.raceStart();
    expect(run(g, 60, 31)).toEqual([4]);
  });

  it('steps back and locks when a step up cannot hold 54 fps', () => {
    const g = new Governor(2);
    run(g, 60, 31);
    expect(g.tier).toBe(3);
    expect(run(g, 50, 2)).toEqual([2]);
    expect(g.locked).toBe(true);
    g.raceStart();
    expect(run(g, 60, 60)).toEqual([]);
  });

  it('skips tiers that look the same on this device', () => {
    // a screen at pixel ratio 1: every cap from 1 up is the same picture
    const caps = [0.5, 0.75, 1, 1, 1, 1];
    const g = floored(new Governor(TOP, (a, b) => caps[a] === caps[b]));
    expect(run(g, 30, 4)).toEqual([1]);
    until(g, 60, () => g.scale >= 1); // the buffer comes back first, then the tier - and tier 2 is the next one that differs
    expect(run(g, 60, 31)).toEqual([2]);
  });
});

describe('start tier', () => {
  it('puts software GL at the bottom and phones below desktops', () => {
    expect(isSoftware('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)')).toBe(true);
    expect(isSoftware('llvmpipe (LLVM 15.0.7, 256 bits)')).toBe(true);
    expect(isSoftware('ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe(false);
    expect(startTier({ touch: false, gpu: 'Google SwiftShader' })).toBe(0);
    expect(startTier({ touch: true, gpu: 'Adreno (TM) 610' })).toBeLessThan(startTier({ touch: false, gpu: 'Apple M1' }));
  });

  it('reads ?quality= and rejects anything else', () => {
    expect(forcedTier('?quality=0')).toBe(0);
    expect(forcedTier('?stats&quality=5')).toBe(5);
    expect(forcedTier('?quality=6')).toBe(null);
    expect(forcedTier('?quality=high')).toBe(null);
    expect(forcedTier('')).toBe(null);
  });
});

describe('tiers', () => {
  it('never get cheaper going up: pixel ratio, particles and view distance all grow or hold', () => {
    for (let t = 1; t <= TOP; t++) {
      expect(TIERS[t].dpr).toBeGreaterThan(TIERS[t - 1].dpr);
      expect(TIERS[t].fx).toBeGreaterThanOrEqual(TIERS[t - 1].fx);
      expect(TIERS[t].view).toBeGreaterThanOrEqual(TIERS[t - 1].view);
    }
    expect(TIERS[TOP].view).toBe(1);
    expect(TIERS[0].view).toBeGreaterThanOrEqual(0.5); // the road ahead stays readable
  });

  it('leaves the bottom tier somewhere to go: the smallest buffer is a ninth of a plain screen', () => {
    expect(TIERS[0].dpr * SCALE.min).toBeCloseTo(0.3, 5);
    expect(SCALE.min).toBeGreaterThan(0.5); // ...and no further: the toon outlines fall apart below that
  });
});
