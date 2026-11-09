// What is on the road this race besides traffic: construction zones that close the right lane, shortcut
// trails just outside the barrier, and ramps. Placed once per race from their own dice; the sim asks it
// where a rider may ride (bounds), what a car can drive through, and what a rider rode over this tick.

import * as C from './config';
import type { Prng } from './rng';

export type Side = -1 | 1;

/** A construction zone: lane 3 is coned off from z0 to z1 (with a taper in before and out after). */
export interface Works {
  z0: number;
  z1: number;
}

/** A shortcut trail on `side`, from z0 (barrier open for C.CUT.gap) to z1 (open again for C.CUT.merge). */
export interface Cut {
  z0: number;
  z1: number;
  side: Side;
}

export interface Ramp {
  x: number;
  z: number;
  halfW: number;
  /** C.LANE_X index on the road; -1 mid-trail. */
  lane: number;
  trail: boolean;
}

type Kind = 'works' | 'cut' | 'ramp';

export class Road {
  readonly works: Works[] = [];
  readonly cuts: Cut[] = [];
  readonly ramps: Ramp[] = [];
  /** Per lane: stretches [from, to] a car can't drive through. */
  private readonly blocks: [number, number][][] = [[], [], [], []];

  constructor(readonly length: number, div: C.Division, rng: Prng) {
    const kinds: Kind[] = [];
    for (let i = 0; i < div.works; i++) kinds.push('works');
    for (let i = 0; i < div.cuts; i++) kinds.push('cut');
    for (let i = 0; i < div.ramps; i++) kinds.push('ramp');
    for (let i = kinds.length - 1; i > 0; i--) {
      const j = rng.int(i + 1);
      const k = kinds[i];
      kinds[i] = kinds[j];
      kinds[j] = k;
    }
    // evenly spaced slots, each feature jittered within its own; one that would crowd the last is left out
    // (only on short test roads)
    const F = C.FEATURES;
    const slot = ((F.to - F.from) * length) / Math.max(1, kinds.length);
    let free = 60;
    for (let i = 0; i < kinds.length; i++) {
      const mid = F.from * length + (i + 0.5) * slot + (rng.float() * 2 - 1) * F.jitter * slot;
      const k = kinds[i];
      if (k === 'ramp') {
        const lane = 1 + rng.int(3);
        if (mid - 20 < free || mid > length - 60) continue;
        this.ramps.push({ x: C.LANE_X[lane], z: mid, halfW: C.RAMP.halfW, lane, trail: false });
        free = mid + 20;
        continue;
      }
      const [a, b] = k === 'works' ? C.WORKS.len : C.CUT.len;
      const len = a + (b - a) * rng.float();
      const side: Side = rng.float() < 0.5 ? -1 : 1;
      const z0 = mid - len / 2;
      const z1 = mid + len / 2;
      const lead = k === 'works' ? C.WORKS.taper + 10 : 10;
      if (z0 - lead < free || z1 > length - 80) continue;
      if (k === 'works') {
        this.works.push({ z0, z1 });
        free = z1 + C.WORKS.out + 20;
      } else {
        this.cuts.push({ z0, z1, side });
        this.ramps.push({ x: side * C.CUT.mid, z: (z0 + C.CUT.gap + z1 - C.CUT.merge) / 2, halfW: C.RAMP.trailHalfW, lane: -1, trail: true });
        free = z1 + 20;
      }
    }
    for (const w of this.works) this.blocks[3].push([w.z0 - C.WORKS.taper, w.z1 + C.WORKS.out]);
    for (const r of this.ramps) if (!r.trail) this.blocks[r.lane].push([r.z - C.RAMP.before, r.z + C.RAMP.after]);
  }

  /** How far right a rider can be at z (the cones of a construction zone; the barrier elsewhere). */
  worksHi(z: number): number {
    const W = C.WORKS;
    for (const w of this.works) {
      if (z < w.z0 - W.taper || z > w.z1 + W.out) continue;
      if (z < w.z0) return C.EDGE - ((C.EDGE - W.edge) * (z - (w.z0 - W.taper))) / W.taper;
      if (z <= w.z1) return W.edge;
      return W.edge + ((C.EDGE - W.edge) * (z - w.z1)) / W.out;
    }
    return C.EDGE;
  }

