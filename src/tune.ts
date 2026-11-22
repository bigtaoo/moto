// Where a race's money goes once the garage has sold everything it has (3.3.70). Two things that never
// run out: a tune-up that lasts one race and ignores the season's cap, and the dents the ride picks up,
// which cost money to beat out. Both are priced off the stage, like the weapon in src/shop.ts, so they
// stay the same bite out of a race's take from the first division to the last.
//
// Why they were needed: a career is 63 races, and a probe of one (scripts/career.ts) found upgrades on
// sale in 7 of them and a ride in 5. The other 51 had nothing but paint, and the career ended with
// $120,566 in the bank and nothing to spend it on.

import type { Save } from './meta';
import type { UpKey } from './career';
import type { Upgrades } from './sim/types';
import * as C from './sim/config';

/** The stage's purse, which both prices below are charged in. */
const purse = (save: Save): number => C.stage(save.div, save.tier, save.endless).prize;

/**
 * Prices here follow src/shop.ts's weapon: `purse ** CURVE` rather than the purse itself. The purse
 * multiplies x10.8 up the ladder but what a race actually pays only about x2.9 -- the field gets harder
 * at the same rate it gets richer -- so a price written in the purse's money would start cheap and end
 * unaffordable. At 0.45 the whole tune-up is about what one race pays, all career.
 */
export const TUNE_CURVE = 0.45;

/** First-division price of one race's tune-up, by stat. Toughness is dearest: it is the one that stops a fall. */
export const TUNE: Record<UpKey, number> = { top: 600, steer: 500, hp: 800 };

export const tunePrice = (save: Save, k: UpKey): number =>
  Math.round((TUNE[k] * purse(save) ** TUNE_CURVE) / 10) * 10;

/** Fit a stat for the next race: one level, past the season's cap and past the garage's last one. */
export function buyTune(save: Save, k: UpKey): boolean {
  const p = tunePrice(save, k);
  if (save.tune[k] || save.cash < p) return false;
  save.cash -= p;
  save.tune[k] = 1;
  return true;
}

/** What is fitted for the next race, for the garage's badge and the results' line. */
export const tuneSpent = (save: Save): number =>
  (Object.keys(TUNE) as UpKey[]).filter((k) => save.tune[k]).length;

// ---- the dents ---------------------------------------------------------------------------------
/**
 * From the second season on, a ride remembers being knocked off: every knockdown dents it, and a dented
 * ride is slower, vaguer and softer until it is fixed. Not before then -- a rookie already falls seven
 * times in a losing race (3.3.68), and billing them for it is the opposite of what that round was for.
 * It is capped at 1 (a wreck), which costs the ride WEAR_BITE levels of everything.
 */
export const WEAR_AT = 1;
export const WEAR_PER_KO = 0.06;
export const WEAR_BITE = 2;
/** First-division price of beating out a wrecked ride; a half-wrecked one is half of it. */
export const REPAIR_FULL = 900;

/** Add a race's knockdowns to the ride's dents. Before WEAR_AT nothing marks it. */
export function dent(save: Save, kos: number): void {
  if (save.tier < WEAR_AT) return;
  save.wear = Math.min(1, save.wear + WEAR_PER_KO * kos);
}

export const repairPrice = (save: Save): number =>
  Math.round((REPAIR_FULL * save.wear * purse(save) ** TUNE_CURVE) / 10) * 10;

export function repair(save: Save): boolean {
  const p = repairPrice(save);
  if (save.wear <= 0 || save.cash < p) return false;
  save.cash -= p;
  save.wear = 0;
  return true;
}

/**
 * What the next race is actually riding: the garage's levels, plus the tune-up if this race is the one
 * it was bought for, less the dents. `side` is a shift or a free race, which the tune-up does not ride
 * in and is not spent on -- the same rule the carried weapon has had since 3.3.45.
 */
export function fitted(save: Save, side: boolean): Upgrades {
  const bite = save.wear * WEAR_BITE;
  const one = (k: UpKey): number => Math.max(0, save.up[k] + (side ? 0 : save.tune[k]) - bite);
  return { top: one('top'), steer: one('steer'), hp: one('hp') };
}
