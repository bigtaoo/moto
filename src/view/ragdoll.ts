// View-only ragdoll for a dummy thrown off its scooter: 12 Verlet points in sim space (x across, y up,
// z along) with elbows and knees, drawn with the same chunky parts as the riding dummy. Once the sim
// has the rider up, the same points are posed instead: a slow climb to its feet from wherever the body
// came to rest (on all fours, on one knee, standing up with a wobble), one of eight gags while the sim
// keeps it standing (DOWN.stand; the poses are in getup.ts), then a panicky cartoon scurry back to the
// scooter, legs going far faster than the body moves, arms flailing over the head, head wobbling, and
// stars circling it from the moment it lands. This never feeds back into the sim.

import * as THREE from 'three';
import { ROAD_HALF } from '../sim/config';
import { toWorld } from './track';
import { Kit, cached, rigidParts, rigidMesh } from './toon';
import { JOINT, TARGET, INK_W, rbox, ball, rod, headKit } from './rider';

import { HEAD, SH_L, SH_R, PELVIS, EL_L, HAND_L, EL_R, HAND_R, KNEE_L, FOOT_L, KNEE_R, FOOT_R, L, GagState, nextGag, getUpPose } from './getup';
// Rest pose, roughly as it stands on the scooter. Sim -x is the dummy's left.
const REST: [number, number, number][] = [
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
// limb meshes: from point, to point, part (0 upper arm, 1 forearm, 2 thigh, 3 shin), hip offset (thighs start at the hip)
const LIMBS: [number, number, number, number][] = [
  [SH_L, EL_L, 0, 0], [EL_L, HAND_L, 1, 0], [SH_R, EL_R, 0, 0], [EL_R, HAND_R, 1, 0],
  [PELVIS, KNEE_L, 2, 0.11], [KNEE_L, FOOT_L, 3, 0], [PELVIS, KNEE_R, 2, -0.11], [KNEE_R, FOOT_R, 3, 0],
];
const GRAVITY = -20;
const STEP = 1 / 60;

const dist = (i: number, j: number) => Math.hypot(REST[i][0] - REST[j][0], REST[i][1] - REST[j][1], REST[i][2] - REST[j][2]);
const LEN = [dist(SH_L, EL_L), dist(EL_L, HAND_L), dist(PELVIS, KNEE_L), dist(KNEE_L, FOOT_L)];

const a = new THREE.Vector3();
const dir = new THREE.Vector3();
const bx = new THREE.Vector3();
const by = new THREE.Vector3();
const bz = new THREE.Vector3();
const tx = new THREE.Vector3();
const m4 = new THREE.Matrix4();
const spinV = new THREE.Vector3();
const vel = new THREE.Vector3();
const w = REST.map(() => new THREE.Vector3());

/** Parts along +y from 0 to the limb's length. */
const along = (g: THREE.BufferGeometry, len: number) => g.rotateX(-Math.PI / 2).translate(0, len / 2, 0);

/** The body from the hips to the neck, in the pelvis frame: y towards the shoulders, x to the dummy's left, z forward. */
function torsoKit(body: number, ride: number, mark: number): Kit {
  return new Kit(INK_W)
    .add(rbox(0.4, 0.22, 0.27), ride, { at: [0, 0, 0] })
    .add(rbox(0.46, 0.54, 0.29, 0.09), body, { at: [0, 0.33, 0] })
    .add(rbox(0.48, 0.06, 0.31, 0.02), JOINT, { at: [0, 0.12, 0], ink: false })
    .add(new THREE.CylinderGeometry(0.055, 0.065, 0.14, 8), JOINT, { at: [0, 0.64, 0], ink: false })
    .decal(0.085, mark, { at: [0, 0.4, 0.151] })
    .decal(0.085, mark, { at: [0, 0.4, -0.151], rot: [0, Math.PI, 0] });
}

/** A chunky five-pointed star (puffed out to a point front and back), for the ones circling a dazed head. */
function starGeo(): THREE.BufferGeometry {
  const at = (i: number) => { const r = i % 2 ? 0.045 : 0.11, t = (i / 10) * Math.PI * 2; return [Math.sin(t) * r, Math.cos(t) * r, 0]; };
  const pts: number[] = [];
  for (let i = 0; i < 10; i++) pts.push(0, 0, 0.035, ...at(i + 1), ...at(i), 0, 0, -0.035, ...at(i), ...at(i + 1));
  const g = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  g.computeVertexNormals();
  return new Kit(INK_W * 0.6).add(g, 0xffd23a).build();
}
const STARS = 3;


/** Upper arm, forearm, thigh, shin (LIMBS' part numbers). */
const LIMB_KITS: ((body: number) => Kit)[] = [
  (body) => new Kit(INK_W).add(ball(0.075), JOINT, { ink: false }).add(along(rod(0.06, LEN[0]), LEN[0]), body),
  (body) => new Kit(INK_W).add(ball(0.062), JOINT, { ink: false }).add(along(rod(0.055, LEN[1]), LEN[1]), body)
    .add(ball(0.078), JOINT, { at: [0, LEN[1], 0] }),
  (body) => new Kit(INK_W).add(along(rod(0.08, LEN[2]), LEN[2]), body),
  (body) => new Kit(INK_W).add(ball(0.072), JOINT, { ink: false }).add(along(rod(0.07, LEN[3]), LEN[3]), body)
    .add(rbox(0.15, 0.1, 0.28, 0.04), JOINT, { at: [0, LEN[3], 0.06] }),
];

/** Bones, one per rigid part: the torso, the head, the limbs (LIMBS' order), the stars. */
const TORSO = 0, HEADB = 1, LIMB0 = 2, STAR0 = LIMB0 + LIMBS.length, BONES = STAR0 + STARS;

/** The whole body as one skinned geometry (see rigidParts), bone order as above. */
function bodyGeo(body: number, ride: number, mark: number): THREE.BufferGeometry {
  const limb = LIMB_KITS.map((kit) => kit(body).build());
  const star = starGeo();
  return rigidParts([torsoKit(body, ride, mark).build(), headKit(body, mark).build(),
    ...LIMBS.map(([, , part]) => limb[part]), ...Array.from({ length: STARS }, () => star)]);
}

export class Ragdoll {
  readonly group = new THREE.Group();
  private readonly p = REST.map(() => new THREE.Vector3());
  private readonly q = REST.map(() => new THREE.Vector3());
  private readonly len = STICKS.map(([i, j]) => dist(i, j));
  private readonly mesh: THREE.SkinnedMesh;
  private readonly bones = Array.from({ length: BONES }, () => new THREE.Bone());
  private readonly torso = this.bones[TORSO];
  private readonly head = this.bones[HEADB];
  private readonly limbs = this.bones.slice(LIMB0, STAR0);
  private readonly stars = this.bones.slice(STAR0);
  /** Head roll (radians) on top of the torso's turn: the wobble while running. */
  private roll = 0;
  private acc = 0;
  private bumpT = 0;
  /** Tumbling (the physics), getting up (posed, standing still) or running back (posed). */
  private mode: 'tumble' | 'up' | 'run' = 'tumble';
  /** Running: blend from the pose it was in (0) to the run cycle (1), how long that takes, stride phase. */
  private upT = 0;
  private blendT = 0.35;
  /** Getting up: which way it faces (towards the scooter, up the road), the gag (also the last one done). */
  private fx = 0;
  private fz = 1;
  private gag: GagState = { gag: -1, puffs: 0 };
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
    // One draw call for the whole body instead of 13 (two thrown dummies were a quarter of the phone
    // budget); built once per colours and kept across races (see `cached` in toon.ts).
    this.mesh = rigidMesh(cached(`rag:${body}:${ride}:${mark}`, () => bodyGeo(body, ride, mark)), mat, this.bones, new THREE.Sphere(new THREE.Vector3(), 2.4));
    this.group.add(this.mesh, ...this.bones);
    this.group.visible = false;
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
    const v = vel;
    for (let i = 0; i < REST.length; i++) {
      const [rx, ry, rz] = REST[i];
      this.p[i].set(x + rx, ry, z + rz);
      a.set(rx, ry - 1.3, rz);
      v.set(vx * (0.9 + 0.3 * power), lift, fwd).add(dir.copy(spin).cross(a));
      this.q[i].copy(this.p[i]).addScaledVector(v, -STEP);
    }
    this.active = true;
    this.mode = 'tumble';
    this.roll = 0;
    this.age = 0;
    this.acc = 0;
    this.bumpT = 0.15;
    this.group.visible = true;
  }

  /** Let go from sim (x, y, z) at velocity (vx, vy, vz), tumbling head over heels: the launch mode's dummy. */
  fling(x: number, y: number, z: number, vx: number, vy: number, vz: number, rnd: () => number): void {
    const spin = spinV.set(4 + rnd() * 3, (rnd() - 0.5) * 3, (rnd() - 0.5) * 3);
    for (let i = 0; i < REST.length; i++) {
      const [rx, ry, rz] = REST[i];
      this.p[i].set(x + rx, y + ry, z + rz);
      a.set(rx, ry - 1.1, rz);
      vel.set(vx, vy, vz).add(dir.copy(spin).cross(a));
      this.q[i].copy(this.p[i]).addScaledVector(vel, -STEP);
    }
    this.active = true;
    this.mode = 'tumble';
    this.roll = 0;
    this.age = 0;
    this.acc = 0;
    this.bumpT = 0.15;
    this.group.visible = true;
  }

  /**
   * Moves the whole body a share `k` of the way from its pelvis to sim (x, y, z), velocity untouched, so the
   * tumble stays on the path the sim flies; `y` null leaves the height to the physics (rolling on the ground).
   */
  pull(x: number, y: number | null, z: number, k: number): void {
    if (!this.active || this.mode !== 'tumble') return;
    const c = this.p[PELVIS];
    const dx = (x - c.x) * k;
    const dy = y === null ? 0 : (y - c.y) * k;
    const dz = (z - c.z) * k;
    for (let i = 0; i < this.p.length; i++) {
      this.p[i].x += dx;
      this.p[i].y += dy;
      this.p[i].z += dz;
      this.q[i].x += dx;
      this.q[i].y += dy;
      this.q[i].z += dz;
    }
  }

  /** A hat on the head, and a head `scale` times the size (the big-heads week). */
  dress(hat: THREE.Object3D | null, scale = 1): void {
    this.head.scale.setScalar(scale);
    this.mesh.boundingSphere!.radius = 2.4 + scale - 1;
    if (!hat) return;
    hat.position.y = 0.17;
    this.head.add(hat);
  }

  /** The player leaning the tumbling body sideways (sim metres): the whole body moves with it. */
  nudge(dx: number): void {
    if (!this.active || this.mode !== 'tumble' || dx === 0) return;
    for (let i = 0; i < this.p.length; i++) {
      this.p[i].x += dx;
      this.q[i].x += dx;
    }
  }

  hide(): void {
    this.active = false;
    this.group.visible = false;
  }

  /** Pelvis in sim space, for the camera. */
  centre(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.p[PELVIS]);
  }

  update(dt: number): void {
    if (!this.active || this.mode !== 'tumble') return;
    this.age += dt;
    this.bumpT -= dt;
    this.acc += Math.min(dt, 0.1);
    while (this.acc >= STEP) {
      this.acc -= STEP;
      this.simulate();
    }
    this.draw();
  }

  /**
   * Up and running back to the scooter at (tx, tz). The run starts wherever the body came to rest and
   * keeps pace with the sim's runner at (x, z), so they reach the scooter on the same tick; the run
   * cycle replaces the physics, blended in over a moment so it looks like getting up.
   */
  run(x: number, z: number, tx: number, tz: number, pace: number, reach: number, dt: number): void {
    if (!this.active) return;
    const { p } = this;
    const simD = Math.hypot(tx - x, tz - z);
    if (this.mode !== 'run') {
      // from standing after the gag a quick blend; straight off the road (no get-up seen) a slower one
      this.blendT = this.mode === 'up' ? 0.2 : 0.35;
      this.mode = 'run';
      this.upT = 0;
      this.stride = 0;
      for (let i = 0; i < p.length; i++) this.from[i].copy(p[i]);
      this.sx = p[PELVIS].x;
      this.sz = p[PELVIS].z;
      this.simD0 = Math.max(simD, reach + 0.01);
    }
    this.age += dt;
    this.upT = Math.min(1, this.upT + dt / this.blendT);
    const prog = Math.min(1, Math.max(0, (this.simD0 - simD) / (this.simD0 - reach)));
    const ox = this.sx + (tx - this.sx) * prog;
    const oz = this.sz + (tz - this.sz) * prog;
    const viewD0 = Math.hypot(tx - this.sx, tz - this.sz);
    const speed = pace * (viewD0 / (this.simD0 - reach));
    // little legs going flat out, whatever the pace
    this.stride += dt * (13 + Math.min(10, speed) * 0.5);
    let fx = tx - ox;
    let fz = tz - oz;
    const n = Math.hypot(fx, fz);
    if (n > 0.2) { fx /= n; fz /= n; } else { fx = 0; fz = 1; }
    const k = this.upT * this.upT * (3 - 2 * this.upT);
    const ph = this.stride;
    const sw = Math.sin(ph);
    const bob = Math.abs(sw) * 0.1;
    const lean = 0.18 + 0.14 * Math.sin(ph * 0.37);
    this.roll = 0.3 * Math.sin(ph * 0.5) * k;
    for (let i = 0; i < REST.length; i++) {
      let [lx, ly, lz] = REST[i];
      ly -= 0.15; // feet on the road, not the deck
      const leg = i === KNEE_L || i === FOOT_L ? 0 : i === KNEE_R || i === FOOT_R ? Math.PI : -1;
      const side = i === EL_L || i === HAND_L ? -1 : i === EL_R || i === HAND_R ? 1 : 0;
      if (leg >= 0) {
        // high knees, short steps
        const s = Math.sin(ph + leg);
        if (i === KNEE_L || i === KNEE_R) { lz += 0.08 + s * 0.2; ly += Math.max(0, s) * 0.26; }
        else { lz += Math.sin(ph + leg - 0.7) * 0.26; ly += Math.max(0, -Math.cos(ph + leg)) * 0.3; }
      } else if (side) {
        // both arms up, windmilling out of step with each other
        const t = ph * 0.8 + (side > 0 ? 0 : 2.2);
        const sx = side * 0.27;
        const ux = side * 0.55, uy = 0.72 + 0.2 * Math.sin(t), uz = 0.4 * Math.cos(t);
        const un = Math.hypot(ux, uy, uz);
        const ex = sx + (ux / un) * LEN[0], ey = 1.49 + (uy / un) * LEN[0], ez = 0.05 + (uz / un) * LEN[0];
        const vx = side * (0.25 + 0.35 * Math.sin(t * 1.7)), vy = 0.85, vz = 0.5 * Math.sin(t + 1.3);
        const vn = Math.hypot(vx, vy, vz);
        if (i === EL_L || i === EL_R) [lx, ly, lz] = [ex, ey, ez];
        else [lx, ly, lz] = [ex + (vx / vn) * LEN[1], ey + (vy / vn) * LEN[1], ez + (vz / vn) * LEN[1]];
      }
      // the body rocks from side to side with each step
      if (i <= PELVIS) { lx += sw * (i === PELVIS ? 0.04 : 0.09); if (i === SH_L || i === SH_R) ly += sw * 0.05 * (i === SH_L ? 1 : -1); }
      ly += bob;
      lz += Math.max(0, ly - 1) * lean; // lean into it
      const wx = ox + fz * lx + fx * lz;
      const wz = oz - fx * lx + fz * lz;
      p[i].lerpVectors(this.from[i], a.set(wx, ly, wz), k);
      this.q[i].copy(p[i]);
    }
    this.draw();
  }

  /**
   * Getting up, `t` seconds into the sim's DOWN.stand (the rider stays where it lay): a slow climb to its
   * feet facing the scooter at (tx, tz), then a gag picked at random (never the same one twice running).
   */
  getUp(t: number, tx: number, tz: number, dt: number): void {
    if (!this.active) return;
    const { p } = this;
    if (this.mode !== 'up') {
      this.mode = 'up';
      for (let i = 0; i < p.length; i++) this.from[i].copy(p[i]);
      this.sx = p[PELVIS].x;
      this.sz = p[PELVIS].z;
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
    for (let i = 0; i < p.length; i++) {
      const lx = L[i].x * c + L[i].z * sn;
      const lz = L[i].z * c - L[i].x * sn;
      a.set(this.sx + this.fz * lx + this.fx * lz, L[i].y, this.sz - this.fx * lx + this.fz * lz);
      p[i].lerpVectors(this.from[i], a, k);
      this.q[i].copy(p[i]);
    }
    this.draw();
  }

  private simulate(): void {
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
      const wall = ROAD_HALF + 1.4;
      if (Math.abs(pt.x) > wall) {
        pt.x = Math.sign(pt.x) * wall;
        q[i].x = pt.x + (pt.x - q[i].x) * 0.4;
      }
    }
    if (slam > 4 && this.bumpT <= 0) {
      this.bumpT = 0.18;
      this.onImpact?.(p[PELVIS].x, p[PELVIS].z, slam);
    }
  }

  private draw(): void {
    for (let i = 0; i < REST.length; i++) toWorld(this.p[i].x, this.p[i].y, this.p[i].z, w[i]);
    // Torso frame: x from the right shoulder to the left, y from the pelvis up to between the shoulders.
    by.copy(w[SH_L]).add(w[SH_R]).multiplyScalar(0.5).sub(w[PELVIS]).normalize();
    bx.copy(w[SH_L]).sub(w[SH_R]);
    bx.addScaledVector(by, -bx.dot(by)).normalize();
    bz.crossVectors(bx, by);
    m4.makeBasis(bx, by, bz);
    this.torso.position.copy(w[PELVIS]);
    this.torso.quaternion.setFromRotationMatrix(m4);
    this.head.position.copy(w[HEAD]);
    this.mesh.boundingSphere!.center.copy(w[PELVIS]);
    this.head.quaternion.copy(this.torso.quaternion);
    if (this.roll) this.head.rotateZ(this.roll);
    // dazed: stars round the head once the body has hit the road
    const dazed = this.age > 0.5;
    for (let k = 0; k < STARS; k++) {
      const st = this.stars[k];
      st.scale.setScalar(dazed ? 1 : 0);
      if (!dazed) continue;
      const t = this.age * 5 + (k / STARS) * Math.PI * 2;
      const h = this.p[HEAD];
      toWorld(h.x + Math.cos(t) * 0.3, h.y + 0.32 + Math.sin(t * 2) * 0.03, h.z + Math.sin(t) * 0.3, st.position);
      st.rotation.set(0, t * 1.5, 0);
    }
    const fwd = a.copy(bz);
    tx.copy(bx);
    for (let k = 0; k < LIMBS.length; k++) {
      const [i, j, , hip] = LIMBS[k];
      const m = this.limbs[k];
      m.position.copy(w[i]).addScaledVector(tx, hip);
      by.copy(w[j]).sub(m.position).normalize();
      // keep feet and hands facing the way the body faces
      bz.copy(fwd).addScaledVector(by, -fwd.dot(by));
      if (bz.lengthSq() < 1e-6) bz.set(0, 0, 1);
      bz.normalize();
      bx.crossVectors(by, bz);
      m4.makeBasis(bx, by, bz);
      m.quaternion.setFromRotationMatrix(m4);
    }
  }
}
