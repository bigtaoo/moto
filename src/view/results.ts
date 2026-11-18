// The results screen: the race's pay, the nemesis, the cup table and the day's challenges -- what the race
// did, and nothing else. What cash buys moved to the garage (view/garage.ts) in 3.3.40; one button goes
// there. Taps count only once the screen has been up long enough to be seen, so a tap meant for the race
// doesn't skip it.

import { icon } from './icons';
import { GRUDGE_BONUS, stage } from '../sim/config';
import { bountyPay } from '../shift';
import type { Save } from '../meta';
import { BREAK_AT, type CupEnd, type FeudOutcome, type Nemesis } from '../career';
import type { DailyOutcome, DailyRow, Kind } from '../daily';
import type { Flair } from '../sim/flair';
import type { Mutator } from '../sim/fun';
import { t, ord, money, type Key } from '../i18n';
import { garageButton } from './garage';
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
  /** The cup still running: the line the player is chasing (career.ts cupGoal). */
  goal?: string;
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
  /** The garage: upgrades, rides and looks, on their own screen. */
  garage: () => void;
  double: () => void;
  again: () => void;
  /** A security shift instead of the next race (offered once they are open). */
  shift: () => void;
  /** Back to the title card, where the launch game, the board and the achievements live. */
  home: () => void;
}

/** A finished shift's buttons: back to the cup, or another shift. */
export interface ShiftActions {
  again: () => void;
  shift: () => void;
  home: () => void;
}

/** The secondary button that starts a security shift. */
export const shiftButton = (save: Save, cls = 'shift'): string =>
  `<button class="${cls}"><span>${icon('target')} ${t('shiftGo')}</span><small>${t('shiftTip', { n: bountyPay(stage(save.div, save.tier, save.endless).prize) })}</small></button>`;

const DAILY_NAMES: Record<Kind, Key> = { kos: 'dKos', shoves: 'dShoves', podium: 'dPodium', near: 'dNear', races: 'dRaces', chain: 'dChain', grudge: 'dGrudge' };
/** How long the screen is up before a tap or key on it counts. */
const ARM_MS = 600;

/** The day's challenges as a list: done ones ticked, the others with their progress. */
export function dailyHtml(rows: DailyRow[], fresh: Kind[] = [], pay = 0, extra = ''): string {
  const items = rows.map((r) => {
    const cls = r.done ? (fresh.includes(r.kind) ? 'done new' : 'done') : '';
    const right = fresh.includes(r.kind) ? `+${money(pay)}` : r.done ? icon('star') : `${r.prog}/${r.goal}`;
    return `<div class="dc ${cls}"><span>${t(DAILY_NAMES[r.kind], { n: r.goal })}</span><b>${right}</b></div>`;
  }).join('');
  return `<div class="daily"><div class="cuphead">${t('daily')}</div>${items}${extra}</div>`;
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
    (card.querySelector('.shiftgo') as HTMLButtonElement).onclick = guard(on.shift);
    (card.querySelector('.home') as HTMLButtonElement).onclick = guard(on.home);
    this.el.classList.remove('hidden');
  }

  /** Show (or redraw, after a purchase) the screen; a redraw keeps the time it came up. */
  show(res: RaceResult, save: Save, on: ResultActions): void {
    if (!this.open) this.shownAt = performance.now();
    const card = this.el.querySelector('.card') as HTMLElement;
    const d = res.daily;
    // a new player's first results are just the race: the day's challenges and the way back to the title
    // come in from the 2nd (save.races counts this race already)
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
      <button class="primary again">${againLabel(res.league)}</button>
      <div class="tiles">${garageButton(save)}${shiftOpen(save) ? shiftButton(save, 'shift shiftgo') : ''}${n >= NEW.home ? `<button class="shift home">${t('toMenu')}</button>` : ''}</div>`;
    const guard = (f: () => void) => () => { if (this.armed) f(); };
    (card.querySelector('.garagego') as HTMLButtonElement).onclick = guard(on.garage);
    this.again = on.again;
    (card.querySelector('.again') as HTMLButtonElement).onclick = guard(on.again);
    const sh = card.querySelector<HTMLButtonElement>('.shiftgo');
    if (sh) sh.onclick = guard(on.shift);
    const hm = card.querySelector<HTMLButtonElement>('.home');
    if (hm) hm.onclick = guard(on.home);
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
    ${shiftButton(save, 'shift shiftgo')}
    <button class="shift home">${t('toMenu')}</button>`;
}

/** From which race's results each part of the card shows (a new player's first results stay short). */
export const NEW = { daily: 2, home: 2 };

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
  // the last division promotes nobody, so "top 3 go up" would be a lie there: say what it really takes
  const head = e
    ? e.onGate ? `<div class="cupend win">${t('through', { o: ord(e.rank), n: e.bonus })}</div>`
      : e.champion ? `<div class="cupend win">${t('champion', { n: e.bonus })}</div>`
      : e.promoted ? `<div class="cupend win">${t('promoted', { o: ord(e.rank) })}${bonus}</div>`
      : `<div class="cupend">${t('cupRank', { o: ord(e.rank) })}${bonus} · ${t(e.last ? (e.gateNext ? 'topAgain' : 'topWin') : 'top3')}</div>`
    : '';
  // after the second-to-last race, say what is coming: the finale scores double (career.ts FINALE_PTS)
  // and, while it runs, the one thing the next race is for: the points to the places that go up (3.3.59)
  const fin = !e && l.race === l.races - 1 ? `${t('final')} · ${t('x2pts')}` : '';
  const goal = [fin, e ? '' : l.goal ?? ''].filter(Boolean).join(' · ');
  const next = goal ? `<div class="cupend">${goal}</div>` : '';
  return `<div class="cup"><div class="cuphead">${t('cupHead', { div: l.div })} · ${e ? t('final') : t('raceN', { n: l.race, m: l.races })}</div>${head}${rows}${next}</div>`;
}
