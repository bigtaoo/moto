import { describe, it, expect } from 'vitest';
import { visit, newStreak, dayMult, STREAK_PAY, unlock, afterRace, ACHIEVEMENTS } from './rewards';
import { parseSave } from './meta';
import * as C from './sim/config';

describe('login streak', () => {
  it('grows on days in a row, holds on the same day and starts over after a gap', () => {
    const s = newStreak();
    expect(visit(s, 100, 1, true)).toBe(STREAK_PAY[0]);
    expect(visit(s, 100, 1, true)).toBe(0);
    expect(visit(s, 101, 2, true)).toBe(STREAK_PAY[1] * 2);
    s.doubled = true;
    for (let d = 102; d < 120; d++) visit(s, d, 1, true);
    expect(s.n).toBe(20);
    expect(s.pay).toBe(STREAK_PAY[STREAK_PAY.length - 1]);
    expect(s.doubled).toBe(false);
    expect(visit(s, 125, 1, true)).toBe(STREAK_PAY[0]);
    expect(s.n).toBe(1);
    expect(visit(s, 126, 1, false)).toBe(0); // a new player's first visit counts but pays nothing
    expect(s.n).toBe(2);
  });

  it('pays the day rewards at the root of the stage multiplier, so the last stage pays about 3×, not 11×', () => {
    expect(dayMult(1)).toBe(1);
    const last = C.stage(C.DIVISIONS.length - 1, C.TIERS.length - 1).prize;
    expect(last).toBeGreaterThan(10);
    expect(dayMult(last)).toBeGreaterThan(3);
    expect(dayMult(last)).toBeLessThan(3.5);
  });
});

describe('achievements', () => {
  const race = { place: 1, falls: 0, kos: 3, near: 0, chain: 1 };

  it('pays each once, from the race and from the save', () => {
    const save = parseSave(null);
    const got = afterRace(save, race);
    expect(got.map((a) => a.id).sort()).toEqual(['clean', 'win']);
    expect(save.cash).toBe(got.reduce((n, a) => n + a.pay, 0));
    expect(afterRace(save, race)).toEqual([]);
    expect(save.life).toEqual({ kos: 6, wins: 2 });
    save.titles = 1;
    save.div = 2;
    expect(unlock(save).map((a) => a.id)).toEqual(['promo', 'champ']);
    expect(unlock(save)).toEqual([]);
  });

  it('keeps known ids only, and every one has a name in the save round trip', () => {
    const save = parseSave(null);
    save.tier = C.TIERS.length - 1;
    unlock(save);
    const back = parseSave(JSON.stringify({ ...save, ach: [...save.ach, 'nope', 7], streak: { day: 9, n: -3, pay: 'x' } }));
    expect(back.ach).toEqual(['promo', 'legend']);
    expect(back.streak).toEqual({ day: 9, n: 0, pay: 0, doubled: false });
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(ACHIEVEMENTS.length);
  });
});
