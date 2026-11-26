// View-only ragdoll for a dummy thrown off its scooter: what it does, and when. The body itself is two
// independent pieces -- dollBody.ts moves 12 Verlet points, dollRig.ts draws them as one skinned mesh --
// and this holds the state machine between them: a tumble under physics until the sim has the rider up,
// then the same points posed instead, a slow climb to its feet from wherever the body came to rest (on
// all fours, on one knee, standing up with a wobble), one of eight gags while the sim keeps it standing
// (DOWN.stand; the poses are in getup.ts), then a panicky cartoon scurry back to the scooter, legs going
// far faster than the body moves, arms flailing over the head, head wobbling, and stars circling it from
// the moment it lands. This never feeds back into the sim.

import * as THREE from 'three';
import { DollBody, REST } from './dollBody';
import { DollRig } from './dollRig';
import { TARGET } from './rider';
import { SH_L, SH_R, PELVIS, EL_L, HAND_L, EL_R, HAND_R, KNEE_L, FOOT_L, KNEE_R, FOOT_R, L, GagState, nextGag, getUpPose } from './getup';
import { RunState, nextRun, gaitOf, runArm } from './runback';

const a = new THREE.Vector3();
const spinV = new THREE.Vector3();

export class Ragdoll {
  private readonly body = new DollBody();
  private readonly rig: DollRig;
  readonly group: THREE.Group;
  /** Head roll (radians) on top of the torso's turn: the wobble while running. */
  private roll = 0;
  /** Tumbling (the physics), getting up (posed, standing still) or running back (posed). */
  private mode: 'tumble' | 'up' | 'run' = 'tumble';
  /** Running: blend from the pose it was in (0) to the run cycle (1), how long that takes, stride phase. */
  private upT = 0;
  private blendT = 0.35;
  /** Getting up: which way it faces (towards the scooter, up the road), the gag (also the last one done). */
  private fx = 0;
  private fz = 1;
  private gag: GagState = { gag: -1, puffs: 0 };
  /** Which run back to the scooter this fall gets (runback.ts), picked when the run starts. */
  private run_: RunState = { run: -1 };
  private readonly puff = (n: number) => this.onImpact?.(this.sx, this.sz, n);
  private stride = 0;
  private readonly from = REST.map(() => new THREE.Vector3());
  /** Where the body came to rest (it rarely matches the sim's body), and the sim's distance left then. */
  private sx = 0;
  private sz = 0;
  private simD0 = 0;
  active = false;
  /** Seconds since the throw. */
  age = 0;
  /** Called when the body slams into the road (sim x, z, impact speed in m/s). */
  onImpact: ((x: number, z: number, v: number) => void) | null = null;

  /** `mat` is the rider's own vertex-coloured toon material, so a hit flash shows here too. */
  constructor(body: number, ride: number, mat: THREE.Material, mark = TARGET) {
    this.rig = new DollRig(body, ride, mat, mark);
    this.group = this.rig.group;
    this.body.onImpact = (x, z, v) => this.onImpact?.(x, z, v);
  }

  /**
   * Throw from sim position (x, z) at forward speed, sideways velocity vx. `power` scales the launch:
   * 1 for a knock-out, more for being hit by a car.
   */
  throw(x: number, z: number, speed: number, vx: number, rnd: () => number, power = 1): void {
    const fwd = Math.max(6, speed * 0.85);
    const lift = (4.5 + Math.min(4, speed * 0.14)) * power + rnd() * 1.5;
    const side = vx === 0 ? (rnd() < 0.5 ? 1 : -1) : Math.sign(vx);
    // Spin about the body's middle: head over heels, and a roll the way it was knocked.
    const spin = spinV.set((3 + rnd() * 3) * power, (rnd() - 0.5) * 4, -side * (1.5 + rnd() * 2) * power);
    this.body.launch(x, 0, z, vx * (0.9 + 0.3 * power), lift, fwd, spin, 1.3);
    this.thrown();
  }

