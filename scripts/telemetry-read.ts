// Turning the collector's NDJSON into sessions, and the few judgements a read of it rests on: which
// sessions were nobody, where each one ended, and what the opening funnel's steps are. It is here
// rather than in the script that prints it because these are the places a wrong reading comes from,
// and they are the part a test can hold still (scripts/telemetry-read.test.ts).
import type { Stored, WireEvent } from '../server/wire.ts';

export type Fields = Record<string, number | string | boolean>;

export interface Session {
  sid: string;
  uid?: string;
  v: string;
  c?: string;
  /** Batch numbers that arrived, so a hole in them is visible. */
  batches: Set<number>;
  evs: WireEvent[];
}

/** The stored lines of one or more days, joined into sessions. Blank and error lines are skipped. */
export function sessions(lines: Iterable<string>): Session[] {
  const by = new Map<string, Session>();
  for (const line of lines) {
    if (!line.trim() || line.startsWith('{"error"')) continue;
    const b = JSON.parse(line) as Stored;
    let s = by.get(b.sid);
    if (!s) by.set(b.sid, (s = { sid: b.sid, v: b.v, batches: new Set(), evs: [] }));
    // The uid arrives once the save has been read (src/telemetry.ts's `begin`), and the country with
    // every batch; take whichever batch carried them.
    if (b.uid) s.uid = b.uid;
    if (b.c) s.c = b.c;
    s.batches.add(b.n);
    s.evs.push(...b.evs);
  }
  for (const s of by.values()) {
    // A batch the browser refused is queued again and sent later, so the same event can arrive twice.
    // `i` counts from 0 within the session and is never reused (src/collect.ts), so it is the identity.
    const seen = new Set<number>();
    s.evs = s.evs
      .filter((e) => (seen.has(e.i) ? false : (seen.add(e.i), true)))
      .sort((a, b) => a.i - b.i || a.s - b.s);
  }
  return [...by.values()];
}

export const dur = (s: Session): number => Math.max(0, ...s.evs.map((e) => e.s));
export const names = (s: Session): Set<string> => new Set(s.evs.map((e) => e.e));
export const at = (s: Session, name: string): WireEvent | undefined => s.evs.find((e) => e.e === name);
const tut = (s: Session, which: string): WireEvent | undefined =>
  s.evs.find((e) => e.e === 'tutorial_step' && e.d?.step === which);

/**
 * The thirteen fields every event carries once the save has been read (src/telemetry.ts's `begin`):
 * device, build, new_player, focus and the rest. Events from before that -- the boot marks, a boot
 * error -- carry none, so take them from the first event that has them. `build` is the marker: it is
 * the one field that is always there and is never anything else's.
 */
export const facts = (s: Session): Fields => s.evs.find((e) => e.d && 'build' in e.d)?.d ?? {};

/** Those thirteen by name, so an event's own fields can be told from the ones it merely carries. */
export const COMMON: ReadonlySet<string> = new Set([
  'device', 'form', 'touch', 'orient', 'lang', 'build', 'new_player', 'career', 'rung', 'session_n',
  'days', 'focus', 'gfx',
]);

/** What this event says that every other event does not: `facts` would swallow its own fields too. */
export const own = (e: WireEvent): Fields =>
  Object.fromEntries(Object.entries(e.d ?? {}).filter(([k]) => !COMMON.has(k)));

/**
 * A session no person was behind. The tell is leaving during the boot in about a second, which nobody
 * decides to do: those are crawlers and link previews, and they never reach a first frame.
 */
export function bot(s: Session): boolean {
  const left = at(s, 'boot_left');
  return !!left && left.s < 3 && !names(s).has('game_loaded');
}

/**
 * A tab that never held the focus. `focus` is `document.hasFocus()` at the moment of each event, so a
 * session where no event ever saw it was opened in a background tab and left there -- the thing that
 * made race 1's "never pressed a key" look like a quarter of the players until we looked (the r53
 * read-up). They do reach a first frame, so the bot rule above does not catch them, and they are not
 * a person giving up either: they are counted apart.
 */
