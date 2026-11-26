// The title card's live parts: where the player stands, the streak's double-up ad, the security shift,
// the dummy launch and the leaderboard. Drawn again whenever one of them changes something.

import { titleInfo, achHtml, dailyPage } from './title';
import { openPage } from './subpage';
import { ACHIEVEMENTS } from '../rewards';
import { wireBoard, openBoard } from './board';
import { streakDouble } from '../shopping';
import { cupGoal, cupRaces, goalText } from '../career';
import { today } from '../daily';
import * as L from '../sim/ladder';
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
  /** Today's challenge race: the same race for everybody who rides it today (src/dailyRace.ts). */
  dailyRace: () => void;
  /** The free race: a stage the player picks, for a stake (3.3.69). */
  free: () => void;
  /** Where the next cup runs (3.3.69). */
  stop: () => void;
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
    best.textContent = t('best', { div: L.stage(save.div, save.tier, save.endless).name, n: save.cup.race + 1, m: cupRaces(save.cup), cash: save.cash })
      + (save.titles ? t('champs', { n: save.titles }) : '');
    const g = cupGoal(save.cup, save.div, save.gate);
    if (g) best.textContent += ` · ${goalText(g)}`;
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
  const fr = info.querySelector<HTMLButtonElement>('.freego');
  if (fr) fr.onclick = () => { if (on.onTitle()) on.free(); };
  const st = info.querySelector<HTMLButtonElement>('.stopgo');
  if (st) st.onclick = () => { if (on.onTitle()) on.stop(); };
  const lg = info.querySelector<HTMLButtonElement>('.launchgo');
  if (lg) lg.onclick = () => { if (on.onTitle()) on.launch(); };
  const gg = info.querySelector<HTMLButtonElement>('.garagego');
  if (gg) gg.onclick = () => { if (on.onTitle()) on.garage(); };
  const og = info.querySelector<HTMLButtonElement>('.optsgo');
  if (og) og.onclick = () => { if (on.onTitle()) on.opts(); };
  // 3.3.66: the two folds are pages of their own now, so the card itself stays one screen
  const dl = info.querySelector<HTMLButtonElement>('.dailygo');
  if (dl) dl.onclick = () => {
    if (!on.onTitle()) return;
    const page = openPage(on.app, t('daily'), dailyPage(save).body);
    const dr = page.el.querySelector<HTMLButtonElement>('.dracego');
    if (dr) dr.onclick = () => { page.close(); if (on.onTitle()) on.dailyRace(); };
    const db = page.el.querySelector<HTMLButtonElement>('.dboardgo');
    if (db) db.onclick = () => openBoard(on.app, 'daily_points');
  };
  const ac = info.querySelector<HTMLButtonElement>('.achsgo');
  if (ac) ac.onclick = () => {
    if (on.onTitle()) openPage(on.app, t('achievements', { n: save.ach.length, m: ACHIEVEMENTS.length }), achHtml(save, on.ach));
  };
  wireBoard(info, on.app);
}
