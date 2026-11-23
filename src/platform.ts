// The host platform, through the Playgama Bridge (index.html loads it first). Saves, ads, the host's
// pause and audio switches, and the ready signal all go through here, so the game itself never touches
// `window.bridge`. The Bridge loads from Playgama's CDN, as its docs recommend. Without it (blocked)
// everything falls back: saves to localStorage, no ads. On the Bridge's mock platform (local runs) ads are faked in dev builds, or with `?fakeads`,
// so the rewarded flows can be played through.

/* eslint-disable @typescript-eslint/no-explicit-any */
type Bridge = any;

const params = new URLSearchParams(typeof location === 'undefined' ? '' : location.search);
let bridge: Bridge | null = null;
let fake = false;
let rewardedBusy = false;
type Props = Record<string, string | number | boolean>;
/** Fields on every analytics event (src/telemetry.ts sets them: device, cohort, build ...). */
let common: () => Props = () => ({});
export const setCommonFields = (f: () => Props): void => { common = f; };
/** Events from before the Bridge was up (a boot error, the boot marks) wait here, then go out. */
let early: [string, Props | undefined][] | null = [];

/** Callbacks the game sets: the host wants the game paused, or the sound off. */
export const host = {
  onPause: (_paused: boolean) => {},
  onAudio: (_enabled: boolean) => {},
};

const INIT_MS = 8000;
const READ_MS = 5000;
const AUTH_MS = 60000; // the platform's own sign-in window: the player types in it, so give them a minute

