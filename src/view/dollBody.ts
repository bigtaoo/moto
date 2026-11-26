// The thrown dummy's body as physics: 12 Verlet points in sim space (x across, y up, z along) held
// together by sticks, with elbows and knees that bend but do not fold flat. Nothing here is drawn --
// dollRig.ts turns these points into bones -- and nothing here feeds back into the sim.

import * as THREE from 'three';
import { ROAD_HALF } from '../sim/config';
import { HEAD, SH_L, SH_R, PELVIS, EL_L, HAND_L, EL_R, HAND_R, KNEE_L, FOOT_L, KNEE_R, FOOT_R } from './getup';

/** Rest pose, roughly as it stands on the scooter. Sim -x is the dummy's left. */
export const REST: [number, number, number][] = [
  [0, 1.94, 0.12], [-0.27, 1.64, 0.05], [0.27, 1.64, 0.05], [0, 1.1, -0.05],
  [-0.3, 1.45, 0.3], [-0.3, 1.3, 0.6], [0.3, 1.45, 0.3], [0.3, 1.3, 0.6],
  [-0.11, 0.66, 0], [-0.11, 0.25, 0], [0.11, 0.66, 0], [0.11, 0.25, 0],
];
/** Ground contact radius per point. */
const RAD = [0.18, 0.12, 0.12, 0.15, 0.08, 0.08, 0.08, 0.08, 0.08, 0.1, 0.08, 0.1];
// [a, b, stiffness, kind]: 0 holds the rest length, 1 only stops the pair getting closer than `min` x rest
// (elbows and knees can bend but not fold flat; legs and feet don't pass through each other).
const STICKS: [number, number, number, number, number][] = [
  [SH_L, SH_R, 1, 0, 0], [SH_L, PELVIS, 1, 0, 0], [SH_R, PELVIS, 1, 0, 0], [HEAD, SH_L, 1, 0, 0], [HEAD, SH_R, 1, 0, 0], [HEAD, PELVIS, 0.5, 0, 0],
  [SH_L, EL_L, 1, 0, 0], [EL_L, HAND_L, 1, 0, 0], [SH_R, EL_R, 1, 0, 0], [EL_R, HAND_R, 1, 0, 0],
  [PELVIS, KNEE_L, 1, 0, 0], [KNEE_L, FOOT_L, 1, 0, 0], [PELVIS, KNEE_R, 1, 0, 0], [KNEE_R, FOOT_R, 1, 0, 0],
  [SH_L, HAND_L, 0.6, 1, 0.55], [SH_R, HAND_R, 0.6, 1, 0.55], [PELVIS, FOOT_L, 0.6, 1, 0.6], [PELVIS, FOOT_R, 0.6, 1, 0.6],
  [KNEE_L, KNEE_R, 0.5, 1, 0.9], [FOOT_L, FOOT_R, 0.5, 1, 0.9], [HAND_L, PELVIS, 0.3, 1, 0.7], [HAND_R, PELVIS, 0.3, 1, 0.7],
];
const GRAVITY = -20;
const STEP = 1 / 60;
/**
 * How far past the road's own edge a limb may flop: out onto the shoulder, never as far as the barrier.
 * The sprawl is the joke, so the body is let over the paint -- but it climbs to its feet and runs back
 * from wherever it lands, and a dummy getting up out on the verge read as the player having been thrown
 * clean off the track, which the sim itself never does (it clamps every downed rider to the road).
 */
const SPILL = 0.8;

/** Distance between two rest-pose points, in metres. */
export const restDist = (i: number, j: number) =>
  Math.hypot(REST[i][0] - REST[j][0], REST[i][1] - REST[j][1], REST[i][2] - REST[j][2]);

const a = new THREE.Vector3();
const dir = new THREE.Vector3();
const vel = new THREE.Vector3();

export class DollBody {
  /** The points, in sim space. Read them to draw or to aim; write them through `place`. */
  readonly p = REST.map(() => new THREE.Vector3());
  private readonly q = REST.map(() => new THREE.Vector3());
  private readonly len = STICKS.map(([i, j]) => restDist(i, j));
  /** Where the body may be, in sim x: the road under it widened by SPILL (see `band`). */
  private lo = -(ROAD_HALF + 1.4);
  private hi = ROAD_HALF + 1.4;
  private acc = 0;
  /** Seconds before another slam may be reported, so one landing is one puff. */
  private bumpT = 0;
  /** Called when the body slams into the road (sim x, z, impact speed in m/s). */
  onImpact: ((x: number, z: number, v: number) => void) | null = null;

