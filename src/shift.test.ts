import { describe, expect, it } from 'vitest';
import { CHASE } from './sim/config';
import { World } from './sim/world';
import { parseSave } from './meta';
import { settleShift, shiftOpen } from './shift';

/** A finished shift with `caught` runners taken, on an untouched save. */
function shift(caught: number) {
  const w = new World({ seed: 4, chase: true });
  w.caught = caught;
  w.tick = 30 * 97;
  return { save: parseSave(null), w };
}

describe('a security shift settles', () => {
  it('pays the bounty into the save and splits out the sweep bonus', () => {
    const { save, w } = shift(3);
    const r = settleShift(save, w);
    expect(r.caught).toBe(3);
    expect(r.of).toBe(w.racers - 1);
    expect(r.bounty).toBe(Math.round(3 * CHASE.bounty * w.div.prize));
    expect(r.sweep).toBe(0); // not the whole field: no bonus
    expect(r.earned).toBe(r.bounty);
    expect(save.cash).toBe(r.earned);
    expect(r.time).toBe(w.time);
  });

  it('adds the sweep bonus once every runner is caught', () => {
    const { save, w } = shift(0);
    w.caught = w.racers - 1;
    const r = settleShift(save, w);
    expect(r.sweep).toBe(Math.round(CHASE.sweep * w.div.prize));
    expect(r.earned).toBe(r.bounty + r.sweep);
    expect(save.cash).toBe(r.earned);
  });

  it('pays nothing for an empty shift, and leaves the rest of the save alone', () => {
    const { save, w } = shift(0);
    const before = JSON.stringify({ ...save, cash: 0 });
    const r = settleShift(save, w);
    expect(r.earned).toBe(0);
    expect(save.cash).toBe(0);
    // a shift is not a race: no cup points, no race count, no carried weapon spent
    expect(JSON.stringify({ ...save, cash: 0 })).toBe(before);
  });

  it('opens only once the player knows the game', () => {
    const save = parseSave(null);
    expect(shiftOpen(save)).toBe(false);
    save.races = CHASE.unlock - 1;
    expect(shiftOpen(save)).toBe(false);
    save.races = CHASE.unlock;
    expect(shiftOpen(save)).toBe(true);
  });
});
