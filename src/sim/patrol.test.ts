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

  it('blocks and squeezes but is solid: no rider ends a tick inside it', () => {
    let inside = 0;
    let presses = 0;
    let pressTicks = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const w = new World({ seed, upgrades: { top: 3, steer: 3, hp: 0 } });
      while (!w.over && w.tick < 300 * C.TICK_HZ) {
        botInput(w, 1, false);
        w.step();
        for (const e of w.events) if (e.type === 'patrolWarn') presses++;
        w.events.length = 0;
        const pt = w.patrol;
        if (!pt.active || pt.mode === 'off') continue;
        if (pt.mode === 'block' || pt.mode === 'squeeze') pressTicks++;
        for (const r of w.riders) {
          if (r.state !== 'ride') continue;
          if (Math.abs(r.x - pt.x) < C.PATROL.halfW + C.PATROL.riderHalfW - 0.01 && Math.abs(r.z - pt.z) < C.PATROL.halfL + 0.59) inside++;
        }
      }
    }
    expect(inside).toBe(0);
    expect(presses).toBeGreaterThan(4);
    expect(pressTicks).toBeGreaterThan(0);
  });

  it('slows you while it squeezes you', () => {
    let squeezed = 0;
    let lost = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const w = new World({ seed, upgrades: { top: 3, steer: 3, hp: 0 } });
      while (!w.over && w.tick < 300 * C.TICK_HZ) {
        botInput(w, 1, false);
        const before = w.player.speed;
        w.step();
        w.events.length = 0;
        const p = w.player;
        if (w.patrol.mode === 'squeeze' && p.state === 'ride' && p.rubT === C.CONTACT.rubTicks && Math.abs(p.x - w.patrol.x) < 1.5) {
          squeezed++;
          lost += before - p.speed;
        }
      }
    }
    expect(squeezed).toBeGreaterThan(60);
    expect(lost / squeezed).toBeGreaterThan(0.05); // m/s per tick, net of the scooter's own acceleration
  });
});
