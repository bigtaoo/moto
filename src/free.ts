// The free race: the player picks the track instead of the cup picking it, and backs themselves with a
// stake on where they will finish. Nothing in the career moves -- no cup points, no promotion, no races
// count, no dailies, no achievements, no feud -- so the only thing on the line is the stake.
// 3.3.69: until this there was no way at all to decide which of the fifteen stages to ride; the cup said
// where you went, and a stage you liked was gone the moment its cup was won.

import * as C from './sim/config';
import * as L from './sim/ladder';
import type { World } from './sim/world';
import type { Save } from './meta';
import { reached } from './career';

/** A track the player can ride: a division of a season they have been in. */
export interface Scene {
  div: number;
  tier: number;
  name: string;
  /** The stage's purse, against which the odds are set. */
  prize: number;
  /** The odds the stake is paid at here, 1 at the stage the career is actually on. */
  edge: number;
  /** This is the stage the cup is at. */
  here: boolean;
}

/** A picked track and what was staked on it. */
export interface Free {
  div: number;
  tier: number;
  stake: number;
}

/** Free races open as the security shift does: with the first cup over, there is both a track to pick
 *  and cash to stake. */
export const freeOpen = (save: Save): boolean => save.races >= C.CHASE.unlock;

/** The purse of the stage the career is on: the yardstick for every other stage's odds. */
export const careerPrize = (save: Save): number => L.stage(save.div, save.tier, save.endless).prize;

/**
 * A stage below the one the career is on pays its share and no more: its purse against the career's.
 * Without this the first meadow would be the whole game's safest bet -- a field the player outgrew ten
 * divisions ago, paying the same 1.8x as the cup they can barely hold a place in.
 */
export const freeEdge = (prize: number, at: number): number => Math.round(Math.min(1, prize / at) * 10) / 10;

/** Every track open to the player: all of an earlier season, and this one as far as they have got. */
export function scenes(save: Save): Scene[] {
  const at = careerPrize(save);
  const out: Scene[] = [];
  for (let tier = 0; tier <= save.tier; tier++) {
    const last = tier < save.tier ? L.DIVISIONS.length - 1 : reached(save);
    for (let div = 0; div <= last; div++) {
      const st = L.stage(div, tier, tier === save.tier ? save.endless : 0);
      out.push({ div, tier, name: st.name, prize: st.prize, edge: freeEdge(st.prize, at), here: tier === save.tier && div === save.div });
    }
  }
  return out;
}

/** The share of the player's cash each stake is, and the least one worth taking. The small one is a
 *  cheap ticket back to a track the player liked; the big one is a real bet, never the whole purse. */
export const STAKES = [0.02, 0.1, 0.25];
export const STAKE_MIN = 100;

/** The three stakes on offer, in cash: a share of what the player has, so the bet keeps up with the
 *  career without ever being the whole of it. */
export const stakes = (cash: number): number[] =>
  STAKES.map((p) => Math.max(STAKE_MIN, Math.round((cash * p) / 100) * 100)).filter((s, i, a) => s <= cash && a.indexOf(s) === i);

/** What a place gives back, as a multiple of the stake. Below third the stake is gone. */
export const FREE_BACK = [1.8, 1.1, 0.7];

/** What a place pays back out of a stake, at a stage's odds. */
export const freePay = (stake: number, place: number, edge: number): number =>
  Math.round((stake * (FREE_BACK[place - 1] ?? 0) * edge) / 10) * 10;

export interface FreeResult {
  place: number;
  stake: number;
  /** What came back: 0 below third, so the whole stake is lost. */
  paid: number;
  name: string;
  kos: number;
  time: number;
}

/** Pay a free race's stake back into the save. The stake itself went when the race started. */
export function settleFree(save: Save, w: World, f: Free): FreeResult {
  const paid = freePay(f.stake, w.player.place, freeEdge(w.div.prize, careerPrize(save)));
  save.cash += paid;
  return { place: w.player.place, stake: f.stake, paid, name: w.div.name, kos: w.kos, time: w.time };
}