  /** Let go from sim (x, y, z) at velocity (vx, vy, vz), tumbling head over heels: the launch mode's dummy. */
  fling(x: number, y: number, z: number, vx: number, vy: number, vz: number, rnd: () => number): void {
    const spin = spinV.set(4 + rnd() * 3, (rnd() - 0.5) * 3, (rnd() - 0.5) * 3);
    this.body.launch(x, y, z, vx, vy, vz, spin, 1.1);
    this.thrown();
  }

  private thrown(): void {
    this.active = true;
    this.mode = 'tumble';
    this.roll = 0;
    this.age = 0;
    this.rig.show(true);
  }

  /**
   * Moves the whole body a share `k` of the way from its pelvis to sim (x, y, z), velocity untouched, so the
   * tumble stays on the path the sim flies; `y` null leaves the height to the physics (rolling on the ground).
   */
  pull(x: number, y: number | null, z: number, k: number): void {
    if (!this.active || this.mode !== 'tumble') return;
    const c = this.body.pelvis;
    this.body.shift((x - c.x) * k, y === null ? 0 : (y - c.y) * k, (z - c.z) * k);
  }

  /** A hat on the head, and a head `scale` times the size (the big-heads week). */
  dress(hat: THREE.Object3D | null, scale = 1): void {
    this.rig.dress(hat, scale);
  }

  /** The player leaning the tumbling body sideways (sim metres): the whole body moves with it. */
  nudge(dx: number): void {
    if (!this.active || this.mode !== 'tumble' || dx === 0) return;
    this.body.shift(dx, 0, 0);
  }

  /**
   * The sim's own bounds for the road the body is over, handed in by the view as the body moves (the
   * launch mode's open field keeps the default). Only the tumble is held to them; the limbs still spill.
   */
  band(lo: number, hi: number): void {
    this.body.band(lo, hi);
  }

  hide(): void {
    this.active = false;
    this.rig.show(false);
  }

