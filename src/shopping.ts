// What the results screen's buttons spend cash on (upgrades, rides, paint, a weapon for the next race) and the
// achievements paid out: each purchase pays, saves, is counted and redraws the screen.

import { buyUpgrade, chooseRide, type UpKey } from './career';
import { choosePaint, chooseHat, buyCarry } from './shop';
import { buyTune, repair } from './tune';
import { storeSave, type Save } from './meta';
import { unlock, type Unlocked } from './rewards';
import type { WeaponKind } from './sim/config';
import * as funnel from './funnel';
import * as platform from './platform';
import * as tele from './telemetry';
import { sfx } from './view/audio';

type Fields = Record<string, string | number | boolean>;

/** Count achievements just won (the caller shows them). */
export function counted(save: Save, got: Unlocked[]): Unlocked[] {
  for (const a of got) funnel.event('achievement', { id: a.id, n: save.ach.length, cash: a.pay });
  if (got.length) sfx.coin();
  return got;
}

/** The title card's "watch an ad, double today's streak pay" button. */
export function streakDouble(save: Save, btn: HTMLButtonElement, redraw: () => void): void {
  btn.onclick = () => {
    btn.disabled = true;
    void platform.showRewarded('streak_double').then((ok) => {
      if (ok && !save.streak.doubled) {
        save.cash += save.streak.pay;
        save.streak.doubled = true;
        storeSave(save);
        sfx.coin();
      }
      redraw();
    });
  };
}

/** The results screen's shop buttons; `got` hears of achievements a purchase won (owning every ride ..). */
export function shopActions(save: Save, redraw: () => void, got: (u: Unlocked[]) => void) {
  // 3.3.79: paints and hats come out of the show purse, so what a purchase cost is the drop across both
  // purses -- measuring `cash` alone would have priced every paint at $0 and gone through without a coin
  // sound or a `bought` of its own.
  const spend = (event: string, act: () => boolean, fields: (price: number) => Fields) => {
    const had = save.cash + save.show;
    if (!act()) return;
    const price = had - save.cash - save.show;
    funnel.event(event, { ...fields(price), price, cash: save.cash, show: save.show });
    if (price > 0) { tele.bought(); sfx.coin(); }
    got(counted(save, unlock(save)));
    storeSave(save);
    redraw();
  };
  return {
    buy: (k: UpKey) => spend('upgrade_purchased', () => buyUpgrade(save, k), () => ({ upgrade_id: k, level: save.up[k] })),
    ride: (v: number) => spend('ride_chosen', () => chooseRide(save, v), (p) => ({ ride: v, bought: p > 0 })),
    paint: (i: number) => spend('paint_chosen', () => choosePaint(save, i), (p) => ({ paint: i, bought: p > 0 })),
    hat: (i: number) => spend('hat_chosen', () => chooseHat(save, i), (p) => ({ hat: i, bought: p > 0 })),
    carry: (k: WeaponKind) => spend('weapon_bought', () => buyCarry(save, k), () => ({ weapon: k })),
    tune: (k: UpKey) => spend('tune_bought', () => buyTune(save, k), () => ({ upgrade_id: k, level: save.up[k] })),
    repair: () => spend('repair_bought', () => repair(save), () => ({ wear: 0 })),
  };
}
