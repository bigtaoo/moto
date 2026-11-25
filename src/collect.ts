// Our own telemetry wire, for the hosts whose backend collects nothing for us.
//
// Everything the game measures goes through `platform.track`, and that call ends in
// `bridge.analytics.send` — so on Playgama we get a backend that fills in the envelope (session,
// player, timestamp, version, country) and on anything else we get silence. The CrazyGames SDK has
// no custom events at all: its analytics module is `trackOrder`, for purchases. A build without the
// Playgama Bridge therefore recorded nothing whatsoever, which is no way to read a version.
//
// So: a copy of every event goes here as well, with the envelope written by us, batched, and handed
// to `sendBeacon` when the page goes away. Playgama keeps getting its copy unchanged — the sandbox
// readings have to stay comparable with the ones already written down.
//
// The server end is `server/` (a small node service on the box blight bloom owns, writing one
// NDJSON file per day -- server/README.md), and `server/wire.ts` is the contract both ends import,
// so they cannot drift apart without the typechecker saying so. With no `VITE_TELEMETRY` configured nothing is sent and the game is
// unchanged: that is what a dev run and a test are.

import type { Batch, WireEvent } from '../server/wire';

declare const __BUILD__: string;
const BUILD = typeof __BUILD__ === 'string' ? __BUILD__ : 'dev';

/** Send when this many are waiting: a batch is cheap, a lost batch is not. */
export const MAX_BATCH = 24;
/** ...or when the oldest has waited this long. */
export const FLUSH_MS = 5_000;
/**
 * Hard cap while the collector is unreachable. Dropping the newest keeps the opening -- the boot
 * marks, the funnel, the first race -- which is the part no later event can tell us about.
 */
export const MAX_QUEUE = 400;
/**
 * Events in one POST. The server reads at most `LIMITS.events` (200) and at most `LIMITS.body` bytes,
 * and it drops the rest without a word -- so a queue that built up while the collector was
 * unreachable has to go out as several batches, not one long one that arrives half-read. Every event
 * here carries the dozen common fields (src/telemetry.ts), about 250 bytes, so a hundred of them is a
 * quarter of the body limit.
 */
export const MAX_SEND = 100;
/**
 * How long nothing goes out after a send failed. A blocked address or a collector that is down fails
 * every time, and with the queue standing above MAX_BATCH every single event would otherwise fire its
 * own flush -- one request per event at a dead endpoint, a worse storm than the gap it is closing. One
 * try every half minute instead, while the queue fills to its cap in the meantime.
 */
export const RETRY_MS = 30_000;

/** 11 random chars: enough that two sessions never collide, short enough to repeat in every batch. */
const randomId = (): string => Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 7);

/** This page view's id, made before anything else so even a boot failure is attributable. */
export const SID = randomId();
/** A fresh id for a player who has none yet; it is saved, so it lasts as long as the save does. */
export const newPlayerId = randomId;

function configured(): string {
  const url = (import.meta.env.VITE_TELEMETRY as string | undefined) ?? '';
  if (!import.meta.env.DEV) return url;
  // Dev only: point a local build at a collector under test. Never honoured in a build, where the URL
  // would be whatever the host page put in our address bar.
  try {
    const asked = new URLSearchParams(location.search).get('telemetry');
    if (asked === 'off') return '';
    if (asked) return asked;
  } catch { /* no location (tests): fall through */ }
  return url;
}

let url: string | null = null;

/** The collector endpoint, or '' when none is configured -- then nothing is sent at all. */
export function telemetryUrl(): string {
  if (url === null) url = configured();
  return url;
}

/** Test seam: forget the cached URL (and set one). */
export function setTelemetryUrl(next: string | null): void {
  url = next;
}

/**
 * The body is JSON, but it goes out labelled as text: `application/json` is not a CORS-safelisted type,
 * so it costs a preflight on every batch -- and a beacon fired from `pagehide` has no time for one,
 * which is exactly the send we most need to arrive. The collector parses the body by shape, not by
 * this header.
 */
const WIRE_TYPE = 'text/plain;charset=UTF-8';

let batches = 0;

/**
 * Send one batch, as beacon when the page is going away (it is the only thing that survives `pagehide`)
 * and as a keepalive fetch otherwise. False when nothing was handed to the browser, so the caller can
 * keep the events and try again. Never throws.
 */
export function post(evs: WireEvent[], extra: { uid?: string } = {}, leaving = false): boolean {
  const to = telemetryUrl();
  if (!to || !evs.length) return false;
  const batch: Batch = { sid: SID, v: BUILD, n: batches++, t: Date.now(), evs, ...extra };
  const body = JSON.stringify(batch);
  try {
    // sendBeacon is capped (64 KB in Chrome) and refuses when the queue is full; fetch then still has
    // a chance while the page lives.
    if (leaving && navigator.sendBeacon?.(to, new Blob([body], { type: WIRE_TYPE }))) return true;
    void fetch(to, { method: 'POST', body, keepalive: true, headers: { 'content-type': WIRE_TYPE }, mode: 'cors', credentials: 'omit' })
      // Handed to the browser is not arrived: a dropped connection, a blocked address, a collector that
      // is down -- all of them land here, and until this they took the batch with them. Back in the
      // queue it goes. A 4xx other than 429 is the one exception: the server read this body and refused
      // it on purpose, and sending the same bytes again would only be refused again.
      .then((r) => { if (r.status === 429 || r.status >= 500) requeue(evs); }, () => requeue(evs));
    return true;
  } catch {
    batches--;
    return false;
  }
}

