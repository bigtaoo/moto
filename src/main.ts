// Wires the 30 Hz sim to the 3D view, the HUD, input, sound and the save.

import './style.css';
import { World } from './sim/world';
import { react, newFeel } from './events';
import * as C from './sim/config';
import * as L from './sim/ladder';
import { botInput } from './sim/ai';
import { Recorder } from './sim/replay';
import { RaceView } from './view/scene';
import { Stage } from './view/stage';
import { Controls, controlKind, keysReach, riderBounds } from './view/input';
import { Hud } from './view/hud';
import { drawTitle } from './view/titleCard';
import { openGarage, garageStop } from './view/garageOpen';
import { wireMenu, wireChrome, menuSettings, type Wiring } from './view/wiring';
import { sfx, unlockAudio, hold, setMuted, setChannel, music, raceTrack, shiftTrack, preloadAudio, TITLE_TRACK } from './view/audio';
import { installIconCss } from './view/icons';
import { statsOverlay } from './view/stats';
import * as funnel from './funnel';
import * as tele from './telemetry';
import { parseSave, storeSave, type Save } from './meta';
import { cupRaces, FIRST_CUP, isFinale, pickDiv, riderName, REVENGE_PAY } from './career';
import { settleWorld } from './raceEnd';
import { BOSS } from './sim/fun';
import { Moments, Highlight, HIGHLIGHT } from './highlight';
import { LaunchMode } from './launchMode';
import { today } from './daily';
import * as platform from './platform';
import { setLang, loadLang, t, money } from './i18n';
import { setHaptics } from './haptics';
import { MOTION, setCalm } from './view/motion';
import { PAINTS, HATS } from './shop';
import { shopActions, counted } from './shopping';
import { finishFree, finishShift, finishDaily, type SideCtx } from './sideRaces';
import type { Free } from './free';
import { raceOpts } from './raceOpts';
import { openFree, openStop } from './view/scenes';
import { blocker } from './view/blocker';
import { SlapCoach, StartCoach, hintNeed, usedControl } from './coach';
import { KeyWait } from './keyWait';
import { unlock, visit, dayMult, type Unlocked } from './rewards';

const params = new URLSearchParams(location.search);
// English until the platform says otherwise (3.4.2: the language comes from the Bridge only); ?lang=xx wins
setLang(params.get('lang') ?? 'en');
installIconCss();
// no long-press menu, text selection callout or drag ghost on a phone (Playgama 1.4.5)
document.addEventListener('contextmenu', (e) => e.preventDefault());
const BOT = params.has('bot');
const LEN = Number(params.get('len')) || undefined;

const canvas = document.getElementById('c') as HTMLCanvasElement;
const app = document.getElementById('app')!;
const titleEl = document.getElementById('title')!;
/** Made in the boot, once the Bridge is up: a browser without WebGL gets a message instead of a dead page. */
let stage!: Stage;
const hud = new Hud(app);
let save!: Save;

/** The title screen and the HUD's fixed text, in the current language. */
function localize(): void {
  titleEl.querySelector('p')!.textContent = t('tagline');
  titleEl.querySelector('button')!.textContent = t('race');
  hud.localize();
}
localize();

let world!: World;
let view!: RaceView;
let recorder!: Recorder;
let moments = new Moments();
/** The race's best moment, playing again before the results. */
let cine: Highlight | null = null;
let launch: LaunchMode | null = null;
let state: 'title' | 'race' | 'results' = 'title';
/** This race is a security shift (src/shift.ts), and how many this session has run (each its own seed). */
let chase = false;
let shifts = 0;
/** This race is the free one the player picked, and what they staked on it (src/free.ts). */
let free: Free | null = null;
let frees = 0;
/** This race is today's daily challenge (src/dailyRace.ts), which is the same race for everybody. */
let dayRace = false;

