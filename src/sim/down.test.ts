import { describe, it, expect } from 'vitest';
import { World } from './world';
import { botInput } from './ai';
import * as C from './config';

describe('knocked off', () => {
  it('the scooter slides on, the rider runs back to it and rides off from there', () => {
    let crashes = 0;
    let ran = 0;
    let longest = 0;
    let away = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const w = new World({ seed, upgrades: { top: 3, steer: 3, hp: 0 } });
      let down = 0;
      let bike = { x: 0, z: 0 };
      while (!w.over && w.tick < 300 * C.TICK_HZ) {
        botInput(w, 1, false);
        w.step();
        w.events.length = 0;
        const p = w.player;
        if (p.state === 'down') {
          if (down === 0) crashes++;
          down++;
          if (p.runT === 1) ran++;
          // the scooter never ends up behind where the body is
          if (p.runT === 0 && p.bikeZ < p.z - 0.01) away++;
          bike = { x: p.bikeX, z: p.bikeZ };
        } else if (down > 0) {
          longest = Math.max(longest, down);
          // back on where the scooter lay (a shove on that same tick may nudge them a little)
          expect(p.z).toBeGreaterThanOrEqual(bike.z - 0.5);
          expect(Math.abs(p.x - bike.x)).toBeLessThan(1);
          down = 0;
        }
      }
    }
    expect(crashes).toBeGreaterThan(10);
    expect(ran).toBeGreaterThan(crashes * 0.8);
    expect(away).toBe(0);
    expect(longest).toBeLessThanOrEqual((C.DOWN.maxRun + C.DOWN.stand + 1) * C.TICK_HZ);
  });
});

describe('the rubber band after a knockdown', () => {
  it('a rival who came off rides no faster than its own top speed, so the ground it lost stays lost', () => {
    let falls = 0;
    let banded = 0;
    let over = 0;
    let gained = 0;
    let back = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const w = new World({ seed, div: 2, upgrades: { top: 2, steer: 2, hp: 2 } });
      const lost = new Map<number, { gap: number; tick: number }>();
      while (!w.over && w.tick < 300 * C.TICK_HZ) {
        botInput(w);
        w.step();
        for (const e of w.events) {
          if (e.type !== 'crash' || e.rider === 0 || e.cause !== 'ko') continue;
          falls++;
          // set on the tick they came off (the same step may already have ticked one off it)
          if (w.riders[e.rider].bandT >= Math.round(C.AI.band.downSecs * C.TICK_HZ) - 1) banded++;
          lost.set(e.rider, { gap: w.player.z - w.riders[e.rider].z, tick: w.tick });
        }
        w.events.length = 0;
        // the band comes back on its own: nothing leaves a rider banded for longer than it was set
        for (const r of w.riders) if (r.bandT > Math.round(C.AI.band.downSecs * C.TICK_HZ)) over++;
        for (const [id, f] of lost) {
          if (w.tick - f.tick < C.AI.band.downSecs * C.TICK_HZ) continue;
          // on average they are well behind where they were when the band comes back (the player
          // falls too, so plenty of single cases go the other way)
          gained += w.player.z - w.riders[id].z - f.gap;
          back++;
          lost.delete(id);
        }
      }
    }
    expect(falls).toBeGreaterThan(20);
    expect(banded).toBe(falls);
    expect(over).toBe(0);
    expect(gained / back).toBeGreaterThan(10);
  });
});
