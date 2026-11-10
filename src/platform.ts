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

/** Callbacks the game sets: the host wants the game paused, or the sound off. */
export const host = {
  onPause: (_paused: boolean) => {},
  onAudio: (_enabled: boolean) => {},
};

/** Set up the Bridge if it loaded. Never rejects: on any failure the game runs on the fallbacks. */
export async function initPlatform(): Promise<void> {
  const b = (window as any).bridge as Bridge | undefined;
  if (b) {
    try {
      await b.initialize();
      bridge = b;
      const E = b.EVENT_NAME;
      b.platform.on(E.PAUSE_STATE_CHANGED, (p: boolean) => host.onPause(!!p));
      b.platform.on(E.AUDIO_STATE_CHANGED, (on: boolean) => host.onAudio(!!on));
    } catch (e) {
      console.warn('Bridge failed to start, running without it', e);
      bridge = null;
    }
  }
  const mock = !bridge || bridge.platform.id === 'mock';
  fake = mock && (import.meta.env.DEV || params.has('fakeads')) && !params.has('noads');
}

export const platformId = (): string => (bridge ? String(bridge.platform.id) : 'none');
export const audioEnabled = (): boolean => (bridge ? bridge.platform.isAudioEnabled !== false : true);
/** The player's language as the platform reports it; English when there is no Bridge (3.4.2). */
export const language = (): string => String(bridge?.platform.language ?? 'en').slice(0, 2).toLowerCase();

/** The game is loaded and playable. */
export function gameReady(): void {
  try { bridge?.platform.sendMessage('game_ready'); } catch { /* not relayed here */ }
}

/** A game event for Playgama analytics (src/funnel.ts); dropped where there is no Bridge. */
export function track(name: string, data?: Record<string, string | number | boolean>): void {
  if (params.has('trace')) console.info('track', name, data ?? '');
  try { bridge?.analytics?.send(name, data); } catch { /* not supported here */ }
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

/** The saved game as JSON, or null. */
export async function loadData(): Promise<string | null> {
  if (bridge) {
    try {
      const [v] = await bridge.storage.get([KEY]);
      if (v !== null && v !== undefined && v !== '') return typeof v === 'string' ? v : JSON.stringify(v);
    } catch (e) {
      console.warn('Bridge storage read failed', e);
    }
  }
  if (!ownStorage()) return null;
  try { return localStorage.getItem(LOCAL_KEY); } catch { return null; }
}

export function saveData(json: string): void {
  if (bridge) {
    bridge.storage.set([KEY], [json]).catch((e: unknown) => console.warn('Bridge storage write failed', e));
    return;
  }
  try { localStorage.setItem(LOCAL_KEY, json); } catch { /* private mode: progress lasts for this page */ }
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
  if (!rewardedReady()) return Promise.resolve(false);
  rewardedBusy = true;
  const done = (ok: boolean) => { rewardedBusy = false; return ok; };
  if (fake) return fakeAd(placement).then(done);
  return new Promise<boolean>((resolve) => {
    const b = bridge;
    const E = b.EVENT_NAME.REWARDED_STATE_CHANGED;
    let granted = false;
    let over = false;
    const finish = () => {
      if (over) return;
      over = true;
      try { b.advertisement.off?.(E, onState); } catch { /* old Bridge */ }
      clearTimeout(guard);
      resolve(done(granted));
    };
    const onState = (s: string) => {
      if (s === 'rewarded') granted = true;
      else if (s === 'closed' || s === 'failed') finish();
    };
    const guard = setTimeout(finish, 120_000); // never leave the game waiting on a lost event
    b.advertisement.on(E, onState);
    try { b.advertisement.showRewarded(placement); } catch { finish(); }
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
