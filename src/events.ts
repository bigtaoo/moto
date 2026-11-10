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
import { buzz } from './haptics';

/** The game-feel state the events set and the frame loop runs down. */
export interface Feel {
  /** Seconds the sim stands still after a hit. */
  hitstop: number;
  /** Seconds of slow motion. */
  slow: number;
  /** Grudge KOs already called out this race. */
  lastGrudgeKos: number;
}

const WEAPON = { pan: ['stolePan', 'tookPan', 'fryingPan'], bat: ['stoleBat', 'tookBat', 'baseballBat'], oil: ['stoleOil', 'tookOil', 'oilCan'] } as const;
const INTO = { car: 'intoTraffic', cones: 'intoCones', wall: 'intoWall', oil: 'intoOil', cow: 'intoCow' } as const;
const FELL = { ko: 'knockedOff', car: 'wipeout', wall: 'slammed', cones: 'cones', oil: 'slipped', cow: 'moo' } as const;

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
        hud.flash(t(!e.took ? 'knockedLoose' : WEAPON[e.kind][0]), 'go');
        sfx.pickup();
      } else if (e.to === 0) hud.flash(t(!e.took ? 'weaponLoose' : WEAPON[e.kind][1], { name: w.riders[e.from].name }), 'bad');
      break;
    case 'shove':
      if (e.from === 0) {
        feel.slow = 0.6;
        view.shake(0.35);
        buzz(35);
        if (e.to === w.nemesis) hud.flash(t('revenge', { n: Math.round(REVENGE_PAY * w.div.prize) + C.SHOVE_BONUS }), 'ko');
        else if (w.grudgeKos > feel.lastGrudgeKos) {
          feel.lastGrudgeKos = w.grudgeKos;
          hud.flash(t('grudgeSettled', { n: C.GRUDGE_BONUS + C.SHOVE_BONUS }), 'ko');
        } else if (!w.chase) hud.flash(t(INTO[e.into], { n: C.SHOVE_BONUS }), 'ko');
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
        buzz(e.to === 0 ? (e.ko ? 70 : 30) : e.ko ? 45 : 15);
      }
      // a full haymaker landing: a longer freeze and a bigger jolt
      if (e.from === 0 && e.power >= 1) {
        feel.hitstop = 0.13;
        view.shake(0.4);
        buzz(55);
        hud.pop(t('haymaker'), 'big');
      }
      // the nemesis going down is the race's moment: let it play slowly
      if (e.from === 0 && e.ko && e.to === w.nemesis) feel.slow = 0.5;
      if (near(e.to)) sfx.thunk(e.ko);
      if (e.from === 0 && e.counter && !e.ko) hud.flash(t('counter'), 'ko');
      if (e.from === 0 && e.ko) {
        if (e.to === w.nemesis) hud.flash(t('revenge', { n: Math.round(REVENGE_PAY * w.div.prize) + C.KO_BONUS }), 'ko');
        else if (w.grudgeKos > feel.lastGrudgeKos) {
          feel.lastGrudgeKos = w.grudgeKos;
          hud.flash(t('grudgeSettled', { n: C.GRUDGE_BONUS + C.KO_BONUS }), 'ko');
        } else if (!w.chase) hud.flash(t('ko', { n: C.KO_BONUS }), 'ko');
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
        buzz([45, 40, 90]);
        view.shake(0.8);
        hud.flash(t(FELL[e.cause]), 'bad');
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
        hud.flash(t(WEAPON[e.kind][2]), 'go');
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
    case 'caught':
      hud.flash(t('caught', { name: w.riders[e.rider].name, n: Math.round(C.CHASE.bounty * w.div.prize) }), 'ko');
      buzz(25);
      break;
    case 'grudge':
      hud.flash(t('holdsGrudge', { name: w.riders[e.rider].name }), 'warn');
      break;
    case 'finish':
      if (e.rider === 0) {
        hud.flash(t('finished', { o: ord(e.place) }), e.place === 1 ? 'go' : '');
        sfx.coin();
        // a photo finish: someone right on the player's wheel as they cross
        if (w.riders.some((r) => r.id !== 0 && !r.finished && w.player.z - r.z < 5)) feel.slow = 0.6;
      }
      break;
    case 'rub':
      view.fx.scrape(e.x, e.z, Math.random);
      if (e.player || Math.abs(e.z - w.player.z) < 20) sfx.scrape(e.player);
      break;
    case 'drop':
      break;
    case 'bowl': {
      const v = w.riders[e.rider];
      view.fx.pow(v.x, 1.2, v.z, true);
      feel.hitstop = 0.07;
      view.shake(0.35);
      buzz(35);
      sfx.thunk(true);
      hud.pop(t('bowled', { n: e.pay }), 'big');
      break;
    }
    case 'oil':
      if (near(e.rider)) sfx.scrape(e.rider === 0);
      if (e.rider === 0) hud.flash(t('oilPoured'), 'go');
      break;
    case 'weed': {
      const r = w.riders[e.rider];
      view.fx.dust(r.x, r.z, 10, Math.random);
      if (near(e.rider)) sfx.thunk(false);
      if (e.rider === 0) {
        view.shake(0.25);
        buzz(20);
        hud.flash(t('tumbleweed'), 'bad');
      }
      break;
    }
    case 'taunt':
      sfx.coin();
      buzz(15);
      hud.pop(t('taunted', { n: e.pay }), 'big');
      break;
    case 'boss':
      feel.slow = 0.6;
      sfx.coin();
      hud.flash(t('bossDown', { n: e.pay }), 'ko');
      break;
    case 'nearMiss':
      hud.pop(t('closeCall', { n: e.pay }));
      sfx.whoosh();
      buzz(12);
      break;
    case 'combo':
      hud.pop(t('combo', { c: e.n, n: e.pay }), 'big');
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
        buzz(45);
        if (e.stomp === w.nemesis) feel.slow = 0.5;
        hud.flash(e.stomp === w.nemesis ? t('revenge', { n: Math.round(REVENGE_PAY * w.div.prize) + C.KO_BONUS }) : t('stomped', { name: w.riders[e.stomp].name, n: C.KO_BONUS }), 'ko');
      } else if (e.stomp === 0) {
        buzz(60);
        hud.flash(t('landedOn', { name: w.riders[e.rider].name }), 'bad');
      }
      break;
  }
}
