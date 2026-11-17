// A security shift's settlement (the sim side is src/sim/chase.ts): a bounty for each runner caught, a bonus
// for the lot, at the stage's prize multiplier. It isn't a race: no cup points, races count, dailies or
// achievements, and a weapon bought for the next race stays bought.

import * as C from './sim/config';
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
  const bounty = w.caught * bountyPay(w.div.prize);
  save.cash += earned;
  return { caught: w.caught, of, bounty, sweep: earned - bounty, earned, time: w.time };
}

/** Shifts open up once the player knows the game. */
export const shiftOpen = (save: Save): boolean => save.races >= C.CHASE.unlock;

/**
 * What a shift pays, against the stage's purse: a bounty per runner caught, a bonus for catching the lot.
 * The purse multiplies elevenfold across the ladder while a race's take to the player barely doubles, so the
 * shift follows `prize ** curve` instead -- otherwise a Legend shift paid three times a race per minute
 * while the first one ever offered paid a quarter of one (3.3.47).
 */
export const shiftMult = (prize: number): number => prize ** C.CHASE.curve;

/** The bounty on one runner at this stage: what the catch flash and the shift button quote. */
export const bountyPay = (prize: number): number => Math.round(C.CHASE.bounty * shiftMult(prize));

export function shiftPay(caught: number, of: number, prize: number): number {
  return Math.round((caught * C.CHASE.bounty + (caught >= of && of > 0 ? C.CHASE.sweep : 0)) * shiftMult(prize));
}
