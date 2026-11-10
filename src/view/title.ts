// The title screen for a returning player: what to go for next (the next ride, the nemesis) and today's
// challenges, so the first thing they see is a reason to race.

import { icon } from './icons';
import { dailyHtml, rideName } from './results';
import { VEHICLES, DIVISIONS, stage } from '../sim/config';
import type { Save } from '../meta';
import { BREAK_AT, riderName, rideState } from '../career';
import { rows, FIRST_WIN_PAY } from '../daily';
import { t, money } from '../i18n';

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

/** The returning player's goals, as HTML for the title card. */
export function titleInfo(save: Save): string {
  if (save.races === 0) return '';
  const mult = stage(save.div, save.tier).prize;
  const win = save.daily.won ? '' : `<div class="dc"><span>${t('firstWin')}</span><b>+${money(Math.round(FIRST_WIN_PAY * mult))}</b></div>`;
  return nextRide(save) + nemesis(save) + dailyHtml(rows(save.daily), [], 0, win);
}
