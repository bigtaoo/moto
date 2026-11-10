// A security shift's settlement (the sim side is src/sim/chase.ts): a bounty for each runner caught, a bonus
// for the lot, at the stage's prize multiplier. It isn't a race: no cup points, races count, dailies or
// achievements, and a weapon bought for the next race stays bought.

import { CHASE } from './sim/config';
import { shiftPay } from './sim/chase';
import type { World } from './sim/world';
import type { Save } from './meta';

export interface ShiftResult {
  caught: number;
  of: number;
  bounty: number;
  sweep: number;
  earned: number;
  time: number;
}

/** Pay the shift into the save. */
export function settleShift(save: Save, w: World): ShiftResult {
  const of = w.racers - 1;
  const earned = shiftPay(w.caught, of, w.div.prize);
  const bounty = Math.round(w.caught * CHASE.bounty * w.div.prize);
  save.cash += earned;
  return { caught: w.caught, of, bounty, sweep: earned - bounty, earned, time: w.time };
}

/** Shifts open up once the player knows the game. */
export const shiftOpen = (save: Save): boolean => save.races >= CHASE.unlock;