/** `p`, or a rejection after `ms`. */
function within<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const late = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${what} timed out`)), ms); });
  return Promise.race([p, late]).finally(() => clearTimeout(timer));
}

/** Set up the Bridge if it loaded. Never rejects: on any failure the game runs on the fallbacks. */
export async function initPlatform(): Promise<void> {
  const b = (window as any).bridge as Bridge | undefined;
  if (b) {
    try {
      // a Bridge that never answers must not hold the game on a blank page: past this it runs on the fallbacks
      await within(b.initialize(), INIT_MS, 'init');
      bridge = b;
      const E = b.EVENT_NAME;
      b.platform.on(E.PAUSE_STATE_CHANGED, (p: boolean) => host.onPause(!!p));
      b.platform.on(E.AUDIO_STATE_CHANGED, (on: boolean) => host.onAudio(!!on));
      // an interstitial already open as the game starts: held paused and silent until it closes (the Bridge's
      // pause and audio events cover the ones that open later)
      if (b.advertisement?.interstitialState === 'opened') {
        host.onPause(true);
        host.onAudio(false);
        const done = (s: string) => {
          if (s !== 'closed' && s !== 'failed') return;
          host.onPause(false);
          host.onAudio(b.platform.isAudioEnabled !== false);
          try { b.advertisement.off?.(E.INTERSTITIAL_STATE_CHANGED, done); } catch { /* old Bridge */ }
        };
        b.advertisement.on(E.INTERSTITIAL_STATE_CHANGED, done);
      }
    } catch (e) {
      console.warn('Bridge failed to start, running without it', e);
      bridge = null;
    }
  }
  const mock = !bridge || bridge.platform.id === 'mock';
  fake = mock && (import.meta.env.DEV || params.has('fakeads')) && !params.has('noads');
}

/** The Bridge is up and the save is read: the common fields can be filled, the held events go out. */
export function flushEarly(): void {
  const q = early ?? [];
  early = null;
  for (const [n, d] of q) track(n, d);
}

/** Bridge's device type (`mobile`, `tablet`, `desktop`), or null where it does not say. */
export const deviceType = (): string | null => (bridge?.device?.type ? String(bridge.device.type) : null);
export const audioEnabled = (): boolean => (bridge ? bridge.platform.isAudioEnabled !== false : true);
/** The player's language as the platform reports it; English when there is no Bridge (3.4.2). */
export const language = (): string => String(bridge?.platform.language ?? 'en').slice(0, 2).toLowerCase();

/** The game is loaded and playable. */
export function gameReady(): void {
  try { bridge?.platform.sendMessage('game_ready'); } catch { /* not relayed here */ }
}

/** A game event for Playgama analytics (src/funnel.ts); dropped where there is no Bridge. */
export function track(name: string, data?: Props): void {
  if (early) { if (early.length < 40) early.push([name, data]); return; }
  const all = { ...common(), ...data };
  if (params.has('trace')) console.info('track', name, all);
  try { bridge?.analytics?.send(name, all); } catch { /* not supported here */ }
}

/** Lifecycle message (`level_started`, `level_completed` ...), for the platforms that use them. */
export function lifecycle(msg: string, data?: Record<string, string>): void {
  try { bridge?.platform.sendMessage(msg, data); } catch { /* not relayed here */ }
}

// ---- saves -------------------------------------------------------------------------------------

const LOCAL_KEY = 'dummy-brawl-v1';
const KEY = 'save';

/** Our own localStorage is only for runs without the Bridge, or its local mock (an older save there);
 *  on a real platform every byte goes through Bridge storage (Playgama 3.2.1). */
const ownStorage = (): boolean => !bridge || bridge.platform.id === 'mock';

/**
 * The saved game as JSON (null: there is none yet), or `ok: false` when it could not be read. A read that
 * failed is not an empty save: writing a fresh career over it would wipe the player's progress, so the game
 * then plays without writing (`savesOff`).
 */
export async function loadData(): Promise<{ ok: boolean; data: string | null }> {
  if (bridge) {
    let failed = false;
    for (let i = 0; i < 3; i++) {
      try {
        const [v] = await within<unknown[]>(bridge.storage.get([KEY]), READ_MS, 'storage read');
        failed = false;
        if (v !== null && v !== undefined && v !== '') return { ok: true, data: typeof v === 'string' ? v : JSON.stringify(v) };
        break;
      } catch (e) {
        failed = true;
        console.warn('Bridge storage read failed', e);
        await new Promise((r) => setTimeout(r, 400 * (i + 1)));
      }
    }
    if (failed && !ownStorage()) return (writable = false), { ok: false, data: null };
  }
  if (!ownStorage()) return { ok: true, data: null };
  try { return { ok: true, data: localStorage.getItem(LOCAL_KEY) }; } catch { return { ok: true, data: null }; }
}

/** False when the save could not be read this session: nothing is written over it. */
let writable = true;
export const savesOff = (): boolean => !writable;
/** The newest snapshot waiting for the write in flight: writes go one at a time, so an older one never lands last. */
let queued: string | null = null;
let writing = false;

export function saveData(json: string): void {
  if (!writable) return;
  if (bridge) {
    queued = json;
    if (!writing) void drain();
    return;
  }
  try { localStorage.setItem(LOCAL_KEY, json); } catch { /* private mode: progress lasts for this page */ }
}

async function drain(): Promise<void> {
  writing = true;
  while (queued !== null) {
    const json = queued;
    queued = null;
    try { await bridge.storage.set([KEY], [json]); } catch (e) { console.warn('Bridge storage write failed', e); }
  }
  writing = false;
}

// ---- ads ---------------------------------------------------------------------------------------

// The between-races ad's own analytics (3.3.71). r46-r48 lost 32 of 151 race starts from the 4th race on
// right on the countdown (0 of 347 before it), where the first interstitial is asked for, and nothing said
// whether an ad was on screen. `ad_interstitial{placement, state, sec}` follows one ask: `asked`, then the
// Bridge's own states (`loading`, `opened`, `closed`, `failed`), or `quiet` when it said nothing for QUIET_MS
// (no ad was due). `sec` counts from the ask. session_end carries `ad_open` when the page went with one open.
const QUIET_MS = 3000;
let adAsk: { placement: string; at: number; heard: boolean } | null = null;
let adState = '';
let adWatched = false;
const adSec = (): number => (adAsk ? Math.round((performance.now() - adAsk.at) / 100) / 10 : 0);

/** An interstitial is loading or on screen now (the page leaving then is the ad's doing, or the player's escape from it). */
export const interstitialOpen = (): boolean => adState === 'loading' || adState === 'opened';

function watchInterstitial(): void {
  if (adWatched) return;
  adWatched = true;
  try {
    bridge.advertisement.on(bridge.EVENT_NAME.INTERSTITIAL_STATE_CHANGED, (s: string) => {
      adState = String(s);
      if (!adAsk) return; // an ad the game did not ask for (the one at start is platform.ts's own)
      adAsk.heard = true;
      track('ad_interstitial', { placement: adAsk.placement, state: adState, sec: adSec() });
    });
  } catch { adWatched = false; /* old Bridge: the asks still count */ }
}

/** A between-races ad; the Bridge decides whether one is due. */
export function interstitial(placement: string): void {
  if (fake || !bridge) return;
  watchInterstitial();
  const ask = { placement, at: performance.now(), heard: false };
  adAsk = ask;
  track('ad_interstitial', { placement, state: 'asked', sec: 0 });
  try { bridge.advertisement.showInterstitial(placement); } catch { track('ad_interstitial', { placement, state: 'error', sec: 0 }); }
  setTimeout(() => { if (adAsk === ask && !ask.heard) track('ad_interstitial', { placement, state: 'quiet', sec: adSec() }); }, QUIET_MS);
}

export const rewardedReady = (): boolean => !rewardedBusy && (fake || !!bridge?.advertisement.isRewardedSupported);

/** Show a rewarded ad; resolves true only if the player watched it to the reward. */
export function showRewarded(placement: string): Promise<boolean> {
  const t0 = performance.now();
  /** The ad funnel's other half (the offer is the game's): how the ad the player asked for went. */
  const result = (r: 'rewarded' | 'closed' | 'failed' | 'timeout' | 'unavailable') =>
    track('ad_result', { placement, result: r, sec: Math.round((performance.now() - t0) / 1000) });
  if (!rewardedReady()) return result('unavailable'), Promise.resolve(false);
  rewardedBusy = true;
  const done = (ok: boolean) => { rewardedBusy = false; return ok; };
  if (fake) return fakeAd(placement).then((ok) => (result('rewarded'), done(ok)));
  return new Promise<boolean>((resolve) => {
    const b = bridge;
    const E = b.EVENT_NAME.REWARDED_STATE_CHANGED;
    let granted = false;
    let over = false;
    let failed = false;
    const finish = (timeout?: boolean) => {
      if (over) return;
      over = true;
      result(granted ? 'rewarded' : timeout ? 'timeout' : failed ? 'failed' : 'closed');
      try { b.advertisement.off?.(E, onState); } catch { /* old Bridge */ }
      clearTimeout(guard);
      resolve(done(granted));
    };
    const onState = (s: string) => {
      if (s === 'rewarded') granted = true;
      else if (s === 'closed' || s === 'failed') { failed = s === 'failed'; finish(); }
    };
    const guard = setTimeout(() => finish(true), 120_000); // never leave the game waiting on a lost event
    b.advertisement.on(E, onState);
    try { b.advertisement.showRewarded(placement); } catch { failed = true; finish(); }
  });
}

/** A stand-in ad for local runs: a dark screen and a countdown, then the reward. */
function fakeAd(placement: string): Promise<boolean> {
  return new Promise((resolve) => {
    host.onPause(true);
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;inset:0;z-index:999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;background:#111d;color:#fff;font:900 22px system-ui;';
    el.innerHTML = `<div>AD · ${placement}</div><div style="font-size:14px;opacity:.7">test ad, not shown on the platform</div>`;
    document.body.appendChild(el);
    setTimeout(() => {
      el.remove();
      host.onPause(false);
      resolve(true);
    }, 1200);
  });
}

// ---- leaderboard -------------------------------------------------------------------------------

/**
 * The two boards (public/playgama-bridge-config.json; on Playgama they run on Bridge SaaS): lifetime
 * takedowns, and the daily challenge's points. Both only ever climb, which is what lets `sent` below
 * hold the last number each one got and skip a write that would say the same thing again.
 */
export type BoardId = 'takedowns' | 'daily_points';
export const BOARDS: BoardId[] = ['takedowns', 'daily_points'];
export type BoardType = 'not_available' | 'in_game' | 'native' | 'native_popup';
export interface BoardEntry { name: string; score: number; rank: number; me: boolean; }

export const boardType = (): BoardType => {
  const ty = bridge?.leaderboards?.type;
  return ty === 'in_game' || ty === 'native' || ty === 'native_popup' ? ty : 'not_available';
};

/** How a board call failed, as one of two words (no messages in analytics). */
const why = (e: unknown): string => (e instanceof Error && e.message.endsWith('timed out') ? 'timeout' : 'error');

const sent: Record<BoardId, number> = { takedowns: -1, daily_points: -1 };
/** The player's score after a race; skipped where there is no board, or when it hasn't changed. A failed
 *  write is tried again after the next race. `board_write{ok}` says whether it landed (3.3.63). */
export function submitScore(board: BoardId, score: number): void {
  if (boardType() === 'not_available' || score <= sent[board]) return;
  sent[board] = score;
  const t0 = performance.now();
  const ms = () => Math.round(performance.now() - t0);
  let p: Promise<unknown>;
  try { p = within(bridge.leaderboards.setScore(board, score), READ_MS, 'leaderboard write'); } catch (e) { p = Promise.reject(e); }
  p.then(() => track('board_write', { ok: true, ms: ms(), score, board }), (e: unknown) => {
    console.warn('Leaderboard write failed', e);
    if (sent[board] === score) sent[board] = -1;
    track('board_write', { ok: false, ms: ms(), score, board, err: why(e) });
  });
}

/** The board's top entries (an `in_game` board only). `board_read` says whether they came, how many, and
 *  whether the player's own row was among them (3.3.63). */
export async function boardEntries(board: BoardId): Promise<BoardEntry[]> {
  const me = String(bridge?.player?.id ?? '');
  const t0 = performance.now();
  let raw: any[];
  try {
    raw = await within<any[]>(bridge.leaderboards.getEntries(board), READ_MS, 'leaderboard read');
  } catch (e) {
    track('board_read', { ok: false, ms: Math.round(performance.now() - t0), board, err: why(e) });
    throw e;
  }
  const list = (Array.isArray(raw) ? raw : []).slice(0, 50).map((e, i) => ({
    name: String(e?.name ?? '').slice(0, 24),
    score: Number(e?.score) || 0,
    rank: Number(e?.rank) || i + 1,
    me: !!me && String(e?.id ?? '') === me,
  }));
  track('board_read', { ok: true, ms: Math.round(performance.now() - t0), board, n: list.length, mine: list.some((e) => e.me), sent: Math.max(sent[board], 0) });
  return list;
}

/** The platform's own board overlay (a `native_popup` board). */
export function showBoardPopup(board: BoardId): void {
  try { bridge.leaderboards.showNativePopup(board).catch(() => { /* closed or none */ }); } catch { /* none */ }
}

/** Every board's last score sent again, under the name the player now has. */
export function resendScore(): void {
  for (const b of BOARDS) {
    const s = sent[b];
    sent[b] = -1;
    if (s >= 0) submitScore(b, s);
  }
}

// ---- the player's name on the board --------------------------------------------------------------

/** The platform can sign the player in, and they are not signed in yet. The board offers it there and
 *  nowhere else: the game never asks for a sign-in by itself (Playgama 1.2.2). */
export const canSignIn = (): boolean => !!bridge?.player?.isAuthorizationSupported && !bridge.player.isAuthorized;

/** Sign in through the platform, from a tap the player made. True when they are authorized afterwards.
 *  A sign-in that fails or is closed changes nothing: the board stays open and playable (1.2.3). */
export async function signIn(): Promise<boolean> {
  if (!bridge?.player) return false;
  try {
    await within(bridge.player.authorize(), AUTH_MS, 'authorize');
  } catch (e) {
    console.warn('Authorization failed or was closed', e);
  }
  return !!bridge.player.isAuthorized;
}
