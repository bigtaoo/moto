// The title screen for a returning player: what to go for next (the next ride, the nemesis) and today's
// challenges, so the first thing they see is a reason to race.

import { icon } from './icons';
import { dailyHtml, rideName } from './results';
import { VEHICLES, DIVISIONS, stage } from '../sim/config';
import type { Save } from '../meta';
import { BREAK_AT, riderName, rideState } from '../career';
import { rows, FIRST_WIN_PAY } from '../daily';
import { t, money, type Key } from '../i18n';
import { ACHIEVEMENTS, type Unlocked } from '../rewards';
import { shiftOpen } from '../shift';
import { shiftButton } from './results';

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

/** The returning player's goals, as HTML for the title card; `ad`: the streak's doubling ad is on offer. */
export function titleInfo(save: Save, fresh: Unlocked[] = [], ad = false): string {
  if (save.races === 0) return '';
  const mult = stage(save.div, save.tier, save.endless).prize;
  const win = save.daily.won ? '' : `<div class="dc"><span>${t('firstWin')}</span><b>+${money(Math.round(FIRST_WIN_PAY * mult))}</b></div>`;
  return streak(save, ad) + (shiftOpen(save) ? shiftButton(save, 'shift shiftgo') : '') + nextRide(save) + nemesis(save) + dailyHtml(rows(save.daily), [], 0, win) + achHtml(save, fresh);
}
