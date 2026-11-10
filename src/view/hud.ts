// DOM overlay. Per-frame changes go through transform/opacity only; text is touched only when it changes.

import { icon } from './icons';
import { DESKTOP } from './input';
import type { World } from '../sim/world';
import { ATTACK, WEAPON } from '../sim/config';
import type { RaceView } from './scene';
import { BREAK_AT, type Nemesis } from '../career';
import { Results } from './results';
import { Menu } from './menu';
import { t, money } from '../i18n';

const $ = <T extends HTMLElement = HTMLElement>(root: ParentNode, sel: string) => root.querySelector(sel) as T;

/** The controls line: the keys where a mouse is the main pointer, else the touch controls. */
const CONTROLS = DESKTOP ? 'hintKeys' : 'hint';

export class Hud {
  readonly root: HTMLElement;
  private readonly placeEl: HTMLElement;
  private readonly hpEl: HTMLElement;
  private readonly cashEl: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly dots: HTMLElement[] = [];
  /** Each dot's last offset along the bar, in whole pixels: the transform is written only when it moves. */
  private dotPx: number[] = [];
  private readonly labels: HTMLElement[] = [];
  private readonly banner: HTMLElement;
  private readonly chaser: HTMLElement;
  private readonly hint: HTMLElement;
  private hintMode: 'off' | 'controls' | 'click' = 'off';
  private readonly slapL: HTMLElement;
  private readonly slapR: HTMLElement;
  private readonly incL: HTMLElement;
  private readonly incR: HTMLElement;
  private readonly heatEl: HTMLElement;
  private readonly leagueEl: HTMLElement;
  private readonly nemEl: HTMLElement;
  readonly remountBtn: HTMLButtonElement;
  private remountOn = false;
  private remountAt = 0;
  /** The remount button is up and has been long enough that a tap on it was meant for it, not a steer. */
  get remountArmed(): boolean {
    return this.remountOn && performance.now() - this.remountAt > 350;
  }
  /** Per rider: seconds left of a swing wound up at the player. */
  private tellT: number[] = [];
  readonly results: Results;
  readonly menu: Menu;
  readonly pauseBtn: HTMLButtonElement;
  /** The player's sound switch, on every screen. */
  readonly muteBtn: HTMLButtonElement;
  private soundOff = false;
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
          <button class="pausebtn" aria-label="Pause">${icon('pause')}</button>
        </div>
        <div class="prog"><div class="fill"></div></div>
        <div class="labels"></div>
        <div class="slap l"></div>
        <div class="slap r"></div>
        <div class="inc l">${icon('warn')}</div>
        <div class="inc r">${icon('warn')}</div>
        <div class="banner"></div>
        <div class="pops"></div>
        <div class="chaser"></div>
        <div class="hint"></div>
        <div class="league"></div>
        <div class="nemcard"></div>
        <button class="remount hidden"></button>
      </div>
      <div id="results" class="overlay hidden"><div class="card"></div></div>
      <div id="paused" class="overlay hidden"><div class="card small"></div></div>
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
    this.nemEl = $(this.root, '.nemcard');
    this.remountBtn = $(this.root, '.remount');
    this.results = new Results($(host, '#results'));
    this.menu = new Menu($(host, '#paused'));
    this.pauseBtn = $(this.root, '.pausebtn');
    this.muteBtn = host.appendChild(document.createElement('button'));
    this.muteBtn.className = 'mutebtn';
    this.localize();
    this.resize();
  }

  /** The fixed text, in the current language (again once the platform has said which). */
  localize(): void {
    this.slapL.innerHTML = `${icon('left')} ${t('slap')}`;
    this.slapR.innerHTML = `${t('slap')} ${icon('right')}`;
    this.hint.textContent = t(this.hintMode === 'click' ? 'clickForKeys' : CONTROLS);
    this.remountBtn.innerHTML = `<span>${icon('play')} ${t('backOnNow')}</span><small>${t('watchAd')}</small>`;
    this.pauseBtn.setAttribute('aria-label', t('pause'));
    this.setSound(!this.soundOff);
    this.menu.localize();
  }

  /** Show the sound switch as on or off. */
  setSound(on: boolean): void {
    this.soundOff = !on;
    this.muteBtn.innerHTML = icon(on ? 'soundOn' : 'soundOff');
    this.muteBtn.setAttribute('aria-label', t(on ? 'soundOn' : 'soundOff'));
    this.muteBtn.setAttribute('aria-pressed', String(!on));
  }

  resize(): void {
    this.barW = this.bar.clientWidth || 200;
    this.dotPx.fill(-1);
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
    this.dotPx = w.riders.map(() => -1);
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

  /** The nemesis card over the countdown: who, their record against the player, the bounty. */
  setNemesis(n: Nemesis | null, name: string, bounty: number): void {
    this.nemEl.className = 'nemcard';
    if (!n) return;
    this.nemEl.innerHTML = `<b>${icon('skull')} ${t('nemTitle', { name })}</b><span>${t('nemRecord', { hurt: n.hurt, paid: n.paid, max: BREAK_AT })}</span><span>${t('nemBounty', { n: bounty })}</span>`;
    void this.nemEl.offsetWidth;
    this.nemEl.className = 'nemcard show';
  }

  /** The "back on now" (rewarded ad) button, shown while the player is down. */
  showRemount(on: boolean): void {
    if (on === this.remountOn) return;
    this.remountOn = on;
    if (on) this.remountAt = performance.now();
    this.remountBtn.classList.toggle('hidden', !on);
  }

  /** The line low on the screen: the touch controls, a pulsing ask for a click while the keys can't reach the game, or nothing. */
  showHint(mode: 'off' | 'controls' | 'click'): void {
    if (mode === this.hintMode) return;
    this.hintMode = mode;
    if (mode !== 'off') this.hint.textContent = t(mode === 'click' ? 'clickForKeys' : CONTROLS);
    this.hint.classList.toggle('on', mode !== 'off');
    this.hint.classList.toggle('ask', mode === 'click');
  }

  flash(text: string, kind = ''): void {
    this.banner.textContent = text;
    this.banner.className = 'banner';
    void this.banner.offsetWidth; // restart the animation
    this.banner.className = `banner show ${kind}`;
    this.bannerT = 1.4;
  }

  /** A small call-out under the banner (near misses, KO chains): several can stack, each fades on its own. */
  pop(text: string, kind = ''): void {
    const box = this.root.querySelector('.pops');
    if (!box) return;
    while (box.childElementCount >= 3) box.firstElementChild!.remove();
    const el = document.createElement('div');
    el.className = `pop ${kind}`;
    el.textContent = text;
    el.addEventListener('animationend', () => el.remove());
    box.appendChild(el);
  }

  /** Rider `id` has wound up a swing at the player that lands in `secs`. */
  tell(id: number, secs: number): void {
    this.tellT[id] = secs + 0.05;
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
    if (cash !== this.last.cash) { this.cashEl.textContent = money(cash); this.last.cash = cash; }
    // progress
    const len = w.length;
    this.fill.style.transform = `scaleX(${Math.min(1, p.z / len)})`;
    for (let i = 0; i < w.riders.length; i++) {
      const px = Math.round(Math.min(1, Math.max(0, w.riders[i].z / len)) * this.barW);
      if (px === this.dotPx[i]) continue;
      this.dotPx[i] = px;
      this.dots[i].style.transform = `translate(${px}px, -50%)`;
    }
    // rival tags
    for (let i = 1; i < w.riders.length; i++) {
      const r = w.riders[i];
      const l = this.labels[i];
      const dz = r.z - p.z;
      const show = r.state === 'ride' && dz > -6 && dz < 45 && view.projectRider(i, 2.55, this.pt);
      l.classList.toggle('on', show);
      if (!show) continue;
      const nem = r.id === w.nemesis;
      if (l.classList.contains('nem') !== nem) l.classList.toggle('nem', nem);
      const grudge = !nem && w.grudges.has(r.id);
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
        `<i style="opacity:${i < lit ? 1 : i === lit ? 0.2 + 0.6 * (w.heat - lit) : 0.15}">${icon('star')}</i>`).join('');
      this.heatEl.classList.toggle('hot', lit >= 2);
    }
    // a rival hunting the leader from behind: who and how far back
    let chase = '';
    if (p.state !== 'away') {
      for (const r of w.riders) {
        const back = p.z - r.z;
        if (r.huntT > 0 && r.state === 'ride' && back > 4) { chase = `${r.name} ${icon('up')} ${Math.round(back)} m`; break; }
      }
    }
    if (chase !== this.last.chaser) {
      this.last.chaser = chase;
      if (chase) this.chaser.innerHTML = chase;
      this.chaser.classList.toggle('on', chase !== '');
    }
    if (this.bannerT > 0) {
      this.bannerT -= dt;
      if (this.bannerT <= 0) this.banner.className = 'banner';
    }
  }
}