export const unfocused = (s: Session): boolean =>
  'focus' in facts(s) && !s.evs.some((e) => e.d?.focus === true);

/** Batches are numbered from 0: a gap means a send that never arrived, and the events in it. */
export function lost(s: Session): number {
  if (!s.batches.size) return 0;
  return Math.max(...s.batches) + 1 - s.batches.size;
}

/**
 * Where the session ended. `session_end` is sent on every hide, so the last one is where they left
 * (src/funnel.ts); `boot_left` is a page left before the first frame; anything else lost its last
 * batch or is still open.
 */
export function ending(s: Session): string {
  const ends = s.evs.filter((e) => e.e === 'session_end');
  const last = ends[ends.length - 1];
  if (last) {
    const d = last.d ?? {};
    return `session_end (${d.reason ?? '?'}, ${d.races ?? '?'} races, ${d.played ?? '?'}s racing)`;
  }
  const left = at(s, 'boot_left');
  if (left) return `boot_left (${left.d?.stage ?? '?'} at ${left.d?.ms ?? '?'}ms)`;
  return 'no word (lost its last batch, or still open)';
}

export function machine(s: Session): string {
  const f = facts(s);
  const bits: string[] = [];
  if (s.c) bits.push(s.c);
  if (typeof f.device === 'string') bits.push(f.device);
  // `form` is what the host says it is and `device` what the user agent says: worth seeing when they
  // disagree, which is how a phone ends up being sent the desktop controls.
  if (typeof f.form === 'string' && f.form !== f.device) bits.push(`form:${f.form}`);
  if (typeof f.orient === 'string') bits.push(f.orient);
  if (f.touch === true) bits.push('touch');
  if (typeof f.lang === 'string') bits.push(f.lang);
  if (typeof f.gfx === 'number') bits.push(`gfx${f.gfx}`);
  return bits.join(' ') || '?';
}

/**
 * The opening, step by step, in the order it happens -- written out rather than read off the event
 * names, because this game has no funnel_ prefix and because the order is the point: a funnel is only
 * a funnel while each step is downstream of the one above it. Ordering the steps by how many reached
 * them, or by median time, puts one slow phone's first frame after its own first tap.
 */
export const STEPS: { label: string; reached: (s: Session) => WireEvent | undefined }[] = [
  { label: 'first frame', reached: (s) => at(s, 'game_loaded') },
  { label: 'first input', reached: (s) => at(s, 'first_input') },
  { label: 'race 1 start', reached: (s) => at(s, 'progression_started') },
  { label: 'steered', reached: (s) => tut(s, 'steer') },
  { label: 'slapped', reached: (s) => tut(s, 'slap') },
  { label: 'landed a hit', reached: (s) => tut(s, 'hit') },
  { label: '30s racing', reached: (s) => at(s, 'play_30s') },
  { label: 'race 1 done', reached: (s) => s.evs.find((e) => e.e === 'progression_completed' || e.e === 'tutorial_completed') },
  { label: 'race 2 start', reached: (s) => s.evs.filter((e) => e.e === 'progression_started')[1] },
  { label: '60s racing', reached: (s) => at(s, 'play_60s') },
  { label: '3min racing', reached: (s) => at(s, 'play_180s') },
  { label: '10min racing', reached: (s) => at(s, 'play_600s') },
];

export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const a = [...xs].sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/** The value q of the way up the sorted list (q = 0.75: three quarters are at or below it). */
export function quantile(xs: number[], q: number): number {
  if (!xs.length) return 0;
  const a = [...xs].sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor(q * a.length))];
}

export const secs = (n: number): string =>
  n >= 60 ? `${Math.floor(n / 60)}m${String(Math.round(n % 60)).padStart(2, '0')}` : `${n.toFixed(n < 10 ? 1 : 0)}s`;
