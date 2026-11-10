// Off the scooter: the body tumbles to a stop (the player can lean it to bowl riders over, src/sim/stunts.ts),
// lies there a moment, then gets up (slowly: the view clowns about in that time) and runs back to the scooter, which slid on by itself.

import * as C from './config';
import { clamp, type Rider } from './types';
import type { World } from './world';
import { nabbed } from './chase';
import { bowl } from './stunts';

export function moveDown(w: World, r: Rider): void {
  const D = C.DOWN;
  // the scooter slides on by itself
  r.bikeV = Math.max(0, r.bikeV - D.bike * C.DT);
  r.bikeZ += r.bikeV * C.DT;
  r.bikeVx *= 0.88;
  r.bikeX = w.road.clampX(r.bikeX + r.bikeVx * C.DT, r.bikeZ);
  if (r.runT === 0) {
    // tumbling to a stop, then a moment on the ground
    r.speed = Math.max(0, r.speed - D.body * C.DT);
    r.z += r.speed * C.DT;
    r.vx *= 0.85;
    r.x = w.road.clampX(r.x + r.vx * C.DT, r.z);
    bowl(w, r);
    if (r.downT > 0) r.downT--;
    if (r.downT === 0 && r.speed < 2) {
      if (r.thug || nabbed(w, r)) return recover(w, r); // thugs and caught runners limp off instead
      r.runT = 1;
      r.speed = 0;
    }
    return;
  }
  // getting up: on their feet, not moving yet
  const t = r.runT - standTicks();
  if (t <= 0) {
    r.speed = 0;
    r.runT++;
    return;
  }
  // up and running back to the scooter
  const dx = r.bikeX - r.x;
  const dz = r.bikeZ - r.z;
  if (dx * dx + dz * dz < D.reach * D.reach || t > D.maxRun * C.TICK_HZ) return recover(w, r);
  // along the road at running pace, across at a bit less (no square roots in the sim)
  const s = D.run * Math.min(1, t / (D.runUp * C.TICK_HZ)) * C.DT;
  const sz = clamp(dz, -s, s);
  r.z += sz;
  r.x += clamp(dx, -s * 0.7, s * 0.7);
  r.speed = Math.max(0, sz / C.DT);
  r.runT++;
}

/** Ticks of runT spent getting up before the run starts (runT counts from 1). */
export const standTicks = (): number => Math.round(C.DOWN.stand * C.TICK_HZ);

export function recover(w: World, r: Rider): void {
  if (r.thug || nabbed(w, r)) {
    // Knocked-off thugs limp away instead of rejoining.
    r.state = 'away';
    r.weapon = null;
    w.events.push({ type: 'recover', rider: r.id });
    return;
  }
  // back on the scooter, where it came to rest
  r.x = r.px = r.bikeX;
  r.z = r.pz = r.bikeZ;
  r.runT = 0;
  r.state = 'ride';
  r.hp = r.maxHp;
  r.invT = C.INVULN_TICKS;
  r.speed = Math.max(r.speed, r.top * C.RECOVER_SPEED);
  r.wantX = r.x;
  r.latV = 0;
  w.events.push({ type: 'recover', rider: r.id });
}
