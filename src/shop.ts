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

/** Index 0 is the stock paint every save starts with. Names are i18n keys `paint0`.. */
export const PAINTS: readonly Paint[] = [
  { body: C.PLAYER_BODY, ride: C.PLAYER_RIDE, mark: 0xf4d23c, price: 0 },
  { body: 0xd83a2e, ride: 0xf2f2f2, mark: 0xffd23c, price: 800 },
  { body: 0x7fd6b4, ride: 0x2b2b33, mark: 0xff6fa8, price: 1500 },
  { body: 0x3c3f58, ride: 0xe0602a, mark: 0x5fe0ff, price: 2500 },
  { body: 0xff8fc8, ride: 0x7a3cff, mark: 0xffffff, price: 4000 },
  { body: 0xd9b45a, ride: 0x1c1c22, mark: 0xe23b3b, price: 7000 },
];

/** Hats for the dummy (looks only, they wobble), bought once and kept. 0 is bare-headed. Names: `hat0`.. */
export const HATS = ['none', 'cap', 'party', 'top', 'cowboy', 'viking', 'cone'] as const;
export type Hat = (typeof HATS)[number];
export const HAT_PRICE = [0, 600, 1000, 1800, 2800, 4500, 6500];

export type PaintState = 'on' | 'owned' | 'buy';
type Wardrobe = 'paint' | 'hat';
const priceOf = (k: Wardrobe, i: number) => (k === 'paint' ? PAINTS[i].price : HAT_PRICE[i]);

export function wearState(save: Save, k: Wardrobe, i: number): PaintState {
  if (save[k].cur === i) return 'on';
  return save[k].owned.includes(i) ? 'owned' : 'buy';
}
export const paintState = (save: Save, i: number) => wearState(save, 'paint', i);

/** Buy (if need be, and affordable) and wear paint or hat `i`. */
export function wear(save: Save, k: Wardrobe, i: number): boolean {
  if (!Number.isInteger(i) || i < 0 || i >= (k === 'paint' ? PAINTS.length : HATS.length)) return false;
  if (wearState(save, k, i) === 'buy') {
    if (save.cash < priceOf(k, i)) return false;
    save.cash -= priceOf(k, i);
    save[k].owned.push(i);
  }
  save[k].cur = i;
  return true;
}
export const choosePaint = (save: Save, i: number) => wear(save, 'paint', i);
export const chooseHat = (save: Save, i: number) => wear(save, 'hat', i);

/** A weapon to start the next race with, priced at the stage's purse (it is worth more where the pay is). */
export const CARRY: Record<C.WeaponKind, number> = { pan: 60, bat: 100, oil: 80 };

export const carryPrice = (save: Save, k: C.WeaponKind): number =>
  Math.round(CARRY[k] * C.stage(save.div, save.tier, save.endless).prize);

/** Buy a weapon for the next race: one at a time, so not while one is already bought. */
export function buyCarry(save: Save, k: C.WeaponKind): boolean {
  const p = carryPrice(save, k);
  if (save.carry !== null || save.cash < p) return false;
  save.cash -= p;
  save.carry = k;
  return true;
}
