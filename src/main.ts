// Wires the 30 Hz sim to the 3D view, the HUD, input, sound and the save.

import './style.css';
import { World } from './sim/world';
import { react, newFeel } from './events';
import * as C from './sim/config';
import { botInput } from './sim/ai';
import { Recorder } from './sim/replay';
import { Stage, RaceView } from './view/scene';
import { Controls, DESKTOP, keysReach } from './view/input';
import { Hud } from './view/hud';
import type { RaceResult } from './view/results';
import { titleInfo } from './view/title';
import { sfx, unlockAudio, hold, setMuted, setChannel, music, raceTrack, preloadAudio } from './view/audio';
import { installIconCss } from './view/icons';
import { statsOverlay } from './view/stats';
import * as funnel from './funnel';
import * as tele from './telemetry';
import { parseSave, storeSave, type Save } from './meta';
import { CUP_RACES, riderName, settleRace, buyUpgrade, chooseRide, REVENGE_PAY, type UpKey } from './career';
import { dailyFor, scoreDaily, today } from './daily';
import * as platform from './platform';
import { setLang, t } from './i18n';
import { setHaptics } from './haptics';
import { PAINTS, choosePaint, buyCarry } from './shop';

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
let state: 'title' | 'race' | 'results' = 'title';

/** Change screens: the HUD layout and the music follow. */
function setState(s: typeof state): void {
  state = s;
  funnel.setScreen(s);
  app.classList.toggle('racing', s === 'race');
  music(s === 'race' ? raceTrack(save.div) : 'title');
}
let paused = false;
/** The host (or an ad) has the game paused; separate from the player's own pause menu. */
let hostPaused = false;
/** A rewarded ad was asked for and hasn't answered: the race waits for it. */
let adPending = false;
/** The WebGL context is gone: nothing runs until it is back. */
let glLost = false;
/** The rewarded "back on now" was used this race. */
let remountUsed = false;
/** Seconds the player has been down (the remount button waits for the tumble to end). */
let downClock = 0;
/** Seconds this race's countdown has stood waiting for the keys to reach the game. */
let keysWait = 0;
let acc = 0;
/** Hitstop, slow motion and the grudge call-outs, which the events set (src/events.ts). */
let feel = newFeel();
let atkBuffer = 0;
let lastCount = -1;
/** Times the player came off this race (for the daily "without falling off"). */
let falls = 0;
/** The world whose race was settled: a race pays out once, whatever happens after. */
let settled: World | null = null;

const controls = new Controls(canvas, () => (world ? world.player.x : 0), () => {
  if (!world) return [-C.EDGE, C.EDGE];
  const p = world.player;
  const R = world.road;
  let [lo, hi] = R.bounds(p.x, p.z);
  hi = Math.max(hi, C.EDGE); // the cones don't hold the player in
  // a trail's opening coming up: pushing out holds the player on the barrier and lets them in when it opens
  const i = R.nextCut(p.z);
  const c = i >= 0 ? R.cuts[i] : null;
  if (c && c.z0 - p.z < 50 && p.z < c.z0 + C.CUT.gap) {
    if (c.side > 0) hi = C.CUT.outer;
    else lo = -C.CUT.outer;
  }
  return [lo, hi];
});

function newRace(): void {
  view?.dispose();
  const seed = ((save.races * 7919 + 17) % 99991) + 1;
  const nem = save.feud.nemesis;
  const opts = { seed, upgrades: save.up, grudges: save.grudges, length: LEN, div: save.div, tier: save.tier, endless: save.endless, vehicle: save.garage.cur, nemesis: nem?.id, weapon: save.carry ?? undefined };
  world = new World(opts);
  recorder = new Recorder(opts);
  const paint = PAINTS[save.paint.cur];
  view = new RaceView(stage, world, seed, paint);
  hud.setup(world, paint.body);
  hud.results.hide();
  intro();
  hud.showRemount(false);
  remountUsed = false;
  controls.reset();
  acc = 0;
  feel = newFeel();
  atkBuffer = 0;
  lastCount = -1;
  falls = 0;
}

/** The division pill and the nemesis card, over the countdown. */
function intro(): void {
  const nem = save.feud.nemesis;
  hud.setLeague(t('pill', { div: world.div.name, n: save.cup.race + 1, m: CUP_RACES }));
  hud.setNemesis(nem, nem ? riderName(nem.id) : '', Math.round(REVENGE_PAY * world.div.prize));
}

function startRace(): void {
  if (!world || state !== 'title') return; // still booting, or already gone
  intro(); // the first race's ran behind the title
  stage.raceStart();
  unlockAudio();
  titleEl.classList.add('hidden');
  setState('race');
  platform.lifecycle('level_started', { world: world.div.name, level: String(save.cup.race + 1) });
  if (!BOT) tele.raceStart(world);
}

