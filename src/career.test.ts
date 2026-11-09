import { describe, it, expect } from 'vitest';
import { newCup, scoreRace, standings, cupOver, endCup, CUP_RACES, POINTS, CUP_BONUS, newFeud, settleFeud, REVENGE_PAY, AHEAD_PAY, BREAK_PAY } from './career';
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

describe('nemesis', () => {
  const z = () => Array.from({ length: C.ROSTER.length + 1 }, () => 0);
  const race = (o: { ko?: [number, number][]; by?: [number, number][]; places?: number[] }) => {
    const r = { koPlayer: z(), koByPlayer: z(), places: o.places ?? [5, 1, 2, 3, 4, 6, 7, 8] };
    for (const [id, n] of o.ko ?? []) r.koPlayer[id] = n;
    for (const [id, n] of o.by ?? []) r.koByPlayer[id] = n;
    return r;
  };

  it('builds bad blood from knockdowns and beating the player home, and names a nemesis', () => {
    const f = newFeud();
    let out = settleFeud(f, race({ ko: [[3, 2]] }), 1); // 2 KOs (+4), finished ahead (+1)
    expect(f.beef[3]).toBe(5);
    expect(out.fresh).toBeNull();
    out = settleFeud(f, race({ ko: [[3, 1]], by: [[2, 1]] }), 1);
    expect(out.fresh).toBe(3);
    expect(f.nemesis).toEqual({ id: 3, hurt: 0, paid: 0 });
    expect(f.beef[3]).toBe(0);
    expect(f.beef[2]).toBe(1); // ahead +1 twice, knocked off once
  });

  it('pays revenge and beating them home, and breaks them after BREAK_AT', () => {
    const f = newFeud();
    f.nemesis = { id: 4, hurt: 0, paid: 0 };
    const first = [1, 2, 3, 4, 5, 6, 7, 8];
    let out = settleFeud(f, race({ by: [[4, 2]], ko: [[4, 1]], places: first }), 2);
    expect(out).toMatchObject({ vs: 4, revenge: 2, ahead: true, beaten: true, broken: false });
    expect(out.cash).toBe((2 * REVENGE_PAY + AHEAD_PAY) * 2);
    expect(f.nemesis).toEqual({ id: 4, hurt: 1, paid: 1 });
    // knocked off but home first: bounty, no progress
    out = settleFeud(f, race({ by: [[4, 3]], places: [8, 1, 2, 3, 4, 5, 6, 7] }), 1);
    expect(out).toMatchObject({ revenge: 3, ahead: false, beaten: false, cash: 3 * REVENGE_PAY });
    // ahead without a knockdown: no progress either
    expect(settleFeud(f, race({ places: first }), 1).beaten).toBe(false);
    expect(f.nemesis!.paid).toBe(1);
    settleFeud(f, race({ by: [[4, 1]], places: first }), 1);
    out = settleFeud(f, race({ by: [[4, 1]], ko: [[1, 9]], places: first }), 1);
    expect(out.broken).toBe(true);
    expect(out.cash).toBe(REVENGE_PAY + AHEAD_PAY + BREAK_PAY);
    expect(out.fresh).toBeNull(); // not straight after a break, even with plenty of bad blood around
    expect([f.nemesis, f.broken]).toEqual([null, 1]);
    expect(settleFeud(f, race({}), 1).fresh).toBe(1);
  });

  it('never lets bad blood go below zero', () => {
    const f = newFeud();
    settleFeud(f, race({ by: [[5, 3]], places: [1, 2, 3, 4, 5, 6, 7, 8] }), 1);
    expect(f.beef[5]).toBe(0);
  });
});
