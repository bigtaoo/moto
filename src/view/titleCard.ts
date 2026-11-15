// The title card's live parts: where the player stands, the streak's double-up ad, the security shift,
// the dummy launch and the leaderboard. Drawn again whenever one of them changes something.

import { titleInfo } from './title';
import { wireBoard } from './board';
import { streakDouble } from '../shopping';
import { CUP_RACES } from '../career';
import { today } from '../daily';
import * as C from '../sim/config';
import * as platform from '../platform';
import * as tele from '../telemetry';
import { t } from '../i18n';
import type { Save } from '../meta';
import type { Unlocked } from '../rewards';

export interface TitleCardActions {
  /** Achievements the boot found won (an older save, a long streak): marked new on the card. */
  ach: Unlocked[];
  app: HTMLElement;
  /** False once the player has left the title: the card's buttons go dead rather than firing into a race. */
  onTitle: () => boolean;
  shift: () => void;
  launch: () => void;
  /** Upgrades, rides and looks, on their own screen. */
  garage: () => void;
  /** The settings card (the pause menu without the race's rows). */
  opts: () => void;
}

/** The title card for a returning player: where they stand, and what to go for. */
export function drawTitle(save: Save, on: TitleCardActions): void {
  const best = document.getElementById('best');
  if (best && save.races > 0) {
    best.textContent = t('best', { div: C.stage(save.div, save.tier, save.endless).name, n: save.cup.race + 1, m: CUP_RACES, cash: save.cash })
      + (save.titles ? t('champs', { n: save.titles }) : '');
  }
  // A returning player has read the tagline: its 52 px go to the grid of places to go instead.
  // (It is translated -- main.ts writes t('tagline') into it on boot -- so this is about room, not words.)
  const tag = document.querySelector<HTMLElement>('#title .card p');
  if (tag) tag.classList.toggle('gone', save.races > 0);
  const info = document.getElementById('titleinfo');
  if (!info) return;
  const ad = !save.streak.doubled && save.streak.pay > 0 && save.streak.day === today() && platform.rewardedReady();
  info.innerHTML = titleInfo(save, on.ach, ad);
  if (ad) tele.adOffer('streak_double');
  const x2 = info.querySelector<HTMLButtonElement>('.x2');
  if (x2) streakDouble(save, x2, () => { if (on.onTitle()) drawTitle(save, on); });
  const sh = info.querySelector<HTMLButtonElement>('.shiftgo');
  if (sh) sh.onclick = () => { if (on.onTitle()) on.shift(); };
  const lg = info.querySelector<HTMLButtonElement>('.launchgo');
  if (lg) lg.onclick = () => { if (on.onTitle()) on.launch(); };
  const gg = info.querySelector<HTMLButtonElement>('.garagego');
  if (gg) gg.onclick = () => { if (on.onTitle()) on.garage(); };
  const og = info.querySelector<HTMLButtonElement>('.optsgo');
  if (og) og.onclick = () => { if (on.onTitle()) on.opts(); };
  wireBoard(info, on.app);
}