/** Change screens: the HUD layout and the music follow. */
function setState(s: typeof state): void {
  state = s;
  if (s === 'results') coach.stop(); // not on 'title': the boot's newRace() armed it for the race behind the card
  funnel.setScreen(s);
  app.classList.toggle('racing', s === 'race');
  music(s !== 'race' ? TITLE_TRACK : chase ? shiftTrack(shifts) : raceTrack(save.div, save.tier, save.cup.race, isFinale(save.cup)));
}
let paused = false;
/** The host (or an ad) has the game paused; separate from the player's own pause menu. */
let hostPaused = false;
/** The WebGL context is gone: nothing runs until it is back. */
let glLost = false;
/** The countdown's wait for a keyboard player's click, and the telemetry for it (src/keyWait.ts). */
const keys = new KeyWait((seconds, held) => funnel.event('keys_wait', { seconds, held: held ? 1 : 0 }));
let acc = 0;
/** Hitstop, slow motion and the grudge call-outs, which the events set (src/events.ts). */
let feel = newFeel();
let atkBuffer = 0;
/** The first slap, taught by force in a rookie's first race (3.3.64, src/coach.ts). */
const coach = new SlapCoach((r) => funnel.event('slap_coach', { slapped: r.slapped, ms: r.ms, n: r.n, early: r.early, kind: controlKind() }));
/** The first steer, asked for on the last beat of a new player's first countdown (3.3.82, src/coach.ts). */
const startCoach = new StartCoach((r) => funnel.event('start_coach', { steered: r.steered, ms: r.ms, shown: r.shown, kind: controlKind() }));
let lastCount = -1;
/** Times the player came off this race (for the daily "without falling off"). */
let falls = 0;
/** The world whose race was settled: a race pays out once, whatever happens after. */
let settled: World | null = null;

const controls = new Controls(canvas, () => (world ? world.player.x : 0),
  () => (world ? riderBounds(world) : [-C.EDGE, C.EDGE]), () => (view ? view.steerPxPerMetre() : 0));

function newRace(): void {
  view?.dispose();
  const opts = raceOpts(save, { chase, free, daily: dayRace, n: chase ? ++shifts : free ? ++frees : 0, length: LEN });
  world = new World(opts);
  recorder = new Recorder(opts);
  moments = new Moments();
  const paint = PAINTS[save.paint.cur];
  view = new RaceView(stage, world, opts.seed, paint, HATS[save.hat.cur]);
  hud.setup(world, paint.body);
  hud.results.hide();
  intro();
  controls.reset();
  startCoach.arm(!BOT && save.races === 0);
  acc = 0;
  feel = newFeel(save.life.kos === 0);
  atkBuffer = 0;
  coach.arm(!BOT && !chase && save.races === 0); // 3.3.65: on every device, not only `pointer: fine` ones
  lastCount = -1;
  falls = 0;
}

/** The division pill and the nemesis card, over the countdown. */
function intro(): void {
  const nem = world.chase || free || dayRace ? null : save.feud.nemesis;
  // the daily's twist is the day's, and it pays no purse: "this week · prize ×1.25" would be two lies
  const extra = dayRace ? (world.mutator ? t('dRaceMut', { name: t(`mut_${world.mutator}`) }) : '')
    : world.mutator ? t('mutPill', { name: t(`mut_${world.mutator}`) }) : world.boss >= 0 ? `${t('bossPill', { n: Math.round(BOSS.pay * world.div.prize) })} · ${t('x2pts')}` : '';
  // a free race is nobody's cup: the stage's name and the stake, not "race 1 of 4" (3.3.69)
  const league = world.chase ? t('shiftPill')
    : dayRace ? `${world.div.name} · ${t('dRace')}`
    : free ? `${world.div.name} · ${t('freeStake')} ${money(free.stake)}`
    : t('pill', { div: world.div.name, n: save.cup.race + 1, m: cupRaces(save.cup) });
  hud.setLeague(league, extra);
  hud.setNemesis(nem, nem ? riderName(nem.id) : '', Math.round(REVENGE_PAY * world.div.prize));
}

