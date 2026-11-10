// Each division's roadside hazard (cows, tumbleweeds, leaves, ice, a burst hydrant) and the oil slicks poured
// from the oil can. Placed from the race's own dice stream, so they don't shift traffic, AI or blows.

import * as C from './config';
import { HAZARD as H, OIL } from './fun';
import type { Hazard, Rider, Side } from './types';
import type { World } from './world';
import { crash } from './combat';

const KIND = { meadow: 'cow', desert: 'weed', autumn: 'leaves', snow: 'ice', dusk: 'hydrant' } as const;
const OUT = C.ROAD_HALF + 2;

/** A triangle wave over `period` ticks, -1..1 (no Math.sin in the sim: it may differ between engines). */
function tri(t: number, period: number): number {
  const u = (((t % period) + period) % period) / period;
  return u < 0.5 ? 4 * u - 1 : 3 - 4 * u;
}

/** Ticks a tumbleweed takes to cross the road and roll back in again. */
const weedPeriod = Math.round(((2 * OUT) / H.weed.speed) * C.TICK_HZ);
/** Ticks a cow takes to amble from one end of its beat to the other and back. */
const cowPeriod = Math.round(((4 * H.cow.roam) / H.cow.speed) * C.TICK_HZ);

export function placeHazards(w: World): void {
  const kind = KIND[w.div.env];
  const k = H[kind];
  const rng = w.funRng;
  for (let i = 0; i < k.count; i++) {
    let z = w.length * (H.from + ((H.to - H.from) * (i + 0.2 + rng.float() * 0.6)) / k.count);
    // clear of the ramps' run-ups and landings
    for (const r of w.road.ramps) if (Math.abs(r.z - z) < 22) z = r.z + 26;
    const side: Side = rng.float() < 0.5 ? -1 : 1;
    const phase = rng.int(1000);
    const h = (o: Partial<Hazard>) => w.hazards.push({ id: w.nextId++, kind, x: 0, px: 0, z, cx: 0, w: 0, side, phase, t: 0, ...o });
    if (kind === 'cow') h({ cx: (rng.float() - 0.5) * 3 });
    else if (kind === 'weed') for (let j = 0; j < H.weed.n; j++) h({ z: z + j * 7, phase: phase + Math.round((j * weedPeriod) / H.weed.n) });
    else if (kind === 'hydrant') h({ x: side * (C.ROAD_HALF + 0.3) });
    else h({ cx: [-3.5, 0, 3.5][rng.int(3)], w: 7 });
  }
  moveHazards(w);
  for (const h of w.hazards) h.px = h.x;
}

function moveHazards(w: World): void {
  for (const h of w.hazards) {
    h.px = h.x;
    if (h.kind === 'cow') {
      const x = h.cx + H.cow.roam * tri(w.tick + h.phase, cowPeriod);
      if (x !== h.x) h.side = x > h.x ? 1 : -1;
      h.x = x;
    } else if (h.kind === 'weed') {
      if (h.t > 0) h.t--;
      const u = ((w.tick + h.phase) % weedPeriod) / weedPeriod;
      h.x = h.side * (-OUT + 2 * OUT * u);
    }
  }
}

/** The slippery patch under (x, z), if any. */
export function patchAt(w: World, x: number, z: number): Hazard | null {
  for (const h of w.hazards) {
    if ((h.kind === 'leaves' || h.kind === 'ice') && z >= h.z && z < h.z + H[h.kind].len && Math.abs(x - h.cx) < h.w / 2) return h;
  }
  return null;
}

/** Spraying this tick? */
export const spraying = (w: World, h: Hazard): boolean => (w.tick + h.phase) % H.hydrant.cycle < H.hydrant.on;

/** Metres along lane x from z to the next cow, for the AI's look ahead (Infinity: none). */
export function cowAhead(w: World, x: number, z: number): number {
  let best = Infinity;
  for (const h of w.hazards) {
    if (h.kind !== 'cow' || Math.abs(h.x - x) > H.cow.halfW + 1.1) continue;
    const d = h.z - z - H.cow.halfL;
    if (d > -H.cow.halfL && d < best) best = Math.max(0, d);
  }
  return best;
}

