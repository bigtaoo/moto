// What goes to Playgama analytics beyond the early-session funnel (src/funnel.ts), per its telemetry guide
// (get_game_telemetry_guide) and what the other games measure:
// - `performance_sample` every ~30 s of visible, unpaused racing, with long tasks, heap and error counts
// - `progression_started/completed/failed` per race (step_id a division of a season, step_index the race on
//   the whole ladder), `failed{reason:'abandon'}` when the page goes in the middle of one, and the career's
//   milestones (cup, division, season, title, nemesis, ride unlocked)
// - `error_report{kind}` (js_error, unhandled_rejection, webgl_lost, no_webgl, save_read, stall, boot_fail,
//   boot_slow), 3 a kind
// - the boot's stages on `game_loaded`, `boot_left{stage}` for a page left before it was up
// - `idle{screen}` when nobody has touched anything for a while, `ad_offer` for the rewarded offers
// - common fields on every event: device, orientation, language, build, career bucket, session number,
//   days since the first session, whether the game has the keyboard
// Bridge counts sessions, playtime, ads and purchases itself; none of that is repeated. No messages, URLs,
// stacks or names: every value is a number, a flag or one of a fixed few words.

import * as C from './sim/config';
import type { World, CrashCause } from './sim/world';
import type { Save } from './meta';
import { CUP_RACES, upgradePrice, type Settlement, type UpKey } from './career';
import { track, setCommonFields, flushEarly, deviceType } from './platform';
import * as funnel from './funnel';
import { getLang } from './i18n';
import { loadErrors } from './view/audio';
import { PerfSampler, RunStutter, careerBucket, stepId, stepIndex, deviceFields, dayOf, STALL_MS, GAP_MS, type Props } from './metrics';

declare const __BUILD__: string;
export const BUILD = typeof __BUILD__ === 'string' ? __BUILD__ : 'dev';

const now = () => performance.now();
const sampler = new PerfSampler(BUILD, now);
const stutter = new RunStutter();
let save: Save | null = null;
let canvas: HTMLCanvasElement | null = null;

// ---- errors ------------------------------------------------------------------------------------

type ErrKind = 'js_error' | 'unhandled_rejection' | 'webgl_lost' | 'no_webgl' | 'save_read' | 'stall' | 'boot_fail' | 'boot_slow';
const reported = new Map<ErrKind, number>();
/** Counts since the last performance_sample (the guide wants them per window). */
const win = { js: 0, rej: 0, gl: 0, lt: 0, ltMs: 0, ltMax: 0, assets: loadErrors.n };

/** One report per kind and occurrence, at most 3 of a kind a session; the kind and where, never a message. */
function report(kind: ErrKind, extra: Props = {}): void {
  const n = reported.get(kind) ?? 0;
  if (n >= 3) return;
  reported.set(kind, n + 1);
  track('error_report', { kind, screen: funnel.currentScreen(), stage: bootStage, n: n + 1, ...extra });
}

/**
 * Wire a page listener, if there is a page. Everything here is wired at module scope, so without this
 * guard merely importing this file -- or anything that imports it, which is most of the game's flow --
 * throws outside a browser, and none of it can be unit-tested (doc 3.3.32).
 */
const on = (ev: string, f: (e: never) => void, opts?: boolean | AddEventListenerOptions): void => {
  if (typeof addEventListener === 'function') addEventListener(ev, f as EventListener, opts);
};

on('error', (e: ErrorEvent) => {
  if (e instanceof ErrorEvent) { win.js++; report('js_error'); }
}, true);
on('unhandledrejection', () => { win.rej++; report('unhandled_rejection'); });

// long main-thread tasks (Chromium): counted only while racing, as the sample's window is the race's
if (typeof PerformanceObserver === 'function' && PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
  new PerformanceObserver((list) => {
    if (!racingNow) return;
    for (const e of list.getEntries()) { win.lt++; win.ltMs += e.duration; win.ltMax = Math.max(win.ltMax, e.duration); }
  }).observe({ type: 'longtask', buffered: false });
}

// ---- boot --------------------------------------------------------------------------------------

/** Where the boot is: script (this file ran), bridge (the Bridge is up), save (the save is read), ready. */
let bootStage = 'script';
const boot: Record<string, number> = { script_ms: Math.round(now()) };

