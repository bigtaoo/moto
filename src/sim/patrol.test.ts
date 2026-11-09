import { describe, it, expect } from 'vitest';
import { World } from './world';
import { botInput } from './ai';
import * as C from './config';

describe('security buggy', () => {
  it('drives round traffic instead of through it', () => {
    let overlaps = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const w = new World({ seed });
      while (!w.over && w.tick < 300 * C.TICK_HZ) {
        botInput(w, 0.5);
        w.step();
        w.events.length = 0;
        const pt = w.patrol;
        if (!pt.active || pt.mode === 'off') continue;
        for (const c of w.cars) {
          if (Math.abs(c.x - pt.x) < C.CAR.halfW + C.PATROL.halfW && Math.abs(c.z - pt.z) < C.CAR.halfL + C.PATROL.halfL) overlaps++;
        }
      }
    }
    expect(overlaps).toBe(0);
  });
});
