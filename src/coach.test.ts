import { describe, expect, it } from 'vitest';
import { SlapCoach, StartCoach, COACH_SLOW, COACH_LIMIT_S, COACH_TRIES, START_LIMIT_S, START_AT, type CoachReport, type StartReport } from './coach';

// 3.3.64: the desktop rookie's first slap, taught by force.

const make = () => {
  const out: CoachReport[] = [];
  return { c: new SlapCoach((r) => out.push(r)), out };
};

describe('the slap coach', () => {
  it('stays out of the way until it is armed and a rival is in reach', () => {
    const { c, out } = make();
    expect(c.frame(0.016, true)).toBe(1); // not armed: not a desktop rookie's first race
    c.arm(true);
    expect(c.frame(0.016, false)).toBe(1);
    expect(c.on).toBe(false);
    expect(out).toEqual([]);
  });

  it('slows the race while the card is up, and lets go on the slap', () => {
    const { c, out } = make();
    c.arm(true);
    expect(c.frame(0.5, true)).toBe(COACH_SLOW);
    expect(c.on).toBe(true);
    c.swung();
    expect(c.on).toBe(false);
    expect(c.frame(0.016, true)).toBe(1); // once is enough
    expect(out).toEqual([{ slapped: true, ms: 500, n: 1, early: false }]);
  });

  it('never holds the race for long: no key in time, and it runs on, and comes back at most a few times', () => {
    const { c, out } = make();
    c.arm(true);
    let t = 0;
    while (c.frame(0.1, true) !== 1) t += 0.1;
    expect(t).toBeLessThanOrEqual(COACH_LIMIT_S);
    for (let i = 0; i < 200; i++) c.frame(0.1, true);
    expect(out).toHaveLength(COACH_TRIES);
    expect(out.every((r) => !r.slapped)).toBe(true);
  });

  it('comes down when the rival drops out of reach, and asks again at the next one', () => {
    const { c, out } = make();
    c.arm(true);
    c.frame(0.2, true);
    expect(c.frame(0.2, false)).toBe(1);
    expect(out).toEqual([{ slapped: false, ms: 400, n: 1, early: false }]);
    expect(c.frame(0.1, true)).toBe(COACH_SLOW);
  });

  it('is not needed by a player who slaps before any rival is near, and says so once', () => {
    const { c, out } = make();
    c.arm(true);
    c.swung();
    expect(c.frame(0.016, true)).toBe(1);
    expect(out).toEqual([{ slapped: true, ms: 0, n: 0, early: true }]); // 3.3.65: the self-taught are counted too
    c.swung();
    expect(out).toHaveLength(1);
  });

  it('comes down without a report when the race ends under it', () => {
    const { c, out } = make();
    c.arm(true);
    c.frame(0.1, true);
    c.stop();
    expect(c.on).toBe(false);
    expect(out).toEqual([]);
  });
});


// 3.3.82: the first steer, asked for on the last beat of a new player's first countdown.

const start = () => {
  const out: StartReport[] = [];
  return { c: new StartCoach((r) => out.push(r)), out };
};

describe('the start coach', () => {
  it('lets the countdown run until its last beat, then holds it', () => {
    const { c, out } = start();
    expect(c.frame(0.016, true, START_AT, false)).toBe(false); // not armed
    c.arm(true);
    expect(c.frame(0.016, true, START_AT + 1, false)).toBe(false); // still beats to play
    expect(c.on).toBe(false);
    expect(c.frame(0.016, true, START_AT, false)).toBe(true);
    expect(c.on).toBe(true);
    expect(out).toEqual([]);
  });

  it('lets go on the first steer, and only asks once a race', () => {
    const { c, out } = start();
    c.arm(true);
    c.frame(0.5, true, START_AT, false);
    expect(c.frame(0.016, true, START_AT, true)).toBe(false);
    expect(c.on).toBe(false);
    expect(out).toEqual([{ steered: true, ms: 500, shown: true }]);
    expect(c.frame(0.016, true, START_AT, false)).toBe(false); // does not come back
    expect(out).toHaveLength(1);
  });

  it('reports the players who steer before the card, without ever showing it', () => {
    const { c, out } = start();
    c.arm(true);
    expect(c.frame(0.016, true, START_AT + 20, true)).toBe(false);
    expect(c.on).toBe(false);
    expect(out).toEqual([{ steered: true, ms: 0, shown: false }]);
  });

  it('never holds the start for long: no steer in time and the race goes anyway', () => {
    const { c, out } = start();
    c.arm(true);
    let t = 0;
    while (c.frame(0.1, true, START_AT, false)) t += 0.1;
    expect(t).toBeGreaterThan(0);
    expect(t).toBeLessThanOrEqual(START_LIMIT_S);
    expect(out).toEqual([{ steered: false, ms: Math.round(START_LIMIT_S * 1000), shown: true }]);
  });

  it('keeps the count still while the game is paused, and does not age the card', () => {
    const { c } = start();
    c.arm(true);
    c.frame(0.5, true, START_AT, false);
    for (let i = 0; i < 100; i++) expect(c.frame(0.1, false, START_AT, false)).toBe(true);
    expect(c.on).toBe(true); // ten seconds of pause did not spend the four it waits
    expect(c.frame(0.016, true, START_AT, true)).toBe(false);
  });

  it('stands down when GO came without it (a bot, or a race it was never armed for)', () => {
    const { c, out } = start();
    c.arm(true);
    expect(c.frame(0.016, true, 0, false)).toBe(false);
    expect(out).toEqual([]);
    expect(c.frame(0.016, true, START_AT, false)).toBe(false); // and stays down
  });
});
