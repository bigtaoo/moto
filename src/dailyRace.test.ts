import { describe, it, expect } from 'vitest';
import * as C from './sim/config';
import { MUTATORS } from './sim/fun';
import { World } from './sim/world';
import { parseSave } from './meta';
import {
  dailyOpts, dailyStage, dailyMutator, dailyScore, settleDailyRace, readDailyRace,
  dailyRaceOpen, newDailyRace, SCORE, DAILY_PAY,
} from './dailyRace';

const DAY = 20780;

describe('the day picks the race', () => {
  it('gives everybody the same race on the same day', () => {
    expect(dailyOpts(DAY)).toEqual(dailyOpts(DAY));
  });

  it('is a different race the next day, and not the same stage either', () => {
    const days = [];
    for (let d = DAY; d < DAY + 40; d++) days.push(dailyOpts(d));
    expect(new Set(days.map((o) => o.seed)).size).toBeGreaterThan(35);
    // neighbouring days never land on the same rung
    for (let i = 1; i < days.length; i++) expect(`${days[i].div}/${days[i].tier}`).not.toBe(`${days[i - 1].div}/${days[i - 1].tier}`);
  });

  it('stays inside the ladder and the mutator list', () => {
    for (let d = DAY; d < DAY + 400; d++) {
      const { div, tier } = dailyStage(d);
      expect(div).toBeGreaterThanOrEqual(0);
      expect(div).toBeLessThan(C.DIVISIONS.length);
      expect(tier).toBeGreaterThanOrEqual(0);
      expect(tier).toBeLessThan(C.TIERS.length);
      expect(MUTATORS).toContain(dailyMutator(d));
      expect(dailyOpts(d).seed).toBeGreaterThan(0);
    }
  });

  it('visits every rung of the ladder once a fortnight', () => {
    const n = C.DIVISIONS.length * C.TIERS.length;
    const rungs = new Set<string>();
    for (let d = DAY; d < DAY + n; d++) { const s = dailyStage(d); rungs.add(`${s.div}/${s.tier}`); }
    expect(rungs.size).toBe(n);
  });

  it('rides the gear the ladder is balanced against, not the player’s garage', () => {
    const { div, tier } = dailyStage(DAY);
    const gear = C.careerGear(div, tier);
    const o = dailyOpts(DAY);
    expect(o.vehicle).toBe(gear.vehicle);
    expect(o.upgrades).toEqual(gear.up);
    expect(o.grudges).toEqual([]);
    expect(o.endless).toBe(0);
  });

  it('builds a world that runs', () => {
    const o = dailyOpts(DAY);
    const w = new World(o);
    for (let i = 0; i < 300; i++) w.step();
    expect(w.time).toBeGreaterThan(0);
  });
});

describe('the score', () => {
  const world = (over: Partial<{ place: number; kos: number; shoves: number; near: number; best: number; time: number }> = {}) => ({
    player: { place: over.place ?? 1 },
    kos: over.kos ?? 0, shoves: over.shoves ?? 0, time: over.time ?? 0,
    flair: { near: over.near ?? 0, best: over.best ?? 0 },
  } as unknown as Parameters<typeof dailyScore>[0]);

  it('adds its own rows up', () => {
    const s = dailyScore(world({ place: 2, kos: 3, shoves: 1, near: 4, best: 3, time: 60 }), 2);
    expect(s.placePts).toBe(SCORE.place[1]);
    expect(s.koPts).toBe(3 * SCORE.ko);
    expect(s.chain).toBe(2);
    expect(s.fallPts).toBe(-2 * SCORE.fall);
    expect(s.timePts).toBe(-60 * SCORE.sec);
    expect(s.total).toBe(s.placePts + s.koPts + s.shovePts + s.nearPts + s.chainPts + s.fallPts + s.timePts);
  });

  it('pays more for winning than for coming last', () => {
    const first = dailyScore(world({ place: 1, time: 70 }), 0).total;
    const last = dailyScore(world({ place: 8, time: 70 }), 0).total;
    expect(first).toBeGreaterThan(last);
  });

  it('never goes below zero', () => {
    expect(dailyScore(world({ place: 8, time: 600 }), 20).total).toBe(0);
  });

  it('counts a chain only once it is a chain', () => {
    expect(dailyScore(world({ best: 1 }), 0).chainPts).toBe(0);
    expect(dailyScore(world({ best: 0 }), 0).chain).toBe(0);
  });
});

describe('the day’s best and its pay', () => {
  const run = (save: ReturnType<typeof parseSave>, place: number, day = DAY) =>
    settleDailyRace(save, { player: { place }, kos: 0, shoves: 0, time: 30, flair: { near: 0, best: 0 }, div: { name: 'X' }, mutator: null } as never, 0, day);

  it('keeps the best of the day and counts the runs', () => {
    const save = parseSave(null);
    const a = run(save, 5);
    const b = run(save, 1);
    const c = run(save, 8);
    expect(a.best).toBe(true);
    expect(b.best).toBe(true);
    expect(c.best).toBe(false);
    expect(save.drace.best).toBe(b.score.total);
    expect(save.drace.runs).toBe(3);
    expect(c.was).toBe(b.score.total);
  });

  it('pays the first run of the day and no other', () => {
    const save = parseSave(null);
    expect(run(save, 1).paid).toBeGreaterThanOrEqual(DAILY_PAY);
    expect(run(save, 1).paid).toBe(0);
  });

  it('turns over at midnight', () => {
    const save = parseSave(null);
    run(save, 1);
    const next = run(save, 8, DAY + 1);
    expect(save.drace.day).toBe(DAY + 1);
    expect(save.drace.runs).toBe(1);
    expect(next.was).toBe(0);
    expect(next.paid).toBeGreaterThan(0);
  });

  it('leaves the career exactly where it was', () => {
    const save = parseSave(null);
    const before = JSON.stringify({ ...save, cash: 0, drace: 0 });
    run(save, 1);
    expect(JSON.stringify({ ...save, cash: 0, drace: 0 })).toBe(before);
  });
});

describe('the save', () => {
  it('reads junk, an old save and yesterday as a fresh day', () => {
    expect(readDailyRace(undefined, DAY)).toEqual(newDailyRace(DAY));
    expect(readDailyRace({ day: DAY - 1, best: 900, runs: 3 }, DAY)).toEqual(newDailyRace(DAY));
    expect(readDailyRace({ day: DAY, best: -5, runs: 1.7 }, DAY)).toEqual({ day: DAY, best: 0, runs: 1 });
    expect(readDailyRace({ day: DAY, best: 900, runs: 2 }, DAY)).toEqual({ day: DAY, best: 900, runs: 2 });
  });

  it('opens where the shift and the free race do', () => {
    const save = parseSave(null);
    save.races = C.CHASE.unlock - 1;
    expect(dailyRaceOpen(save)).toBe(false);
    save.races = C.CHASE.unlock;
    expect(dailyRaceOpen(save)).toBe(true);
  });
});
