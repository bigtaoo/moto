// A fingerprint of the whole race state: the golden-hash test, replay checks and (later) online desync
// checks compare these. Walks every field the World holds, so new state is covered without listing it.
// Numbers are hashed by their exact IEEE-754 bits, so a last-bit drift shows.

import type { World } from './world';

const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);

/** FNV-1a over 32-bit words, folded with MurmurHash3's finalizer at the end. */
class Hasher {
  h = 0x811c9dc5;
  word(x: number): void {
    this.h = Math.imul(this.h ^ (x >>> 0), 0x01000193);
  }
  num(x: number): void {
    f64[0] = x === 0 ? 0 : x; // -0 and 0 hash alike
    this.word(u32[0]);
    this.word(u32[1]);
  }
  str(s: string): void {
    this.word(s.length);
    for (let i = 0; i < s.length; i++) this.word(s.charCodeAt(i));
  }
  done(): string {
    let h = this.h;
    h ^= h >>> 16;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return (h >>> 0).toString(16).padStart(8, '0');
  }
}

// Tags keep e.g. [1, [2]] and [[1], 2] apart.
const T = { undef: 1, nul: 2, f: 3, t: 4, num: 5, str: 6, arr: 7, set: 8, obj: 9, map: 10 };

function walk(h: Hasher, v: unknown): void {
  if (v === undefined) return h.word(T.undef);
  if (v === null) return h.word(T.nul);
  switch (typeof v) {
    case 'boolean': return h.word(v ? T.t : T.f);
    case 'number': h.word(T.num); return h.num(v);
    case 'string': h.word(T.str); return h.str(v);
    case 'function': return;
  }
  if (Array.isArray(v)) {
    h.word(T.arr);
    h.word(v.length);
    for (const x of v) walk(h, x);
    return;
  }
  // Sets and Maps iterate in insertion order, which is the same on every machine running the same inputs.
  if (v instanceof Set) {
    h.word(T.set);
    h.word(v.size);
    for (const x of v) walk(h, x);
    return;
  }
  if (v instanceof Map) {
    h.word(T.map);
    h.word(v.size);
    for (const [k, x] of v) { walk(h, k); walk(h, x); }
    return;
  }
  h.word(T.obj);
  // Field order is creation order, fixed by the code that builds the object.
  for (const k of Object.keys(v as object)) {
    if (k === 'events') continue; // the caller's queue, drained at its own pace
    h.str(k);
    walk(h, (v as Record<string, unknown>)[k]);
  }
}

/** Hex fingerprint of everything the race state holds (except the pending event queue). */
export function hashState(w: World): string {
  const h = new Hasher();
  walk(h, w);
  return h.done();
}
