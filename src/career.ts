// The career ladder: each division is a cup of a few races scored on points; the top PROMOTE in the cup's
// standings go up a division. Pure functions over the save, so it can be tested without the game.

import * as C from './sim/config';
import type { Save } from './meta';
import { t } from './i18n';

export const CUP_RACES = 4;
/** Cup points by finishing place. */
export const POINTS = [10, 8, 6, 5, 4, 3, 2, 1];
/** Cash for finishing the cup 1st/2nd/3rd, times the division's prize multiplier. */
export const CUP_BONUS = [1000, 600, 400];

export interface Cup {
  /** Races run in this cup so far. */
  race: number;
  /** Points per rider id (0 the player, 1.. the roster). */
  pts: number[];
}

export const newCup = (): Cup => ({ race: 0, pts: Array.from({ length: C.ROSTER.length + 1 }, () => 0) });

export const riderName = (id: number) => (id === 0 ? t('you') : C.ROSTER[id - 1]?.name ?? '?');

/** Add one race's finishing places (per rider id; 0 or missing: did not race) to the cup. */
export function scoreRace(cup: Cup, places: number[]): void {
  for (let id = 0; id < cup.pts.length; id++) {
    const p = places[id] ?? 0;
    if (p > 0) cup.pts[id] += POINTS[p - 1] ?? 0;
  }
  cup.race++;
}

export interface Standing {
  id: number;
  pts: number;
  rank: number;
}

/** The cup table, best first. Level on points, the player goes ahead (they earned it on the road too). */
export function standings(cup: Cup): Standing[] {
  const rows = cup.pts.map((pts, id) => ({ id, pts, rank: 0 }));
  rows.sort((a, b) => b.pts - a.pts || a.id - b.id);
  rows.forEach((r, i) => (r.rank = i + 1));
  return rows;
}

export const cupOver = (cup: Cup) => cup.race >= CUP_RACES;

export interface CupEnd {
  rank: number;
  promoted: boolean;
  champion: boolean;
  /** Champion of a tier with another after it: on to the next season, back at the first division. */
  nextTier: boolean;
  bonus: number;
}

/** Close a finished cup: the player's rank, the bonus, and whether they go up (or won the top division). */
export function endCup(cup: Cup, div: number, tier = 0, plus = 0): CupEnd {
  const rank = standings(cup).find((s) => s.id === 0)!.rank;
  const top = rank <= C.PROMOTE;
  const last = div >= C.DIVISIONS.length - 1;
  const bonus = Math.round((CUP_BONUS[rank - 1] ?? 0) * C.stage(div, tier, plus).prize);
  const champion = last && rank === 1;
  return { rank, promoted: top && !last, champion, nextTier: champion && tier < C.TIERS.length - 1, bonus };
}

/** What the race left behind, per rider id where it is a list (0 the player). Thugs are not in the lists. */
export interface RaceSummary {
  place: number;
  kos: number;
  grudgeKos: number;
  shoves: number;
  /** Flair cash (src/sim/flair.ts): near misses and KO chains. */
  nearPay: number;
  chainPay: number;
  fines: number;
  places: number[];
  koPlayer: number[];
  koByPlayer: number[];
  /** Rivals holding a grudge after the race. */
  grudges: number[];
}

export interface Settlement {
  prize: number;
  koBonus: number;
  grudgeBonus: number;
  shoveBonus: number;
  nearPay: number;
  chainPay: number;
  fines: number;
  feud: FeudOutcome;
  /** The race of the cup this was (1-based), and the cup's division and tier. */
  cupRace: number;
  div: number;
  tier: number;
  table: Standing[];
  end: CupEnd | null;
  earned: number;
}

/**
 * Pay out a race and move the career on: prize and bonuses, the cup table (and the cup's end: promotion,
 * the title, the next season), the feuds. Changes `save`; storing it is the caller's.
 */
export function settleRace(save: Save, s: RaceSummary): Settlement {
  const { div, tier } = save;
  const st = C.stage(div, tier, save.endless);
  const prize = Math.round((C.PRIZE[s.place - 1] ?? 0) * st.prize);
  const koBonus = s.kos * C.KO_BONUS;
  const grudgeBonus = s.grudgeKos * C.GRUDGE_BONUS;
  const shoveBonus = s.shoves * C.SHOVE_BONUS;
  let earned = Math.max(0, prize + koBonus + grudgeBonus + shoveBonus + s.nearPay + s.chainPay - s.fines);
  scoreRace(save.cup, s.places);
  const table = standings(save.cup);
  const feud = settleFeud(save.feud, s, st.prize);
  earned += feud.cash;
  const cupRace = save.cup.race;
  const end = cupOver(save.cup) ? endCup(save.cup, div, tier, save.endless) : null;
  if (end) {
    earned += end.bonus;
    if (end.promoted) save.div++;
    if (end.champion) save.titles++;
    // the last season won: each title from here raises the stakes (C.ENDLESS)
    if (end.champion && !end.nextTier) save.endless++;
    if (end.nextTier) {
      save.tier++;
      save.div = 0;
    }
    save.cup = newCup();
  }
  save.cash += earned;
  save.races++;
  if (save.best === 0 || s.place < save.best) save.best = s.place;
  save.grudges = [...s.grudges];
  save.carry = null;
  return { prize, koBonus, grudgeBonus, shoveBonus, nearPay: s.nearPay, chainPay: s.chainPay, fines: s.fines, feud, cupRace, div, tier, table, end, earned };
}

// ---- the garage --------------------------------------------------------------------------------

export type UpKey = 'top' | 'steer' | 'hp';

