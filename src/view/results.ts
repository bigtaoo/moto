// The results screen: the race's pay, the nemesis, the cup table, the day's challenges, the upgrades and the
// garage. Taps on it count only once it has been up long enough to be seen, so a tap meant for the race
// doesn't buy something or skip it.

import { icon } from './icons';
import { CHASE, GRUDGE_BONUS, UPGRADE_MAX, UPGRADE_CAP, VEHICLES, DIVISIONS, stage, type Vehicle, type WeaponKind } from '../sim/config';
import type { Save } from '../meta';
import { BREAK_AT, rideState, upgradeLock, upgradePrice, type CupEnd, type FeudOutcome, type Nemesis, type UpKey } from '../career';
import type { DailyOutcome, DailyRow, Kind } from '../daily';
import type { Flair } from '../sim/flair';
import type { Mutator } from '../sim/fun';
import { t, ord, money, type Key } from '../i18n';
import { shopHtml, bindShop } from './shop';
import type { Unlocked } from '../rewards';
import { shiftOpen, type ShiftResult } from '../shift';

export interface League {
  /** The division this race was in. */
  div: string;
  /** Races of the cup run, this one included, and how many it has. */
  race: number;
  races: number;
  table: { name: string; pts: number; rank: number; me: boolean }[];
  /** Set when this race closed the cup. */
  end: CupEnd | null;
  /** The division the next race is in, and the season (C.TIERS name). */
  next: string;
  season: string;
}

export interface RaceResult {
  place: number;
  total: number;
  prize: number;
  kos: number;
  koBonus: number;
  grudgeKos: number;
  grudgeBonus: number;
  shoves: number;
  shoveBonus: number;
  /** Near misses and KO chains, and what each paid. */
  flair: Flair;
  fines: number;
  earned: number;
  time: number;
  grudges: string[];
  league: League;
  /** The feuds after this race: what the nemesis paid, and who the nemesis is now. */
  feud: { out: FeudOutcome; nemesis: Nemesis | null; name: (id: number) => string };
  /** The day's challenges after this race, and what they paid. */
  daily: DailyOutcome;
  /** Achievements this race (or a purchase after it) won, each paid once. */
  ach: Unlocked[];
  /** The weekly mutator this race ran under (its prize was raised). */
  mutator: Mutator | null;
  /** Cash a rewarded ad would add (doubling this race's earnings); 0: not on offer. */
  double: number;
  /** The ad was watched and the cash added. */
  doubled: boolean;
}

export interface ResultActions {
  buy: (k: UpKey) => void;
  ride: (v: number) => void;
  paint: (i: number) => void;
  hat: (i: number) => void;
  carry: (k: WeaponKind) => void;
  double: () => void;
  again: () => void;
  /** A security shift instead of the next race (offered once they are open). */
  shift: () => void;
}

/** A finished shift's buttons: back to the cup, or another shift. */
export interface ShiftActions {
  again: () => void;
  shift: () => void;
}

/** The secondary button that starts a security shift. */
export const shiftButton = (save: Save, cls = 'shift'): string =>
  `<button class="${cls}"><span>${icon('target')} ${t('shiftGo')}</span><small>${t('shiftTip', { n: Math.round(CHASE.bounty * stage(save.div, save.tier, save.endless).prize) })}</small></button>`;

const UP_NAMES: Record<UpKey, Key> = { top: 'upTop', steer: 'upSteer', hp: 'upHp' };
const DAILY_NAMES: Record<Kind, Key> = { kos: 'dKos', shoves: 'dShoves', podium: 'dPodium', win: 'dWin', races: 'dRaces', clean: 'dClean', grudge: 'dGrudge' };
/** How long the screen is up before a tap or key on it counts. */
const ARM_MS = 600;

/** A ride's name in the player's language. */
export const rideName = (i: number): string => t(`ride${i}` as Key);

