import { describe, expect, it } from 'vitest';
import * as C from './config';
import { botInput } from './ai';
import { World } from './world';
import { knockOff } from './combat';
import { nabbed, runners, shiftPay } from './chase';

describe('security shift', () => {
  it('holds the player, catches runners for good and ends when nobody is left', () => {
    const w = new World({ seed: 5, chase: true });
    const caught: number[] = [];
    let heldMax = 0;
    while (!w.over && w.tick < 300 * C.TICK_HZ) {
      botInput(w);
      w.step();
      for (const e of w.events) if (e.type === 'caught') caught.push(e.rider);
      w.events.length = 0;
      if (w.time < C.CHASE.hold) heldMax = Math.max(heldMax, w.player.speed);
    }
    expect(w.over).toBe(true);
    expect(heldMax).toBe(0);
    expect(w.caught).toBe(caught.length);
    expect(w.caught).toBeGreaterThan(0);
    // no thugs or hunters on a shift
    expect(w.riders.every((r) => !r.thug || r.state === 'away')).toBe(true);
    expect(w.riders.every((r) => r.huntT === 0)).toBe(true);
    for (const id of caught) expect(w.riders[id].state).toBe('away');
  });

  it('counts a runner once, never outside a shift, and pays a sweep bonus', () => {
    const w = new World({ seed: 2, chase: true });
    const v = runners(w)[0];
    knockOff(w, v, w.player);
    expect(nabbed(w, v)).toBe(true);
    v.state = 'ride';
    knockOff(w, v, w.player);
    expect(w.caught).toBe(1);
    const race = new World({ seed: 2 });
    knockOff(race, race.riders[1], race.player);
    expect(race.caught).toBe(0);
    expect(nabbed(race, race.riders[1])).toBe(false);
    expect(shiftPay(2, 7, 1)).toBe(2 * C.CHASE.bounty);
    expect(shiftPay(7, 7, 1.5)).toBe(Math.round((7 * C.CHASE.bounty + C.CHASE.sweep) * 1.5));
  });
});
