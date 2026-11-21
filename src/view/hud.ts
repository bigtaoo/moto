// DOM overlay. Per-frame changes go through transform/opacity only; text is touched only when it changes.

import { icon } from './icons';
import { DESKTOP, controlKind, STEER_WORD as STEER, SLAP_WORD as SLAP, SLAP_BIG_WORD as SLAP_BIG } from './input';
import type { World } from '../sim/world';
import { ATTACK, WEAPON } from '../sim/config';
import type { RaceView } from './scene';
import { BREAK_AT, type Nemesis } from '../career';
import { Results } from './results';
import { Menu } from './menu';
import { Garage } from './garage';
import { t, money } from '../i18n';
import '../style.coach.css';

const $ = <T extends HTMLElement = HTMLElement>(root: ParentNode, sel: string) => root.querySelector(sel) as T;

/** Which halves of the controls line are still unlearnt. `null` is the ask for a click instead. */
export type Hint = { steer: boolean; slap: boolean } | null;
/** The same, as the HUD holds it: `null` has already become the click ask. */
type Want = { steer: boolean; slap: boolean } | 'off' | 'click';

/** Set a class only when it would change: a no-op `toggle` still dirties the element's style. */
const cls = (el: HTMLElement, name: string, on: boolean) => {
  if (el.classList.contains(name) !== on) el.classList.toggle(name, on);
};