const queue: WireEvent[] = [];
let seq = 0;
let dropped = 0;
let uid: string | undefined;
let timer: ReturnType<typeof setTimeout> | null = null;
let listening = false;
/** `Date.now()` before which nothing is sent, set whenever a send fails (RETRY_MS). */
let hold = 0;

/** The marker that stands where the cap threw events away. */
const DROPPED = 'telemetry_dropped';

const onHide = (): void => { if (document.visibilityState === 'hidden') flush(true); };
const onLeave = (): void => flush(true);

/**
 * Page listeners are added on the first event, never at module load: a module that listens as it is
 * imported cannot be imported outside a browser, which is how four modules here once became
 * untestable (doc 3.3.32).
 */
function listen(): void {
  if (listening || typeof document === 'undefined') return;
  listening = true;
  // Both: `pagehide` is the one iOS fires on a real close, `visibilitychange` catches a tab switch,
  // and a switch that never comes back is how most sessions end.
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', onLeave);
}

/** The player's id, once the save has been read. Earlier batches join by session id. */
export function identify(id: string): void {
  uid = id;
}

/** Queue one event. `s` is the page clock, in seconds, as it is everywhere else here. */
export function collect(event: string, data?: Record<string, string | number | boolean>): void {
  if (!telemetryUrl()) return;
  listen();
  if (queue.length >= MAX_QUEUE) { dropped++; return; }
  queue.push({ e: event, i: seq++, s: Math.round(performance.now()) / 1000, t: Date.now(), ...(data ? { d: { ...data } } : {}) });
  if (queue.length >= MAX_BATCH) flush();
  else if (!timer) timer = setTimeout(() => flush(), FLUSH_MS);
}

/** Nothing goes out until RETRY_MS from now, and one try is booked for then. */
function held(): void {
  hold = Date.now() + RETRY_MS;
  if (!timer) timer = setTimeout(() => flush(), RETRY_MS);
}

/**
 * A batch that failed after the browser had taken it. The events are ours again and go back to the
 * front of the queue -- sorted, because the several chunks of one flush can come back in any order and
 * each goes in at the front, which would otherwise leave the oldest at the end where `trim` eats them.
 */
function requeue(evs: WireEvent[]): void {
  queue.unshift(...evs);
  queue.sort((a, b) => a.i - b.i);
  held();
  trim();
}

/**
 * Hold the queue to its cap, keeping the oldest. What is thrown away is counted into `dropped` rather
 * than forgotten, so the gap is still reported -- including when what falls off the end is the marker
 * for an earlier gap, whose own count is carried over rather than going down with it.
 */
function trim(): void {
  if (queue.length <= MAX_QUEUE) return;
  for (const ev of queue.splice(MAX_QUEUE)) {
    const n = ev.e === DROPPED ? ev.d?.n : 1;
    dropped += typeof n === 'number' ? n : 1;
  }
}

/**
 * Hand everything waiting to the browser. `leaving` is the page going away: sendBeacon then, which is
 * all that survives it. A send the browser refused leaves the events queued for the next try.
 */
export function flush(leaving = false): void {
  if (timer) { clearTimeout(timer); timer = null; }
  if (!queue.length) return;
  // Inside the cooldown after a failure nothing goes out, but nothing is abandoned either: one timer,
  // set for the far side of it. The page going away is the exception -- that send is the last there is.
  const wait = hold - Date.now();
  if (!leaving && wait > 0) {
    timer = setTimeout(() => flush(), wait);
    return;
  }
  if (dropped) {
    // Say so rather than quietly serve a short trace: a gap the reader cannot see is worse than a hole.
    queue.push({ e: DROPPED, i: seq++, s: Math.round(performance.now()) / 1000, t: Date.now(), d: { n: dropped } });
    dropped = 0;
  }
  while (queue.length) {
    const sending = queue.splice(0, MAX_SEND);
    if (post(sending, uid ? { uid } : {}, leaving)) continue;
    // Nothing was handed over: keep them, oldest first, and drop the newest down to the cap.
    queue.unshift(...sending);
    held();
    trim();
    return;
  }
}

/** Test seam: drop the queue, the timer and the listeners. */
export function resetCollector(): void {
  if (timer) { clearTimeout(timer); timer = null; }
  queue.length = 0;
  seq = 0;
  dropped = 0;
  batches = 0;
  hold = 0;
  uid = undefined;
  if (listening) {
    document.removeEventListener('visibilitychange', onHide);
    window.removeEventListener('pagehide', onLeave);
    listening = false;
  }
}

/** How many are waiting (tests, and the dev console). */
export const waiting = (): number => queue.length;
