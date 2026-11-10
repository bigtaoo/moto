import { describe, it, expect } from 'vitest';
import { challengesFor, dailyFor, newDaily, readDaily, rows, scoreDaily, GOALS, PER_DAY, CHALLENGE_PAY, FIRST_WIN_PAY, type RaceStats } from './daily';

const race = (o: Partial<RaceStats> = {}): RaceStats => ({ place: 5, kos: 0, shoves: 0, falls: 1, grudge: 0, ...o });

describe('daily challenges', () => {
  it('picks three different kinds a day, the same for the same day, varied over days', () => {
    const seen = new Set<string>();
    for (let day = 20000; day < 20060; day++) {
      const c = challengesFor(day);
      expect(c).toHaveLength(PER_DAY);
      expect(new Set(c).size).toBe(PER_DAY);
      expect(challengesFor(day)).toEqual(c);
      c.forEach((k) => seen.add(k));
    }
    expect(seen.size).toBe(Object.keys(GOALS).length);
  });

  it('adds up a day\'s races, pays each challenge once and the first win once', () => {
    let day = 20000;
    while (!challengesFor(day).includes('races')) day++;
    const d = newDaily(day);
    const i = challengesFor(day).indexOf('races');
    let paid = 0;
    for (let n = 0; n < GOALS.races + 2; n++) {
      const o = scoreDaily(d, race(), 2);
      if (o.done.includes('races')) paid++;
      expect(o.firstWin).toBe(0);
    }
    expect(paid).toBe(1);
    expect(d.prog[i]).toBe(GOALS.races);
    expect(rows(d)[i].done).toBe(true);
    const w = scoreDaily(d, race({ place: 1 }), 2);
    expect(w.firstWin).toBe(FIRST_WIN_PAY * 2);
    expect(scoreDaily(d, race({ place: 1 }), 2).firstWin).toBe(0);
  });

  it('pays by the division', () => {
    let day = 20000;
    while (!challengesFor(day).includes('kos')) day++;
    const o = scoreDaily(newDaily(day), race({ kos: 10 }), 1.5);
    expect(o.done).toContain('kos');
    expect(o.cash).toBeGreaterThanOrEqual(Math.round(CHALLENGE_PAY * 1.5));
  });

  it('starts a new day afresh and reads junk as a fresh day', () => {
    const d = newDaily(5);
    d.prog[0] = 2;
    expect(dailyFor(d, 5)).toBe(d);
    expect(dailyFor(d, 6).prog).toEqual([0, 0, 0]);
    expect(readDaily({ day: 6, prog: [1, 'x', -4], won: true }, 6)).toEqual({ day: 6, prog: [1, 0, 0], won: true });
    expect(readDaily({ day: 5, prog: [3, 3, 3] }, 6)).toEqual(newDaily(6));
    expect(readDaily(null, 6)).toEqual(newDaily(6));
  });
});