  /** The trail whose stretch z is on, if any. */
  cutAt(z: number): Cut | null {
    for (const c of this.cuts) if (z >= c.z0 && z <= c.z1) return c;
    return null;
  }

  /** Index of the first trail not yet behind z (-1: none left). */
  nextCut(z: number): number {
    for (let i = 0; i < this.cuts.length; i++) if (this.cuts[i].z1 > z) return i;
    return -1;
  }

  /** Where a rider who was at px can be at z: [lo, hi]. On a trail between its openings they stay on it. */
  bounds(px: number, z: number): [number, number] {
    let lo = -C.EDGE;
    let hi = this.worksHi(z);
    const c = this.cutAt(z);
    if (c) {
      const K = C.CUT;
      const s = c.side;
      let outer = K.outer;
      let inner = 0;
      if (z < c.z0 + K.gap) {
        // the opening in: anywhere out to the trail's far side
      } else if (z > c.z1 - K.merge) outer = K.outer - ((K.outer - C.EDGE) * (z - (c.z1 - K.merge))) / K.merge;
      else if (px * s > K.split) inner = K.inner;
      else outer = C.EDGE;
      if (s > 0) {
        hi = outer;
        if (inner > 0) lo = inner;
      } else {
        lo = -outer;
        if (inner > 0) hi = -inner;
      }
    }
    return [lo, hi];
  }

  clampX(x: number, z: number): number {
    const [lo, hi] = this.bounds(x, z);
    return x < lo ? lo : x > hi ? hi : x;
  }

  /**
   * A line `want` an AI rider can aim for: inside the bounds both where it is and `ahead` metres on (so it
   * starts away from the cones in time, and doesn't aim back across the barrier once on a trail).
   */
  clampWant(want: number, z: number, ahead: number): number {
    const [lo0, hi0] = this.bounds(want, z);
    const [lo1, hi1] = this.bounds(want, z + ahead);
    const lo = Math.max(lo0, lo1);
    const hi = Math.min(hi0, hi1);
    if (lo > hi) return want < lo0 ? lo0 : want > hi0 ? hi0 : want;
    return want < lo ? lo : want > hi ? hi : want;
  }

  /** Which trail side x is out on at z (0: on the road, or no trail here). */
  trailAt(x: number, z: number): 0 | Side {
    const c = this.cutAt(z);
    return c && x * c.side > C.CUT.split ? c.side : 0;
  }

  /** Is the barrier between these two (one on a trail where it is closed, the other on the road)? */
  apart(ax: number, az: number, bx: number, _bz: number): boolean {
    const c = this.cutAt(az);
    if (!c || az < c.z0 + C.CUT.gap || az > c.z1 - C.CUT.merge) return false;
    return ax * c.side > C.CUT.split !== bx * c.side > C.CUT.split;
  }

  /** Did a rider at x, going from pz to z, run into the end post of a trail's opening? */
  postHit(x: number, pz: number, z: number): boolean {
    for (const c of this.cuts) {
      const g = c.z0 + C.CUT.gap;
      if (pz >= g || z < g) continue;
      const xs = x * c.side;
      return xs > C.EDGE + 0.2 && xs < C.CUT.inner - 0.2;
    }
    return false;
  }

  /** The ramp a rider at x rode onto going from pz to z, if any. */
  rampHit(x: number, pz: number, z: number): Ramp | null {
    for (const r of this.ramps) if (pz < r.z && z >= r.z && Math.abs(x - r.x) < r.halfW) return r;
    return null;
  }

  /** Nearest z in [z, z + ahead] where a car can't drive in `lane` (Infinity: none). */
  blockAhead(lane: number, z: number, ahead: number): number {
    let best = Infinity;
    for (const [a, b] of this.blocks[lane]) if (b >= z && a <= z + ahead) best = Math.min(best, Math.max(a, z));
    return best;
  }

  /** Metres from z until something `halfW` wide riding along x meets the cones (Infinity: it never does). */
  conesAhead(x: number, halfW: number, z: number): number {
    const W = C.WORKS;
    const right = x + halfW;
    if (right <= W.edge || x > C.EDGE + 0.5) return Infinity;
    for (const w of this.works) {
      if (w.z1 < z) continue;
      const k = Math.min(1, Math.max(0, (C.EDGE - right) / (C.EDGE - W.edge)));
      return Math.max(0, w.z0 - W.taper + k * W.taper - z);
    }
    return Infinity;
  }
}