function startRace(): void {
  if (!world || state !== 'title') return; // still booting, or already gone
  intro(); // the first race's ran behind the title
  controls.grab();
  stage.raceStart();
  unlockAudio();
  titleEl.classList.add('hidden');
  setState('race');
  if (chase || free || dayRace) return;
  platform.lifecycle('level_started', { world: world.div.name, level: String(save.cup.race + 1) });
  if (!BOT) tele.raceStart(world);
}

/** From the results (or a restart): the next race, straight into its countdown. */
function nextRace(placement: string, shift = false): void {
  // 3.3.59: no ad inside a new player's first cup; it is the stretch where the sandbox loses them.
  // 3.3.83: nor on the beat that ends it. `>=` put the career's first interstitial exactly between the
  // cup ceremony and the first race of the new division -- the one race r53 lost 10 of 16 players in the
  // middle of -- and the garage stop now stands there too. The first ad waits until that race is behind them.
  if (save.races > FIRST_CUP) platform.interstitial(placement);
  chase = shift;
  newRace();
  stage.raceStart();
  setState('race');
  if (chase || free || dayRace) return;
  platform.lifecycle('level_started', { world: world.div.name, level: String(save.cup.race + 1) });
  tele.raceStart(world);
}

/** Out of a race or the results and back to the title card (3.3.33: nothing ever went back, so the launch
 * game, the achievements, the board and the streak's ad all sat where a reload was the only way to them). */
function backToTitle(): void {
  if (state === 'title' || launch) return;
  setPaused(false);
  chase = false;
  free = null;
  dayRace = false;
  newRace(); // the next race waits behind the card, as it does on a boot
  setState('title');
  titleEl.classList.remove('hidden');
  showTitle();
}

/** The garage over the card that asked for it, and the stop before a race (src/view/garageOpen.ts). */
const garage = (acts: ReturnType<typeof shopActions>, back: () => void, from: 'results' | 'title' | 'stop'): void =>
  openGarage(hud.garage, save, acts, back, from, state);

function finishRace(): void {
  const w = world;
  if (settled === w) return;
  settled = w;
  if (free) return finishFree(side(), w, free);
  if (dayRace) return finishDaily(side(), w, falls);
  if (w.chase) return finishShift(side(), w);
  const res = settleWorld(save, w, falls);
  const place = res.place;
  setState('results');
  platform.lifecycle(place <= L.PROMOTE ? 'level_completed' : 'level_failed', { world: w.div.name, level: String(res.league.race) });
  const show = () => hud.results.show(res, save, {
    garage: () => { hud.results.hide(); garage(shop, show, 'results'); },
    double, again: () => {
      if (!garageStop(save)) return nextRace('race_end');
      hud.results.hide();
      garage(shop, () => nextRace('race_end'), 'stop');
    }, shift: () => nextRace('race_end', true), home: backToTitle,
  });
  const double = () => {
    void platform.showRewarded('double_cash').then((ok) => {
      if (ok && !res.doubled) {
        save.cash += res.earned;
        res.earned *= 2;
        res.doubled = true;
        storeSave(save);
        sfx.coin();
      }
      if (state === 'results') show();
    });
  };
  const shop = shopActions(save, () => hud.garage.redraw(), (u) => res.ach.push(...u));
  if (BOT || moments.score < HIGHLIGHT.min) return show();
  cine = new Highlight(recorder.finish(w), moments.tick, view, hud, (skipped) => {
    cine = null;
    view.cine = 0;
    view.rebind(w);
    funnel.event('highlight', { skipped });
    show();
  });
}

/** Take the stake and line up the free race the player picked (src/free.ts). */
function startFree(f: Free): void {
  free = f;
  save.cash -= f.stake;
  storeSave(save);
  funnel.event('free_start', { div: f.div, tier: f.tier, stake: f.stake, cash: save.cash });
}