/** The boot reached a stage; ms since the page started loading. */
export function bootMark(stage: 'bridge' | 'save'): void {
  bootStage = stage;
  boot[`${stage}_ms`] = Math.round(now());
}
const slow = setTimeout(() => report('boot_slow'), 20_000);

/** The game is up: the boot's stages go on game_loaded. */
export function bootDone(): void {
  bootStage = 'ready';
  clearTimeout(slow);
  funnel.loaded({ ...boot, ready_ms: Math.round(now()) });
}
/** The browser has no WebGL: the game can't run here. */
export function noWebgl(): void {
  report('no_webgl');
  flushEarly();
}
/** The save couldn't be read (so this session won't write over it). */
export const saveReadFailed = (): void => report('save_read');
/** The boot threw; whatever got through to the Bridge goes out with it. */
export function bootFailed(): void {
  report('boot_fail');
  flushEarly();
}

// ---- the session -------------------------------------------------------------------------------

/**
 * The save is read: counts this session in it (the caller stores it), sets the fields every event carries,
 * and lets out the events held since the page started.
 */
export function begin(s: Save, c: HTMLCanvasElement, gfx: () => number): void {
  save = s;
  canvas = c;
  s.sessions++;
  const today = dayOf(Date.now());
  if (!s.firstDay) s.firstDay = today;
  const device = deviceFields(navigator.userAgent, navigator.maxTouchPoints || 0, deviceType());
  setCommonFields(() => ({
    ...device,
    orient: innerWidth >= innerHeight ? 'land' : 'port',
    lang: getLang(),
    build: BUILD,
    new_player: s.sessions <= 1,
    career: careerBucket(s.races),
    rung: C.rung(s.div, s.tier),
    session_n: Math.min(20, s.sessions),
    days: Math.max(0, Math.min(30, today - s.firstDay)),
    focus: document.hasFocus(),
    gfx: gfx(),
  }));
  c.addEventListener('webglcontextlost', () => { win.gl++; report('webgl_lost'); });
  flushEarly();
}

// ---- races -------------------------------------------------------------------------------------

interface Race {
  world: World;
  step: Props;
  falls: number;
  /** Presses by kind in the race: whether the player found the keys, drags a mouse, or plays by touch. */
  presses: { key: number; mouse: number; touch: number };
  /** The player's crashes by what put them down (the sim's crash causes). */
  by: Record<CrashCause, number>;
  downMs: number;
  wasDown: boolean;
  pauses: number;
  hides: number;
  remountOffered: boolean;
}
let race: Race | null = null;
/** When the last results screen came up, and what was bought on it. */
let resultsAt = 0;
let buys = 0;
let racingNow = false;

function stepOf(div: number, tier: number, cupRace: number, ride: number): Props {
  return { step_id: stepId(div, tier), step_index: stepIndex(div, tier, cupRace, CUP_RACES), tier, div, cup_race: cupRace, ride };
}

/** A race starts (the first, or the next from the results). */
export function raceStart(w: World): void {
  if (!save) return;
  const step = stepOf(save.div, save.tier, save.cup.race + 1, save.garage.cur);
  race = { world: w, step, falls: 0, presses: { key: 0, mouse: 0, touch: 0 }, by: { ko: 0, car: 0, wall: 0, cones: 0, oil: 0, cow: 0 }, downMs: 0, wasDown: false, pauses: 0, hides: 0, remountOffered: false };
  stutter.reset();
  const between: Props = resultsAt ? { results_sec: Math.round((now() - resultsAt) / 1000), buys } : {};
  resultsAt = 0;
  buys = 0;
  track('progression_started', { ...step, career_race: save.races + 1, cash: save.cash, up_total: upTotal(save), nemesis: w.nemesis > 0, mutator: w.mutator ?? 'none', boss: w.boss >= 0, ...between });
}

/** The way the race was played: the kind of most presses, or none. */
function inputKind(p: Race['presses']): string {
  const [k, n] = Object.entries(p).sort((a, b) => b[1] - a[1])[0];
  return n > 0 ? k : 'none';
}
on('keydown', (e: KeyboardEvent) => { if (race && !e.repeat) race.presses.key++; }, { capture: true, passive: true });
on('pointerdown', (e: PointerEvent) => { if (race) race.presses[e.pointerType === 'mouse' ? 'mouse' : 'touch']++; }, { capture: true, passive: true });

