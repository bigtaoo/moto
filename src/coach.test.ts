import { describe, expect, it } from 'vitest';
import { SlapCoach, COACH_SLOW, COACH_LIMIT_S, COACH_TRIES, type CoachReport } from './coach';

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
    expect(out).toEqual([{ slapped: true, ms: 500, n: 1 }]);
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
    expect(out).toEqual([{ slapped: false, ms: 400, n: 1 }]);
    expect(c.frame(0.1, true)).toBe(COACH_SLOW);
  });

  it('is not needed by a player who slaps before any rival is near', () => {
    const { c, out } = make();
    c.arm(true);
    c.swung();
    expect(c.frame(0.016, true)).toBe(1);
    expect(out).toEqual([]);
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