/** What the side races are settled with (src/sideRaces.ts). */
const side = (): SideCtx => ({ save, app, results: hud.results, shown: () => setState('results'), next: nextRace, home: backToTitle, stake: startFree, shifts });

function tick(): void {
  const inp = world.input;
  if (state === 'race' && BOT) {
    botInput(world, 0.8);
  } else if (state === 'race') {
    inp.targetX = controls.targetX;
    inp.steer = controls.steer;
    if (controls.steer !== 0 || controls.targetX !== null) { usedControl('steer'); funnel.tutorialStep('steer'); }
    inp.brake = controls.brake;
    if (controls.attack) { atkBuffer = 8; controls.attack = false; }
    inp.attack = atkBuffer > 0;
    inp.charge = controls.charge;
    inp.taunt = controls.taunt;
    controls.taunt = false;
  } else {
    inp.targetX = null; // a finger left on the screen when the race ended must not steer the results away
    inp.steer = 0;
    inp.brake = false;
    inp.attack = false;
    inp.charge = false;
  }
  recorder.capture(world);
  world.step();
  let swung = false;
  let over = false;
  // taken off the world before any is handled: one that throws must not leave the rest, the race's end
  // above all, to be handled again on every tick after
  for (const e of world.events.splice(0)) {
    if (e.type === 'swing' && e.rider === 0) { swung = true; usedControl('slap'); funnel.tutorialStep('slap'); coach.swung(); }
    if (e.type === 'hit' && e.from === 0) funnel.tutorialStep('hit');
    if (e.type === 'crash' && e.rider === 0) falls++;
    if (state === 'race') moments.note(e, world);
    if (e.type === 'over') over = true;
    else try { react(e, world, view, hud, feel); } catch (err) { setTimeout(() => { throw err; }); } // reported as any other error, the race goes on
  }
  if (over) finishRace();
  if (swung) atkBuffer = 0;
  else if (atkBuffer > 0) atkBuffer--;
  // countdown beeps
  if (world.countdown > 0) {
    const n = Math.ceil(world.countdown / C.TICK_HZ);
    if (n !== lastCount) {
      lastCount = n;
      hud.flash(String(n), 'count');
      sfx.beep(false);
    }
  }
}

/** The player's own pause and its menu. */
function setPaused(on: boolean): void {
  if (state !== 'race' || paused === on) return;
  paused = on;
  if (on && !document.hidden) tele.paused();
  hud.menu.show(on, menuSettings(save));
  hold('pause', on);
}

platform.host.onPause = (on) => {
  hostPaused = on;
  hold('host', on);
  // the ad is closing: this, not the showInterstitial() call, is the moment the keyboard can be asked back
  // (the ad frame holds the focus for as long as it is open)
  if (!on) controls.grab();
};
platform.host.onAudio = (on) => setMuted('host', !on);

/** Everything the pause menu and the page chrome reach back into (src/view/wiring.ts). */
const wiring: Wiring = {
  save: () => save, hud, controls, stage: () => stage, titleEl,
  at: () => state, paused: () => paused, setPaused, home: () => backToTitle(), start: () => startRace(),
  relocalize: () => { localize(); if (state === 'title' && !launch) showTitle(); },
  restart: () => {
    if (state !== 'race') return;
    if (!world.chase && !free && !dayRace) {
      tele.raceRestart();
      platform.lifecycle('level_failed', { world: world.div.name, level: String(save.cup.race + 1) });
    }
    setPaused(false);
    nextRace('restart', world.chase);
  },
};
wireMenu(wiring);
wireChrome(wiring);

