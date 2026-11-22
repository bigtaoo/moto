import { describe, expect, it } from 'vitest';
import { parseSave, type Save } from './meta';
import { settleRace } from './career';
import { raceOpts } from './raceOpts';
import { buyTune, tunePrice, repair, repairPrice, dent, fitted, WEAR_AT, WEAR_BITE, WEAR_PER_KO } from './tune';
import * as C from './sim/config';

/** A save at the given season with money in it and the garage's levels already bought. */
function at(tier: number, cash = 100000): Save {
  const save = parseSave(null);
  save.tier = tier;
  save.cash = cash;
  save.up = { top: 3, steer: 3, hp: 1 };
  return save;
}

/** The settle a race hands back; only the fields tune.ts reads matter here. */
const raced = (kos: number[]) => ({
  place: 3, kos: 0, grudgeKos: 0, shoves: 0, nearPay: 0, chainPay: 0, stuntPay: 0, mutator: false, fines: 0,
  grudges: [], places: [3, 1, 2, 4, 5, 6], koPlayer: kos, koByPlayer: [0, 0, 0, 0, 0, 0],
});

describe('the tune-up, a level rented for one race (3.3.70)', () => {
  it('is paid for once and fitted once', () => {
    const save = at(1);
    const price = tunePrice(save, 'top');
    expect(buyTune(save, 'top')).toBe(true);
    expect(save.cash).toBe(100000 - price);
    expect(buyTune(save, 'top')).toBe(false); // already fitted: no second charge
    expect(save.cash).toBe(100000 - price);
  });

  it('will not be sold on credit', () => {
    const save = at(0, 10);
    expect(buyTune(save, 'hp')).toBe(false);
    expect(save.tune.hp).toBe(0);
  });

  it('costs about one race either end of the career', () => {
    const all = (s: Save) => tunePrice(s, 'top') + tunePrice(s, 'steer') + tunePrice(s, 'hp');
    const first = at(0);
    const last = at(2);
    last.div = C.DIVISIONS.length - 1;
    // the purse multiplies x10.8 from the first stage to the last; the tune-up must not
    expect(all(last) / all(first)).toBeGreaterThan(2);
    expect(all(last) / all(first)).toBeLessThan(4);
  });

  it('rides past the season cap, and only in a career race', () => {
    const save = at(0);
    save.up.top = C.UPGRADE_CAP[0].top;
    buyTune(save, 'top');
    expect(fitted(save, false).top).toBe(C.UPGRADE_CAP[0].top + 1);
    expect(fitted(save, true).top).toBe(C.UPGRADE_CAP[0].top); // a shift or a free race gets none of it
    expect(raceOpts(save, { chase: false, free: null, n: 0 }).upgrades?.top).toBe(C.UPGRADE_CAP[0].top + 1);
    expect(raceOpts(save, { chase: true, free: null, n: 0 }).upgrades?.top).toBe(C.UPGRADE_CAP[0].top);
  });

  it('is spent by the race it was bought for', () => {
    const save = at(1);
    buyTune(save, 'steer');
    settleRace(save, raced([0, 0, 0, 0, 0, 0]));
    expect(save.tune).toEqual({ top: 0, steer: 0, hp: 0 });
  });
});

describe('the dents a race leaves (3.3.70)', () => {
  it('leaves the first season alone', () => {
    const save = at(WEAR_AT - 1);
    dent(save, 7);
    expect(save.wear).toBe(0);
  });

  it('marks the ride once the career is past that, and never past a wreck', () => {
    const save = at(WEAR_AT);
    dent(save, 3);
    expect(save.wear).toBeCloseTo(WEAR_PER_KO * 3);
    dent(save, 100);
    expect(save.wear).toBe(1);
  });

  it('costs the ride levels until it is beaten out', () => {
    const save = at(WEAR_AT);
    save.wear = 1;
    expect(fitted(save, false).top).toBe(3 - WEAR_BITE);
    expect(fitted(save, false).hp).toBe(0); // never below zero
    const price = repairPrice(save);
    expect(repair(save)).toBe(true);
    expect(save.cash).toBe(100000 - price);
    expect(save.wear).toBe(0);
    expect(fitted(save, false).top).toBe(3);
    expect(repair(save)).toBe(false); // nothing left to fix
  });

  it(`is settled with the race's money`, () => {
    const save = at(WEAR_AT);
    settleRace(save, raced([2, 0, 0, 0, 0, 0]));
    expect(save.wear).toBeCloseTo(WEAR_PER_KO * 2);
  });
});
