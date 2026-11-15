// The title screen for a returning player: where they stand, a grid of places to go (the garage, the side
// games, the board, the settings) and, folded away under it, today's challenges and the achievements.
// Before 3.3.40 it was one long column of everything, 783 px of it on a 719 px phone.

import { icon } from './icons';
import { dailyHtml } from './results';
import { garageButton, rideName } from './garage';
import { VEHICLES, DIVISIONS, stage } from '../sim/config';
import type { Save } from '../meta';
import { BREAK_AT, riderName, rideState } from '../career';
import { rows, FIRST_WIN_PAY } from '../daily';
import { t, money, type Key } from '../i18n';
import { ACHIEVEMENTS, dayMult, type Unlocked } from '../rewards';
import { shiftOpen } from '../shift';
import { shiftButton } from './results';
import { boardButton } from './board';
import { LAUNCH } from '../sim/launch';

/** The button into the dummy launch, once it's open: its best score under it. */
const launchButton = (save: Save): string =>
  save.races < LAUNCH.unlock ? '' : `<button class="shift launchgo"><span>${icon('burst')} ${t('launchGo')}</span><small>${save.launchBest ? t('launchBest', { n: save.launchBest }) : t('launchTip')}</small></button>`;

/** Sound, graphics and how to play, off the road: the pause menu used to be the only way in. */
const optsButton = (): string =>
  `<button class="shift optsgo"><span>${icon('soundOn')} ${t('settings')}</span><small>${t('settingsTip')}</small></button>`;

/** The next ride the player doesn't own, and how far off it is. */
function nextRide(save: Save): string {
  const i = VEHICLES.findIndex((_, v) => { const st = rideState(save, v); return st === 'buy' || st === 'locked'; });
  if (i < 0) return '';
  const v = VEHICLES[i];
  const st = rideState(save, i);
  const how = st === 'locked'
    ? `${icon('lock')} ${t('rideAt', { d: stage(v.rung % DIVISIONS.length, Math.floor(v.rung / DIVISIONS.length)).name })}`
    : save.cash >= v.price ? `<em>${t('readyToBuy')}</em>` : t('toGo', { n: v.price - save.cash });
  return `<div class="tl"><span>${t('nextRide', { name: `<b>${rideName(i)}</b>` })}</span><span>${how}</span></div>`;
}

/** The nemesis and how close they are to broken. */
function nemesis(save: Save): string {
  const n = save.feud.nemesis;
  if (!n) return '';
  return `<div class="tl nem"><span>${icon('skull')} ${t('nem')} <b>${riderName(n.id)}</b></span><span>${t('nemBeaten', { p: n.paid, n: BREAK_AT })}</span></div>`;
}

/** Today's streak pay, with a rewarded ad to double it when `ad`. */
function streak(save: Save, ad: boolean): string {
  const s = save.streak;
  if (!s.pay) return '';
  const paid = s.doubled ? s.pay * 2 : s.pay;
  const x2 = ad ? `<button class="x2">${icon('play')} ${t('streakX2')}</button>` : '';
  return `<div class="tl streak"><span>${icon('flame')} ${t('streakDay', { n: s.n })}</span><span><em>+${money(paid)}</em>${x2}</span></div>`;
}

/** Every achievement: won ones ticked (`fresh`: just now, highlighted), the rest with what they ask and pay. */
export function achHtml(save: Save, fresh: Unlocked[]): string {
  const items = ACHIEVEMENTS.map((a) => {
    const got = save.ach.includes(a.id);
    const cls = fresh.some((f) => f.id === a.id) ? 'got new' : got ? 'got' : '';
    return `<div class="ac ${cls}"><span><b>${t(`a_${a.id}` as Key)}</b><small>${t(`ad_${a.id}` as Key)}</small></span><i>${got ? icon('star') : '+' + money(a.pay)}</i></div>`;
  }).join('');
  return `<details class="achs"${fresh.length ? ' open' : ''}><summary>${t('achievements', { n: save.ach.length, m: ACHIEVEMENTS.length })}</summary>${items}</details>`;
}

/** Today's challenges, folded away: the summary carries how many of them are done. */
function dailyFold(save: Save): string {
  const rs = rows(save.daily);
  const mult = dayMult(stage(save.div, save.tier, save.endless).prize);
  const win = save.daily.won ? '' : `<div class="dc"><span>${t('firstWin')}</span><b>+${money(Math.round(FIRST_WIN_PAY * mult))}</b></div>`;
  const done = rs.filter((r) => r.done).length;
  return `<details class="achs"><summary>${t('daily')} ${done}/${rs.length}</summary>${dailyHtml(rs, [], 0, win)}</details>`;
}

/** The returning player's goals, as HTML for the title card; `ad`: the streak's doubling ad is on offer. */
export function titleInfo(save: Save, fresh: Unlocked[] = [], ad = false): string {
  if (save.races === 0) return '';
  // where they stand, then where they can go: one tap each, instead of a column to scroll through
  const tiles = garageButton(save) + (shiftOpen(save) ? shiftButton(save, 'shift shiftgo') : '') + launchButton(save) + boardButton() + optsButton();
  return streak(save, ad) + nextRide(save) + nemesis(save)
    + `<div class="tiles">${tiles}</div>` + dailyFold(save) + achHtml(save, fresh);
}
