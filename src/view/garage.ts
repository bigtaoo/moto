// The garage: upgrades, rides and looks — everything cash buys — on a screen of its own, reached from the
// title card and from the results. Until 3.3.40 all three were stacked at the bottom of the results card:
// 673 px of a 1390 px card on a 719 px phone, with "next race" somewhere below them.

import { icon } from './icons';
import { t, money, type Key } from '../i18n';
import { UPGRADE_MAX, UPGRADE_CAP, VEHICLES, DIVISIONS, stage, type Vehicle, type WeaponKind } from '../sim/config';
import { rideState, upgradeLock, upgradePrice, type UpKey } from '../career';
import { PAINTS, HATS, wearState, wearPrice } from '../shop';
import { tunePrice, repairPrice, WEAR_AT, TUNE_MAX } from '../tune';
import { shopHtml, bindShop } from './shop';
import { rideThumb } from './thumbs';
import type { Save } from '../meta';

/** From which race each tab opens; upgrades are there from the first one. */
export const TAB_AT = { rides: 2, looks: 3 };

export type Tab = 'up' | 'rides' | 'looks';

export interface GarageActions {
  buy: (k: UpKey) => void;
  ride: (v: number) => void;
  paint: (i: number) => void;
  hat: (i: number) => void;
  carry: (k: WeaponKind) => void;
  /** One race's levels, and beating the dents out of the ride (3.3.70). */
  tune: (k: UpKey) => void;
  repair: () => void;
  /** Leave: back to wherever the garage was opened from. */
  close: () => void;
  /** The garage stands between the results and the next race (3.3.62): its way out is the race. */
  next?: boolean;
}

const UP_NAMES: Record<UpKey, Key> = { top: 'upTop', steer: 'upSteer', hp: 'upHp' };
/** What each level does, in the player's words. Only the race-1 stop shows these (3.3.72). */
const UP_WHAT: Record<UpKey, Key> = { top: 'upTopWhat', steer: 'upSteerWhat', hp: 'upHpWhat' };
/**
 * The level the race-1 stop recommends and its button fits. 3.3.72: the stop put three rows at the same
 * price in front of a player who had ridden once, named them and nothing else, and left the only button at
 * the foot disabled until one was picked -- 16 of 126 new players left on it. Toughness is the honest pick:
 * a race-1 loser falls seven times, and it is the one level that answers that.
 */
const FIRST_PICK: UpKey = 'hp';
const locked = (what: string) => `${icon('lock')} ${t('unlocks', { s: what })}`;

/** A ride's name in the player's language. */
export const rideName = (i: number): string => t(`ride${i}` as Key);

/** How many things on the three tabs the player can afford right now (the badge on the way in). */
export function buyable(save: Save): number {
  // 3.3.70: the tune-up and the repair count too. They are what the badge is mostly lit by from the
  // middle of a season on, which is the point of them -- before this round 51 of a career's 63 races had
  // nothing on sale but paint.
  let n = upgradesBuyable(save);
  if (tuneOpen(save)) n += (Object.keys(UP_NAMES) as UpKey[]).filter((k) => save.tune[k] < TUNE_MAX && save.cash >= tunePrice(save, k)).length;
  if (save.wear > 0 && save.cash >= repairPrice(save)) n++;
  if (save.races >= TAB_AT.rides) VEHICLES.forEach((v, i) => { if (rideState(save, i) === 'buy' && save.cash >= v.price) n++; });
  // the looks are bought with show money, not cash (3.3.79)
  if (save.races >= TAB_AT.looks) {
    PAINTS.forEach((_, i) => { if (wearState(save, 'paint', i) === 'buy' && save.show >= wearPrice('paint', i)) n++; });
    HATS.forEach((_, i) => { if (wearState(save, 'hat', i) === 'buy' && save.show >= wearPrice('hat', i)) n++; });
  }
  return n;
}

/**
 * The tune-up (3.3.70) waits until the player owns a level outright. Race 1 has a garage that holds the
 * race back until the first upgrade is bought (3.3.64), and a second, cheaper-looking button on those rows
 * could take the money that stop is waiting for -- and would be the second new idea on a screen that is
 * teaching its first.
 */