/** From the results (or a restart): the next race, straight into its countdown. */
function nextRace(placement: string): void {
  platform.interstitial(placement);
  newRace();
  stage.raceStart();
  setState('race');
  platform.lifecycle('level_started', { world: world.div.name, level: String(save.cup.race + 1) });
  tele.raceStart(world);
}

function finishRace(): void {
  const w = world;
  if (settled === w) return;
  settled = w;
  const place = w.player.place;
  const of = (f: (r: (typeof w.riders)[number]) => number) => w.riders.map((r) => (r.thug ? 0 : f(r)));
  const s = settleRace(save, {
    place, kos: w.kos, grudgeKos: w.grudgeKos, shoves: w.shoves, nearPay: w.flair.nearPay, chainPay: w.flair.chainPay, fines: w.fines, grudges: [...w.grudges],
    places: of((r) => r.place), koPlayer: of((r) => r.koPlayer), koByPlayer: of((r) => r.koByPlayer),
  });
  // the day's challenges and first win, paid at the division the race was run in
  save.daily = dailyFor(save.daily, today());
  const daily = scoreDaily(save.daily, { place, kos: w.kos, shoves: w.shoves, falls, grudge: w.grudgeKos + w.revenge }, w.div.prize);
  save.cash += daily.cash + daily.firstWin;
  storeSave(save);
  funnel.raceDone(place);
  tele.raceEnd(s);
  for (const kind of daily.done) funnel.event('daily_done', { kind, done: daily.rows.filter((r) => r.done).length });
  if (daily.firstWin) funnel.event('first_win', { cash: daily.firstWin });
  const table = s.table.map((r) => ({ name: riderName(r.id), pts: r.pts, rank: r.rank, me: r.id === 0 }));
  const res: RaceResult = {
    place, total: w.racers, prize: s.prize, kos: w.kos, koBonus: s.koBonus, grudgeKos: w.grudgeKos, grudgeBonus: s.grudgeBonus,
    shoves: w.shoves, shoveBonus: s.shoveBonus, flair: { ...w.flair }, fines: s.fines, earned: s.earned, time: w.time, grudges: save.grudges.map((id) => w.riders[id].name),
    league: { div: w.div.name, race: s.cupRace, races: CUP_RACES, table, end: s.end, next: C.stage(save.div, save.tier, save.endless).name, season: C.TIERS[save.tier].name },
    feud: { out: s.feud, nemesis: save.feud.nemesis, name: riderName },
    daily,
    double: s.earned > 0 && platform.rewardedReady() ? s.earned : 0,
    doubled: false,
  };
  if (res.double) tele.adOffer('double_cash');
  setState('results');
  platform.lifecycle(place <= C.PROMOTE ? 'level_completed' : 'level_failed', { world: w.div.name, level: String(s.cupRace) });
  const show = () => hud.results.show(res, save, { buy, ride, paint, carry, double, again: () => nextRace('race_end') });
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
  const buy = (k: UpKey) => {
    const had = save.cash;
    if (!buyUpgrade(save, k)) return;
    storeSave(save);
    funnel.event('upgrade_purchased', { upgrade_id: k, level: save.up[k], price: had - save.cash, cash: save.cash });
    tele.bought();
    sfx.coin();
    show();
  };
  const ride = (v: number) => {
    const had = save.cash;
    if (!chooseRide(save, v)) return;
    storeSave(save);
    funnel.event('ride_chosen', { ride: v, bought: save.cash < had, price: had - save.cash, cash: save.cash });
    if (save.cash < had) { tele.bought(); sfx.coin(); }
    show();
  };
  /** A paint job or a weapon for the next race: pay, save, count it, redraw. */
  const shop = (ok: boolean, had: number, event: string, f: Record<string, string | number | boolean>) => {
    if (!ok) return;
    storeSave(save);
    funnel.event(event, { ...f, price: had - save.cash, cash: save.cash });
    if (save.cash < had) { tele.bought(); sfx.coin(); }
    show();
  };
  const paint = (i: number) => { const had = save.cash; shop(choosePaint(save, i), had, 'paint_chosen', { paint: i, bought: had > save.cash }); };
  const carry = (k: C.WeaponKind) => { const had = save.cash; shop(buyCarry(save, k), had, 'weapon_bought', { weapon: k }); };
  show();
}