/** A rival holding the oil can pours it when someone rides close behind it in its line. */
function aiPour(w: World, r: Rider): void {
  for (const o of w.riders) {
    if (o === r || o.state !== 'ride' || o.thug) continue;
    const dz = r.z - o.z;
    if (dz > 3 && dz < 14 && Math.abs(o.x - r.x) < 1.4) {
      w.tryAttack(r);
      return;
    }
  }
}

/** Pour the oil can out behind `r`. */
export function pour(w: World, r: Rider): boolean {
  const z = r.z - OIL.back;
  w.slicks.push({ id: w.nextId++, x: w.road.clampX(r.x, z), z, by: r.id, t: OIL.life });
  r.weapon = null;
  r.atkCd = C.ATTACK.cooldown;
  w.events.push({ type: 'oil', rider: r.id, x: r.x, z });
  return true;
}

/** Each tick, after the pickups: hazards move and catch riders, slicks catch riders. */
export function updateHazards(w: World): void {
  moveHazards(w);
  if (w.tick % 6 === 0) for (const r of w.riders) if (!r.isPlayer && r.weapon === 'oil' && r.state === 'ride' && r.airT === 0) aiPour(w, r);
  for (let i = w.slicks.length - 1; i >= 0; i--) {
    const s = w.slicks[i];
    if (--s.t <= 0) { w.slicks.splice(i, 1); continue; }
    for (const r of w.riders) {
      if (r.state !== 'ride' || r.airT > 0 || r.invT > 0) continue;
      if (Math.abs(r.x - s.x) > OIL.halfW || Math.abs(r.z - s.z) > OIL.halfZ) continue;
      const own = r.id === s.by;
      if (own && OIL.life - s.t < OIL.grace) continue;
      if (!own) { r.hitBy = s.by; r.shoveT = Math.max(r.shoveT, 1); }
      w.slicks.splice(i, 1);
      crash(w, r, 'oil', r.x >= s.x ? OIL.kick : -OIL.kick);
      break;
    }
  }
  for (const h of w.hazards) {
    if (h.kind === 'cow') {
      for (const r of w.riders) {
        if (r.state !== 'ride' || r.airT > 0 || r.invT > 0) continue;
        if (Math.abs(r.x - h.x) < H.cow.halfW + 0.4 && Math.abs(r.z - h.z) < H.cow.halfL + 0.5) crash(w, r, 'cow', r.x >= h.x ? 3 : -3);
      }
    } else if (h.kind === 'weed' && h.t === 0) {
      for (const r of w.riders) {
        if (r.state !== 'ride' || r.airT > 0) continue;
        if (Math.abs(r.x - h.x) > H.weed.r + 0.4 || Math.abs(r.z - h.z) > H.weed.r + 0.5) continue;
        r.vx += h.side * H.weed.push;
        r.latV = 0;
        r.stagT = Math.max(r.stagT, 8);
        r.speed *= 0.93;
        h.t = H.weed.regrow;
        w.events.push({ type: 'weed', hazard: h.id, rider: r.id });
        break;
      }
    } else if (h.kind === 'hydrant' && spraying(w, h)) {
      const Y = H.hydrant;
      for (const r of w.riders) {
        if (r.state !== 'ride' || r.airT > 0 || Math.abs(r.z - h.z) > Y.halfZ) continue;
        if (C.ROAD_HALF - r.x * h.side > Y.reach) continue;
        r.vx -= h.side * Y.push * C.DT;
        r.speed *= Y.slow;
      }
    }
  }
}

/** How well `r` can steer here (1 off a patch), and how much of a sideways shove it keeps each tick. */
export function grip(w: World, r: Rider): { grip: number; carry: number } | null {
  const h = patchAt(w, r.x, r.z);
  return h ? H[h.kind as 'leaves' | 'ice'] : null;
}
