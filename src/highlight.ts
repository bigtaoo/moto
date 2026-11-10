// The race's best moment, shown again before the results: the race is re-simulated from its replay (the
// same seed and the player's recorded input reproduce it exactly), fast and unseen up to a little before the
// moment, then drawn at half speed from a camera at the roadside. A tap or a key skips it.

import * as C from './sim/config';
import type { World, SimEvent } from './sim/world';
import { Playback, type Replay } from './sim/replay';
import type { RaceView } from './view/scene';
import type { Hud } from './view/hud';
import { sfx } from './view/audio';
import { t } from './i18n';

/** Ticks shown before and after the moment, how fast, and the least a moment must score to be shown. */
export const HIGHLIGHT = { before: 40, after: 35, speed: 0.5, min: 3, perFrame: 400 };

/** The race's best moment so far: the tick and how good it was. */
export class Moments {
  tick = -1;
  score = 0;

  note(e: SimEvent, w: World): void {
    let s = 0;
    if (e.type === 'hit' && e.from === 0 && e.ko) s = 3 + (e.to === w.nemesis ? 2 : 0) + (e.power >= 1 ? 1 : 0);
    else if (e.type === 'land' && e.rider === 0 && e.stomp >= 0) s = 5;
    else if (e.type === 'bowl') s = 4;
    else if (e.type === 'boss') s = 6;
    else if (e.type === 'shove' && e.from === 0) s = e.into === 'car' ? 4 : 3;
    else if (e.type === 'crash' && e.rider === 0 && e.cause !== 'ko') s = 3; // a good wipeout is a highlight too
    // the later of two equal moments: the race's end is fresher
    if (s >= this.score && s > 0) {
      this.score = s;
      this.tick = w.tick;
    }
  }
}

/** The highlight playing on the race's view; `done` is called once, when it ends or is skipped. */
export class Highlight {
  private readonly pb: Playback;
  private readonly from: number;
  private readonly to: number;
  private acc = 0;
  private playing = false;
  private over = false;
  private readonly tag: HTMLElement;
  private readonly skip = (e: Event) => {
    e.preventDefault();
    this.end(true);
  };

  constructor(rep: Replay, at: number, private readonly view: RaceView, private readonly hud: Hud, private readonly done: (skipped: boolean) => void) {
    this.pb = new Playback(rep);
    this.from = Math.max(0, at - HIGHLIGHT.before);
    this.to = Math.min(rep.end, at + HIGHLIGHT.after);
    this.tag = document.createElement('div');
    this.tag.className = 'replaytag';
    this.tag.innerHTML = `<b>${t('replay')}</b><small>${t('tapSkip')}</small>`;
    hud.root.classList.add('cine');
    hud.root.appendChild(this.tag);
    // on the next frame's input, so the tap or key that ended the race doesn't skip it
    setTimeout(() => {
      if (this.over) return;
      addEventListener('pointerdown', this.skip, true);
      addEventListener('keydown', this.skip, true);
    }, 250);
  }

  frame(dt: number): void {
    if (this.over) return;
    const w = this.pb.world;
    if (!this.playing) {
      // catching up, unseen, a slice per frame so the page stays live
      for (let n = 0; n < HIGHLIGHT.perFrame && w.tick < this.from; n++) {
        this.pb.step();
        w.events.length = 0;
      }
      if (w.tick < this.from) return;
      this.playing = true;
      this.view.rebind(w);
      this.view.cine = w.player.x > 0 ? -1 : 1; // from the wider side of the road
      this.tag.classList.add('on');
    }
    this.acc += dt * HIGHLIGHT.speed;
    while (this.acc >= C.DT && w.tick < this.to) {
      this.acc -= C.DT;
      this.pb.step();
      for (const e of w.events.splice(0)) this.show(e, w);
    }
    this.view.update(dt * HIGHLIGHT.speed, Math.min(1, this.acc / C.DT));
    if (w.tick >= this.to) this.end(false);
  }

  /** Back to the race as it ended (the results go over it). */
  end(skipped: boolean): void {
    if (this.over) return;
    this.over = true;
    removeEventListener('pointerdown', this.skip, true);
    removeEventListener('keydown', this.skip, true);
    this.tag.remove();
    this.hud.root.classList.remove('cine');
    this.done(skipped);
  }

  /** What an event looks like in the replay: the bodies and the hits, no call-outs or pay. */
  private show(e: SimEvent, w: World): void {
    const v = this.view;
    switch (e.type) {
      case 'swing':
        v.riders[e.rider].swing(e.side, e.windup * C.DT);
        sfx.whoosh();
        break;
      case 'hit': {
        const r = w.riders[e.to];
        v.riders[e.to].hit(e.side, e.ko);
        v.fx.sparks(r.x - e.side * 0.3, 1.5, r.z, e.side, e.ko, Math.random);
        v.fx.pow(r.x - e.side * 0.35, 1.55, r.z, e.ko);
        sfx.thunk(e.ko);
        break;
      }
      case 'crash': {
        const r = w.riders[e.rider];
        v.riders[e.rider].setDown(true, e.vx < 0 ? -1 : 1);
        v.ragdolls[e.rider].throw(r.x, r.z, e.speed, e.vx, Math.random, e.cause === 'car' ? 1.45 : e.cause === 'wall' || e.cause === 'cones' ? 1.2 : 1);
        if (e.cause === 'cones') v.scatterCones(r.x, r.z);
        v.fx.dust(r.x, r.z, e.speed, Math.random);
        sfx.crash();
        break;
      }
      case 'recover':
        v.riders[e.rider].setDown(false);
        v.ragdolls[e.rider].hide();
        break;
      case 'bowl': {
        const r = w.riders[e.rider];
        v.fx.pow(r.x, 1.2, r.z, true);
        sfx.thunk(true);
        break;
      }
      case 'land':
        if (e.stomp >= 0) v.shake(0.3);
        break;
      default:
        break;
    }
  }
}