const tuneOpen = (save: Save): boolean => upLevels(save) > 0;

/** How many upgrade levels the player can pay for right now. */
const upgradesBuyable = (save: Save) =>
  (Object.keys(UP_NAMES) as UpKey[]).filter((k) => { const cost = upgradePrice(save, k); return cost !== null && save.cash >= cost; }).length;

/** No upgrade bought yet, and one is affordable: the moment 3.3.59's nudge and 3.3.62's garage stop are for. */
export const firstUpInReach = (save: Save): boolean =>
  (Object.keys(UP_NAMES) as UpKey[]).every((k) => !save.up[k]) && upgradesBuyable(save) > 0;

/** How many upgrade levels the player owns (analytics). */
export const upLevels = (save: Save): number => save.up.top + save.up.steer + save.up.hp;

/** The button into the garage, with what is affordable under it. */
export function garageButton(save: Save, cls = 'shift garagego'): string {
  const n = buyable(save);
  // 3.3.59: on the sandbox only the long sessions ever bought anything, and the players who bought stayed.
  // So the first time an upgrade is in reach, the tile says so outright and draws the eye to itself.
  // Only an upgrade counts: a paint or a ride in reach is not what the line promises (3.3.60).
  const first = firstUpInReach(save);
  // 3.3.70: a ride dented past half has lost a level of everything, and nothing else on the lobby says so.
  // It goes above the count, because it is the one thing here that is costing the player a race.
  const hurt = save.wear >= 0.5 ? `${t('cond')} ${Math.round((1 - save.wear) * 100)}%` : '';
  return `<button class="${cls}${n ? ' has' : ''}${first ? ' nudge' : ''}"><span>${icon('wrench')} ${t('garage')}</span>
    <small>${first ? t('firstUp') : hurt || (n ? t('canBuy', { n }) : t('garageTip'))}</small></button>`;
}

/** What a vehicle adds over the scooter, in the player's words. */
function statLine(v: Vehicle): string {
  const sg = (n: number) => (n > 0 ? '+' : n < 0 ? '−' : '±') + Math.abs(n);
  if (!v.top && !v.steer && !v.hp && !v.accel) return t('baseline');
  return [
    v.top ? `${sg(Math.round(v.top * 3.6))} ${t('kmh')}` : '', v.accel ? `${sg(v.accel)} ${t('kick')}` : '',
    v.steer ? `${sg(v.steer)} ${t('grip')}` : '', v.hp ? `${sg(v.hp)} ${t('tough')}` : '',
  ].filter(Boolean).join(' · ');
}

/**
 * The three stats: pips, what the next level costs, and beside it what one race of it costs (3.3.70).
 * The tune-up sits here rather than on a tab of its own because this is where the player meets the wall
 * -- the row that says "unlocks: Pro" is the row that can also say "$600, just for this race".
 */
function upsHtml(save: Save, what: boolean): string {
  return (Object.keys(UP_NAMES) as UpKey[]).map((k) => {
    const lvl = save.up[k];
    const cost = upgradePrice(save, k);
    const lock = upgradeLock(save, k);
    const cap = UPGRADE_CAP[save.tier][k];
    const pips = Array.from({ length: UPGRADE_MAX[k] }, (_, i) => `<i class="${i < lvl ? 'on' : i >= cap ? 'lock' : ''}"></i>`).join('')
      + '<i class="fit"></i>'.repeat(save.tune[k]);
    const label = cost !== null ? money(cost) : lock ? locked(lock) : t('max');
    // 3.3.78: the tune-up stacks to TUNE_MAX, so the button sells the next level rather than the only
    // one, and says which it is -- `+2` after one is on. It only reads "fitted" once there is no more.
    const fit = save.tune[k];
    const full = fit >= TUNE_MAX;
    const tp = tunePrice(save, k);
    const tune = !tuneOpen(save) ? ''
      : `<button class="tune${fit ? ' on' : ''}" data-t="${k}"${full || save.cash < tp ? ' disabled' : ''}>${full ? t('tuneOn') : `+${fit + 1} · ${money(tp)}`}</button>`;
    const first = what && k === FIRST_PICK;
    const rec = first ? ` <em class="rec">${t('recUp')}</em>` : '';
    return `<div class="up${first ? ' rec' : ''}"><div class="upname">${t(UP_NAMES[k])}${rec}<div class="pips">${pips}</div>${what ? `<small class="what">${t(UP_WHAT[k])}</small>` : ''}</div>
      ${tune}<button data-k="${k}" ${cost === null || save.cash < cost ? 'disabled' : ''}>${label}</button></div>`;
  }).join('');
}

