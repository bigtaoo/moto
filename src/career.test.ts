import { describe, it, expect } from 'vitest';
import { newCup, scoreRace, standings, cupOver, endCup, CUP_RACES, POINTS, CUP_BONUS } from './career';
import * as C from './sim/config';

/** Places for the player and the roster: the player at `me`, the rivals filling the rest in id order. */
function places(me: number): number[] {
  const out = [me];
  let p = 1;
  for (let id = 1; id <= C.ROSTER.length; id++) {
    if (p === me) p++;
    out.push(p++);
  }
  return out;
}

describe('career cup', () => {
  it('adds points by place and counts the races', () => {
    const cup = newCup();
    scoreRace(cup, places(2));
    expect(cup.pts[0]).toBe(POINTS[1]);
    expect(cup.pts[1]).toBe(POINTS[0]);
    expect(cup.race).toBe(1);
    expect(cupOver(cup)).toBe(false);
  });

  it('promotes a top-3 finisher with a bonus, and holds back the rest', () => {
    const good = newCup();
    for (let i = 0; i < CUP_RACES; i++) scoreRace(good, places(2));
    expect(cupOver(good)).toBe(true);
    const e = endCup(good, 1);
    expect(e.rank).toBeLessThanOrEqual(3);
    expect(e.promoted).toBe(true);
    expect(e.bonus).toBe(Math.round(CUP_BONUS[e.rank - 1] * C.DIVISIONS[1].prize));

    const bad = newCup();
    for (let i = 0; i < CUP_RACES; i++) scoreRace(bad, places(6));
    const b = endCup(bad, 1);
    expect(b.promoted).toBe(false);
    expect(b.bonus).toBe(0);
  });

  it('crowns the champion in the top division instead of promoting', () => {
    const cup = newCup();
    for (let i = 0; i < CUP_RACES; i++) scoreRace(cup, places(1));
    const e = endCup(cup, C.DIVISIONS.length - 1);
    expect(e).toMatchObject({ rank: 1, promoted: false, champion: true });
    expect(standings(cup)[0].id).toBe(0);
  });
});
