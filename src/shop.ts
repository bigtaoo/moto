// What the results screen sells besides upgrades and rides: paint jobs for the player's dummy (looks only,
// bought once and kept) and a weapon carried into the next race (bought per race, gone when it pays out).

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

export type PaintState = 'on' | 'owned' | 'buy';

export function paintState(save: Save, i: number): PaintState {
  if (save.paint.cur === i) return 'on';
  return save.paint.owned.includes(i) ? 'owned' : 'buy';
}

/** Buy (if need be, and affordable) and wear paint `i`. */
export function choosePaint(save: Save, i: number): boolean {
  if (i < 0 || i >= PAINTS.length) return false;
  if (paintState(save, i) === 'buy') {
    if (save.cash < PAINTS[i].price) return false;
    save.cash -= PAINTS[i].price;
    save.paint.owned.push(i);
  }
  save.paint.cur = i;
  return true;
}

/** A weapon to start the next race with, priced at the stage's purse (it is worth more where the pay is). */
export const CARRY: Record<C.WeaponKind, number> = { pan: 60, bat: 100 };

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
