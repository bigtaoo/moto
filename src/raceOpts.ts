// What a race is made of, from the save and which of the four modes is being ridden: the cup's next race,
// a security shift (src/shift.ts), a free race the player picked (src/free.ts) or the daily challenge
// (src/dailyRace.ts). Lifted out of main.ts in 3.3.69, where the modes no longer fitted on one line each.

import { isFinale } from './career';
import { fitted } from './tune';
import { raceMutator } from './sim/fun';
import { dailyOpts } from './dailyRace';
import { today } from './daily';
import type { WorldOpts } from './sim/types';
import type { Save } from './meta';
import type { Free } from './free';

/** `n`: which shift or free race of this session it is, so each gets a seed of its own. */
export interface RaceMode {
  chase: boolean;
  free: Free | null;
  /** Today's daily challenge (src/dailyRace.ts), which takes nothing at all from the save. */
  daily?: boolean;
  n: number;
  length?: number;
}

export function raceOpts(save: Save, m: RaceMode): WorldOpts {
  // the day's race is built from the day and nothing else: the same race for everyone who rides it
  if (m.daily) return { ...dailyOpts(today()), length: m.length };
  // a shift and a free race are both beside the career: no feuds, no weapon waiting for the next race,
  // no cup finale and no mutator. A free race is the stage the player picked instead of the cup's.
  const side = m.chase || m.free !== null;
  const seed = ((save.races * 7919 + 17) % 99991) + 1;
  const nem = side ? null : save.feud.nemesis;
  return {
    seed: m.chase ? seed + 5003 * m.n : m.free ? seed + 7919 * m.n : seed,
    chase: m.chase, upgrades: fitted(save, side), grudges: side ? [] : save.grudges, length: m.length,
    div: m.free ? m.free.div : save.div, tier: m.free ? m.free.tier : save.tier,
    // the "+N" levels past the career belong to its own top stage, not to a season ridden back through
    endless: m.free && m.free.tier < save.tier ? 0 : save.endless,
    rookie: side ? -1 : save.races, vehicle: save.garage.cur, nemesis: nem?.id,
    weapon: side ? undefined : save.carry ?? undefined,
    boss: !side && isFinale(save.cup),
    mutator: side ? undefined : raceMutator(save.cup.race, save.races, Date.now()),
  };
}
