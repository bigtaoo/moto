// The career ladder: each division is a cup of a few races scored on points; the top PROMOTE in the cup's
// standings go up a division. Pure functions over the save, so it can be tested without the game.

import * as C from './sim/config';

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

export const riderName = (id: number) => (id === 0 ? 'You' : C.ROSTER[id - 1]?.name ?? '?');

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
  bonus: number;
}

/** Close a finished cup: the player's rank, the bonus, and whether they go up (or won the top division). */
export function endCup(cup: Cup, div: number): CupEnd {
  const rank = standings(cup).find((s) => s.id === 0)!.rank;
  const top = rank <= C.PROMOTE;
  const last = div >= C.DIVISIONS.length - 1;
  const bonus = Math.round((CUP_BONUS[rank - 1] ?? 0) * C.DIVISIONS[div].prize);
  return { rank, promoted: top && !last, champion: last && rank === 1, bonus };
}
