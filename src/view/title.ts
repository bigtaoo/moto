// The title screen for a returning player: where they stand, a grid of places to go (the garage, the side
// games, the board, the settings) and, folded away under it, today's challenges and the achievements.
// Before 3.3.40 it was one long column of everything, 783 px of it on a 719 px phone.

import { icon } from './icons';
import { dailyHtml } from './results';
import { garageButton, rideName } from './garage';
import { VEHICLES, DIVISIONS, stage } from '../sim/config';
import type { Save } from '../meta';
import { BREAK_AT, reached, riderName, rideState } from '../career';
import { rows, FIRST_WIN_PAY } from '../daily';
import { t, money, type Key } from '../i18n';
import { ACHIEVEMENTS, dayMult, type Unlocked } from '../rewards';
import { shiftOpen } from '../shift';
import { freeOpen } from '../free';
import { shiftButton } from './results';
import { boardButton } from './board';
import { LAUNCH } from '../sim/launch';

/** The button into the dummy launch, once it's open: its best score under it. */
const launchButton = (save: Save): string =>
  save.races < LAUNCH.unlock ? '' : `<button class="shift launchgo"><span>${icon('burst')} ${t('launchGo')}</span><small>${save.launchBest ? t('launchBest', { n: save.launchBest }) : t('launchTip')}</small></button>`;

/** Sound, graphics and how to play, off the road: the pause menu used to be the only way in.
 *  3.3.67: a corner icon rather than a tile -- settings is not a place the player is meant to go next,
 *  and as a tile it was the same size and weight as the garage. */
const optsButton = (): string =>
  `<button class="iconbtn optsgo" title="${t('settings')}" aria-label="${t('settings')}">${icon('soundOn')}</button>`;

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

/** The free race, once it is open: a stage of the player's choosing, for a stake (3.3.69). */
const freeTile = (save: Save): string =>
  !freeOpen(save) ? '' : `<button class="shift freego"><span>${icon('flag')} ${t('freeRace')}</span><small>${t('freeTip')}</small></button>`;

/** Where the next cup starts, and the way to move it (3.3.69). Mid-cup the stage is settled, so it hides. */
function nextStop(save: Save): string {
  if (save.cup.race > 0 || reached(save) === 0) return '';
  const here = stage(save.div, save.tier, save.endless).name;
  return `<div class="tl"><span>${icon('flag')} ${t('nextStop')}</span><span><b>${here}</b><button class="x2 stopgo">${t('swap')}</button></span></div>`;
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

/** Every achievement: won ones ticked (`fresh`: just now, highlighted), the rest with what they ask and pay.
 *  The body of the achievements page (3.3.66); the title card carries only the tile that opens it. */
export function achHtml(save: Save, fresh: Unlocked[]): string {
  return ACHIEVEMENTS.map((a) => {
    const got = save.ach.includes(a.id);
    const cls = fresh.some((f) => f.id === a.id) ? 'got new' : got ? 'got' : '';
    return `<div class="ac ${cls}"><span><b>${t(`a_${a.id}` as Key)}</b><small>${t(`ad_${a.id}` as Key)}</small></span><i>${got ? icon('star') : '+' + money(a.pay)}</i></div>`;
  }).join('');
}

/** Today's challenges: how many are done (for the tile) and the list (for the page). */
export function dailyPage(save: Save): { done: number; of: number; body: string } {
  const rs = rows(save.daily);
  const mult = dayMult(stage(save.div, save.tier, save.endless).prize);
  const win = save.daily.won ? '' : `<div class="dc"><span>${t('firstWin')}</span><b>+${money(Math.round(FIRST_WIN_PAY * mult))}</b></div>`;
  return { done: rs.filter((r) => r.done).length, of: rs.length, body: dailyHtml(rs, [], 0, win) };
}

/** The returning player's goals, as HTML for the title card; `ad`: the streak's doubling ad is on offer. */
export function titleInfo(save: Save, fresh: Unlocked[] = [], ad = false): string {
  if (save.races === 0) return '';
  const d = dailyPage(save);
  const got = save.ach.length;
  // where they stand, then where they can go: one tap each, instead of a column to scroll through.
  // 3.3.67: in two ranks. The garage and the shift are what a race sends you to, so they are wide and
  // come first; the four side screens are small tiles under them. One flat grid of six made every
  // destination look as important as the next, and four of them could turn the same yellow as Race.
  const dests = garageButton(save) + (shiftOpen(save) ? shiftButton(save, 'shift shiftgo') : '');
  const side = `<button class="shift dailygo${d.done < d.of ? '' : ' has'}"><span>${icon('bang')} ${t('daily')}</span><small>${d.done}/${d.of}</small></button>`
    + `<button class="shift achsgo${fresh.length ? ' has' : ''}"><span>${icon('star')} ${t('achievements', { n: got, m: ACHIEVEMENTS.length })}</span><small>${fresh.length ? t('achNew', { n: fresh.length }) : t('achTip')}</small></button>`
    + boardButton() + launchButton(save) + freeTile(save);
  return optsButton() + streak(save, ad) + nextStop(save) + nextRide(save) + nemesis(save)
    + `<div class="tiles dests">${dests}</div><div class="tiles mini">${side}</div>`;
}
