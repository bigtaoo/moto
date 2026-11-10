// What each sim event looks and sounds like: the HUD's call-outs, the hit effects, the camera's shake, the
// hitstop and the slow-motion beat. The race's end ('over') is the game flow's, in main.ts.

import type { World, SimEvent } from './sim/world';
import * as C from './sim/config';
import type { RaceView } from './view/scene';
import type { Hud } from './view/hud';
import { sfx } from './view/audio';
import * as tele from './telemetry';
import { REVENGE_PAY } from './career';
import { t, ord } from './i18n';

/** The game-feel state the events set and the frame loop runs down. */
export interface Feel {
  /** Seconds the sim stands still after a hit. */
  hitstop: number;
  /** Seconds of slow motion. */
  slow: number;
  /** Grudge KOs already called out this race. */
  lastGrudgeKos: number;
}

export const newFeel = (): Feel => ({ hitstop: 0, slow: 0, lastGrudgeKos: 0 });

export function react(e: SimEvent, w: World, view: RaceView, hud: Hud, feel: Feel): void {
  const near = (id: number) => id === 0 || Math.abs(w.riders[id].z - w.player.z) < 28;
  switch (e.type) {
    case 'go':
      hud.flash(t('go'), 'go');
      sfx.beep(true);
      break;
    case 'swing':
      view.riders[e.rider].swing(e.side, e.windup * C.DT);
      if (e.rider !== 0 && e.aim === 0) {
        hud.tell(e.rider, e.windup * C.DT);
        sfx.tell();
        setTimeout(() => sfx.whoosh(), Math.max(0, (e.windup - C.ATTACK.windup) * C.DT * 1000));
      } else if (near(e.rider)) sfx.whoosh();
      break;
    case 'whiff':
      if (e.dodged) {
        hud.flash(t('dodged'), 'go');
        sfx.dodge();
      }
      break;
    case 'steal':
      if (e.from === 0) {
        hud.flash(t(!e.took ? 'knockedLoose' : e.kind === 'pan' ? 'stolePan' : 'stoleBat'), 'go');
        sfx.pickup();
      } else if (e.to === 0) hud.flash(t(!e.took ? 'weaponLoose' : e.kind === 'pan' ? 'tookPan' : 'tookBat', { name: w.riders[e.from].name }), 'bad');
      break;
    case 'shove':
      if (e.from === 0) {
        feel.slow = 0.6;
        view.shake(0.35);
        if (e.to === w.nemesis) hud.flash(t('revenge', { n: Math.round(REVENGE_PAY * w.div.prize) + C.SHOVE_BONUS }), 'ko');
        else if (w.grudgeKos > feel.lastGrudgeKos) {
          feel.lastGrudgeKos = w.grudgeKos;
          hud.flash(t('grudgeSettled', { n: C.GRUDGE_BONUS + C.SHOVE_BONUS }), 'ko');
        } else hud.flash(t(e.into === 'car' ? 'intoTraffic' : e.into === 'cones' ? 'intoCones' : 'intoWall', { n: C.SHOVE_BONUS }), 'ko');
      }
      break;
    case 'hit': {
      const v = w.riders[e.to];
      view.riders[e.to].hit(e.side, e.ko);
      view.fx.sparks(v.x - e.side * 0.3, 1.5, v.z, e.side, e.ko, Math.random);
      view.fx.pow(v.x - e.side * 0.35, 1.55, v.z, e.ko);
      const mine = e.from === 0 || e.to === 0;
      if (mine) {
        feel.hitstop = e.ko ? 0.1 : 0.055;
        view.shake(e.to === 0 ? 0.45 : 0.22);
      }
      if (near(e.to)) sfx.thunk(e.ko);
      if (e.from === 0 && e.counter && !e.ko) hud.flash(t('counter'), 'ko');
      if (e.from === 0 && e.ko) {
        if (e.to === w.nemesis) hud.flash(t('revenge', { n: Math.round(REVENGE_PAY * w.div.prize) + C.KO_BONUS }), 'ko');
        else if (w.grudgeKos > feel.lastGrudgeKos) {
          feel.lastGrudgeKos = w.grudgeKos;
          hud.flash(t('grudgeSettled', { n: C.GRUDGE_BONUS + C.KO_BONUS }), 'ko');
        } else hud.flash(t('ko', { n: C.KO_BONUS }), 'ko');
      }
      break;
    }
    case 'crash': {
      const r = w.riders[e.rider];
      view.riders[e.rider].setDown(true, e.vx < 0 ? -1 : 1);
      view.ragdolls[e.rider].throw(r.x, r.z, e.speed, e.vx, Math.random, e.cause === 'car' ? 1.45 : e.cause === 'wall' || e.cause === 'cones' ? 1.2 : 1);
      if (e.cause === 'cones') view.scatterCones(r.x, r.z);
      view.fx.dust(r.x, r.z, e.speed, Math.random);
      if (e.rider === 0) {
        tele.crashed(e.cause);
        feel.slow = 0.55;
        view.shake(0.8);
        hud.flash(t(e.cause === 'car' ? 'wipeout' : e.cause === 'wall' ? 'slammed' : e.cause === 'cones' ? 'cones' : 'knockedOff'), 'bad');
      }
      if (near(e.rider)) sfx.crash();
      break;
    }
    case 'recover':
      view.riders[e.rider].setDown(false);
      view.ragdolls[e.rider].hide();
      break;
    case 'pickup':
      if (e.rider === 0) {
        hud.flash(t(e.kind === 'pan' ? 'fryingPan' : 'baseballBat'), 'go');
        sfx.pickup();
      }
      break;
    case 'patrolWarn':
      hud.flash(t('security'), 'warn');
      sfx.siren();
      break;
    case 'patrolLetGo':
      hud.flash(t('fined', { n: e.fine }), 'warn');
      break;
    case 'hunt':
      hud.flash(t('hunting', { name: w.riders[e.rider].name }), 'warn');
      sfx.alarm();
      break;
    case 'ambush':
      hud.flash(t(e.riders.length > 1 ? 'thugs' : 'thug'), 'warn');
      sfx.alarm();
      break;
    case 'grudge':
      hud.flash(t('holdsGrudge', { name: w.riders[e.rider].name }), 'warn');
      break;
    case 'finish':
      if (e.rider === 0) {
        hud.flash(t('finished', { o: ord(e.place) }), e.place === 1 ? 'go' : '');
        sfx.coin();
      }
      break;
    case 'rub':
      view.fx.scrape(e.x, e.z, Math.random);
      if (e.player || Math.abs(e.z - w.player.z) < 20) sfx.scrape(e.player);
      break;
    case 'drop':
      break;
    case 'jump':
      if (near(e.rider)) sfx.whoosh();
      if (e.rider === 0) hud.flash(t('air'), 'go');
      break;
    case 'land':
      if (near(e.rider)) sfx.thunk(e.stomp >= 0);
      if (e.rider === 0) view.shake(e.stomp >= 0 ? 0.5 : 0.2);
      if (e.stomp >= 0 && e.rider === 0) {
        feel.hitstop = 0.1;
        hud.flash(e.stomp === w.nemesis ? t('revenge', { n: Math.round(REVENGE_PAY * w.div.prize) + C.KO_BONUS }) : t('stomped', { name: w.riders[e.stomp].name, n: C.KO_BONUS }), 'ko');
      } else if (e.stomp === 0) hud.flash(t('landedOn', { name: w.riders[e.rider].name }), 'bad');
      break;
  }
}
