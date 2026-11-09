// View-only ragdoll for a dummy thrown off its scooter: 12 Verlet points in sim space (x across, y up,
// z along) with elbows and knees, drawn with the same chunky parts as the riding dummy. The sim only
// knows "down for N ticks"; this never feeds back into it.

import * as THREE from 'three';
import { ROAD_HALF } from '../sim/config';
import { toWorld } from './track';
import { Kit } from './toon';
import { JOINT, TARGET, INK_W, rbox, ball, rod } from './rider';

const HEAD = 0, SH_L = 1, SH_R = 2, PELVIS = 3, EL_L = 4, HAND_L = 5, EL_R = 6, HAND_R = 7, KNEE_L = 8, FOOT_L = 9, KNEE_R = 10, FOOT_R = 11;
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
const w = REST.map(() => new THREE.Vector3());

/** Parts along +y from 0 to the limb's length. */
const along = (g: THREE.BufferGeometry, len: number) => g.rotateX(-Math.PI / 2).translate(0, len / 2, 0);

export class Ragdoll {
  readonly group = new THREE.Group();
  private readonly p = REST.map(() => new THREE.Vector3());
  private readonly q = REST.map(() => new THREE.Vector3());
  private readonly len = STICKS.map(([i, j]) => dist(i, j));
  private readonly torso: THREE.Mesh;
  private readonly head: THREE.Mesh;
  private readonly limbs: THREE.Mesh[];
  private acc = 0;
  private bumpT = 0;
  active = false;
  /** Seconds since the throw. */
  age = 0;
  /** Called when the body slams into the road (sim x, z, impact speed in m/s). */
  onImpact: ((x: number, z: number, v: number) => void) | null = null;

  /** `mat` is the rider's own vertex-coloured toon material, so a hit flash shows here too. */
  constructor(body: number, ride: number, mat: THREE.Material) {
    // In the pelvis frame: y towards the shoulders, x towards the dummy's left, z forward.
    const torso = new Kit(INK_W)
      .add(rbox(0.4, 0.22, 0.27), ride, { at: [0, 0, 0] })
      .add(rbox(0.46, 0.54, 0.29, 0.09), body, { at: [0, 0.33, 0] })
      .add(rbox(0.48, 0.06, 0.31, 0.02), JOINT, { at: [0, 0.12, 0], ink: false })
      .add(new THREE.CylinderGeometry(0.055, 0.065, 0.14, 8), JOINT, { at: [0, 0.64, 0], ink: false })
      .decal(0.085, TARGET, { at: [0, 0.4, 0.151] })
      .decal(0.085, TARGET, { at: [0, 0.4, -0.151], rot: [0, Math.PI, 0] });
    this.torso = new THREE.Mesh(torso.build(), mat);
    const head = new Kit(INK_W).add(ball(0.175, 12), body, { scale: [0.95, 1.06, 1] });
    for (const s of [-1, 1]) head.decal(0.06, TARGET, { at: [s * 0.172, 0.01, 0], rot: [0, (s * Math.PI) / 2, 0] });
    this.head = new THREE.Mesh(head.build(), mat);
    const parts = [
      new Kit(INK_W).add(ball(0.075), JOINT, { ink: false }).add(along(rod(0.06, LEN[0]), LEN[0]), body),
      new Kit(INK_W).add(ball(0.062), JOINT, { ink: false }).add(along(rod(0.055, LEN[1]), LEN[1]), body)
        .add(ball(0.078), JOINT, { at: [0, LEN[1], 0] }),
      new Kit(INK_W).add(along(rod(0.08, LEN[2]), LEN[2]), body),
      new Kit(INK_W).add(ball(0.072), JOINT, { ink: false }).add(along(rod(0.07, LEN[3]), LEN[3]), body)
        .add(rbox(0.15, 0.1, 0.28, 0.04), JOINT, { at: [0, LEN[3], 0.06] }),
    ].map((k) => k.build());
    this.limbs = LIMBS.map(([, , part]) => new THREE.Mesh(parts[part], mat));
    this.group.add(this.torso, this.head, ...this.limbs);
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
    const spin = new THREE.Vector3((3 + rnd() * 3) * power, (rnd() - 0.5) * 4, -side * (1.5 + rnd() * 2) * power);
    const v = new THREE.Vector3();
    for (let i = 0; i < REST.length; i++) {
      const [rx, ry, rz] = REST[i];
      this.p[i].set(x + rx, ry, z + rz);
      a.set(rx, ry - 1.3, rz);
      v.set(vx * (0.9 + 0.3 * power), lift, fwd).add(dir.copy(spin).cross(a));
      this.q[i].copy(this.p[i]).addScaledVector(v, -STEP);
    }
    this.active = true;
    this.age = 0;
    this.acc = 0;
    this.bumpT = 0.15;
    this.group.visible = true;
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
    if (!this.active) return;
    this.age += dt;
    this.bumpT -= dt;
    this.acc += Math.min(dt, 0.1);
    while (this.acc >= STEP) {
      this.acc -= STEP;
      this.simulate();
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
    this.head.quaternion.copy(this.torso.quaternion);
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
