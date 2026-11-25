// The wire contract between the game and our own collector, and the only place that decides what is
// allowed through it. Both ends import these types (src/collect.ts sends them, server/index.ts
// receives them), so the two cannot drift apart without the typechecker saying so.
//
// Validation here is not politeness, it is the privacy rule and the abuse guard in one: the endpoint is public — anyone who opens the game can see its
// address — so nothing reaches the disk that we did not ask for. Unknown fields are dropped rather
// than rejected: an old build must keep being readable after the client adds a field.

/** The wire batch. The envelope is per batch, not per event: ~200 events a session, so it adds up. */
export interface Batch {
  /** This page view. Everything from one session carries it; it is what per-player traces are joined on. */
  sid: string;
  /** Build version (`__BUILD__`): on Playgama the Bridge tagged every event with it, here we do. */
  v: string;
  /** The player, once the save has been read (the boot entry sends before that; join by `sid`). */
  uid?: string;
  /** Batch number within the session, so the server can see a dropped one. */
  n: number;
  /** `Date.now()` at send. Each event carries its own too: a batch may sit in the queue. */
  t: number;
  evs: WireEvent[];
}

export interface WireEvent {
  /** Event name, as sent to `platform.track` (src/telemetry.ts, src/funnel.ts). */
  e: string;
  /** Order within the session: a batch can arrive late or out of order. */
  i: number;
  /** Seconds since the page started (`performance.now()`), one decimal, as `s` everywhere else. */
  s: number;
  t: number;
  d?: Record<string, number | string | boolean>;
}

/** What one batch may carry. Generous against today's game, tight against anything else. */
export const LIMITS = {
  /** Bytes of JSON. The client's own cap is 24 events; 64 KB is also sendBeacon's ceiling in Chrome. */
  body: 64 * 1024,
  /** Ids are 11 random chars (src/collect.ts); allow room without allowing a paragraph. */
  id: 40,
  /** `0.2.0+e348781.dirty`, or `test`. */
  version: 32,
  events: 200,
  /**
   * Every event carries the thirteen common fields (src/telemetry.ts) on top of its own, and
   * `progression_started` already measures 26. Over the cap the rest are dropped without a word, so
   * the cap sits well clear of the widest event; the body limit is what actually holds a batch down.
   */
  fields: 64,
  name: 64,
  /** No free text: the longest legitimate value is a gpu string, which we already cut client-side. */
  value: 96,
} as const;

/** A batch as it is stored: what the client sent, plus what only the server can know. */
export interface Stored extends Batch {
  /** Server receive time (`Date.now()`). The client's clock is the player's clock and can be anything. */
  rt: number;
  /** Two-letter country, from Cloudflare's edge. The IP it came from is never read and never stored. */
  c?: string;
}

function str(v: unknown, max: number): string | null {
  return typeof v === 'string' && v.length > 0 && v.length <= max ? v : null;
}

function int(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null;
}

/** Event names are ours: lowercase words and digits joined by `_` (`garage_closed`, `play_30s`). */
const NAME = /^[a-z][a-z0-9_]*$/;
/** Ids are what `Math.random().toString(36)` makes. */
const ID = /^[a-z0-9]+$/;

function fields(v: unknown): Record<string, number | string | boolean> | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const out: Record<string, number | string | boolean> = {};
  let n = 0;
  for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
    if (++n > LIMITS.fields) break;
    if (k.length > 24 || !NAME.test(k)) continue;
    // Numbers, flags and short labels only. An object or an array here would be a nesting we never send,
    // and a long string is the shape free text arrives in.
    if (typeof raw === 'number') {
      if (Number.isFinite(raw)) out[k] = raw;
    } else if (typeof raw === 'boolean') out[k] = raw;
    else if (typeof raw === 'string' && raw.length <= LIMITS.value) out[k] = raw;
  }
  return Object.keys(out).length ? out : undefined;
}

function event(v: unknown): WireEvent | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const e = str(o.e, LIMITS.name);
  if (!e || !NAME.test(e)) return null;
  const i = int(o.i);
  const t = int(o.t);
  if (i === null || t === null) return null;
  const s = typeof o.s === 'number' && Number.isFinite(o.s) ? Math.round(o.s * 100) / 100 : 0;
  const d = fields(o.d);
  return d ? { e, i, s, t, d } : { e, i, s, t };
}

export type Parsed = { ok: true; batch: Batch } | { ok: false; why: string };

/**
 * Read one POSTed body. Never throws: a malformed body is a 400, not a 500, and an endpoint that
 * 500s on junk is one we cannot tell a real fault from.
 */
export function parseBatch(text: string): Parsed {
  if (text.length > LIMITS.body) return { ok: false, why: 'too big' };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, why: 'not json' };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, why: 'not an object' };
  const o = raw as Record<string, unknown>;
  const sid = str(o.sid, LIMITS.id);
  if (!sid || !ID.test(sid)) return { ok: false, why: 'no sid' };
  const v = str(o.v, LIMITS.version);
  if (!v) return { ok: false, why: 'no version' };
  const n = int(o.n);
  const t = int(o.t);
  if (n === null || n < 0 || t === null) return { ok: false, why: 'no envelope' };
  if (!Array.isArray(o.evs) || !o.evs.length) return { ok: false, why: 'no events' };
  const evs: WireEvent[] = [];
  for (const raw of o.evs.slice(0, LIMITS.events)) {
    const ev = event(raw);
    if (ev) evs.push(ev);
  }
  if (!evs.length) return { ok: false, why: 'no usable event' };
  const uid = str(o.uid, LIMITS.id);
  const batch: Batch = { sid, v, n, t, evs };
  if (uid && ID.test(uid)) batch.uid = uid;
  return { ok: true, batch };
}