/** A rival tag's height plus a hair of air: the step a tag is lifted to clear one already placed. */
const TAG_H = 20;

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
  /** Each rival tag's last screen spot, in tenths of a pixel: the transform is written only when it moves. */
  private tagX: number[] = [];
  private tagY: number[] = [];
  /** Each tag's width, measured once when the race's tags are built. */
  private tagW: number[] = [];
  /** Scratch for the tags already placed this frame: x, y, half-width per tag. */
  private readonly placed: number[] = [];
  /** The HUD's width: a tag is kept inside it, so a name never hangs off the screen. */
  private roomW = 0;
  private readonly banner: HTMLElement;
  private readonly chaser: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly coachEl: HTMLElement;
  private coachOn = false;
  private hintKey = '';
  private want: Want = 'off';
  private readonly slapL: HTMLElement;
  private readonly slapR: HTMLElement;
  private readonly incL: HTMLElement;
  private readonly incR: HTMLElement;
  private readonly heatEl: HTMLElement;
  private readonly leagueEl: HTMLElement;
  private readonly nemEl: HTMLElement;
  private readonly speedEl: HTMLElement;
  private readonly unitEl: HTMLElement;
  /** Seconds until the speedometer is next written: a few times a second, so the number can be read. */
  private speedT = 0;
  /** The taunt, up for a moment after the player puts someone down. */
  readonly tauntBtn: HTMLButtonElement;
  private tauntOn = false;
  /** Per rider: seconds left of a swing wound up at the player. */
  private tellT: number[] = [];
  readonly results: Results;
  readonly menu: Menu;
  /** Upgrades, rides and looks: reached from the title card and from the results. */
  readonly garage: Garage;
  readonly pauseBtn: HTMLButtonElement;
  /** The player's sound switch, on every screen. */
  readonly muteBtn: HTMLButtonElement;
  private soundOff = false;
  private barW = 200;
  private last = { place: '', hp: '', cash: -1, fill: -1, slapL: false, slapR: false, chaser: '', incL: false, incR: false, heat: '' };
  private bannerT = 0;
  private readonly pt = { x: 0, y: 0 };

  constructor(host: HTMLElement) {
    host.insertAdjacentHTML('beforeend', `
      <div id="hud">
        <div class="top">
          <div class="place"><b>8</b><span>/8</span></div>
          <div class="hp"></div>
          <div class="grow"></div>
          <button class="pausebtn" aria-label="Pause">${icon('pause')}</button>
        </div>
        <div class="prog"><div class="fill"></div></div>
        <div class="heat"></div>
        <div class="cash">$0</div>
        <div class="labels"></div>
        <div class="slap l"></div>
        <div class="slap r"></div>
        <div class="inc l">${icon('warn')}</div>
        <div class="inc r">${icon('warn')}</div>
        <div class="banner"></div>
        <div class="pops"></div>
        <div class="chaser"></div>
        <div class="hint"></div>
        <div class="coach"></div>
        <div class="league"></div>
        <div class="nemcard"></div>
        <div class="speedo"><b>0</b><span></span></div>
        <button class="taunt"></button>
      </div>
      <div id="results" class="overlay hidden"><div class="card"></div></div>
      <div id="garage" class="overlay hidden"><div class="card"></div></div>
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
    this.coachEl = $(this.root, '.coach');
    this.slapL = $(this.root, '.slap.l');
    this.slapR = $(this.root, '.slap.r');
    this.incL = $(this.root, '.inc.l');
    this.incR = $(this.root, '.inc.r');
    this.heatEl = $(this.root, '.heat');
    this.leagueEl = $(this.root, '.league');
    this.nemEl = $(this.root, '.nemcard');
    this.speedEl = $(this.root, '.speedo b');
    this.unitEl = $(this.root, '.speedo span');
    this.tauntBtn = $(this.root, '.taunt');
    this.results = new Results($(host, '#results'));
    this.menu = new Menu($(host, '#paused'));
    this.garage = new Garage($(host, '#garage'));
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
    this.coachEl.textContent = t(SLAP_BIG[controlKind()]);
    const want = this.want;
    this.hintKey = '';
    this.paintHint(want);
    this.pauseBtn.setAttribute('aria-label', t('pause'));
    this.unitEl.textContent = t('kmh');
    this.tauntBtn.textContent = DESKTOP ? `${t('taunt')} [T]` : t('taunt');
    this.setSound(!this.soundOff);
    this.menu.localize();
    this.garage.redraw();
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
    this.roomW = this.root.clientWidth || this.barW;
    this.dotPx.fill(-1);
    this.tagX.fill(NaN);
  }

  /** Build the per-race bits: progress dots and rival name tags. */
  /** `me`: the player's dot colour (their paint job). */
  setup(w: World, me?: number): void {
    for (const d of this.dots) d.remove();
    for (const l of this.labels) l.remove();
    this.dots.length = 0;
    this.labels.length = 0;
    const lab = $(this.root, '.labels');
    for (const r of w.riders) {
      const d = document.createElement('div');
      d.className = r.isPlayer ? 'dot me' : r.thug ? 'dot hidden' : 'dot';
      d.style.background = '#' + (r.isPlayer && me !== undefined ? me : r.body).toString(16).padStart(6, '0');
      this.bar.appendChild(d);
      this.dots.push(d);
      const l = document.createElement('div');
      l.className = r.thug ? 'tag thug' : r.boss ? 'tag boss' : 'tag';
      l.textContent = r.isPlayer ? '' : r.boss ? `${t('bossTag')} · ${r.name}` : r.name;
      lab.appendChild(l);
      this.labels.push(l);
    }
    this.last = { place: '', hp: '', cash: -1, fill: -1, slapL: false, slapR: false, chaser: '', incL: false, incR: false, heat: '' };
    this.speedT = 0;
    this.tellT = w.riders.map(() => 0);
    this.dotPx = w.riders.map(() => -1);
    this.tagX = w.riders.map(() => NaN);
    this.tagY = w.riders.map(() => NaN);
    this.tagW = this.labels.map((l) => l.offsetWidth); // one layout per race, read before anything moves
    this.chaser.classList.remove('on');
    this.banner.className = 'banner';
    this.root.classList.remove('flashing');
    this.resize();
  }

  /** The division and cup race, shown over the countdown. */
  /** `extra`: a second line under it (this race's mutator or boss). */
  setLeague(text: string, extra = ''): void {
    this.leagueEl.textContent = text;
    if (extra) {
      const s = document.createElement('small');
      s.textContent = extra;
      this.leagueEl.appendChild(s);
    }
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

  /**
   * The line low on the screen: whichever controls the player has not used yet, a pulsing ask for a click
   * while the keys can't reach the game, or nothing. 3.3.65: it used to be one line for the first 8 s of
   * the first two races, but in r46 the median first steer came at 7 s and the median first slap at 12 s,
   * with the slowest tenth at 28 s and 34 s - most of the tail only started looking for the controls after
   * the line had gone. Now each half stays up until that control has been used.
   */
  showHint(need: Hint | 'off'): void {
    this.paintHint(need === null ? 'click' : need);
  }

  private paintHint(want: Want): void {
    const kind = controlKind();
    const key = typeof want === 'string' ? want : `${kind}:${want.steer ? 1 : 0}${want.slap ? 1 : 0}`;
    if (key === this.hintKey) return;
    this.hintKey = key;
    this.want = want;
    let on = want !== 'off';
    if (want === 'click') this.hint.textContent = t('clickForKeys');
    else if (typeof want !== 'string') {
      const parts: string[] = [];
      if (want.steer) parts.push(t(STEER[kind]));
      if (want.slap) parts.push(t(SLAP[kind]));
      on = parts.length > 0;
      if (on) this.hint.textContent = parts.join(' · ');
    }
    this.hint.classList.toggle('on', on);
    this.hint.classList.toggle('ask', want === 'click');
    this.root.classList.toggle('hinting', on);
  }

  /** The big ask for the slap key over a slowed race (3.3.64). */
  coach(on: boolean): void {
    if (on === this.coachOn) return;
    this.coachOn = on;
    if (on) this.coachEl.textContent = t(SLAP_BIG[controlKind()]);
    this.coachEl.classList.toggle('on', on);
  }

  flash(text: string, kind = ''): void {
    this.banner.textContent = text;
    this.banner.className = 'banner';
    void this.banner.offsetWidth; // restart the animation
    this.banner.className = `banner show ${kind}`;
    this.bannerT = 1.4;
    // The banner crosses the lane the rival tags float in. They stand down while it is up, so the two
    // never garble each other -- a nemesis tag behind "KNOCKED OFF!" could not be read at all.
    this.root.classList.add('flashing');
  }

  /**
   * A small call-out under the banner: up to three stack and each fades on its own, so this is the lane for
   * anything that happens often (KOs, dodges, near misses, chains) -- see the note at the top of src/events.ts.
   */
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
    // on a security shift: runners caught out of the field
    const place = w.chase ? `${icon('target')}<b>${w.caught}</b><span>/${w.racers - 1}</span>` : `<b>${w.standing}</b><span>/${w.racers}</span>`;
    if (place !== this.last.place) { this.placeEl.innerHTML = place; this.last.place = place; }
    const hp = `${p.state === 'down' ? 0 : p.hp}/${p.maxHp}`;
    if (hp !== this.last.hp) {
      this.last.hp = hp;
      const cur = p.state === 'down' ? 0 : p.hp;
      this.hpEl.innerHTML = Array.from({ length: p.maxHp }, (_, i) => `<i class="${i < cur ? 'on' : ''}"></i>`).join('');
    }
    if (cash !== this.last.cash) { this.cashEl.textContent = money(cash); this.last.cash = cash; }
    // speedometer: 0 while off the scooter; yellow past the scooter's top speed (a ramp's boost)
    this.speedT -= dt;
    if (this.speedT <= 0) {
      this.speedT = 0.12;
      const kmh = p.state === 'ride' ? Math.round(p.speed * 3.6) : 0;
      const txt = String(kmh);
      if (txt !== this.speedEl.textContent) this.speedEl.textContent = txt;
      const fast = p.state === 'ride' && p.speed > p.top + 0.5;
      cls(this.speedEl, 'fast', fast);
    }
    // progress
    const len = w.length;
    // in thousandths of the bar: a finer step than a phone can show, and the write is skipped between them
    const prog = Math.round(Math.min(1, Math.max(0, p.z / len)) * 1000);
    if (prog !== this.last.fill) { this.last.fill = prog; this.fill.style.transform = `scaleX(${prog / 1000})`; }
    for (let i = 0; i < w.riders.length; i++) {
      if (w.chase) this.dots[i].classList.toggle('gone', w.riders[i].state === 'away'); // a runner caught
      const px = Math.round(Math.min(1, Math.max(0, w.riders[i].z / len)) * this.barW);
      if (px === this.dotPx[i]) continue;
      this.dotPx[i] = px;
      this.dots[i].style.transform = `translate(${px}px, -50%)`;
    }
    // rival tags. Two riders side by side used to print their names over each other, one name
    // unreadable under the other; a tag that would land on one already placed is lifted a row instead.
    // The order is the rider list, not the distance, so a pair trading places never makes them flicker.
    const placed = this.placed;
    placed.length = 0;
    for (let i = 1; i < w.riders.length; i++) {
      const r = w.riders[i];
      const l = this.labels[i];
      const dz = r.z - p.z;
      const show = r.state === 'ride' && dz > -6 && dz < 45 && view.projectRider(i, 2.55, this.pt);
      l.classList.toggle('on', show);
      if (!show) continue;
      const nem = r.id === w.nemesis;
      cls(l, 'nem', nem);
      const grudge = !nem && w.grudges.has(r.id);
      cls(l, 'grudge', grudge);
      const hunt = r.huntT > 0;
      cls(l, 'hunt', hunt);
      const tell = this.tellT[i] > 0;
      cls(l, 'tell', tell);
      const open = r.openT > 0 && !tell;
      cls(l, 'open', open);
      // an icon class adds its 1em badge in front of the name, which the measured width predates
      const half = (this.tagW[i] + (nem || grudge || hunt || tell || open ? 15 : 0)) / 2 + 3;
      // A rider at the edge of the road used to get a tag half off the screen (`.labels` clips it), so the
      // name was cut in two. Held inside the screen instead: it still sits over its rider, just not past the
      // edge. Clamped before the stacking pass, so two tags pushed to the same corner still part vertically.
      const lo = half + 4, hi = this.roomW - half - 4;
      let x = hi > lo ? Math.max(lo, Math.min(hi, this.pt.x)) : this.pt.x, y = this.pt.y;
      for (let pass = 0; pass < 3; pass++) {
        let hit = false;
        for (let k = 0; k < placed.length; k += 3) {
          if (Math.abs(x - placed[k]) < half + placed[k + 2] && Math.abs(y - placed[k + 1]) < TAG_H) {
            hit = true;
            y = placed[k + 1] - TAG_H;
          }
        }
        if (!hit) break;
      }
      placed.push(x, y, half);
      const tx = Math.round(x * 10), ty = Math.round(y * 10);
      if (tx === this.tagX[i] && ty === this.tagY[i]) continue;
      this.tagX[i] = tx;
      this.tagY[i] = ty;
      l.style.transform = `translate(${tx / 10}px, ${ty / 10}px) translate(-50%, -100%)`;
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
    const taunt = w.tauntT > 0 && p.state === 'ride';
    if (taunt !== this.tauntOn) { this.tauntOn = taunt; this.tauntBtn.classList.toggle('on', taunt); }
    if (this.bannerT > 0) {
      this.bannerT -= dt;
      if (this.bannerT <= 0) { this.banner.className = 'banner'; this.root.classList.remove('flashing'); }
    }
  }
}