/** How dented the ride is and what beating it out costs; it only starts marking in the second season. */
function condHtml(save: Save): string {
  if (save.tier < WEAR_AT && save.wear === 0) return '';
  const price = repairPrice(save);
  const mint = save.wear <= 0;
  return `<div class="up cond"><div class="upname">${t('cond')}<div class="bar"><i style="width:${Math.round((1 - save.wear) * 100)}%"></i></div></div>
    <button class="fix" data-r="1"${mint || save.cash < price ? ' disabled' : ''}>${mint ? t('mint') : `${t('repair')} · ${money(price)}`}</button></div>`;
}

/** The rides: the one being ridden, the others owned, the next to buy, and what is still locked. */
function ridesHtml(save: Save): string {
  const cards = VEHICLES.map((v, i) => {
    const st = rideState(save, i);
    const label = st === 'riding' ? t('riding') : st === 'owned' ? t('rideIt') : st === 'buy' ? money(v.price)
      : locked(stage(v.rung % DIVISIONS.length, Math.floor(v.rung / DIVISIONS.length)).name);
    const off = st === 'riding' || st === 'locked' || (st === 'buy' && save.cash < v.price);
    // the ride in the player's own paint, so the card shows the thing they would be riding (3.3.66)
    return `<button class="ride ${st}" data-v="${i}" ${off ? 'disabled' : ''}>${rideThumb(i, PAINTS[save.paint.cur].ride)}
      <b>${rideName(i)}</b><span>${statLine(v)}</span><small>${t(`blurb${i}` as Key)}</small><i>${label}</i></button>`;
  }).join('');
  return `<div class="rides">${cards}</div>`;
}

/** The garage overlay: one tab at a time, and a way back out. */
export class Garage {
  private tab: Tab = 'up';
  private save: Save | null = null;
  private on: GarageActions | null = null;

  constructor(private readonly el: HTMLElement) {
    el.addEventListener('click', (e) => {
      const b = (e.target as Element).closest<HTMLButtonElement>('button[data-tab]');
      if (!b) return;
      this.tab = b.dataset.tab as Tab;
      this.draw();
    });
  }

  get open(): boolean {
    return !this.el.classList.contains('hidden');
  }

  private shownAt = 0;

  /** Enter or Space on the stop before a race: the race, once the screen has been up long enough to read
   *  (the same 600 ms as the results, or the key that went on from the results would skip it). */
  continue(): boolean {
    if (!this.open || !this.on?.next) return false;
    if (performance.now() - this.shownAt < 600) return true;
    if (this.mustBuy) this.firstBuy();
    else this.on.close();
    return true;
  }

  /** 3.3.64: the stop holds the race back until the first upgrade is bought. On r45 the stop was up for 1 s
   *  for 10 of 11 players and 1 bought: they tapped its button where the results' had been. Every player who
   *  meets the stop can afford a level (that is what brings it up), so there is always a way on. */
  get mustBuy(): boolean {
    return !!this.on?.next && !!this.save && firstUpInReach(this.save);
  }

  /** The stop's one tap (3.3.72): fit the level it recommends, and on to the race. */
  private firstBuy(): void {
    const save = this.save;
    const on = this.on;
    if (!save || !on) return;
    const cost = upgradePrice(save, FIRST_PICK);
    if (cost === null || save.cash < cost) return;
    on.buy(FIRST_PICK);
    on.close();
  }

  show(save: Save, on: GarageActions): void {
    this.shownAt = performance.now();
    this.save = save;
    this.on = on;
    if (!this.tabs(save).includes(this.tab) || this.mustBuy) this.tab = 'up';
    this.el.classList.remove('hidden');
    this.draw();
  }

  hide(): void {
    this.el.classList.add('hidden');
    this.save = null;
    this.on = null;
  }

