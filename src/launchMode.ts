// The launch mode's round, start to finish: the sim on ticks, its view, the input (a tap or a key lets go,
// left and right steer the flight), the overlay (distance, score, the lip meter, call-outs) and the card at
// the end, which pays the cash into the save. One round at a time; Again starts another on a new field.

import * as THREE from 'three';
import * as C from './sim/config';
import { LAUNCH, Launch, launchCash } from './sim/launch';
import { LaunchView } from './view/launch';
import { ENVS } from './view/env';
import type { Stage } from './view/stage';
import { PAINTS, HATS } from './shop';
import { type Save, storeSave } from './meta';
import { sfx, music, raceTrack } from './view/audio';
import { buzz } from './haptics';
import { t, money } from './i18n';
import * as funnel from './funnel';

/** Ticks at most per frame (a slow frame catches up, a long stall doesn't). */
const MAX_STEPS = 8;
/** Metres before the lip the meter shows. */
const METER = 30;

export class LaunchMode {
  private l!: Launch;
  private view!: LaunchView;
  private acc = 0;
  private overT = 0;
  private round = 0;
  private readonly root: HTMLElement;
  private readonly keys = { left: false, right: false };
  private pointer = 0;
  private readonly at = { x: 0, y: 0 };
  private readonly titleEl = document.getElementById('title');
  private readonly hudEl = document.getElementById('hud');
  /** The race's look, put back on the way out. */
  private readonly env0;

  /** `hide`: the race's view, put away while this runs; `done` is called after it has cleaned up. */
  constructor(private readonly stage: Stage, private readonly hide: THREE.Object3D, private readonly save: Save, app: HTMLElement, private readonly done: () => void) {
    this.env0 = stage.envNow;
    this.root = document.createElement('div');
    this.root.className = 'launch';
    app.appendChild(this.root);
    hide.visible = false;
    this.titleEl?.classList.add('hidden');
    this.hudEl?.classList.add('away');
    music(raceTrack(save.div));
    addEventListener('keydown', this.onKey);
    addEventListener('keyup', this.onKey);
    this.root.addEventListener('pointerdown', this.onDown);
    addEventListener('pointerup', this.onUp);
    addEventListener('pointercancel', this.onUp);
    this.start();
  }

  private get div(): C.Stage {
    return C.stage(this.save.div, this.save.tier, this.save.endless);
  }

  private start(): void {
    this.view?.dispose();
    const seed = (this.save.races * 131 + ++this.round * 977) % 99991;
    this.l = new Launch(seed);
    const paint = PAINTS[this.save.paint.cur];
    this.view = new LaunchView(this.stage, this.l, seed, ENVS[this.div.env], paint, HATS[this.save.hat.cur], this.save.garage.cur);
    this.acc = 0;
    this.overT = 0;
    this.root.innerHTML = `<button class="lx" aria-label="${t('back')}">✕</button>
      <div class="lhud"><b class="ld">0 m</b><span class="lp">0</span></div>
      <div class="lmeter"><i class="lzone"></i><i class="lsweet"></i><b class="lmark"></b></div>
      <div class="lhint">${t('launchTap')}</div><div class="ljudge"></div><div class="lpop"></div>`;
    this.root.querySelector<HTMLButtonElement>('.lx')!.onclick = () => this.exit();
    const zone = this.root.querySelector<HTMLElement>('.lzone')!;
    zone.style.left = `${(1 - LAUNCH.timing / METER) * 100}%`;
    this.root.querySelector<HTMLElement>('.lsweet')!.style.left = `${(1 - LAUNCH.sweet / METER) * 100}%`;
    funnel.event('launch_start', { round: Math.min(this.round, 20) });
  }

