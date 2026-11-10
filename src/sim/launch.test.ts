import { describe, expect, it } from 'vitest';
import { LAUNCH, Launch, launchCash } from './launch';
import { TICK_HZ } from './config';

/** Runs a round, letting go `before` metres before the lip (never, if null), steering with `steer`. */
function play(seed: number, before: number | null, steer = 0): Launch {
  const l = new Launch(seed);
  for (let i = 0; i < TICK_HZ * 60 && l.phase !== 'done'; i++) {
    if (l.phase === 'run' && before !== null && LAUNCH.lip - l.z <= before) l.input.release = true;
    l.input.steer = steer;
    l.step();
  }
  return l;
}

describe('launch', () => {
  it('a timed release flies further than a late one or an early one', () => {
    const timed = play(1, LAUNCH.sweet);
    const late = play(1, null);
    const early = play(1, 40);
    expect(timed.events.find((e) => e.type === 'release')).toMatchObject({ timed: true });
    expect(timed.power).toBeGreaterThan(0.95);
    expect(timed.dist).toBeGreaterThan(late.dist);
    expect(timed.dist).toBeGreaterThan(early.dist);
  });

  it('is the same round from the same seed and input', () => {
    const a = play(7, 5, 0.3);
    const b = play(7, 5, 0.3);
    expect(a.score).toBe(b.score);
    expect(a.tick).toBe(b.tick);
    expect(a.props.map((p) => p.hit)).toEqual(b.props.map((p) => p.hit));
  });

  it('always ends, inside the time limit', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const l = play(seed, seed % 3 === 0 ? null : seed % 9, ((seed % 5) - 2) / 2);
      expect(l.phase).toBe('done');
      expect(l.tick).toBeLessThanOrEqual(LAUNCH.maxT * TICK_HZ + 1);
    }
  });

  it('smashes props on the way and pays for them', () => {
    let smashed = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const l = play(seed, LAUNCH.sweet);
      smashed += l.smashed;
      expect(l.score).toBeGreaterThanOrEqual(Math.round(l.dist));
      expect(launchCash(l, 1)).toBe(Math.round(l.score * LAUNCH.cash));
    }
    expect(smashed).toBeGreaterThan(10);
  });

  it('lands a timed round in the prop field', () => {
    const l = play(3, LAUNCH.sweet);
    const land = l.z;
    expect(land).toBeGreaterThan(LAUNCH.field.from);
  });
});