let lastT = performance.now();
function frame(now: number): void {
  requestAnimationFrame(frame);
  const ms = now - lastT;
  const dt = Math.min(0.1, ms / 1000);
  lastT = now;
  // the HUD asks a keyboard player in a portal's iframe for the click that gets them the keys, paused or
  // not, and the countdown waits for it so the race doesn't start without them (src/keyWait.ts)
  const reach = keysReach();
  const askKeys = state === 'race' && !BOT && !paused && controlKind() === 'key' && !reach;
  // 3.3.82: the countdown stops on its last beat and asks a new player for one steer, and the grid is
  // steerable so the answer shows. Read from `controls` rather than from the tick, since this is settled
  // before the world steps. It lets go on that steer or after START_LIMIT_S, whichever comes first.
  const steerNow = controls.steer !== 0 || controls.targetX !== null;
  world.holdCount = startCoach.frame(dt, state === 'race' && !BOT && !paused && !askKeys, world.countdown, steerNow);
  hud.coach(startCoach.on && state === 'race', 'steer');
  // the line yields to either big card, which asks for the same control in bigger letters (src/coach.ts)
  hud.showHint(askKeys ? null : hintNeed(state === 'race' && !BOT && !paused && save.races < 2 && !coach.on && !startCoach.on));
  const waiting = keys.frame(dt, reach, askKeys && world.countdown > 0);
  const stopped = paused || hostPaused || glLost;
  tele.frame(ms, state === 'race' && !BOT, !stopped && !waiting);
  stage.frame(ms, state === 'race' && !stopped && !waiting && !document.hidden);
  if (stopped) return;
  if (cine) return cine.frame(dt);
  if (launch) return launch.frame(dt);
  let simDt = dt;
  if (feel.hitstop > 0) { feel.hitstop -= dt; simDt = 0; }
  else if (feel.slow > 0) { feel.slow -= dt; if (!MOTION.calm) simDt *= 0.35; }
  // the slap card holds the race nearly still until the key (src/coach.ts); it slows rather than freezes, so
  // the rival it points at is still seen moving alongside
  if (state === 'race' && !waiting && world.countdown <= 0 && !world.player.finished) {
    simDt *= coach.frame(dt, world.player.state === 'ride' && world.targetFor(world.player, 0.3) !== null);
  }
  if (!startCoach.on) hud.coach(coach.on && state === 'race');
  if (state !== 'title' && !waiting) {
    acc += simDt;
    let n = 0;
    while (acc >= C.DT && n++ < 8) { acc -= C.DT; tick(); }
  }
  view.update(simDt, Math.min(1, acc / C.DT));
  hud.update(world, view, save.cash, dt);
  if (state === 'race' && !BOT) funnel.playing(dt);
  showStats?.(dt);
}

let showStats: ((dt: number) => void) | null = null;

/** Achievements the boot found won (an older save, a long streak): marked new on the title card. */
let bootAch: Unlocked[] = [];
const showTitle = (): void => drawTitle(save, {
  ach: bootAch, app, onTitle: () => state === 'title',
  garage: () => {
    const acts = shopActions(save, () => hud.garage.redraw(), (u) => bootAch = [...bootAch, ...u]);
    titleEl.classList.add('hidden');
    garage(acts, () => { titleEl.classList.remove('hidden'); showTitle(); }, 'title');
  },
  shift: () => { chase = true; newRace(); startRace(); },
  dailyRace: () => { dayRace = true; newRace(); startRace(); funnel.event('drace_start', { day: today() }); },
  free: () => openFree(app, save, (f) => { startFree(f); newRace(); startRace(); }),
  stop: () => openStop(app, save, (d) => { if (pickDiv(save, d)) { storeSave(save); newRace(); } showTitle(); }),
  launch: () => { if (!launch) launch = new LaunchMode(stage, view.group, save, app, () => { launch = null; showTitle(); }); },
  opts: () => hud.menu.show(true, menuSettings(save), 'settings'),
});

