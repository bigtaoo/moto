// The career ladder: each division is a cup of a few races scored on points; the top PROMOTE in the cup's
// standings go up a division. Pure functions over the save, so it can be tested without the game.

import * as C from './sim/config';
import { MUTATOR } from './sim/fun';
import type { Save } from './meta';
import { t } from './i18n';
import { dent } from './tune';

export const CUP_RACES = 4;
/**
 * 3.3.59: a new career's first cup is a race shorter. On the sandbox the first cup ended 10-16 minutes
 * in, past the point most sessions are over, so the cup's payoff (the podium, the bonus, the promotion)
 * landed after the player had gone. A rookie race takes about 150 s whatever its length (the player's
 * own falls set the time, not the road), so shortening the road did not move it: dropping a race does.
 */
export const FIRST_CUP = 3;
/** Cup points by finishing place. */
export const POINTS = [10, 8, 6, 5, 4, 3, 2, 1];
/** Cash for finishing the cup 1st/2nd/3rd, times the division's prize multiplier. */
export const CUP_BONUS = [1000, 600, 400];

export interface Cup {
  /** Races run in this cup so far. */
  race: number;
  /** Points per rider id (0 the player, 1.. the roster). */
  pts: number[];
  /** Races this cup runs to (FIRST_CUP for a new career's first one); absent in old saves: CUP_RACES. */
  of?: number;
}

export const newCup = (of = CUP_RACES): Cup => ({ race: 0, pts: Array.from({ length: C.ROSTER.length + 1 }, () => 0), ...(of !== CUP_RACES ? { of } : {}) });

/** How many races this cup runs to. */
export const cupRaces = (cup: Cup) => cup.of ?? CUP_RACES;

export const riderName = (id: number) => (id === 0 ? t('you') : C.ROSTER[id - 1]?.name ?? '?');

/**
 * The cup's last race -- the boss race, the one the game dresses up as the finale -- scores double. On
 * flat points 3.3.49 measured the finale as a dead rubber: the player went into it already promoted in
 * 58% of cups and already out in another 5%, so only 37% of finales were still worth riding.
 */
export const FINALE_PTS = 2;

/** Is the cup's next race the double-points finale? */
export const isFinale = (cup: Cup) => cup.race === cupRaces(cup) - 1;

