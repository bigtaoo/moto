// View-only ragdoll for a dummy thrown off its scooter: 7 Verlet points in sim space (x across, y up, z along),
// drawn as boxes between them. The sim only knows "down for N ticks"; this never feeds back into it.

import * as THREE from 'three';
import { ROAD_HALF } from '../sim/config';
import { toWorld } from './track';

// head, chest, pelvis, hand L, hand R, foot L, foot R
const REST: [number, number, number][] = [[0, 1.8, 0], [0, 1.45, 0], [0, 1.08, 0], [-0.32, 1.2, 0.4], [0.32, 1.2, 0.4], [-0.1, 0.25, 0], [0.1, 0.25, 0]];
const STICKS: [number, number][] = [[0, 1], [1, 2], [1, 3], [1, 4], [2, 5], [2, 6], [0, 2], [3, 2], [4, 2], [5, 6], [1, 5], [1, 6]];
// limbs drawn as boxes: from point, to point, thickness
const BONES: [number, number, number][] = [[1, 2, 0.34], [1, 3, 0.1], [1, 4, 0.1], [2, 5, 0.14], [2, 6, 0.14]];
const R = 0.12;
const GRAVITY = -20;
const STEP = 1 / 60;

const up = new THREE.Vector3(0, 1, 0);
const a = new THREE.Vector3();
const b = new THREE.Vector3();
const dir = new THREE.Vector3();

export class Ragdoll {
  readonly group = new THREE.Group();
  private readonly p = REST.map(() => new THREE.Vector3());
  private readonly q = REST.map(() => new THREE.Vector3());
  private readonly len = STICKS.map(([i, j]) => new THREE.Vector3(...REST[i]).distanceTo(new THREE.Vector3(...REST[j])));
  private readonly head: THREE.Mesh;
  private readonly bones: THREE.Mesh[];
  private acc = 0;
  active = false;
  /** Seconds since the throw. */
  age = 0;

  constructor(bodyMat: THREE.Material) {
    this.head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), bodyMat);
    const unit = new THREE.BoxGeometry(1, 1, 1);
    this.bones = BONES.map(([, , t]) => {
      const m = new THREE.Mesh(unit, bodyMat);
      m.scale.set(t, 1, t * 0.8);
      return m;
    });
    this.group.add(this.head, ...this.bones);
    this.group.visible = false;
  }

  /** Throw from sim position (x, z) at forward speed, sideways velocity vx. */
  throw(x: number, z: number, speed: number, vx: number, rnd: () => number): void {
    const fwd = Math.max(6, speed * 0.8);
    const lift = 4 + Math.min(4, speed * 0.12);
    const spin = 0.6 + rnd() * 0.8;
    for (let i = 0; i < REST.length; i++) {
      const [rx, ry, rz] = REST[i];
      this.p[i].set(x + rx, ry, z + rz);
      // Head and hands get extra forward speed so the body tumbles head over heels.
      const extra = (ry - 1) * spin * 3;
      const v = new THREE.Vector3(vx * (0.8 + rnd() * 0.4), lift + rnd() * 1.5, fwd + extra);
      this.q[i].copy(this.p[i]).addScaledVector(v, -STEP);
    }
    this.active = true;
    this.age = 0;
    this.acc = 0;
    this.group.visible = true;
  }

  hide(): void {
    this.active = false;
    this.group.visible = false;
  }

  /** Pelvis in sim space, for the camera. */
  centre(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.p[2]);
  }

  update(dt: number): void {
    if (!this.active) return;
    this.age += dt;
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
    for (let k = 0; k < 4; k++) {
      for (let s = 0; s < STICKS.length; s++) {
        const [i, j] = STICKS[s];
        dir.copy(p[j]).sub(p[i]);
        const d = dir.length() || 1e-4;
        const diff = (d - this.len[s]) / d / 2;
        // Cross braces (index >= 6) are soft so the body can fold.
        const k2 = s >= 6 ? diff * 0.3 : diff;
        p[i].addScaledVector(dir, k2);
        p[j].addScaledVector(dir, -k2);
      }
    }
    for (let i = 0; i < p.length; i++) {
      const pt = p[i];
      if (pt.y < R) {
        const vy = pt.y - q[i].y;
        pt.y = R;
        q[i].y = R + vy * 0.35; // bounce
        q[i].x += (pt.x - q[i].x) * 0.18; // friction
        q[i].z += (pt.z - q[i].z) * 0.18;
      }
      const wall = ROAD_HALF + 1.4;
      if (Math.abs(pt.x) > wall) {
        pt.x = Math.sign(pt.x) * wall;
        q[i].x = pt.x + (pt.x - q[i].x) * 0.4;
      }
    }
  }

  private draw(): void {
    const w = REST.map((_, i) => toWorld(this.p[i].x, this.p[i].y, this.p[i].z, new THREE.Vector3()));
    this.head.position.copy(w[0]);
    for (let k = 0; k < BONES.length; k++) {
      const [i, j] = BONES[k];
      a.copy(w[i]);
      b.copy(w[j]);
      const m = this.bones[k];
      m.position.copy(a).add(b).multiplyScalar(0.5);
      dir.copy(b).sub(a);
      m.scale.y = dir.length();
      m.quaternion.setFromUnitVectors(up, dir.normalize());
    }
  }
}
