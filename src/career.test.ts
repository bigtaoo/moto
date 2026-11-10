import { describe, it, expect } from 'vitest';
import { newCup, scoreRace, standings, cupOver, endCup, CUP_RACES, POINTS, CUP_BONUS, newFeud, settleFeud, REVENGE_PAY, AHEAD_PAY, BREAK_PAY, settleRace, buyUpgrade, upgradePrice, upgradeLock, rideState, chooseRide, type RaceSummary } from './career';
import { parseSave } from './meta';
import { PAINTS, choosePaint, buyCarry, carryPrice } from './shop';
import { World } from './sim/world';
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

describe('career settlement, seasons and the garage', () => {
  const summary = (place: number, extra: Partial<RaceSummary> = {}): RaceSummary => ({
    place, kos: 0, grudgeKos: 0, shoves: 0, nearPay: 0, chainPay: 0, fines: 0, grudges: [], places: places(place),
    koPlayer: Array(C.ROSTER.length + 1).fill(0), koByPlayer: Array(C.ROSTER.length + 1).fill(0), ...extra,
  });

  it('pays the race at the stage purse and moves the cup on', () => {
    const save = parseSave(null);
    save.tier = 1;
    const s = settleRace(save, summary(1, { kos: 2, fines: 50 }));
    expect(s.prize).toBe(Math.round(C.PRIZE[0] * C.stage(0, 1).prize));
    expect(s.earned).toBe(s.prize + 2 * C.KO_BONUS - 50 + s.feud.cash);
    expect(save.cash).toBe(s.earned);
    expect(save.races).toBe(1);
    expect(save.cup.race).toBe(1);
    expect(s.end).toBeNull();
  });

  it('starts the next season at the first division after the top title, and stops at the last', () => {
    const save = parseSave(null);
    save.div = C.DIVISIONS.length - 1;
    let s;
    for (let i = 0; i < CUP_RACES; i++) s = settleRace(save, summary(1));
    expect(s!.end!.champion).toBe(true);
    expect(s!.end!.nextTier).toBe(true);
    expect(save.tier).toBe(1);
    expect(save.div).toBe(0);
    expect(save.titles).toBe(1);
    expect(save.cup.race).toBe(0);

    save.tier = C.TIERS.length - 1;
    save.div = C.DIVISIONS.length - 1;
    for (let i = 0; i < CUP_RACES; i++) s = settleRace(save, summary(1));
    expect(s!.end!.champion).toBe(true);
    expect(s!.end!.nextTier).toBe(false);
    expect(save.tier).toBe(C.TIERS.length - 1);
    expect(save.div).toBe(C.DIVISIONS.length - 1);
    expect(save.endless).toBe(1);
  });

  it('raises the stakes with every title past the career', () => {
    const save = parseSave(null);
    save.tier = C.TIERS.length - 1;
    save.div = C.DIVISIONS.length - 1;
    const base = C.stage(save.div, save.tier);
    for (let n = 1; n <= 3; n++) for (let i = 0; i < CUP_RACES; i++) settleRace(save, summary(1));
    expect(save.endless).toBe(3);
    const st = C.stage(save.div, save.tier, save.endless);
    expect(st.name).toBe(`${base.name} +3`);
    expect(st.top).toBeGreaterThan(base.top);
    expect(st.prize).toBeGreaterThan(base.prize);
    expect(st.hp).toBe(base.hp + 1);
    // the +N is the last season's only
    expect(C.stage(0, 0, 5)).toEqual(C.stage(0, 0));
    // a lost cup holds the level
    for (let i = 0; i < CUP_RACES; i++) settleRace(save, summary(8));
    expect(save.endless).toBe(3);
  });

  it('caps upgrades per season and names the season that opens the next level', () => {
    const save = parseSave(null);
    save.cash = 1e7;
    while (buyUpgrade(save, 'top'));
    expect(save.up.top).toBe(C.UPGRADE_CAP[0].top);
    expect(upgradePrice(save, 'top')).toBeNull();
    expect(upgradeLock(save, 'top')).toBe(C.TIERS[1].name);
    save.tier = C.TIERS.length - 1;
    while (buyUpgrade(save, 'top'));
    expect(save.up.top).toBe(C.UPGRADE_MAX.top);
    expect(upgradeLock(save, 'top')).toBeNull();
  });

  it('opens rides by rung, buys them once and swaps between owned ones for free', () => {
    const save = parseSave(null);
    const v = 1;
    expect(rideState(save, 0)).toBe('riding');
    expect(rideState(save, v)).toBe('locked');
    expect(chooseRide(save, v)).toBe(false);
    save.div = C.VEHICLES[v].rung;
    expect(rideState(save, v)).toBe('buy');
    expect(chooseRide(save, v)).toBe(false); // no cash
    save.cash = C.VEHICLES[v].price + 5;
    expect(chooseRide(save, v)).toBe(true);
    expect(save.cash).toBe(5);
    expect(save.garage).toEqual({ cur: v, owned: [0, v] });
    expect(chooseRide(save, 0)).toBe(true);
    expect(rideState(save, v)).toBe('owned');
    expect(chooseRide(save, v)).toBe(true);
    expect(save.cash).toBe(5);
  });

  it('reads old saves without seasons or a garage, and clamps bad ones', () => {
    const old = parseSave(JSON.stringify({ cash: 900, up: { top: 9, steer: 2, hp: 1 }, div: 3 }));
    expect(old.tier).toBe(0);
    expect(old.garage).toEqual({ cur: 0, owned: [0] });
    expect(old.up.top).toBe(C.UPGRADE_MAX.top > 9 ? 9 : C.UPGRADE_MAX.top);
    const bad = parseSave(JSON.stringify({ tier: 99, up: { top: 99 }, garage: { cur: 3, owned: [2, 2, 99, -1, 'x'] } }));
    expect(bad.tier).toBe(C.TIERS.length - 1);
    expect(bad.up.top).toBe(C.UPGRADE_MAX.top);
    expect(bad.garage).toEqual({ cur: 0, owned: [0, 2] });
  });

  it('sells paint once and a weapon per race, and starts that race with it', () => {
    const save = parseSave(null);
    expect(choosePaint(save, 1)).toBe(false); // no cash
    save.cash = PAINTS[1].price + carryPrice(save, 'bat') + 10;
    expect(choosePaint(save, 1)).toBe(true);
    expect(save.paint).toEqual({ cur: 1, owned: [0, 1] });
    expect(choosePaint(save, 0)).toBe(true);
    expect(choosePaint(save, 1)).toBe(true);
    expect(buyCarry(save, 'bat')).toBe(true);
    expect(buyCarry(save, 'pan')).toBe(false); // one at a time
    expect(save.cash).toBe(10);
    const w = new World({ seed: 3, weapon: save.carry ?? undefined });
    expect(w.player.weapon).toBe('bat');
    expect(new World({ seed: 3 }).player.weapon).toBeNull();
    settleRace(save, summary(4));
    expect(save.carry).toBeNull();
    const back = parseSave(JSON.stringify({ ...save, carry: 'pan', paint: { cur: 9, owned: [1, 1, 99] } }));
    expect(back.carry).toBe('pan');
    expect(back.paint).toEqual({ cur: 0, owned: [0, 1] });
    expect(parseSave(JSON.stringify({ carry: 'toString' })).carry).toBeNull();
  });
});