/** Add one race's finishing places (per rider id; 0 or missing: did not race) to the cup. */
export function scoreRace(cup: Cup, places: number[]): void {
  const mult = isFinale(cup) ? FINALE_PTS : 1;
  for (let id = 0; id < cup.pts.length; id++) {
    const p = places[id] ?? 0;
    if (p > 0) cup.pts[id] += (POINTS[p - 1] ?? 0) * mult;
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

export const cupOver = (cup: Cup) => cup.race >= cupRaces(cup);

/**
 * 3.3.59: what the cup asks of the player next, in one line: the points between them and the places that
 * move the career on. That is the top PROMOTE, except in a season's last division, which promotes nobody:
 * there 1st takes the title, and so does the top PROMOTE once the gate is one cup away (see `endCup`).
 * `gap` 0: they are in those places. Level on points the player is ahead (see `standings`), so the gap is
 * the rider at the line's points minus theirs. Null before the cup's first race, when everyone has
 * nothing, and when the races left cannot close the gap: a target out of reach is no reason to ride on.
 */
export function cupGoal(cup: Cup, div: number, gate = 0): CupGoal | null {
  if (cup.race === 0) return null;
  const line = div >= C.DIVISIONS.length - 1 && gate + 1 < GATE_AT ? 1 : C.PROMOTE;
  const table = standings(cup);
  const me = table.find((s) => s.id === 0)!;
  if (me.rank <= line) return { gap: 0, line };
  const gap = table.filter((s) => s.id !== 0)[line - 1].pts - me.pts;
  let left = 0;
  for (let r = cup.race; r < cupRaces(cup); r++) left += POINTS[0] * (r === cupRaces(cup) - 1 ? FINALE_PTS : 1);
  return gap > left ? null : { gap, line };
}

export interface CupGoal {
  gap: number;
  /** The place the player has to be at or above: 1 or C.PROMOTE. */
  line: number;
}

/** The goal as the card says it. */
export const goalText = (g: CupGoal): string =>
  g.line === 1 ? (g.gap ? t('goalWin', { n: g.gap }) : t('goalLead')) : g.gap ? t('goalUp', { n: g.gap }) : t('goalHold');

export interface CupEnd {
  rank: number;
  promoted: boolean;
  champion: boolean;
  /** Champion of a tier with another after it: on to the next season, back at the first division. */
  nextTier: boolean;
  bonus: number;
  /** This was the tier's last division, where finishing 2nd or 3rd does not promote. */
  last: boolean;
  /** Won on the second top-three cup in a row rather than outright (see `gate`). */
  onGate: boolean;
  /** Top-three cups in a row at the last division, carried to the next one (see `gate`). */
  gateNext: number;
}

/**
 * The last division of a season promotes nobody: only its champion moves the career on. Until 3.3.34 a
 * player who kept finishing 2nd there replayed the same four races forever -- scripts/career.ts had one
 * take 2nd five cups running, fifty minutes for nothing, while the card still read "top 3 go up". So the
 * second top-three cup in a row counts as a win too: `gate` carries those near misses between cups.
 */
export const GATE_AT = 2;

/** Close a finished cup: the player's rank, the bonus, and whether they go up (or won the top division). */
export function endCup(cup: Cup, div: number, tier = 0, plus = 0, gate = 0): CupEnd {
  const rank = standings(cup).find((s) => s.id === 0)!.rank;
  const top = rank <= C.PROMOTE;
  const last = div >= C.DIVISIONS.length - 1;
  const bonus = Math.round((CUP_BONUS[rank - 1] ?? 0) * C.stage(div, tier, plus).prize);
  const onGate = last && rank > 1 && top && gate + 1 >= GATE_AT;
  const champion = last && (rank === 1 || onGate);
  const gateNext = last && top && !champion ? gate + 1 : 0;
  return { rank, promoted: top && !last, champion, nextTier: champion && tier < C.TIERS.length - 1, bonus, last, onGate, gateNext };
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
  /** Bowling, taunts and the boss' bounty (src/sim/stunts.ts). */
  stuntPay?: number;
  /** The weekly mutator was on: the prize is MUTATOR.prize times. */
  mutator?: boolean;
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
  stuntPay: number;
  /** What the showing off paid into the wardrobe's own purse: near misses, chains, stunts (3.3.79). */
  show: number;
  fines: number;
  feud: FeudOutcome;
  /** The race of the cup this was (1-based), the races the cup ran to, and the cup's division and tier. */
  cupRace: number;
  cupOf: number;
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
  const prize = Math.round((C.PRIZE[s.place - 1] ?? 0) * st.prize * (s.mutator ? MUTATOR.prize : 1));
  const stuntPay = s.stuntPay ?? 0;
  const koBonus = s.kos * C.KO_BONUS;
  const grudgeBonus = s.grudgeKos * C.GRUDGE_BONUS;
  const shoveBonus = s.shoves * C.SHOVE_BONUS;
  /**
   * 3.3.79: the showing off is paid into a purse of its own. Near misses, KO chains, riders bowled over,
   * taunts and the boss' bounty are the only money paints and hats take, and they are no longer part of
   * the race's own pay -- so the purse the tune-up is bleeding is about a tenth lighter than it was, and
   * the one thing on sale that a player can show anyone is bought by playing to the crowd.
   */
  const show = s.nearPay + s.chainPay + stuntPay;
  let earned = Math.max(0, prize + koBonus + grudgeBonus + shoveBonus - s.fines);
  scoreRace(save.cup, s.places);
  const table = standings(save.cup);
  const feud = settleFeud(save.feud, s, st.prize);
  earned += feud.cash;
  const cupRace = save.cup.race;
  const cupOf = cupRaces(save.cup);
  const end = cupOver(save.cup) ? endCup(save.cup, div, tier, save.endless, save.gate) : null;
  if (end) {
    earned += end.bonus;
    save.gate = end.gateNext;
    if (end.promoted) save.div++;
    if (end.champion) save.titles++;
    // the last season won: each title from here raises the stakes (C.ENDLESS)
    if (end.champion && !end.nextTier) save.endless++;
    if (end.nextTier) {
      save.tier++;
      save.div = 0;
      save.reach = 0;
    }
    save.reach = Math.max(save.reach, save.div);
    save.cup = newCup();
  }
  save.cash += earned;
  save.show += show;
  save.races++;
  if (save.best === 0 || s.place < save.best) save.best = s.place;
  save.grudges = [...s.grudges];
  save.carry = null;
  // the tune-up rode in this race and the ride took what it took: both are settled here, with the money
  dent(save, s.koPlayer.reduce((a, b) => a + b, 0));
  save.tune = { top: 0, steer: 0, hp: 0 };
  return { prize, koBonus, grudgeBonus, shoveBonus, nearPay: s.nearPay, chainPay: s.chainPay, stuntPay, show, fines: s.fines, feud, cupRace, cupOf, div, tier, table, end, earned };
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

/** The highest division reached this season. A save from before 3.3.69 is wherever it stands. */
export const reached = (save: Save): number => Math.max(save.div, save.reach);

/**
 * Run the next cup at another division of this season. Only between cups, and only somewhere already
 * reached: the ladder is still climbed in order, but a division once won stays open, so a player who
 * likes the Dust Bowl is not sent away from it for good by winning there (3.3.69).
 */
export function pickDiv(save: Save, div: number): boolean {
  if (save.cup.race > 0 || div < 0 || div > reached(save) || div === save.div) return false;
  save.div = div;
  return true;
}

export type RideState = 'riding' | 'owned' | 'buy' | 'locked';

export function rideState(save: Save, v: number): RideState {
  if (save.garage.cur === v) return 'riding';
  if (save.garage.owned.includes(v)) return 'owned';
  // what the career has reached, not where this cup happens to be run: dropping back a division to race
  // somewhere else must not take the next ride off the shelf
  return C.rung(reached(save), save.tier) >= C.VEHICLES[v].rung ? 'buy' : 'locked';
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
// Every rival keeps a tally of bad blood with the player: knocking the player off counts double, beating
// them home or being knocked off by them counts one. The bad blood is mutual -- until 3.3.33 the player's
// own knockdowns cancelled it out, so a player who fought well never earned a nemesis at all (the first
// appeared at race 62-76 of an 80-96 race career). That fix overshot: with nothing taking the tally down
// the whole field crossed the line in the first two races, so 3.3.46 made it fade (BEEF_FADE), raised the
// line and put a cooling-off on the rest of the field when one is broken (COOL). The first to reach
// NEMESIS_AT becomes the player's nemesis
// (one at a time): faster and keener in every race (C.NEMESIS), and worth a bounty each time the
// player knocks them off. Beating them outright in a race (knocking them off and finishing ahead) BREAK_AT
// times breaks them for good.

export const NEMESIS_AT = 24;
/** Bad blood fades by this much each race: a rivalry is who you have been tangling with lately. */
export const BEEF_FADE = 0.95;
export const BREAK_AT = 4;
/** Breaking one settles the score with the whole field: everyone else's bad blood is cut to this share. */
export const COOL = 0.5;
/** Cash, times the division's prize multiplier: per revenge KO, for beating them home, for breaking them. */
export const REVENGE_PAY = 60;
export const AHEAD_PAY = 50;
export const BREAK_PAY = 300;

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
      for (let id = 1; id < f.beef.length; id++) f.beef[id] = Math.floor(f.beef[id] * COOL);
    }
  }
  for (let id = 1; id < f.beef.length; id++) {
    if (n && id === n.id) continue;
    f.beef[id] = Math.floor(f.beef[id] * BEEF_FADE);
    const place = r.places[id] ?? 0;
    if (!place && !r.koPlayer[id] && !r.koByPlayer[id]) continue;
    const beat = place > 0 && place < me ? 1 : 0;
    f.beef[id] = f.beef[id] + (r.koPlayer[id] ?? 0) * 2 + beat + (r.koByPlayer[id] ?? 0);
  }
  if (!f.nemesis && !out.broken) {
    let best = 0;
    for (let id = 1; id < f.beef.length; id++) if (f.beef[id] >= NEMESIS_AT && f.beef[id] > f.beef[best]) best = id;
    if (best) {
      f.nemesis = { id: best, hurt: 0, paid: 0 };
      f.beef[best] = 0;
      out.fresh = best;
    }
  }
  out.cash = Math.round(out.cash * prizeMul);
  return out;
}
