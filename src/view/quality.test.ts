import { describe, expect, it } from 'vitest';
import { Governor, TIERS, TOP, forcedTier, isSoftware, startTier } from './quality';

/** Feed `secs` seconds of frames at `fps`; returns the tier changes seen. */
function run(g: Governor, fps: number, secs: number, active = true): number[] {
  const seen: number[] = [];
  const ms = 1000 / fps;
  for (let t = 0; t < secs * 1000; t += ms) if (g.frame(ms, active)) seen.push(g.tier);
  return seen;
}

describe('Governor', () => {
  it('holds steady at a good frame rate', () => {
    const g = new Governor(3);
    expect(run(g, 50, 60)).toEqual([]);
  });

  it('steps down one tier after 3 s under 40 fps, and keeps stepping while it stays slow', () => {
    const g = new Governor(TOP);
    expect(run(g, 30, 2.5)).toEqual([]);
    expect(run(g, 30, 1)).toEqual([TOP - 1]);
    expect(run(g, 30, 4)).toEqual([TOP - 2]);
  });

  it('drops straight to the bottom under 15 fps', () => {
    const g = new Governor(TOP);
    expect(run(g, 10, 4)).toEqual([0]);
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
    const g = new Governor(TOP, (a, b) => caps[a] === caps[b]);
    expect(run(g, 30, 3.6)).toEqual([1]);
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
});
