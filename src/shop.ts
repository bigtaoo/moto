// What the results screen sells besides upgrades and rides: paint jobs and hats for the player's dummy (looks
// only, bought once and kept) and a weapon carried into the next race (bought per race, gone when it pays out).

import type { Save } from './meta';
import * as C from './sim/config';

export interface Paint {
  /** The dummy, the ride's paint and the target marks on the chest and head. */
  body: number;
  ride: number;
  mark: number;
  price: number;
}

/**
 * Index 0 is the stock paint every save starts with. Names are i18n keys `paint0`..
 *
 * 3.3.79: priced in show money (`save.show`), not cash -- see `wear` below for why. A career that never
 * plays to the crowd takes about $41k into that purse, so the whole wardrobe ($61,700) is out of reach on
 * race pay alone and the two trophies are what a showman has over a racer.
 */
export const PAINTS: readonly Paint[] = [
  { body: C.PLAYER_BODY, ride: C.PLAYER_RIDE, mark: 0xf4d23c, price: 0 },
  { body: 0xd83a2e, ride: 0xf2f2f2, mark: 0xffd23c, price: 400 },
  { body: 0x7fd6b4, ride: 0x2b2b33, mark: 0xff6fa8, price: 900 },
  { body: 0x3c3f58, ride: 0xe0602a, mark: 0x5fe0ff, price: 1600 },
  { body: 0xff8fc8, ride: 0x7a3cff, mark: 0xffffff, price: 5000 },
  { body: 0xd9b45a, ride: 0x1c1c22, mark: 0xe23b3b, price: 20000 },
];

/** Hats for the dummy (looks only, they wobble), bought once and kept. 0 is bare-headed. Names: `hat0`.. */
export const HATS = ['none', 'cap', 'party', 'top', 'cowboy', 'viking', 'cone'] as const;
export type Hat = (typeof HATS)[number];
export const HAT_PRICE = [0, 300, 600, 1100, 2800, 7000, 22000];

/**
 * The season (`save.tier`) each paint and hat goes on sale in. Once the upgrades are capped the later seasons
 * paid far more than their one ride cost (scripts/career.ts ended Legend $60–170k up with nothing to buy), and
 * every paint and hat was affordable by the middle of Pro; these give Pro and Legend something to save for.
 *
 * The gate alone was not enough. A Legend race pays 10.8x a Rookie one, so the shop still ran dry around race
 * 95 of ~145 and the last fifty races earned ~$330k with nothing on sale (see 3.3.25). The two tier-2 goods
 * and the last ride carry that whole season now: they are priced off what Legend actually pays, not off what
 * the Pro-era goods cost.
 *
 * 3.3.33: priced off what Legend actually pays, not what it looked like it might. At $110k and $120k the two
 * tier-2 goods were never bought in any run of scripts/career.ts -- a career ends around $60-100k spare, so
 * the collector's goal was not a long save, it was unreachable. They now land inside the last season.
 *
 * 3.3.79: and then they were never bought anyway, at any price, because cash has somewhere better to be
 * every single race (the tune-up). The gate stays -- it is what spaces the wardrobe over the seasons -- but
 * the money is the show purse now, which nothing else can spend.
 */
export const PAINT_TIER = [0, 0, 0, 0, 1, 2];
export const HAT_TIER = [0, 0, 0, 0, 1, 1, 2];

export type PaintState = 'on' | 'owned' | 'buy' | 'locked';
type Wardrobe = 'paint' | 'hat';
export const wearPrice = (k: Wardrobe, i: number) => (k === 'paint' ? PAINTS[i].price : HAT_PRICE[i]);
/** The season paint or hat `i` goes on sale in. */
export const wearTier = (k: Wardrobe, i: number) => (k === 'paint' ? PAINT_TIER[i] : HAT_TIER[i]);

export function wearState(save: Save, k: Wardrobe, i: number): PaintState {
  if (save[k].cur === i) return 'on';
  if (save[k].owned.includes(i)) return 'owned';
  return save.tier >= wearTier(k, i) ? 'buy' : 'locked';
}
/**
 * Buy (if need be, and affordable) and wear paint or hat `i`. Paid out of the show purse (`save.show`),
 * which only the looks tab can spend: 3.3.79's answer to a wardrobe that no probe career ever bought a
 * thing from. Against a tune-up that is worth a place next race, a paint job never wins an argument about
 * cash, so it stopped having that argument -- showing off pays for it instead (src/career.ts settleRace).
 */
export function wear(save: Save, k: Wardrobe, i: number): boolean {
  if (!Number.isInteger(i) || i < 0 || i >= (k === 'paint' ? PAINTS.length : HATS.length)) return false;
  const st = wearState(save, k, i);
  if (st === 'locked') return false;
  if (st === 'buy') {
    if (save.show < wearPrice(k, i)) return false;
    save.show -= wearPrice(k, i);
    save[k].owned.push(i);
  }
  save[k].cur = i;
  return true;
}
export const choosePaint = (save: Save, i: number) => wear(save, 'paint', i);
export const chooseHat = (save: Save, i: number) => wear(save, 'hat', i);

/** A weapon to start the next race with: bought per race, gone when the race is. Price at the first rung. */
export const CARRY: Record<C.WeaponKind, number> = { pan: 60, bat: 100, oil: 80 };

/**
 * 3.3.45: the price used to be the full purse multiplier, so a bat went from $100 to $1080 across the
 * career. What a race actually pays does not follow the purse -- the field gets harder at the same rate it
 * gets richer, so a capped player takes $1292 at the first rung and $2471 at the last, x1.9 against the
 * purse's x10.8. A top-rung bat was 44% of a race for one extra knockdown. `purse ** CARRY_CURVE` tracks
 * that x1.9 instead, holding the weapon at about 8% of a race's take all career.
 */
export const CARRY_CURVE = 0.3;

export const carryPrice = (save: Save, k: C.WeaponKind): number =>
  Math.round((CARRY[k] * C.stage(save.div, save.tier, save.endless).prize ** CARRY_CURVE) / 10) * 10;

/** Buy a weapon for the next race: one at a time, so not while one is already bought. */
export function buyCarry(save: Save, k: C.WeaponKind): boolean {
  const p = carryPrice(save, k);
  if (save.carry !== null || save.cash < p) return false;
  save.cash -= p;
  save.carry = k;
  return true;
}