async function boot(): Promise<void> {
  await platform.initPlatform();
  tele.bootMark('bridge');
  // the language's words are their own chunk (3.3.39): fetch it before the first screen is drawn
  await loadLang(params.get('lang') ?? platform.language());
  localize();
  try {
    stage = new Stage(canvas);
  } catch (e) {
    console.error(e);
    titleEl.classList.add('hidden');
    blocker(app, 'noGl');
    tele.noWebgl();
    return;
  }
  canvas.addEventListener('webglcontextlost', () => {
    glLost = true;
    setPaused(true);
    const el = blocker(app, 'glLost');
    canvas.addEventListener('webglcontextrestored', () => { glLost = false; el.remove(); }, { once: true });
  });
  if (params.has('stats')) showStats = statsOverlay(stage.renderer, () => `${launch ? 'launch' : chase && state === 'race' ? 'shift' : state} d${save?.div ?? 0} q${stage.tier}×${stage.resScale.toFixed(2)}`);
  preloadAudio(); // after the Bridge is up (its required step 2), small and in the background
  const read = await platform.loadData();
  save = parseSave(read.data);
  // the player's own pick beats the platform's language; ?lang=xx beats both (3.3.38)
  if (save.lang && !params.has('lang')) { await loadLang(save.lang); localize(); }
  tele.bootMark('save');
  tele.begin(save, canvas, () => stage.tier);
  stage.setQualityMode(save.quality);
  stage.onQuality = (tier, prev) => tele.qualityChanged(tier, prev, stage.qualityMode);
  // the day's visit: the streak goes on or starts over; a new player's first is their tutorial and pays nothing
  const streakPay = visit(save.streak, today(), dayMult(L.stage(save.div, save.tier, save.endless).prize), save.races > 0);
  save.cash += streakPay;
  if (streakPay) funnel.event('streak', { n: save.streak.n, cash: streakPay });
  bootAch = counted(save, unlock(save));
  // a save that couldn't be read is left alone: this session plays on a fresh one and writes nothing
  if (read.ok) storeSave(save);
  else {
    tele.saveReadFailed();
    hud.flash(t('savesOff'), 'warn');
  }
  setMuted('host', !platform.audioEnabled());
  setMuted('player', save.muted);
  setChannel('music', !save.musicOff);
  setChannel('sfx', !save.sfxOff);
  setHaptics(!save.hapticsOff);
  setCalm(save.calm);
  hud.setSound(!save.muted);
  newRace();
  // every shader built before the first frame, so the race doesn't hitch on its first hits
  await view.prewarm();
  setState(state);
  titleEl.querySelector('button')!.removeAttribute('disabled'); // a race is ready: the card's button works now
  showTitle();
  requestAnimationFrame(frame);
  // The first real draw costs a frame of its own - the uploads and pipeline validation the prewarm's compile
  // doesn't settle - and the sandbox's telemetry caught it in every machine's first race: one frame of 1.0 to
  // 4.2 s, one or two seconds in, i.e. inside the starting countdown, and never again that session. A new
  // player goes straight into that race, so the session's first drawn frame was the race's. Spend it here
  // instead, behind the title card where nothing is moving, and start the race on a warm pipeline.
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  // a new player is straight into their first race, no menu tap; the countdown is the tutorial's start
  if (BOT || save.races === 0) startRace();
  if (!BOT && save.races === 0) funnel.startTutorial();
  // ready once the shaders are built and a frame of it is on the screen (3.4: game_ready at the first playable frame)
  platform.gameReady();
  tele.bootDone();
}
boot().catch((e) => { console.error(e); tele.bootFailed(); });

// For poking at the game from the console while testing.
Object.assign(window, { __game: { get world() { return world; }, get view() { return view; }, get state() { return state; }, get paused() { return { player: paused, host: hostPaused }; }, hud, get save() { return save; }, botInput, platform, coach, startCoach,
  /** Bug report: this race so far as a replay (seed, options, every input), JSON to paste. */
  replay: () => JSON.stringify(recorder.finish(world)) } });
