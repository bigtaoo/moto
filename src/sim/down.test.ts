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
