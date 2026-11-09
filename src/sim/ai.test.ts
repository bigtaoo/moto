import { describe, it, expect } from 'vitest';
import { World } from './world';
import { botInput } from './ai';
import * as C from './config';

/** A world past the countdown with the road to itself: no traffic, the rivals far behind. */
function emptyRoad(): World {
  const w = new World({ seed: 1 });
  while (w.countdown > 0) w.step();
  return w;
}
function clearRoad(w: World): void {
  w.cars.length = 0;
  for (const r of w.riders) if (!r.isPlayer) { r.z = w.player.z - 300; r.speed = 0; }
}
/** Put a buggy in front of the player, blocking in the player's lane. */
function blockAhead(w: World, react: number): void {
  const p = w.player;
  Object.assign(w.patrol, {
    active: true, mode: 'block', from: 'ahead', move: 'block', t: 0, hold: 0, press: 9999,
    x: C.LANE_X[2], z: p.z + 9, speed: p.speed, vx: 0, laneX: C.LANE_X[2], laneT: 99,
    react, top: 40, blockAhead: 9, pace: 0.8, slowT: 0, haltT: 0, resume: 'block',
  });
  w.patrol.px = w.patrol.x;
  w.patrol.pz = w.patrol.z;
}

describe('riders and buggies react like drivers, not mirrors', () => {
  it('sees others a reaction time late, carried forward a little', () => {
    const w = emptyRoad();
    const p = w.player;
    const xs: number[] = [];
    w.input.targetX = C.LANE_X[2];
    for (let i = 0; i < 40; i++) { clearRoad(w); w.step(); xs.push(p.x); }
    w.input.targetX = C.LANE_X[3];
    for (let i = 0; i < 12; i++) { clearRoad(w); w.step(); xs.push(p.x); }
    const s = w.seen(p, 10);
    const then = xs[xs.length - 11];
    // somewhere between where they were 10 ticks ago and where they are now, short of now
    expect(s.x).toBeGreaterThan(then);
    expect(s.x).toBeLessThan(p.x - 0.5);
  });

  it('a blocking buggy follows a lane change only after its reaction time, and a feint fools it', () => {
    const react = 10;
    // a real lane change
    let w = emptyRoad();
    let p = w.player;
    w.input.targetX = C.LANE_X[2];
    for (let i = 0; i < 40; i++) { clearRoad(w); w.step(); }
    blockAhead(w, react);
    w.input.targetX = C.LANE_X[3];
    let crossed = -1;
    let switched = -1;
    for (let i = 0; i < 60 && switched < 0; i++) {
      clearRoad(w);
      w.step();
      if (crossed < 0 && p.x > C.LANE_X[2] + 1.75 + C.PATROL.laneCommit) crossed = w.tick;
      if (w.patrol.laneX === C.LANE_X[3]) switched = w.tick;
    }
    expect(crossed).toBeGreaterThan(0);
    expect(switched).toBeGreaterThanOrEqual(crossed + react - 1);

    // a feint: duck out and straight back
    w = emptyRoad();
    p = w.player;
    w.input.targetX = C.LANE_X[2];
    for (let i = 0; i < 40; i++) { clearRoad(w); w.step(); }
    blockAhead(w, react);
    w.input.targetX = C.LANE_X[3];
    let fooled = 0;
    for (let i = 0; i < 70; i++) {
      clearRoad(w);
      if (p.x > C.LANE_X[2] + 2.3) w.input.targetX = C.LANE_X[2];
      w.step();
      if (w.patrol.laneX === C.LANE_X[3] && Math.abs(p.x - C.LANE_X[2]) < 0.6) fooled++;
    }
    // it went for the lane the player only looked at, and was stuck there a moment once they were back
    expect(fooled).toBeGreaterThan(3);
  });

  it('lets a player who pulls over go with a warning', () => {
    let halts = 0;
    let letGo = 0;
    let slow = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const w = new World({ seed, upgrades: { top: 3, steer: 3, hp: 0 } });
      let haltAt = -1;
      let stoppedUnderIt = 0;
      while (!w.over && w.tick < 300 * C.TICK_HZ) {
        botInput(w, 1, false, true);
        const was = w.patrol.mode;
        w.step();
        for (const e of w.events) if (e.type === 'patrolLetGo') {
          letGo++;
          if (haltAt >= 0) slow = Math.max(slow, w.tick - haltAt);
        }
        w.events.length = 0;
        const pt = w.patrol;
        if (pt.active && pt.mode === 'halt' && was !== 'halt') { halts++; haltAt = w.tick; }
        // a stopped player is never still being pressed a couple of seconds on
        const pressing = pt.active && (pt.mode === 'squeeze' || pt.mode === 'block');
        stoppedUnderIt = pressing && w.player.speed < 3 && Math.abs(w.player.z - pt.z) < 15 ? stoppedUnderIt + 1 : 0;
        expect(stoppedUnderIt).toBeLessThan(2 * C.TICK_HZ);
      }
    }
    expect(halts).toBeGreaterThan(8);
    expect(letGo).toBeGreaterThan(halts * 0.7);
    expect(slow).toBeLessThan(3 * C.TICK_HZ);
  });

  it('a rival harassing someone keeps to the side it picked', () => {
    let stints = 0;
    let flips = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const w = new World({ seed, upgrades: { top: 3, steer: 3, hp: 0 } });
      const on = new Map<number, string>();
      while (!w.over && w.tick < 300 * C.TICK_HZ) {
        botInput(w, 1, false);
        w.step();
        w.events.length = 0;
        for (const r of w.riders) {
          if (r.isPlayer || r.thug) continue;
          const key = r.intent === 'harass' && r.foe !== null ? `${r.foe}:${r.foeSide}` : '';
          const before = on.get(r.id) ?? '';
          if (key && !before) stints++;
          if (key && before && key.split(':')[0] === before.split(':')[0] && key !== before) flips++;
          on.set(r.id, key);
        }
      }
    }
    expect(stints).toBeGreaterThan(20);
    expect(flips).toBe(0);
  });
});
