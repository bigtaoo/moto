// Road traffic: cars spawning ahead, keeping their lane - give or take the sway that keeps the painted
// lines from being safe - or merging round a closure, and running riders down.

import * as C from './config';
import { clamp, type Car } from './types';
import type { World } from './world';
import { crash } from './combat';

const CAR_COLORS = [0xd8d8d8, 0x3f6fb5, 0xb53f3f, 0x2e8b57, 0xe0c040, 0x444a55, 0xf08a30, 0x8a5cc0];

/**
 * Would a car in `lane` at `z` close the last way through? A rider needs one lane going their way still
 * open abreast of it: not this one, not one coned off or ramped, and with no car already across it. The
 * oncoming lane doesn't count as a way through - riding up it is the gamble, not the gap.
 */
function wallsRoad(w: World, lane: number, z: number): boolean {
  const W = C.TRAFFIC.wall;
  for (let l = 0; l < 4; l++) {
    if (l === lane || l === C.ONCOMING_LANE) continue;
    if (w.road.blockAhead(l, z - W, 2 * W) < Infinity) continue;
    if (w.cars.some((c) => c.lane === l && Math.abs(c.z - z) < W)) continue;
    return false;
  }
  return true;
}

export function spawnCar(w: World, z: number): void {
  const lane = w.traffic.int(4);
  const x = C.LANE_X[lane];
  for (const c of w.cars) if (c.lane === lane && Math.abs(c.z - z) < C.TRAFFIC.gap) return;
  // not in a coned-off lane or on a ramp
  if (w.road.blockAhead(lane, z - C.CAR.halfL - 3, 2 * C.CAR.halfL + 6) < Infinity) return;
  // never park a wall across the road: there is always a lane to take instead of a car to hit
  if (lane !== C.ONCOMING_LANE && wallsRoad(w, lane, z)) return;
  // nor on top of (or right on the tail of) the security buggy
  const pt = w.patrol;
  if (pt.active && Math.abs(pt.x - x) < C.CAR.halfW + C.PATROL.halfW + 0.5 && Math.abs(pt.z - z) < C.TRAFFIC.gap) return;
  const oncoming = lane === C.ONCOMING_LANE;
  const speed = oncoming ? C.CAR.oncoming : C.CAR.minSpeed + w.traffic.float() * (C.CAR.maxSpeed - C.CAR.minSpeed);
  w.cars.push({ id: w.nextId++, x, z, pz: z, speed, cruise: speed, lane, color: w.traffic.pick(CAR_COLORS), brushed: false });
}

/**
 * How far off its lane's middle a car is driving this tick: one slow wander either way, each car on its own
 * phase, so no two drift together and no line on the road is a lane the traffic can never reach. A folded
 * triangle, not a sine: the sim keeps to + - * / so every machine gets the same race (determinism lint).
 */
function sway(w: World, c: Car): number {
  const t = (w.tick * C.DT) / C.TRAFFIC.swayS + c.id * 0.37;
  const tri = 4 * Math.abs(t - Math.floor(t) - 0.5) - 1; // -1 .. 1, with a corner at either end
  return C.TRAFFIC.sway * tri * (2 - Math.abs(tri)); // ...rounded off, so the car turns rather than jerks
}

export function updateTraffic(w: World): void {
  const p = w.player;
  const progress = clamp(p.z / w.length, 0, 1);
  const want = w.trafficBase + Math.round(progress * w.trafficExtra);
  const [R, pt] = [w.road, w.patrol];
  for (const c of w.cars) {
    if (c.speed > 0 || c.cruise > 0) {
      let cap = c.cruise;
      // the lane closes ahead (cones, a ramp): merge over when there's room (cars and buggy), else stop short of it
      const block = R.blockAhead(c.lane, c.z, C.WORKS.carMerge);
      if (block < Infinity) {
        const opts = c.lane === 3 ? [2] : c.lane === 2 ? [1, 3] : [2];
        const to = opts.find((l) => R.blockAhead(l, c.z - 10, C.WORKS.carMerge + 20) === Infinity &&
          w.cars.every((o) => o === c || o.lane !== l || Math.abs(o.z - c.z) > C.TRAFFIC.gap) &&
          !(pt.active && Math.abs(pt.x - C.LANE_X[l]) < C.CAR.halfW + C.PATROL.halfW + 0.15 && Math.abs(pt.z - c.z) < C.TRAFFIC.gap));
        if (to !== undefined) c.lane = to;
        else cap = Math.min(cap, Math.max(0, (block - 8 - c.z) * 0.8));
      }
      // Same-direction cars brake behind slower cars in their lane instead of driving through them.
      for (const o of w.cars) {
        if (o !== c && o.lane === c.lane && o.z > c.z && o.z - c.z < 9 && o.speed < cap) cap = Math.max(0, o.speed);
      }
      // ...and behind the security buggy when it is in their lane
      if (pt.active && Math.abs(pt.x - c.x) < C.CAR.halfW + C.PATROL.halfW + 0.15 &&
        pt.z > c.z && pt.z - c.z < 10 && pt.speed < cap) cap = pt.speed;
      c.speed = c.speed < cap ? Math.min(cap, c.speed + 3 * C.DT) : cap;
      // the wander gives way to the security buggy: that one has its own way round traffic, and nothing
      // in it expects a car to drift onto it
      const mid = C.LANE_X[c.lane];
      const reach = C.CAR.halfL + C.PATROL.halfL + 4 + Math.abs(c.speed - pt.speed) * 0.6;
      const near = pt.active && Math.abs(pt.z - c.z) < reach;
      c.x += clamp((near ? mid : mid + sway(w, c)) - c.x, -3 * C.DT, 3 * C.DT);
    }
    c.z += c.speed * C.DT;
  }
  for (let i = w.cars.length - 1; i >= 0; i--) {
    const c = w.cars[i];
    if (c.z < p.z - C.TRAFFIC.behind || c.z > p.z + C.TRAFFIC.ahead + 120) w.cars.splice(i, 1);
  }
  if (w.cars.length < want && w.tick % 4 === 0 && p.z < w.length - 60) {
    spawnCar(w, p.z + C.TRAFFIC.spawnFrom + w.traffic.float() * 90);
  }
  for (const r of w.riders) {
    if (r.state !== 'ride' || r.invT > 0 || r.airT > 0) continue;
    for (const c of w.cars) {
      const dx = r.x - c.x;
      if (Math.abs(dx) < C.CAR.halfW + C.CAR.riderHalfW && Math.abs(r.z - c.z) < C.CAR.halfL + 0.4) {
        const side = dx >= 0 ? 1 : -1;
        const close = Math.abs(r.speed - c.speed);
        // the opening races forgive the player a graze along a flank at something like the car's own speed
        if (r.isPlayer && C.inRookie(w.rookie) && Math.abs(dx) >= C.SCRAPE.x && c.speed > 0) {
          r.speed = Math.max(0, Math.min(r.speed, close * 0.6 + C.SCRAPE.keep));
          r.latV = side * C.SCRAPE.push;
          r.x = w.road.clampX(c.x + side * (C.CAR.halfW + C.CAR.riderHalfW + 0.02), r.z);
          r.invT = C.SCRAPE.invT;
          w.events.push({ type: 'scrape', rider: r.id, vx: side * C.SCRAPE.push, speed: r.speed });
          break;
        }
        r.speed = Math.max(0, Math.min(r.speed, close * 0.6 + 4));
        crash(w, r, 'car', side * 4);
        break;
      }
    }
  }
}