function tick(): void {
  const inp = world.input;
  if (state === 'race' && BOT) {
    botInput(world, 0.8);
  } else if (state === 'race') {
    inp.targetX = controls.targetX;
    inp.steer = controls.steer;
    if (controls.steer !== 0 || controls.targetX !== null) funnel.tutorialStep('steer');
    inp.brake = controls.brake;
    if (controls.attack) { atkBuffer = 8; controls.attack = false; }
    inp.attack = atkBuffer > 0;
  } else {
    inp.steer = 0;
    inp.brake = false;
    inp.attack = false;
  }
  recorder.capture(world);
  world.step();
  let swung = false;
  let over = false;
  // taken off the world before any is handled: one that throws must not leave the rest, the race's end
  // above all, to be handled again on every tick after
  for (const e of world.events.splice(0)) {
    if (e.type === 'swing' && e.rider === 0) { swung = true; funnel.tutorialStep('slap'); }
    if (e.type === 'hit' && e.from === 0) funnel.tutorialStep('hit');
    if (e.type === 'crash' && e.rider === 0) falls++;
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
  hud.menu.show(on, { music: !save.musicOff, sfx: !save.sfxOff, haptics: !save.hapticsOff, quality: save.quality });
  hold('pause', on);
}

platform.host.onPause = (on) => {
  hostPaused = on;
  hold('host', on);
};
platform.host.onAudio = (on) => setMuted('host', !on);

/** A pause-menu setting changed: into the save and the analytics. */
function setting(name: string, value: string | boolean): void {
  storeSave(save);
  funnel.event('settings_changed', { setting: name, value });
}

/** The player's own sound switch, kept in the save. */
function toggleSound(): void {
  save.muted = !save.muted;
  setMuted('player', save.muted);
  hud.setSound(!save.muted);
  setting('sound', !save.muted);
}

hud.menu.on = {
  resume: () => setPaused(false),
  restart: () => {
    if (state !== 'race') return;
    tele.raceRestart();
    platform.lifecycle('level_failed', { world: world.div.name, level: String(save.cup.race + 1) });
    setPaused(false);
    nextRace('restart');
  },
  music: (on) => { save.musicOff = !on; setChannel('music', on); setting('music', on); },
  sfx: (on) => { save.sfxOff = !on; setChannel('sfx', on); setting('sfx', on); },
  haptics: (on) => { save.hapticsOff = !on; setHaptics(on); setting('haptics', on); },
  quality: (q) => { save.quality = q; stage.setQualityMode(q); setting('quality', q); },
};

/** "Back on now": a rewarded ad puts a downed player straight back on the scooter, once a race. */
function remount(): void {
  if (remountUsed || adPending || !hud.remountArmed || state !== 'race' || world.player.state !== 'down') return;
  remountUsed = true;
  adPending = true;
  hud.showRemount(false);
  void platform.showRewarded('remount').then((ok) => {
    adPending = false;
    const down = state === 'race' && world.player.state === 'down';
    if (ok && down) {
      world.input.remount = true;
      hud.flash(t('backOn'), 'go');
    } else if (!ok || !down) remountUsed = false; // no ad, or nothing left for it to do: no charge
  });
}

/** A screen in place of the game: no WebGL, or it went and didn't come back. */
function blocker(key: 'noGl' | 'glLost'): HTMLElement {
  const el = document.createElement('div');
  el.className = 'overlay blocker';
  el.innerHTML = `<div class="card small"><p>${t(key)}</p><button class="primary">${t('reload')}</button></div>`;
  el.querySelector('button')!.addEventListener('click', () => location.reload());
  app.appendChild(el);
  return el;
}

controls.onPause = () => setPaused(!paused);
controls.onAny = () => { unlockAudio(); funnel.input(); };
// any first tap or key unlocks sound (iOS wants it in the gesture's own handler, which may be the release)
for (const ev of ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown']) document.addEventListener(ev, () => { unlockAudio(); funnel.input(); }, true);
document.addEventListener('click', (e) => { if ((e.target as Element).closest?.('button')) sfx.click(); });
// Enter or Space: start from the title, go on from the results (a focused button takes its own key)
document.addEventListener('keydown', (e) => {
  if (e.repeat || (e.key !== 'Enter' && e.key !== ' ')) return;
  const b = (e.target as Element).closest?.('button');
  if (b) { if (e.key === ' ') b.click(); return; }
  if (state === 'title' && !titleEl.classList.contains('hidden')) startRace();
  else if (state === 'results') hud.results.continue();
  else return;
  e.preventDefault();
});
hud.muteBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
hud.muteBtn.addEventListener('click', () => { if (save) toggleSound(); });
hud.pauseBtn.addEventListener('click', () => setPaused(true));
// a click, not a press: a finger steering across the screen when the button comes up doesn't buy an ad
hud.remountBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
hud.remountBtn.addEventListener('click', remount);
// a hidden page is silent whatever screen it is on, and a race pauses
document.addEventListener('visibilitychange', () => {
  hold('hidden', document.hidden);
  if (document.hidden) setPaused(true);
});
titleEl.querySelector('button')!.addEventListener('click', startRace);
window.addEventListener('resize', () => { stage?.resize(); hud.resize(); });

let lastT = performance.now();
function frame(now: number): void {
  requestAnimationFrame(frame);
  const ms = now - lastT;
  const dt = Math.min(0.1, ms / 1000);
  lastT = now;
  // a keyboard player in a portal's iframe has no keys until a click in it (they scroll the portal page, and
  // the Bridge holds the game paused while it lacks the focus): the HUD asks for that click, paused or not,
  // and a countdown waits for it so the race doesn't start without them
  const askKeys = state === 'race' && !BOT && !paused && DESKTOP && !keysReach();
  hud.showHint(askKeys ? 'click' : state === 'race' && save.races < 2 && world.time < 6 ? 'controls' : 'off');
  const waiting = askKeys && world.countdown > 0;
  if (waiting) keysWait += dt;
  else if (keysWait > 0) {
    funnel.event('keys_wait', { seconds: Math.round(keysWait) });
    keysWait = 0;
  }
  const stopped = paused || hostPaused || adPending || glLost;
  tele.frame(ms, state === 'race' && !BOT, !stopped && !waiting);
  stage.frame(ms, state === 'race' && !stopped && !waiting && !document.hidden);
  if (stopped) return;
  let simDt = dt;
  if (feel.hitstop > 0) { feel.hitstop -= dt; simDt = 0; }
  else if (feel.slow > 0) { feel.slow -= dt; simDt *= 0.35; }
  if (state !== 'title' && !waiting) {
    acc += simDt;
    let n = 0;
    while (acc >= C.DT && n++ < 8) { acc -= C.DT; tick(); }
  }
  view.update(simDt, Math.min(1, acc / C.DT));
  hud.update(world, view, save.cash, dt);
  downClock = world.player.state === 'down' ? downClock + dt : 0;
  // not in a new player's first race: their first look at the game is the game, not an ad button
  const offer = state === 'race' && !BOT && save.races > 0 && !remountUsed && downClock > 0.6 && platform.rewardedReady();
  hud.showRemount(offer);
  if (offer) tele.remountOffer();
  if (state === 'race' && !BOT) funnel.playing(dt);
  showStats?.(dt);
}

let showStats: ((dt: number) => void) | null = null;

/** The title card for a returning player: where they stand, and what to go for. */
function showTitle(): void {
  const best = document.getElementById('best');
  if (best && save.races > 0) {
    best.textContent = t('best', { div: C.stage(save.div, save.tier, save.endless).name, n: save.cup.race + 1, m: CUP_RACES, cash: save.cash }) + (save.titles ? t('champs', { n: save.titles }) : '');
  }
  const info = document.getElementById('titleinfo');
  if (info) info.innerHTML = titleInfo(save);
}

async function boot(): Promise<void> {
  await platform.initPlatform();
  tele.bootMark('bridge');
  if (!params.has('lang')) {
    setLang(platform.language());
    localize();
  }
  try {
    stage = new Stage(canvas);
  } catch (e) {
    console.error(e);
    titleEl.classList.add('hidden');
    blocker('noGl');
    tele.noWebgl();
    return;
  }
  canvas.addEventListener('webglcontextlost', () => {
    glLost = true;
    setPaused(true);
    const el = blocker('glLost');
    canvas.addEventListener('webglcontextrestored', () => { glLost = false; el.remove(); }, { once: true });
  });
  if (params.has('stats')) showStats = statsOverlay(stage.renderer);
  preloadAudio(); // after the Bridge is up (its required step 2), small and in the background
  const read = await platform.loadData();
  save = parseSave(read.data);
  tele.bootMark('save');
  tele.begin(save, canvas, () => stage.tier);
  stage.setQualityMode(save.quality);
  stage.onQuality = (tier, prev) => tele.qualityChanged(tier, prev, stage.qualityMode);
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
  hud.setSound(!save.muted);
  newRace();
  // every shader built before the first frame, so the race doesn't hitch on its first hits
  await view.prewarm();
  setState(state);
  showTitle();
  requestAnimationFrame(frame);
  // a new player is straight into their first race, no menu tap; the countdown is the tutorial's start
  if (BOT || save.races === 0) startRace();
  if (!BOT && save.races === 0) funnel.startTutorial();
  // ready once the shaders are built and a frame of it is on the screen (3.4: game_ready at the first playable frame)
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  platform.gameReady();
  tele.bootDone();
}
boot().catch((e) => { console.error(e); tele.bootFailed(); });

// For poking at the game from the console while testing.
Object.assign(window, { __game: { get world() { return world; }, get view() { return view; }, get state() { return state; }, get paused() { return { player: paused, host: hostPaused }; }, hud, get save() { return save; }, botInput, platform,
  /** Bug report: this race so far as a replay (seed, options, every input), JSON to paste. */
  replay: () => JSON.stringify(recorder.finish(world)) } });