const upTotal = (s: Save) => s.up.top + s.up.steer + s.up.hp;

/** The race as it stands, for an end or an abandon. */
function raceFields(r: Race): Props {
  const w = r.world;
  return {
    ...r.step, place: w.standing, racers: w.racers, kos: w.kos, grudge_kos: w.grudgeKos, shoves: w.shoves, fines: w.fines,
    near_misses: w.flair.near, best_chain: w.flair.best, flair_cash: w.flair.nearPay + w.flair.chainPay,
    falls: r.falls, falls_ko: r.by.ko, falls_car: r.by.car, falls_wall: r.by.wall, falls_cones: r.by.cones, falls_oil: r.by.oil, falls_cow: r.by.cow, down_s: Math.round(r.downMs / 1000), time_s: Math.round(w.time), pauses: r.pauses, hides: r.hides,
    revenge: w.revenge, input: inputKind(r.presses), capped: w.time >= C.TIME_CAP_S, ...stutter.fields(),
  };
}

/** The race is over and settled into the save: its progression event and the career's milestones. */
export function raceEnd(s: Settlement): void {
  const r = race;
  if (!r || !save) return;
  race = null;
  sendSample(sampler.flush());
  const place = r.world.standing;
  const done = place <= C.PROMOTE;
  track(done ? 'progression_completed' : 'progression_failed', {
    ...raceFields(r), ...(done ? {} : { reason: 'place' }), career_race: save.races, earned: s.earned, cash: save.cash, up_total: upTotal(save),
  });
  milestones(s);
  resultsAt = now();
}

function milestones(s: Settlement): void {
  if (!save) return;
  const from = stepId(s.div, s.tier);
  const e = s.end;
  if (e) {
    track('cup_completed', { step_id: from, rank: e.rank, promoted: e.promoted, champion: e.champion, next_tier: e.nextTier, bonus: e.bonus });
    if (e.promoted) track('division_reached', { step_id: stepId(save.div, save.tier), rung: C.rung(save.div, save.tier) });
    if (e.champion) track('title_won', { step_id: from, tier: s.tier, titles: save.titles, endless: save.endless });
    if (e.nextTier) track('season_reached', { tier: save.tier, season: C.TIERS[save.tier].name.toLowerCase() });
    const was = C.rung(s.div, s.tier);
    const is = C.rung(save.div, save.tier);
    C.VEHICLES.forEach((v, i) => { if (i > 0 && v.rung > was && v.rung <= is) track('ride_unlocked', { ride: i, rung: v.rung, cash: save!.cash, affordable: save!.cash >= v.price }); });
  }
  const f = s.feud;
  if (f.fresh !== null) track('nemesis', { result: 'new', step_id: from });
  if (f.beaten) track('nemesis', { result: f.broken ? 'broken' : 'beaten', step_id: from, revenge: f.revenge, cash: f.cash });
}

/** The player restarted the race from the pause menu: it ends as a failure with that reason. */
export function raceRestart(): void {
  const r = race;
  if (!r) return;
  race = null;
  sendSample(sampler.flush());
  track('progression_failed', { ...raceFields(r), reason: 'restart', started: r.world.countdown <= 0 });
}

/** The player crashed (the sim's crash event): counted by cause on the race's progression event. */
/** The renderer's quality tier moved (the governor, or the player's setting). */
export function qualityChanged(tier: number, prev: number, mode: string): void {
  track('quality_changed', { tier, prev, mode });
}

export function crashed(cause: CrashCause): void {
  if (race) race.by[cause]++;
}

/** Something bought on the results screen (counted onto the next progression_started). */
export function bought(): void {
  buys++;
}

/** The player opened the pause menu. */
export function paused(): void {
  if (race) race.pauses++;
}

/** The rewarded remount button is up: one offer a race. */
export function remountOffer(): void {
  if (!race || race.remountOffered) return;
  race.remountOffered = true;
  adOffer('remount');
}

/** A rewarded ad was offered (the result is platform.ts's ad_result). */
export function adOffer(placement: 'double_cash' | 'remount' | 'streak_double'): void {
  track('ad_offer', { placement, ...(race ? { step_id: race.step.step_id as string } : {}) });
}

// ---- frames ------------------------------------------------------------------------------------