/** Price of the next level of an upgrade; null at the top, or at this season's cap (see `upgradeLock`). */
export const upgradePrice = (save: Save, k: UpKey): number | null =>
  save.up[k] >= C.UPGRADE_CAP[save.tier][k] ? null : C.upgradeCost(save.up[k]);

/** The season that opens the next level, when this one has it capped; null if open or maxed. */
export function upgradeLock(save: Save, k: UpKey): string | null {
  if (save.up[k] >= C.UPGRADE_MAX[k] || save.up[k] < C.UPGRADE_CAP[save.tier][k]) return null;
  const t = C.UPGRADE_CAP.findIndex((c) => c[k] > save.up[k]);
  return C.TIERS[t].name;
}

export function buyUpgrade(save: Save, k: UpKey): boolean {
  const p = upgradePrice(save, k);
  if (p === null || save.cash < p) return false;
  save.cash -= p;
  save.up[k]++;
  return true;
}

export type RideState = 'riding' | 'owned' | 'buy' | 'locked';

export function rideState(save: Save, v: number): RideState {
  if (save.garage.cur === v) return 'riding';
  if (save.garage.owned.includes(v)) return 'owned';
  return C.rung(save.div, save.tier) >= C.VEHICLES[v].rung ? 'buy' : 'locked';
}

/** Buy (if need be, and affordable) and ride vehicle `v`. */
export function chooseRide(save: Save, v: number): boolean {
  const st = rideState(save, v);
  if (st === 'locked') return false;
  if (st === 'buy') {
    const price = C.VEHICLES[v].price;
    if (save.cash < price) return false;
    save.cash -= price;
    save.garage.owned.push(v);
  }
  save.garage.cur = v;
  return true;
}

// ---- the nemesis -------------------------------------------------------------------------------
// Every rival keeps a tally of bad blood with the player: knocking them off and beating them home add
// to it, being knocked off takes it down. The first to reach NEMESIS_AT becomes the player's nemesis
// (one at a time): faster and keener in every race (C.NEMESIS), and worth a bounty each time the
// player knocks them off. Beating them outright in a race (knocking them off and finishing ahead) BREAK_AT
// times breaks them for good.

export const NEMESIS_AT = 6;
export const BREAK_AT = 3;
/** Cash, times the division's prize multiplier: per revenge KO, for beating them home, for breaking them. */
export const REVENGE_PAY = 150;
export const AHEAD_PAY = 100;
export const BREAK_PAY = 500;

export interface Nemesis {
  id: number;
  /** Times they knocked the player off, since they became the nemesis. */
  hurt: number;
  /** Races the player beat them outright in (knocked them off and finished ahead), towards BREAK_AT. */
  paid: number;
}

export interface Feud {
  /** Bad blood per rider id (0 unused). */
  beef: number[];
  nemesis: Nemesis | null;
  /** Nemeses broken. */
  broken: number;
}

export const newFeud = (): Feud => ({ beef: Array.from({ length: C.ROSTER.length + 1 }, () => 0), nemesis: null, broken: 0 });

/** One race, per rider id: KOs on the player, KOs by the player, finishing place (0: did not finish). */
export interface RaceFeud {
  koPlayer: number[];
  koByPlayer: number[];
  places: number[];
}

export interface FeudOutcome {
  /** The nemesis this race was against, if any. */
  vs: number | null;
  revenge: number;
  ahead: boolean;
  /** Knocked them off and beat them home: one towards breaking them. */
  beaten: boolean;
  broken: boolean;
  cash: number;
  /** A rival who just became the nemesis. */
  fresh: number | null;
}

/** Settle one race's feuds into `f` and say what it paid. */
export function settleFeud(f: Feud, r: RaceFeud, prizeMul: number): FeudOutcome {
  const out: FeudOutcome = { vs: null, revenge: 0, ahead: false, beaten: false, broken: false, cash: 0, fresh: null };
  const me = r.places[0] || 99;
  const n = f.nemesis;
  if (n) {
    out.vs = n.id;
    out.revenge = r.koByPlayer[n.id] ?? 0;
    out.ahead = (r.places[n.id] || 99) > me;
    n.hurt += r.koPlayer[n.id] ?? 0;
    out.beaten = out.revenge > 0 && out.ahead;
    if (out.beaten) n.paid++;
    out.cash += out.revenge * REVENGE_PAY + (out.ahead ? AHEAD_PAY : 0);
    if (n.paid >= BREAK_AT) {
      out.broken = true;
      out.cash += BREAK_PAY;
      f.broken++;
      f.beef[n.id] = 0;
      f.nemesis = null;
    }
  }
  for (let id = 1; id < f.beef.length; id++) {
    if (n && id === n.id) continue;
    const place = r.places[id] ?? 0;
    if (!place && !r.koPlayer[id] && !r.koByPlayer[id]) continue;
    const beat = place > 0 && place < me ? 1 : 0;
    f.beef[id] = Math.max(0, f.beef[id] + (r.koPlayer[id] ?? 0) * 2 + beat - (r.koByPlayer[id] ?? 0));
  }
  if (!f.nemesis && !out.broken) {
    let best = 0;
    for (let id = 1; id < f.beef.length; id++) if (f.beef[id] >= NEMESIS_AT && f.beef[id] > (f.beef[best] ?? 0)) best = id;
    if (best) {
      f.nemesis = { id: best, hurt: 0, paid: 0 };
      f.beef[best] = 0;
      out.fresh = best;
    }
  }
  out.cash = Math.round(out.cash * prizeMul);
  return out;
}