  /** After a purchase, and when the language changes. */
  redraw(): void {
    if (this.open && this.save) this.draw();
  }

  private tabs(save: Save): Tab[] {
    const ts: Tab[] = ['up'];
    if (save.races >= TAB_AT.rides) ts.push('rides');
    if (save.races >= TAB_AT.looks) ts.push('looks');
    return ts;
  }

  private draw(): void {
    const save = this.save;
    const on = this.on;
    if (!save || !on) return;
    const card = this.el.querySelector('.card') as HTMLElement;
    const names: Record<Tab, Key> = { up: 'upgrades', rides: 'rides', looks: 'looks' };
    // one tab is not a choice: on the race-1 stop the lone "Upgrades" tab was a 60 px black slab above
    // the three rows it labelled, on the one screen that should read as a single step (3.3.72)
    const open = this.tabs(save);
    const tabs = open.length < 2 ? '' : open.map((x) => `<button class="tab ${x === this.tab ? 'on' : ''}" data-tab="${x}">${t(names[x])}</button>`).join('');
    const must = this.mustBuy;
    const body = this.tab === 'up' ? `<div class="ups">${upsHtml(save, must)}${condHtml(save)}${tuneOpen(save) ? `<small class="tip">${t('tuneTip')}</small>` : ''}</div>`
      : this.tab === 'rides' ? ridesHtml(save) : shopHtml(save);
    // on the stop before a race, the line says why the garage came up, and the upgrades in reach move
    const hint = on.next && firstUpInReach(save) ? `<div class="ghint">${t('firstUp')}</div>` : '';
    // 3.3.66: leaving is not what this screen is for, so Back is a small white button at the top, where
    // every second-level page keeps it. The big yellow button at the foot is left for the one case where
    // going on IS the point: the stop that stands between the results and the next race.
    const back = on.next ? '' : `<button class="back gback">${icon('left')} ${t('back')}</button>`;
    // 3.3.72: while the stop is waiting for that first level, the foot button is the purchase itself --
    // one tap fits the recommended level and goes racing. A disabled button at the foot of a screen with no
    // way back is what 3.3.64 watched ten of eleven players tap once and leave.
    const pick = must ? upgradePrice(save, FIRST_PICK) : null;
    const one = pick !== null && save.cash >= pick;
    const go = !on.next ? ''
      : one ? `<button class="primary gfirst">${t('firstBuy', { s: t(UP_NAMES[FIRST_PICK]), n: money(pick as number) })}</button>`
      : `<button class="primary gback"${must ? ' disabled' : ''}>${must ? t('buyFirst') : `${t('nextRace')} ${icon('play')}`}</button>`;
    // both purses once the looks are open, because from there on half of what is on sale is priced in the
    // other one and a player looking at a $400 paint needs to see which $400 the game means (3.3.79)
    const purses = `<div class="cashline">${t('cash')} <b>${money(save.cash)}</b>${save.races >= TAB_AT.looks ? ` <em>${t('showCash')} <b>${money(save.show)}</b></em>` : ''}</div>`;
    card.innerHTML = `<div class="ghead"><h2>${t('garage')}</h2>${back}${purses}</div>
      ${hint}${tabs ? `<div class="tabs">${tabs}</div>` : ''}
      <div class="gbody${hint ? ' first' : ''}">${body}</div>
      ${go}`;
    const pass = (f: () => void) => () => f();
    card.querySelectorAll<HTMLButtonElement>('.up button').forEach((b) => {
      b.onclick = b.dataset.t ? () => on.tune(b.dataset.t as UpKey) : b.dataset.r ? () => on.repair() : () => on.buy(b.dataset.k as UpKey);
    });
    card.querySelectorAll<HTMLButtonElement>('.ride').forEach((b) => { b.onclick = () => on.ride(Number(b.dataset.v)); });
    bindShop(card, pass, on);
    const gb = card.querySelector<HTMLButtonElement>('.gback');
    if (gb) gb.onclick = () => { if (!this.mustBuy) on.close(); };
    const gf = card.querySelector<HTMLButtonElement>('.gfirst');
    if (gf) gf.onclick = () => this.firstBuy();
  }
}