  private readonly onKey = (e: KeyboardEvent) => {
    const down = e.type === 'keydown';
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') this.keys.left = down;
    else if (e.code === 'ArrowRight' || e.code === 'KeyD') this.keys.right = down;
    else if (down && !e.repeat && (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW' || e.code === 'Enter')) {
      if (this.l.phase === 'run') this.l.input.release = true;
      else if (this.l.phase === 'done' && this.overT > 1) this.start();
    } else if (down && e.code === 'Escape') this.exit();
    else return;
    e.preventDefault();
  };

  private readonly onDown = (e: PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    if (this.l.phase === 'run') this.l.input.release = true;
    else this.pointer = e.clientX < innerWidth / 2 ? -1 : 1;
  };

  private readonly onUp = () => {
    this.pointer = 0;
  };

  frame(dt: number): void {
    const l = this.l;
    l.input.steer = this.pointer || (this.keys.right ? 1 : 0) - (this.keys.left ? 1 : 0);
    this.acc += dt;
    let n = 0;
    while (this.acc >= C.DT && n++ < MAX_STEPS) {
      this.acc -= C.DT;
      l.step();
      for (const e of l.events.splice(0)) {
        this.view.show(e);
        this.event(e);
      }
    }
    if (n >= MAX_STEPS) this.acc = 0;
    this.view.update(dt, Math.min(1, this.acc / C.DT));
    this.hud();
    if (l.phase === 'done') {
      this.overT += dt;
      if (this.overT > 0.9 && !this.root.querySelector('.lcard')) this.card();
    }
  }

  private event(e: Launch['events'][number]): void {
    if (e.type === 'release') {
      const key = !e.timed ? (this.l.z >= LAUNCH.lip ? 'launchLate' : 'launchEarly') : e.power >= 0.92 ? 'launchPerfect' : 'launchGood';
      this.judge(t(key), e.timed && e.power >= 0.92 ? 'perfect' : e.timed ? 'good' : 'miss');
      this.root.querySelector('.lmeter')?.classList.add('off');
      this.root.querySelector('.lhint')?.classList.add('off');
      buzz(e.timed ? 30 : 12);
    } else if (e.type === 'smash') {
      this.pop(`+${e.pts}${e.combo > 1 ? ` ×${e.combo}` : ''}`);
      buzz(e.combo > 1 ? [20, 30, 40] : 25);
    } else if (e.type === 'land' && e.speed > 10) buzz(18);
  }

  private judge(text: string, cls: string): void {
    const j = this.root.querySelector<HTMLElement>('.ljudge')!;
    j.textContent = text;
    j.className = `ljudge ${cls}`;
    void j.offsetWidth; // restart the animation
    j.classList.add('on');
  }

  private pop(text: string): void {
    const p = this.root.querySelector<HTMLElement>('.lpop')!;
    this.view.screenOf(this.at);
    p.textContent = text;
    p.style.left = `${Math.max(40, Math.min(innerWidth - 40, this.at.x))}px`;
    p.style.top = `${Math.max(60, this.at.y - 30)}px`;
    p.classList.remove('on');
    void p.offsetWidth;
    p.classList.add('on');
  }

  private hud(): void {
    const l = this.l;
    this.root.querySelector('.ld')!.textContent = `${Math.round(l.dist)} m`;
    this.root.querySelector('.lp')!.textContent = String(l.score);
    if (l.phase === 'run') {
      const before = LAUNCH.lip - l.z;
      this.root.querySelector<HTMLElement>('.lmark')!.style.left = `${(1 - Math.min(METER, before) / METER) * 100}%`;
      this.root.querySelector('.lmeter')!.classList.toggle('near', before <= METER);
    }
  }

  /** The round's card: how far, what it smashed, the pay (into the save now) and the best. */
  private card(): void {
    const l = this.l;
    const s = this.save;
    const cash = launchCash(l, this.div.prize);
    const best = l.score > s.launchBest;
    s.cash += cash;
    s.launchBest = Math.max(s.launchBest, l.score);
    storeSave(s);
    sfx.coin();
    funnel.event('launch_end', { dist: Math.round(l.dist), smashed: l.smashed, score: l.score, cash, best });
    const el = document.createElement('div');
    el.className = 'lcard card';
    el.innerHTML = `<h2>${t('launchGo')}</h2>
      <div class="st"><span>${t('launchDist')}</span><b>${Math.round(l.dist)} m</b></div>
      <div class="st"><span>${t('launchSmashed')}</span><b>${l.smashed}</b></div>
      <div class="st"><span>${t('launchScore')}</span><b>${l.score}</b></div>
      <div class="st me"><span>${t('earned')}</span><b>+${money(cash)}</b></div>
      <div class="lbest">${best ? `<em>${t('launchNewBest')}</em>` : t('launchBest', { n: s.launchBest })}</div>
      <button class="primary lagain">${t('launchAgain')}</button><button class="shift lback">${t('back')}</button>`;
    el.querySelector<HTMLButtonElement>('.lagain')!.onclick = () => this.start();
    el.querySelector<HTMLButtonElement>('.lback')!.onclick = () => this.exit();
    this.root.appendChild(el);
  }

  /** Back to the title: this round's road freed, the race's view and the title card back. */
  private exit(): void {
    removeEventListener('keydown', this.onKey);
    removeEventListener('keyup', this.onKey);
    removeEventListener('pointerup', this.onUp);
    removeEventListener('pointercancel', this.onUp);
    this.view.dispose();
    this.root.remove();
    this.hide.visible = true;
    this.stage.setEnv(this.env0);
    this.titleEl?.classList.remove('hidden');
    this.hudEl?.classList.remove('away');
    music('title');
    this.done();
  }
}