  /** The pelvis, in sim space: where the body is, for the camera and for the get-up. */
  get pelvis(): THREE.Vector3 {
    return this.p[PELVIS];
  }

  /**
   * Put the body in its rest pose about sim (x, y, z) and throw it: every point gets velocity (vx, vy, vz)
   * plus `spin` about a point `pivot` metres up the rest pose, so the whole thing tumbles.
   */
  launch(x: number, y: number, z: number, vx: number, vy: number, vz: number, spin: THREE.Vector3, pivot: number): void {
    for (let i = 0; i < REST.length; i++) {
      const [rx, ry, rz] = REST[i];
      this.p[i].set(x + rx, y + ry, z + rz);
      a.set(rx, ry - pivot, rz);
      vel.set(vx, vy, vz).add(dir.copy(spin).cross(a));
      this.q[i].copy(this.p[i]).addScaledVector(vel, -STEP);
    }
    this.acc = 0;
    this.bumpT = 0.15;
  }

  /** Move every point, velocity untouched: the sim pulling the tumble onto its own path, or a lean. */
  shift(dx: number, dy: number, dz: number): void {
    for (let i = 0; i < this.p.length; i++) {
      this.p[i].x += dx;
      this.p[i].y += dy;
      this.p[i].z += dz;
      this.q[i].x += dx;
      this.q[i].y += dy;
      this.q[i].z += dz;
    }
  }

  /** Point `i` posed a share `k` of the way from `from` to `to`, at rest: a posed frame carries no velocity. */
  place(i: number, from: THREE.Vector3, to: THREE.Vector3, k: number): void {
    this.p[i].lerpVectors(from, to, k);
    this.q[i].copy(this.p[i]);
  }

  /**
   * The sim's own bounds for the road the body is over, handed in by the view as the body moves (the
   * launch mode's open field keeps the default). Only the tumble is held to them; the limbs still spill.
   */
  band(lo: number, hi: number): void {
    this.lo = lo - SPILL;
    this.hi = hi + SPILL;
  }

  /** The get-up and the run back both start from where the body came to rest, so that spot has to be on the road. */
  onRoad(x: number): number {
    return x < this.lo ? this.lo : x > this.hi ? this.hi : x;
  }

  /** `dt` seconds of physics, in fixed STEP ticks (at most 0.1 s of catch-up after a stall). */
  update(dt: number): void {
    this.bumpT -= dt;
    this.acc += Math.min(dt, 0.1);
    while (this.acc >= STEP) {
      this.acc -= STEP;
      this.step();
    }
  }

  private step(): void {
    const { p, q } = this;
    for (let i = 0; i < p.length; i++) {
      const v = a.copy(p[i]).sub(q[i]);
      q[i].copy(p[i]);
      p[i].add(v).y += GRAVITY * STEP * STEP;
    }
    for (let k = 0; k < 5; k++) {
      for (let s = 0; s < STICKS.length; s++) {
        const [i, j, stiff, kind, min] = STICKS[s];
        dir.copy(p[j]).sub(p[i]);
        const d = dir.length() || 1e-4;
        const rest = kind ? this.len[s] * min : this.len[s];
        if (kind && d >= rest) continue;
        const diff = ((d - rest) / d / 2) * stiff;
        p[i].addScaledVector(dir, diff);
        p[j].addScaledVector(dir, -diff);
      }
    }
    let slam = 0;
    for (let i = 0; i < p.length; i++) {
      const pt = p[i];
      const r = RAD[i];
      if (pt.y < r) {
        const vy = pt.y - q[i].y;
        if (i <= PELVIS) slam = Math.max(slam, -vy / STEP);
        pt.y = r;
        q[i].y = r + vy * 0.4; // bounce
        q[i].x += (pt.x - q[i].x) * 0.15; // friction
        q[i].z += (pt.z - q[i].z) * 0.15;
      }
      // The road under the body rather than one pair of fixed walls: a trail is wider than the road and a
      // works zone narrower, and the old wall stood out at the barrier, two metres past anywhere the sim
      // would put a rider -- which is how a fall ended with the dummy getting up off the track.
      if (pt.x < this.lo || pt.x > this.hi) {
        pt.x = pt.x < this.lo ? this.lo : this.hi;
        q[i].x = pt.x + (pt.x - q[i].x) * 0.4;
      }
    }
    if (slam > 4 && this.bumpT <= 0) {
      this.bumpT = 0.18;
      this.onImpact?.(p[PELVIS].x, p[PELVIS].z, slam);
    }
  }
}
