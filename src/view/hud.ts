// DOM overlay. Per-frame changes go through transform/opacity only; text is touched only when it changes.

import type { World } from '../sim/world';
import { ATTACK, WEAPON, UPGRADE_MAX, upgradeCost } from '../sim/config';
import type { RaceView } from './scene';
import type { Save } from '../meta';
import type { CupEnd } from '../career';

export interface League {
  /** The division this race was in. */
  div: string;
  /** Races of the cup run, this one included, and how many it has. */
  race: number;
  races: number;
  table: { name: string; pts: number; rank: number; me: boolean }[];
  /** Set when this race closed the cup. */
  end: CupEnd | null;
  /** The division the next race is in. */
  next: string;
}

const $ = <T extends HTMLElement = HTMLElement>(root: ParentNode, sel: string) => root.querySelector(sel) as T;

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
  fines: number;
  earned: number;
  time: number;
  grudges: string[];
  league: League;
}

type UpKey = keyof Save['up'];
const UP_NAMES: Record<UpKey, string> = { top: 'Top speed', steer: 'Handling', hp: 'Toughness' };

const ordinal = (n: number) => n + (n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th');

export class Hud {
  readonly root: HTMLElement;
  private readonly placeEl: HTMLElement;
  private readonly hpEl: HTMLElement;
  private readonly cashEl: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly dots: HTMLElement[] = [];
  private readonly labels: HTMLElement[] = [];
  private readonly banner: HTMLElement;
  private readonly chaser: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly slapL: HTMLElement;
  private readonly slapR: HTMLElement;
  private readonly incL: HTMLElement;
  private readonly incR: HTMLElement;
  private readonly heatEl: HTMLElement;
  private readonly leagueEl: HTMLElement;
  /** Per rider: seconds left of a swing wound up at the player. */
  private tellT: number[] = [];
  private readonly results: HTMLElement;
  private readonly pauseEl: HTMLElement;
  readonly pauseBtn: HTMLButtonElement;
  private barW = 200;
  private last = { place: '', hp: '', cash: -1, slapL: false, slapR: false, chaser: '', incL: false, incR: false, heat: '' };
  private bannerT = 0;
  private readonly pt = { x: 0, y: 0 };

  constructor(host: HTMLElement) {
    host.insertAdjacentHTML('beforeend', `
      <div id="hud">
        <div class="top">
          <div class="place"><b>8</b><span>/8</span></div>
          <div class="hp"></div>
          <div class="heat"></div>
          <div class="grow"></div>
          <div class="cash">$0</div>
          <button class="pausebtn" aria-label="Pause">II</button>
        </div>
        <div class="prog"><div class="fill"></div></div>
        <div class="labels"></div>
        <div class="slap l">◀ SLAP</div>
        <div class="slap r">SLAP ▶</div>
        <div class="inc l">⚠</div>
        <div class="inc r">⚠</div>
        <div class="banner"></div>
        <div class="chaser"></div>
        <div class="hint">Drag to steer · Tap to slap</div>
        <div class="league"></div>
      </div>
      <div id="results" class="overlay hidden"><div class="card"></div></div>
      <div id="paused" class="overlay hidden"><div class="card small"><h2>Paused</h2><button class="primary">Resume</button></div></div>
    `);
    this.root = $(host, '#hud');
    this.placeEl = $(this.root, '.place');
    this.hpEl = $(this.root, '.hp');
    this.cashEl = $(this.root, '.cash');
    this.bar = $(this.root, '.prog');
    this.fill = $(this.root, '.prog .fill');
    this.banner = $(this.root, '.banner');
    this.chaser = $(this.root, '.chaser');
    this.hint = $(this.root, '.hint');
    this.slapL = $(this.root, '.slap.l');
    this.slapR = $(this.root, '.slap.r');
    this.incL = $(this.root, '.inc.l');
    this.incR = $(this.root, '.inc.r');
    this.heatEl = $(this.root, '.heat');
    this.leagueEl = $(this.root, '.league');
    this.results = $(host, '#results');
    this.pauseEl = $(host, '#paused');
    this.pauseBtn = $(this.root, '.pausebtn');
    this.resize();
  }

  get pauseResume(): HTMLButtonElement {
    return $(this.pauseEl, 'button');
  }

  resize(): void {
    this.barW = this.bar.clientWidth || 200;
  }

  /** Build the per-race bits: progress dots and rival name tags. */
  setup(w: World): void {
    for (const d of this.dots) d.remove();
    for (const l of this.labels) l.remove();
    this.dots.length = 0;
    this.labels.length = 0;
    const lab = $(this.root, '.labels');
    for (const r of w.riders) {
      const d = document.createElement('div');
      d.className = r.isPlayer ? 'dot me' : r.thug ? 'dot hidden' : 'dot';
      d.style.background = '#' + r.body.toString(16).padStart(6, '0');
      this.bar.appendChild(d);
      this.dots.push(d);
      const l = document.createElement('div');
      l.className = r.thug ? 'tag thug' : 'tag';
      l.textContent = r.isPlayer ? '' : r.name;
      lab.appendChild(l);
      this.labels.push(l);
    }
    this.last = { place: '', hp: '', cash: -1, slapL: false, slapR: false, chaser: '', incL: false, incR: false, heat: '' };
    this.tellT = w.riders.map(() => 0);
    this.chaser.classList.remove('on');
    this.banner.className = 'banner';
    this.resize();
  }

  /** The division and cup race, shown over the countdown. */
  setLeague(text: string): void {
    this.leagueEl.textContent = text;
    this.leagueEl.className = 'league';
    void this.leagueEl.offsetWidth;
    this.leagueEl.className = 'league show';
  }

  showHint(on: boolean): void {
    this.hint.classList.toggle('on', on);
  }

  flash(text: string, kind = ''): void {
    this.banner.textContent = text;
    this.banner.className = 'banner';
    void this.banner.offsetWidth; // restart the animation
    this.banner.className = `banner show ${kind}`;
    this.bannerT = 1.4;
  }

  /** Rider `id` has wound up a swing at the player that lands in `secs`. */
  tell(id: number, secs: number): void {
    this.tellT[id] = secs + 0.05;
  }

  setPaused(on: boolean): void {
    this.pauseEl.classList.toggle('hidden', !on);
  }

  update(w: World, view: RaceView, cash: number, dt: number): void {
    const p = w.player;
    const place = `<b>${w.standing}</b><span>/${w.racers}</span>`;
    if (place !== this.last.place) { this.placeEl.innerHTML = place; this.last.place = place; }
    const hp = `${p.state === 'down' ? 0 : p.hp}/${p.maxHp}`;
    if (hp !== this.last.hp) {
      this.last.hp = hp;
      const cur = p.state === 'down' ? 0 : p.hp;
      this.hpEl.innerHTML = Array.from({ length: p.maxHp }, (_, i) => `<i class="${i < cur ? 'on' : ''}"></i>`).join('');
    }
    if (cash !== this.last.cash) { this.cashEl.textContent = `$${cash}`; this.last.cash = cash; }
    // progress
    const len = w.length;
    this.fill.style.transform = `scaleX(${Math.min(1, p.z / len)})`;
    for (let i = 0; i < w.riders.length; i++) {
      const f = Math.min(1, Math.max(0, w.riders[i].z / len));
      this.dots[i].style.transform = `translate(${f * this.barW}px, -50%)`;
    }
    // rival tags
    for (let i = 1; i < w.riders.length; i++) {
      const r = w.riders[i];
      const l = this.labels[i];
      const dz = r.z - p.z;
      const show = r.state === 'ride' && dz > -6 && dz < 45 && view.projectRider(i, 2.55, this.pt);
      l.classList.toggle('on', show);
      if (!show) continue;
      const grudge = w.grudges.has(r.id);
      if (l.classList.contains('grudge') !== grudge) l.classList.toggle('grudge', grudge);
      const hunt = r.huntT > 0;
      if (l.classList.contains('hunt') !== hunt) l.classList.toggle('hunt', hunt);
      const tell = this.tellT[i] > 0;
      if (l.classList.contains('tell') !== tell) l.classList.toggle('tell', tell);
      const open = r.openT > 0 && !tell;
      if (l.classList.contains('open') !== open) l.classList.toggle('open', open);
      l.style.transform = `translate(${this.pt.x.toFixed(1)}px, ${this.pt.y.toFixed(1)}px) translate(-50%, -100%)`;
    }
    // slap reach indicators
    let left = false;
    let right = false;
    if (p.state === 'ride') {
      const reach = ATTACK.reachX + (p.weapon ? WEAPON[p.weapon].reach : 0) + 0.3;
      for (const o of w.riders) {
        if (o === p || o.state !== 'ride') continue;
        const dx = o.x - p.x;
        if (Math.abs(o.z - p.z) > ATTACK.reachZ + 0.3 || Math.abs(dx) > reach || Math.abs(dx) < ATTACK.minX) continue;
        if (dx > 0) right = true;
        else left = true;
      }
    }
    if (left !== this.last.slapL) { this.slapL.classList.toggle('on', left); this.last.slapL = left; }
    if (right !== this.last.slapR) { this.slapR.classList.toggle('on', right); this.last.slapR = right; }
    // a swing coming in: which side to get away from
    let incL = false;
    let incR = false;
    for (let i = 1; i < this.tellT.length; i++) {
      if (this.tellT[i] <= 0) continue;
      this.tellT[i] -= dt;
      const r = w.riders[i];
      if (r.state !== 'ride' || p.state !== 'ride') { this.tellT[i] = 0; continue; }
      if (r.x > p.x) incR = true;
      else incL = true;
    }
    if (incL !== this.last.incL) { this.incL.classList.toggle('on', incL); this.last.incL = incL; }
    if (incR !== this.last.incR) { this.incR.classList.toggle('on', incR); this.last.incR = incR; }
    // heat: a star per level, the next one filling in
    const lit = Math.floor(w.heat);
    const heat = w.heat < 0.05 ? '' : `${lit}:${Math.round((w.heat - lit) * 4)}`;
    if (heat !== this.last.heat) {
      this.last.heat = heat;
      this.heatEl.innerHTML = heat === '' ? '' : Array.from({ length: 3 }, (_, i) =>
        `<i style="opacity:${i < lit ? 1 : i === lit ? 0.2 + 0.6 * (w.heat - lit) : 0.15}">★</i>`).join('');
      this.heatEl.classList.toggle('hot', lit >= 2);
    }
    // a rival hunting the leader from behind: who and how far back
    let chase = '';
    if (p.state !== 'away') {
      for (const r of w.riders) {
        const back = p.z - r.z;
        if (r.huntT > 0 && r.state === 'ride' && back > 4) { chase = `${r.name} ▲ ${Math.round(back)} m`; break; }
      }
    }
    if (chase !== this.last.chaser) {
      this.last.chaser = chase;
      if (chase) this.chaser.textContent = chase;
      this.chaser.classList.toggle('on', chase !== '');
    }
    if (this.bannerT > 0) {
      this.bannerT -= dt;
      if (this.bannerT <= 0) this.banner.className = 'banner';
    }
  }

  hideResults(): void {
    this.results.classList.add('hidden');
  }

  showResults(res: RaceResult, save: Save, onBuy: (k: UpKey) => void, onAgain: () => void): void {
    const card = $(this.results, '.card');
    const row = (a: string, b: string, cls = '') => `<div class="row ${cls}"><span>${a}</span><b>${b}</b></div>`;
    const ups = (Object.keys(UP_NAMES) as UpKey[]).map((k) => {
      const lvl = save.up[k];
      const max = lvl >= UPGRADE_MAX;
      const cost = upgradeCost(lvl);
      const pips = Array.from({ length: UPGRADE_MAX }, (_, i) => `<i class="${i < lvl ? 'on' : ''}"></i>`).join('');
      return `<div class="up"><div class="upname">${UP_NAMES[k]}<div class="pips">${pips}</div></div>
        <button data-k="${k}" ${max || save.cash < cost ? 'disabled' : ''}>${max ? 'MAX' : '$' + cost}</button></div>`;
    }).join('');
    card.innerHTML = `
      <h2 class="${res.place === 1 ? 'win' : ''}">${ordinal(res.place)} place</h2>
      <div class="sub">${res.time.toFixed(1)} s</div>
      <div class="rows">
        ${row(`Prize (${ordinal(res.place)})`, `$${res.prize}`)}
        ${row(`Knockouts × ${res.kos}`, `$${res.koBonus}`)}
        ${res.shoves ? row(`Into traffic or the wall × ${res.shoves}`, `$${res.shoveBonus}`, 'good') : ''}
        ${res.grudgeKos ? row(`Grudges settled × ${res.grudgeKos}`, `$${res.grudgeBonus}`, 'good') : ''}
        ${res.fines ? row('Security fines', `−$${res.fines}`, 'bad') : ''}
        ${row('Earned', `$${res.earned}`, 'total')}
      </div>
      ${this.leagueHtml(res.league)}
      ${res.grudges.length ? `<div class="grudges">Holding a grudge: <b>${res.grudges.join(', ')}</b><br><small>Knock them off next race for +$150 each</small></div>` : ''}
      <div class="cashline">Cash <b>$${save.cash}</b></div>
      <div class="ups">${ups}</div>
      <button class="primary again">${res.league.end ? (res.league.end.promoted ? `On to ${res.league.next}` : res.league.end.champion ? 'Defend the title' : `Retry the ${res.league.next} cup`) : 'Next race'}</button>`;
    card.querySelectorAll<HTMLButtonElement>('.up button').forEach((b) => {
      b.onclick = () => onBuy(b.dataset.k as UpKey);
    });
    $<HTMLButtonElement>(card, '.again').onclick = onAgain;
    this.results.classList.remove('hidden');
  }

  /** The cup table after this race (the top 3 and the player), and how the cup ended if it did. */
  private leagueHtml(l: League): string {
    const rows = l.table.filter((t) => t.rank <= 3 || t.me).map((t) =>
      `<div class="st ${t.me ? 'me' : ''} ${t.rank <= 3 ? 'up' : ''}"><span>${t.rank}. ${t.name}</span><b>${t.pts}</b></div>`).join('');
    const e = l.end;
    const head = e
      ? e.champion ? `<div class="cupend win">CHAMPION! +$${e.bonus}</div>`
        : e.promoted ? `<div class="cupend win">${ordinal(e.rank)} in the cup · PROMOTED${e.bonus ? ` +$${e.bonus}` : ''}</div>`
        : `<div class="cupend">${ordinal(e.rank)} in the cup${e.bonus ? ` +$${e.bonus}` : ''} · top 3 go up</div>`
      : '';
    return `<div class="cup"><div class="cuphead">${l.div} cup · ${e ? 'final' : `race ${l.race}/${l.races}`}</div>${head}${rows}</div>`;
  }
}
