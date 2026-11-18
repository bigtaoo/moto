// The garage: upgrades, rides and looks — everything cash buys — on a screen of its own, reached from the
// title card and from the results. Until 3.3.40 all three were stacked at the bottom of the results card:
// 673 px of a 1390 px card on a 719 px phone, with "next race" somewhere below them.

import { icon } from './icons';
import { t, money, type Key } from '../i18n';
import { UPGRADE_MAX, UPGRADE_CAP, VEHICLES, DIVISIONS, stage, type Vehicle, type WeaponKind } from '../sim/config';
import { rideState, upgradeLock, upgradePrice, type UpKey } from '../career';
import { PAINTS, HATS, wearState, wearPrice } from '../shop';
import { shopHtml, bindShop } from './shop';
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
  /** Leave: back to wherever the garage was opened from. */
  close: () => void;
}

const UP_NAMES: Record<UpKey, Key> = { top: 'upTop', steer: 'upSteer', hp: 'upHp' };
const locked = (what: string) => `${icon('lock')} ${t('unlocks', { s: what })}`;

/** A ride's name in the player's language. */
export const rideName = (i: number): string => t(`ride${i}` as Key);

/** How many things on the three tabs the player can afford right now (the badge on the way in). */
export function buyable(save: Save): number {
  let n = upgradesBuyable(save);
  if (save.races >= TAB_AT.rides) VEHICLES.forEach((v, i) => { if (rideState(save, i) === 'buy' && save.cash >= v.price) n++; });
  if (save.races >= TAB_AT.looks) {
    PAINTS.forEach((_, i) => { if (wearState(save, 'paint', i) === 'buy' && save.cash >= wearPrice('paint', i)) n++; });
    HATS.forEach((_, i) => { if (wearState(save, 'hat', i) === 'buy' && save.cash >= wearPrice('hat', i)) n++; });
  }
  return n;
}

/** How many upgrade levels the player can pay for right now. */
const upgradesBuyable = (save: Save) =>
  (Object.keys(UP_NAMES) as UpKey[]).filter((k) => { const cost = upgradePrice(save, k); return cost !== null && save.cash >= cost; }).length;

/** The button into the garage, with what is affordable under it. */
export function garageButton(save: Save, cls = 'shift garagego'): string {
  const n = buyable(save);
  // 3.3.59: on the sandbox only the long sessions ever bought anything, and the players who bought stayed.
  // So the first time an upgrade is in reach, the tile says so outright and draws the eye to itself.
  // Only an upgrade counts: a paint or a ride in reach is not what the line promises (3.3.60).
  const first = (Object.keys(UP_NAMES) as UpKey[]).every((k) => !save.up[k]) && upgradesBuyable(save) > 0;
  return `<button class="${cls}${n ? ' has' : ''}${first ? ' nudge' : ''}"><span>${icon('wrench')} ${t('garage')}</span>
    <small>${first ? t('firstUp') : n ? t('canBuy', { n }) : t('garageTip')}</small></button>`;
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

/** The three stats, their pips and what the next level costs. */
function upsHtml(save: Save): string {
  return (Object.keys(UP_NAMES) as UpKey[]).map((k) => {
    const lvl = save.up[k];
    const cost = upgradePrice(save, k);
    const lock = upgradeLock(save, k);
    const cap = UPGRADE_CAP[save.tier][k];
    const pips = Array.from({ length: UPGRADE_MAX[k] }, (_, i) => `<i class="${i < lvl ? 'on' : i >= cap ? 'lock' : ''}"></i>`).join('');
    const label = cost !== null ? money(cost) : lock ? locked(lock) : t('max');
    return `<div class="up"><div class="upname">${t(UP_NAMES[k])}<div class="pips">${pips}</div></div>
      <button data-k="${k}" ${cost === null || save.cash < cost ? 'disabled' : ''}>${label}</button></div>`;
  }).join('');
}

/** The rides: the one being ridden, the others owned, the next to buy, and what is still locked. */
function ridesHtml(save: Save): string {
  const cards = VEHICLES.map((v, i) => {
    const st = rideState(save, i);
    const label = st === 'riding' ? t('riding') : st === 'owned' ? t('rideIt') : st === 'buy' ? money(v.price)
      : locked(stage(v.rung % DIVISIONS.length, Math.floor(v.rung / DIVISIONS.length)).name);
    const off = st === 'riding' || st === 'locked' || (st === 'buy' && save.cash < v.price);
    return `<button class="ride ${st}" data-v="${i}" ${off ? 'disabled' : ''}><b>${rideName(i)}</b><span>${statLine(v)}</span><small>${t(`blurb${i}` as Key)}</small><i>${label}</i></button>`;
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

  show(save: Save, on: GarageActions): void {
    this.save = save;
    this.on = on;
    if (!this.tabs(save).includes(this.tab)) this.tab = 'up';
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
    const tabs = this.tabs(save).map((x) => `<button class="tab ${x === this.tab ? 'on' : ''}" data-tab="${x}">${t(names[x])}</button>`).join('');
    const body = this.tab === 'up' ? `<div class="ups">${upsHtml(save)}</div>`
      : this.tab === 'rides' ? ridesHtml(save) : shopHtml(save);
    card.innerHTML = `<div class="ghead"><h2>${t('garage')}</h2><div class="cashline">${t('cash')} <b>${money(save.cash)}</b></div></div>
      <div class="tabs">${tabs}</div>
      <div class="gbody">${body}</div>
      <button class="primary gback">${icon('left')} ${t('back')}</button>`;
    const pass = (f: () => void) => () => f();
    card.querySelectorAll<HTMLButtonElement>('.up button').forEach((b) => { b.onclick = () => on.buy(b.dataset.k as UpKey); });
    card.querySelectorAll<HTMLButtonElement>('.ride').forEach((b) => { b.onclick = () => on.ride(Number(b.dataset.v)); });
    bindShop(card, pass, on);
    (card.querySelector('.gback') as HTMLButtonElement).onclick = () => on.close();
  }
}