/** The day's challenges as a list: done ones ticked, the others with their progress. */
export function dailyHtml(rows: DailyRow[], fresh: Kind[] = [], pay = 0, extra = ''): string {
  const items = rows.map((r) => {
    const cls = r.done ? (fresh.includes(r.kind) ? 'done new' : 'done') : '';
    const right = fresh.includes(r.kind) ? `+${money(pay)}` : r.done ? icon('star') : `${r.prog}/${r.goal}`;
    return `<div class="dc ${cls}"><span>${t(DAILY_NAMES[r.kind], { n: r.goal })}</span><b>${right}</b></div>`;
  }).join('');
  return `<div class="daily"><div class="cuphead">${t('daily')}</div>${items}${extra}</div>`;
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

function againLabel(l: League): string {
  const e = l.end;
  if (!e) return t('nextRace');
  if (e.nextTier) return t('onSeason', { s: l.season });
  if (e.promoted) return t('onTo', { d: l.next });
  if (e.champion) return t('onTo', { d: l.next });
  return t('retry', { d: l.next });
}

const row = (a: string, b: string, cls = '') => `<div class="row ${cls}"><span>${a}</span><b>${b}</b></div>`;
const locked = (what: string) => `${icon('lock')} ${t('unlocks', { s: what })}`;

export class Results {
  private shownAt = 0;
  private again: (() => void) | null = null;

  constructor(private readonly el: HTMLElement) {}

  get open(): boolean {
    return !this.el.classList.contains('hidden');
  }

  private get armed(): boolean {
    return performance.now() - this.shownAt >= ARM_MS;
  }

  hide(): void {
    this.el.classList.add('hidden');
    this.again = null;
  }

  /** Enter or Space: the main button, once the screen can be read. True if it went on. */
  continue(): boolean {
    if (!this.open || !this.armed || !this.again) return false;
    this.again();
    return true;
  }

  /** A finished security shift. */
  showShift(r: ShiftResult, save: Save, on: ShiftActions): void {
    this.shownAt = performance.now();
    const card = this.el.querySelector('.card') as HTMLElement;
    card.innerHTML = shiftHtml(r, save);
    const guard = (f: () => void) => () => { if (this.armed) f(); };
    this.again = on.again;
    (card.querySelector('.again') as HTMLButtonElement).onclick = guard(on.again);
    (card.querySelector('.shift') as HTMLButtonElement).onclick = guard(on.shift);
    this.el.classList.remove('hidden');
  }

  /** Show (or redraw, after a purchase) the screen; a redraw keeps the time it came up. */
  show(res: RaceResult, save: Save, on: ResultActions): void {
    if (!this.open) this.shownAt = performance.now();
    const card = this.el.querySelector('.card') as HTMLElement;
    const ups = (Object.keys(UP_NAMES) as UpKey[]).map((k) => {
      const lvl = save.up[k];
      const cost = upgradePrice(save, k);
      const lock = upgradeLock(save, k);
      const cap = UPGRADE_CAP[save.tier][k];
      const pips = Array.from({ length: UPGRADE_MAX[k] }, (_, i) => `<i class="${i < lvl ? 'on' : i >= cap ? 'lock' : ''}"></i>`).join('');
      const label = cost !== null ? money(cost) : lock ? locked(lock) : t('max');
      return `<div class="up"><div class="upname">${t(UP_NAMES[k])}<div class="pips">${pips}</div></div>
        <button data-k="${k}" ${cost === null || save.cash < cost ? 'disabled' : ''}>${label}</button></div>`;
    }).join('');
    const d = res.daily;
    // a new player's first results are the race and what to upgrade: the challenges and the garage come in
    // from the 2nd, the paint, hat and weapon shop from the 3rd (save.races counts this race already)
    const n = save.races;
    card.innerHTML = `
      <h2 class="${res.place === 1 ? 'win' : ''}">${t('place', { o: ord(res.place) })}</h2>
      <div class="sub">${res.time.toFixed(1)} s</div>
      <div class="rows">
        ${row(t('prize', { o: ord(res.place) }) + (res.mutator ? ` · ${t('mutRow', { name: t(`mut_${res.mutator}`) })} ×1.25` : ''), money(res.prize))}
        ${row(t('kos', { n: res.kos }), money(res.koBonus))}
        ${res.shoves ? row(t('shoves', { n: res.shoves }), money(res.shoveBonus), 'good') : ''}
        ${res.flair.near ? row(t('nearMisses', { n: res.flair.near }), money(res.flair.nearPay), 'good') : ''}
        ${res.flair.chainPay ? row(t('koChains', { n: res.flair.best }), money(res.flair.chainPay), 'good') : ''}
        ${res.flair.bowls ? row(t('bowlRow', { n: res.flair.bowls }), money(res.flair.bowlPay), 'good') : ''}
        ${res.flair.taunts ? row(t('tauntRow', { n: res.flair.taunts }), money(res.flair.tauntPay), 'good') : ''}
        ${res.flair.bossPay ? row(`${icon('star')} ${t('bossRow')}`, money(res.flair.bossPay), 'good') : ''}
        ${res.grudgeKos ? row(t('grudgeKos', { n: res.grudgeKos }), money(res.grudgeBonus), 'good') : ''}
        ${res.fines ? row(t('fines'), money(-res.fines), 'bad') : ''}
        ${feudRows(res)}
        ${res.doubled ? row(t('adBonus'), money(res.earned / 2), 'good') : ''}
        ${row(t('earned'), money(res.earned), 'total')}
        ${d.firstWin ? row(t('firstWin'), '+' + money(d.firstWin), 'good') : ''}
        ${res.ach.map((a) => row(`${icon('star')} ${t(`a_${a.id}` as Key)}`, '+' + money(a.pay), 'good')).join('')}
      </div>
      ${res.double > 0 && !res.doubled ? `<button class="double"><span>${icon('play')} ${t('double', { n: res.double })}</span><small>${t('watchAd')}</small></button>` : ''}
      ${feudCard(res)}
      ${leagueHtml(res.league)}
      ${n >= NEW.daily ? dailyHtml(d.rows, d.done, d.done.length ? d.cash / d.done.length : 0) : ''}
      ${res.grudges.length ? `<div class="grudges">${t('holding')} <b>${res.grudges.join(', ')}</b><br><small>${t('grudgeTip', { n: GRUDGE_BONUS })}</small></div>` : ''}
      <div class="cashline">${t('cash')} <b>${money(save.cash)}</b></div>
      <div class="ups">${ups}${n >= NEW.garage ? garageHtml(save) : ''}${n >= NEW.shop ? shopHtml(save) : ''}</div>
      <button class="primary again">${againLabel(res.league)}</button>
      ${shiftOpen(save) ? shiftButton(save) : ''}`;
    const guard = (f: () => void) => () => { if (this.armed) f(); };
    card.querySelectorAll<HTMLButtonElement>('.up button').forEach((b) => { b.onclick = guard(() => on.buy(b.dataset.k as UpKey)); });
    card.querySelectorAll<HTMLButtonElement>('.ride').forEach((b) => { b.onclick = guard(() => on.ride(Number(b.dataset.v))); });
    bindShop(card, guard, on);
    this.again = on.again;
    (card.querySelector('.again') as HTMLButtonElement).onclick = guard(on.again);
    const sh = card.querySelector<HTMLButtonElement>('.shift');
    if (sh) sh.onclick = guard(on.shift);
    const dbl = card.querySelector<HTMLButtonElement>('.double');
    if (dbl) dbl.onclick = guard(() => { dbl.disabled = true; on.double(); });
    this.el.classList.remove('hidden');
  }
}

/** A finished security shift: who was caught and what it paid. */
export function shiftHtml(r: ShiftResult, save: Save): string {
  return `
    <h2 class="${r.caught >= r.of ? 'win' : ''}">${t('shiftOver')}</h2>
    <div class="sub">${r.time.toFixed(1)} s</div>
    <div class="rows">
      ${row(t('shiftCaught', { n: r.caught, m: r.of }), money(r.bounty))}
      ${r.sweep ? row(t('shiftSweep'), money(r.sweep), 'good') : ''}
      ${row(t('earned'), money(r.earned), 'total')}
    </div>
    <div class="cashline">${t('cash')} <b>${money(save.cash)}</b></div>
    <button class="primary again">${t('backToCup')}</button>
    ${shiftButton(save)}`;
}

/** From which race's results each part of the card shows (a new player's first results stay short). */
export const NEW = { daily: 2, garage: 2, shop: 3 };

/** The rides: the one being ridden, the others owned, the next to buy, and what is still locked. */
function garageHtml(save: Save): string {
  const cards = VEHICLES.map((v, i) => {
    const st = rideState(save, i);
    const label = st === 'riding' ? t('riding') : st === 'owned' ? t('rideIt') : st === 'buy' ? money(v.price)
      : locked(stage(v.rung % DIVISIONS.length, Math.floor(v.rung / DIVISIONS.length)).name);
    const off = st === 'riding' || st === 'locked' || (st === 'buy' && save.cash < v.price);
    return `<button class="ride ${st}" data-v="${i}" ${off ? 'disabled' : ''}><b>${rideName(i)}</b><span>${statLine(v)}</span><small>${t(`blurb${i}` as Key)}</small><i>${label}</i></button>`;
  }).join('');
  return `<div class="garage"><div class="cuphead">${t('garage')}</div><div class="rides">${cards}</div></div>`;
}

function feudRows(res: RaceResult): string {
  const o = res.feud.out;
  if (o.vs === null) return '';
  const name = res.feud.name(o.vs);
  let html = '';
  if (o.revenge) html += row(t('revengeRow', { name, n: o.revenge }), '', 'good');
  if (o.ahead) html += row(t('beatHome', { name }), '', 'good');
  if (o.beaten && !o.broken) html += row(t('beaten', { name }), `${res.feud.nemesis?.paid ?? 0}/${BREAK_AT}`, 'good');
  if (o.broken) html += row(t('broken', { name }), '', 'good');
  if (o.cash) html += row(t('bounty'), money(o.cash), 'good');
  return html;
}

/** A new nemesis, or one just broken: the big news of the race. */
function feudCard(res: RaceResult): string {
  const { out, nemesis, name } = res.feud;
  if (out.broken) return `<div class="nemres win">${icon('skull')} ${t('brokenCard', { name: name(out.vs!) })}</div>`;
  if (out.fresh !== null) return `<div class="nemres">${icon('skull')} ${t('newNem')} <b>${name(out.fresh)}</b><small>${t('newNemTip', { n: BREAK_AT })}</small></div>`;
  if (nemesis) return `<div class="nemres small">${icon('skull')} ${t('nem')} <b>${name(nemesis.id)}</b> · ${t('nemBeaten', { p: nemesis.paid, n: BREAK_AT })}<small>${t('nemTip')}</small></div>`;
  return '';
}

/** The cup table after this race (the top 3 and the player), and how the cup ended if it did. */
function leagueHtml(l: League): string {
  const rows = l.table.filter((r) => r.rank <= 3 || r.me).map((r) =>
    `<div class="st ${r.me ? 'me' : ''} ${r.rank <= 3 ? 'up' : ''}"><span>${r.rank}. ${r.name}</span><b>${r.pts}</b></div>`).join('');
  const e = l.end;
  const bonus = e?.bonus ? ` +${money(e.bonus)}` : '';
  const head = e
    ? e.champion ? `<div class="cupend win">${t('champion', { n: e.bonus })}</div>`
      : e.promoted ? `<div class="cupend win">${t('promoted', { o: ord(e.rank) })}${bonus}</div>`
      : `<div class="cupend">${t('cupRank', { o: ord(e.rank) })}${bonus} · ${t('top3')}</div>`
    : '';
  return `<div class="cup"><div class="cuphead">${t('cupHead', { div: l.div })} · ${e ? t('final') : t('raceN', { n: l.race, m: l.races })}</div>${head}${rows}</div>`;
}
