// Road traffic: cars spawning ahead, keeping their lane (or merging round a closure) and running riders down.

import * as C from './config';
import { clamp } from './types';
import type { World } from './world';
import { crash } from './combat';

const CAR_COLORS = [0xd8d8d8, 0x3f6fb5, 0xb53f3f, 0x2e8b57, 0xe0c040, 0x444a55, 0xf08a30, 0x8a5cc0];

export function spawnCar(w: World, z: number): void {
  const lane = w.traffic.int(4);
  const x = C.LANE_X[lane];
  for (const c of w.cars) if (c.lane === lane && Math.abs(c.z - z) < C.TRAFFIC.gap) return;
  // not in a coned-off lane or on a ramp
  if (w.road.blockAhead(lane, z - C.CAR.halfL - 3, 2 * C.CAR.halfL + 6) < Infinity) return;
  // nor on top of (or right on the tail of) the security buggy
  const pt = w.patrol;
  if (pt.active && Math.abs(pt.x - x) < C.CAR.halfW + C.PATROL.halfW + 0.5 && Math.abs(pt.z - z) < C.TRAFFIC.gap) return;
  const oncoming = lane === C.ONCOMING_LANE;
  const speed = oncoming ? C.CAR.oncoming : C.CAR.minSpeed + w.traffic.float() * (C.CAR.maxSpeed - C.CAR.minSpeed);
  w.cars.push({ id: w.nextId++, x, z, pz: z, speed, cruise: speed, lane, color: w.traffic.pick(CAR_COLORS), brushed: false });
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
      c.x += clamp(C.LANE_X[c.lane] - c.x, -3 * C.DT, 3 * C.DT);
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
      if (Math.abs(r.x - c.x) < C.CAR.halfW + C.CAR.riderHalfW && Math.abs(r.z - c.z) < C.CAR.halfL + 0.4) {
        const side = r.x >= c.x ? 1 : -1;
        r.speed = Math.max(0, Math.min(r.speed, Math.abs(r.speed - c.speed) * 0.6 + 4));
        crash(w, r, 'car', side * 4);
        break;
      }
    }
  }
}
