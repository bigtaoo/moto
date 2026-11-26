import { describe, expect, it } from 'vitest';
import { DIVISIONS, stage } from './sim/ladder';
import { parseSave } from './meta';
import { pickDiv, reached } from './career';
import { freeEdge, freeOpen, freePay, scenes, stakes, STAKE_MIN, FREE_BACK } from './free';

/** A save standing at a division and tier, having reached `reach` this season. */
function at(div: number, tier: number, reach = div, cash = 10000) {
  const save = parseSave(null);
  save.div = div;
  save.tier = tier;
  save.reach = reach;
  save.cash = cash;
  save.races = 20;
  return save;
}

describe('which tracks are open', () => {
  it('opens with the security shift, not before', () => {
    const save = parseSave(null);
    save.races = 0;
    expect(freeOpen(save)).toBe(false);
    save.races = 3;
    expect(freeOpen(save)).toBe(true);
  });

  it('offers this season as far as it has been climbed, and every earlier season whole', () => {
    const list = scenes(at(1, 1, 2));
    expect(list.filter((s) => s.tier === 0)).toHaveLength(DIVISIONS.length);
    expect(list.filter((s) => s.tier === 1).map((s) => s.div)).toEqual([0, 1, 2]);
  });

  it('keeps a division open after the cup has moved on from it', () => {
    const save = at(3, 0, 3);
    save.div = 1; // dropped back
    expect(scenes(save).map((s) => s.div)).toEqual([0, 1, 2, 3]);
    expect(scenes(save).find((s) => s.here)?.div).toBe(1);
  });

  it('names the stages the way the cup does', () => {
    const list = scenes(at(0, 1));
    expect(list[0].name).toBe(stage(0, 0).name);
  });
});

describe('the odds of a track', () => {
  it('pays full at the stage the career is on', () => {
    expect(freeEdge(2.1, 2.1)).toBe(1);
  });

  it('cuts a stage the career has outgrown down to its share of the purse', () => {
    expect(freeEdge(1, 2)).toBe(0.5);
    expect(freeEdge(1, 3.6)).toBeCloseTo(0.3, 5);
  });

  it('never pays more than full, however rich the stage', () => {
    expect(freeEdge(3.6, 1)).toBe(1);
  });

  it('is on every tile, and is 1 only where the cup stands', () => {
    const list = scenes(at(2, 0));
    expect(list.find((s) => s.here)?.edge).toBe(1);
    expect(list[0].edge).toBeLessThan(1);
  });
});

describe('what a place brings back', () => {
  it('gives the stake back with a win and keeps most of it on a podium', () => {
    expect(freePay(1000, 1, 1)).toBe(1800);
    expect(freePay(1000, 2, 1)).toBe(1100);
    expect(freePay(1000, 3, 1)).toBe(700);
  });

  it('keeps the whole stake below third', () => {
    for (const place of [4, 5, 6, 7, 8]) expect(freePay(1000, place, 1)).toBe(0);
  });

  it('is worse than even money on average, so it can never be the income', () => {
    const paid = FREE_BACK.reduce((a, b) => a + b, 0);
    expect(paid).toBeLessThan(8 * 0.5); // 3 of 8 places pay; 3.6 back on 8 stakes
  });

  it('scales the whole return by the stage, not just the win', () => {
    expect(freePay(1000, 1, 0.5)).toBe(900);
    expect(freePay(1000, 2, 0.5)).toBe(550);
  });
});

describe('the stakes on offer', () => {
  it('are shares of what the player has, rounded to hundreds', () => {
    expect(stakes(10000)).toEqual([200, 1000, 2500]);
  });

  it('never offers one the player cannot cover', () => {
    for (const cash of [0, 50, 99, 100, 250, 1000, 42429]) {
      for (const s of stakes(cash)) expect(s).toBeLessThanOrEqual(cash);
    }
  });

  it('offers nothing to a player with less than the floor', () => {
    expect(stakes(99)).toEqual([]);
    expect(stakes(100)).toEqual([STAKE_MIN]);
  });

  it('never offers the same stake twice', () => {
    for (const cash of [120, 300, 450, 800]) {
      expect(new Set(stakes(cash)).size).toBe(stakes(cash).length);
    }
  });
});

describe('moving the cup to another division', () => {
  it('goes anywhere already reached this season', () => {
    const save = at(3, 1, 3);
    expect(pickDiv(save, 1)).toBe(true);
    expect(save.div).toBe(1);
    expect(reached(save)).toBe(3);
  });

  it('refuses a division the season has not got to', () => {
    const save = at(1, 0, 1);
    expect(pickDiv(save, 2)).toBe(false);
    expect(save.div).toBe(1);
  });

  it('refuses once the cup has started', () => {
    const save = at(2, 0, 2);
    save.cup.race = 1;
    expect(pickDiv(save, 0)).toBe(false);
    expect(save.div).toBe(2);
  });

  it('refuses the division already being run, and anything off the ladder', () => {
    const save = at(2, 0, 2);
    expect(pickDiv(save, 2)).toBe(false);
    expect(pickDiv(save, -1)).toBe(false);
  });

  it('remembers the high-water mark through a drop and back', () => {
    const save = at(3, 0, 3);
    pickDiv(save, 0);
    expect(reached(save)).toBe(3);
    pickDiv(save, 3);
    expect(reached(save)).toBe(3);
  });
});

describe('an older save', () => {
  it('has been everywhere up to where it stands', () => {
    const save = parseSave(JSON.stringify({ div: 2, tier: 1, races: 30 }));
    expect(save.reach).toBe(2);
  });
});
