import { describe, expect, it } from 'vitest';
import * as C from './config';
import { HAZARD as H } from './fun';
import { spraying, updateHazards } from './hazards';
import type { Hazard, Rider } from './types';
import { World } from './world';

/**
 * A race in the division whose roadside hazard is `kind`, with every rider but the player parked
 * well behind: the bot only ever races division 0, so the tumbleweed and the hydrant are the two
 * hazards nothing in the suite had ever touched (doc 3.3.32).
 */
function race(div: number, kind: Hazard['kind']) {
  const w = new World({ seed: 7, div });
  const hs = w.hazards.filter((h) => h.kind === kind);
  expect(hs.length).toBeGreaterThan(0);
  for (const r of w.riders) if (!r.isPlayer) r.z = -500;
  return { w, hs };
}

/** Put `r` on the hazard, with a clean slate to measure the hit against. */
function onto(r: Rider, x: number, z: number): void {
  r.x = x;
  r.z = z;
  r.vx = 0;
  r.latV = 3;
  r.stagT = 0;
  r.airT = 0;
  r.invT = 0;
  r.speed = 20;
  r.state = 'ride';
}

describe('a tumbleweed', () => {
  /** Roll the weeds on until this one is on the road, where a rider could actually meet it. */
  function rollOnto(w: World, h: Hazard): void {
    for (let i = 0; i < 400 && Math.abs(h.x) > 4; i++) {
      w.tick++;
      updateHazards(w);
    }
    expect(Math.abs(h.x)).toBeLessThan(4);
  }

  it('shoves the rider the way it was rolling, staggers them and scrubs speed', () => {
    const { w, hs } = race(1, 'weed');
    const h = hs[0];
    rollOnto(w, h);
    const p = w.player;
    onto(p, h.x, h.z);
    w.events.length = 0;
    updateHazards(w);

    expect(p.vx).toBeCloseTo(h.side * H.weed.push, 6);
    expect(p.latV).toBe(0); // the shove wins: whatever lean the rider had is gone
    expect(p.stagT).toBeGreaterThanOrEqual(8);
    expect(p.speed).toBeCloseTo(20 * 0.93, 6);
    expect(h.t).toBe(H.weed.regrow);
    expect(w.events).toContainEqual({ type: 'weed', hazard: h.id, rider: p.id });
  });

  it('is spent until it regrows: a second pass through the same one does nothing', () => {
    const { w, hs } = race(1, 'weed');
    const h = hs[0];
    rollOnto(w, h);
    const p = w.player;
    onto(p, h.x, h.z);
    updateHazards(w);
    expect(h.t).toBe(H.weed.regrow);

    onto(p, h.x, h.z);
    w.events.length = 0;
    updateHazards(w);
    expect(p.vx).toBe(0);
    expect(p.speed).toBe(20);
    expect(w.events).toEqual([]);
    expect(h.t).toBe(H.weed.regrow - 1); // ticking back down
  });

  it('misses a rider in the air', () => {
    const { w, hs } = race(1, 'weed');
    const h = hs[0];
    rollOnto(w, h);
    const p = w.player;
    onto(p, h.x, h.z);
    p.airT = 5;
    updateHazards(w);
    expect(p.vx).toBe(0);
    expect(h.t).toBe(0);
  });
});

describe('a burst hydrant', () => {
  /** Wind the clock to a tick where `h` is spraying (or holding off, with `on` false). */
  function phase(w: World, h: Hazard, on: boolean): void {
    const Y = H.hydrant;
    w.tick = (((on ? 0 : Y.on) - h.phase) % Y.cycle + Y.cycle) % Y.cycle;
    expect(spraying(w, h)).toBe(on);
  }

  it('pushes a rider off the kerb it stands on and slows them', () => {
    const { w, hs } = race(4, 'hydrant');
    const h = hs[0];
    phase(w, h, true);
    const p = w.player;
    onto(p, h.side * (C.ROAD_HALF - 1), h.z);
    updateHazards(w);

    expect(p.vx).toBeCloseTo(-h.side * H.hydrant.push * C.DT, 6);
    expect(p.speed).toBeCloseTo(20 * H.hydrant.slow, 6);
  });

  it('cannot reach the far side of the road', () => {
    const { w, hs } = race(4, 'hydrant');
    const h = hs[0];
    phase(w, h, true);
    const p = w.player;
    onto(p, -h.side * (C.ROAD_HALF - 0.2), h.z); // ROAD_HALF + 6.8 away: past its reach of 6.5
    updateHazards(w);
    expect(p.vx).toBe(0);
    expect(p.speed).toBe(20);
  });

  it('does nothing between sprays, or to a rider past it', () => {
    const { w, hs } = race(4, 'hydrant');
    const h = hs[0];
    const p = w.player;

    phase(w, h, false);
    onto(p, h.side * (C.ROAD_HALF - 1), h.z);
    updateHazards(w);
    expect(p.vx).toBe(0);
    expect(p.speed).toBe(20);

    phase(w, h, true);
    onto(p, h.side * (C.ROAD_HALF - 1), h.z + H.hydrant.halfZ + 0.5);
    updateHazards(w);
    expect(p.vx).toBe(0);
    expect(p.speed).toBe(20);
  });
});
