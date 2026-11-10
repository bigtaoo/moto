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

export const platformId = (): string => (bridge ? String(bridge.platform.id) : 'none');
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

/** A between-races ad; the Bridge decides whether one is due. */
export function interstitial(placement: string): void {
  if (fake || !bridge) return;
  try { bridge.advertisement.showInterstitial(placement); } catch { /* none */ }
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