let wasActive = false;
let lastInput = now();
let idleScreen = '';
let idleSent = 0;
let idleWas = false;
const IDLE_S: Record<string, number> = { race: 30, results: 45, title: 30 }; // the scooter rides itself: 15 s of straight road with no input is still playing
for (const ev of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart']) on(ev, () => { lastInput = now(); }, { capture: true, passive: true });

/**
 * One animation frame: `ms` its real length (before any clamp), `racing` a player's race on screen (no
 * bot), `active` not paused by anyone and not waiting on the keys.
 */
export function frame(ms: number, racing: boolean, active: boolean): void {
  const on = racing && active && !document.hidden;
  racingNow = on;
  if (on) {
    if (ms >= STALL_MS && ms < GAP_MS) report('stall', { ms: Math.min(4900, Math.round(ms / 100) * 100) });
    sendSample(sampler.frame(ms));
    stutter.frame(ms);
  } else if (wasActive) {
    sendSample(sampler.flush());
    stutter.away();
  }
  wasActive = on;
  const r = race;
  if (r && racing) {
    const down = r.world.player.state === 'down';
    if (down && !r.wasDown) r.falls++;
    if (down && on) r.downMs += ms;
    r.wasDown = down;
  }
  idle(racing || funnel.currentScreen() !== 'race');
}

/** Nobody has touched the game for a while on this screen: once a screen visit, 5 a session. */
function idle(player: boolean): void {
  const scr = funnel.currentScreen();
  if (scr !== idleScreen) { idleScreen = scr; lastInput = now(); idleWas = false; }
  const limit = IDLE_S[scr];
  if (!player || !limit || idleWas || idleSent >= 5 || document.hidden) return;
  if (now() - lastInput < limit * 1000) return;
  idleWas = true;
  idleSent++;
  const extra: Props = race ? { step_id: race.step.step_id as string, place: race.world.standing, race_t: Math.round(race.world.time) } : {};
  track('idle', { screen: scr, sec: limit, ...extra });
}

function sendSample(p: Props | null): void {
  if (!p) return;
  const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  const extra: Props = {
    long_task_count: win.lt, long_task_total_ms: Math.round(win.ltMs), long_task_max_ms: Math.round(win.ltMax),
    memory_measurement_supported: !!mem,
    js_error_count: win.js, unhandled_rejection_count: win.rej, webgl_context_loss_count: win.gl,
    asset_load_error_count: loadErrors.n - win.assets,
    dpr: Math.round(devicePixelRatio * 4) / 4,
    mpix: canvas ? Math.round((canvas.width * canvas.height) / 1e5) / 10 : 0,
  };
  if (mem) { extra.memory_used_mb = Math.round(mem.usedJSHeapSize / 1048576); extra.memory_measurement_type = 'js_heap'; }
  if (race) Object.assign(extra, { step_id: race.step.step_id, racers: race.world.racers });
  Object.assign(win, { js: 0, rej: 0, gl: 0, lt: 0, ltMs: 0, ltMax: 0, assets: loadErrors.n });
  track('performance_sample', { ...p, ...extra });
}

// ---- leaving -----------------------------------------------------------------------------------

if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (race) race.hides++;
    sendSample(sampler.flush());
    stutter.away();
  }
});

// what the player was in the middle of goes on session_end; a race left half-run is an abandon
funnel.onLeave(() => {
  if (bootStage !== 'ready') return { boot_stage: bootStage };
  const s = save;
  if (!s) return {};
  const out: Props = { cash: s.cash };
  const scr = funnel.currentScreen();
  if (scr === 'results') out.can_buy = (['top', 'steer', 'hp'] as UpKey[]).some((k) => { const p = upgradePrice(s, k); return p !== null && p <= s.cash; });
  if (race && scr === 'race') {
    const w = race.world;
    Object.assign(out, { step_id: race.step.step_id, race_t: Math.round(w.time), place: w.standing, down: w.player.state === 'down', started: w.countdown <= 0 });
  }
  return out;
});
on('pagehide', () => {
  if (bootStage !== 'ready') { track('boot_left', { stage: bootStage, ms: Math.round(now()) }); return; }
  sendSample(sampler.flush());
  if (race && funnel.currentScreen() === 'race') {
    track('progression_failed', { ...raceFields(race), reason: 'abandon', started: race.world.countdown <= 0 });
    race = null;
  }
});