  /** Pelvis in sim space, for the camera. */
  centre(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.body.pelvis);
  }

  update(dt: number): void {
    if (!this.active || this.mode !== 'tumble') return;
    this.age += dt;
    this.body.update(dt);
    this.draw();
  }

  /**
   * Up and running back to the scooter at (tx, tz). The run starts wherever the body came to rest and
   * keeps pace with the sim's runner at (x, z), so they reach the scooter on the same tick; the run
   * cycle replaces the physics, blended in over a moment so it looks like getting up.
   */
  run(x: number, z: number, tx: number, tz: number, pace: number, reach: number, dt: number): void {
    if (!this.active) return;
    const simD = Math.hypot(tx - x, tz - z);
    if (this.mode !== 'run') {
      // from standing after the gag a quick blend; straight off the road (no get-up seen) a slower one
      this.blendT = this.mode === 'up' ? 0.2 : 0.35;
      this.mode = 'run';
      this.upT = 0;
      this.stride = 0;
      nextRun(this.run_);
      this.restFrom();
      this.simD0 = Math.max(simD, reach + 0.01);
    }
    this.age += dt;
    this.upT = Math.min(1, this.upT + dt / this.blendT);
    const prog = Math.min(1, Math.max(0, (this.simD0 - simD) / (this.simD0 - reach)));
    const ox = this.sx + (tx - this.sx) * prog;
    const oz = this.sz + (tz - this.sz) * prog;
    const viewD0 = Math.hypot(tx - this.sx, tz - this.sz);
    const speed = pace * (viewD0 / (this.simD0 - reach));
    const gait = gaitOf(this.run_.run);
    // little legs going flat out, whatever the pace
    this.stride += dt * (gait.rate + Math.min(10, speed) * 0.5);
    let fx = tx - ox;
    let fz = tz - oz;
    const n = Math.hypot(fx, fz);
    if (n > 0.2) { fx /= n; fz /= n; } else { fx = 0; fz = 1; }
    const k = this.upT * this.upT * (3 - 2 * this.upT);
    const ph = this.stride;
    const sw = Math.sin(ph);
    // a limp drags the bob down on the sore leg's step
    const bob = Math.abs(sw) * gait.bob - (gait.limp ? Math.max(0, -sw) * gait.limp * 0.06 : 0);
    const lean = gait.lean + 0.14 * Math.sin(ph * 0.37);
    this.roll = gait.roll * Math.sin(ph * 0.5) * k;
    for (let i = 0; i < REST.length; i++) {
      let [lx, ly, lz] = REST[i];
      ly -= 0.15; // feet on the road, not the deck
      const leg = i === KNEE_L || i === FOOT_L ? 0 : i === KNEE_R || i === FOOT_R ? Math.PI : -1;
      const side = i === EL_L || i === HAND_L ? -1 : i === EL_R || i === HAND_R ? 1 : 0;
      if (leg >= 0) {
        // high knees, short steps; a limp keeps the sore (right) leg stiff and its step short
        const sore = gait.limp && leg > 0 ? 1 - gait.limp : 1;
        const s = Math.sin(ph + leg);
        if (i === KNEE_L || i === KNEE_R) { lz += 0.08 + s * 0.2 * sore; ly += Math.max(0, s) * 0.26 * gait.knee * sore; }
        else { lz += Math.sin(ph + leg - 0.7) * 0.26 * sore; ly += Math.max(0, -Math.cos(ph + leg)) * 0.3 * gait.knee * sore; }
      } else if (side) {
        // whichever arms this run uses (runback.ts): windmilling, pumping, clutching its head, trailing...
        const arm = runArm(this.run_.run, side, ph);
        const o = i === EL_L || i === EL_R ? 0 : 3;
        [lx, ly, lz] = [arm[o], arm[o + 1], arm[o + 2]];
      }
      // the body rocks from side to side with each step
      if (i <= PELVIS) { lx += sw * (i === PELVIS ? 0.04 : 0.09); if (i === SH_L || i === SH_R) ly += sw * 0.05 * (i === SH_L ? 1 : -1); }
      ly += bob;
      lz += Math.max(0, ly - 1) * lean; // lean into it
      const wx = ox + fz * lx + fx * lz;
      const wz = oz - fx * lx + fz * lz;
      this.body.place(i, this.from[i], a.set(wx, ly, wz), k);
    }
    this.draw();
  }

  /**
   * Getting up, `t` seconds into the sim's DOWN.stand (the rider stays where it lay): a slow climb to its
   * feet facing the scooter at (tx, tz), then a gag picked at random (never the same one twice running).
   */
  getUp(t: number, tx: number, tz: number, dt: number): void {
    if (!this.active) return;
    if (this.mode !== 'up') {
      this.mode = 'up';
      this.restFrom();
      // the scooter slid on ahead: face up the road, turned a little towards it
      const fx = tx - this.sx;
      const fz = Math.max(2, tz - this.sz);
      const n = Math.hypot(fx, fz);
      this.fx = fx / n;
      this.fz = fz / n;
      nextGag(this.gag);
    }
    this.age += dt;
    const { k, yaw, roll } = getUpPose(t, this.gag, this.puff);
    this.roll = roll;
    const c = Math.cos(yaw);
    const sn = Math.sin(yaw);
    for (let i = 0; i < REST.length; i++) {
      const lx = L[i].x * c + L[i].z * sn;
      const lz = L[i].z * c - L[i].x * sn;
      a.set(this.sx + this.fz * lx + this.fx * lz, L[i].y, this.sz - this.fx * lx + this.fz * lz);
      this.body.place(i, this.from[i], a, k);
    }
    this.draw();
  }

  /** A posed stretch starts from where the body is now, on the road (the physics may have spilled it off). */
  private restFrom(): void {
    for (let i = 0; i < this.from.length; i++) this.from[i].copy(this.body.p[i]);
    this.sx = this.body.onRoad(this.body.pelvis.x);
    this.sz = this.body.pelvis.z;
  }

  private draw(): void {
    this.rig.pose(this.body.p, this.roll, this.age);
  }
}
