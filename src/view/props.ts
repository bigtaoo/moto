// Traffic (instanced), the security buggy, weapon pickups and blob shadows.

import * as THREE from 'three';
import type { World } from '../sim/world';
import { CAR } from '../sim/config';
import { place } from './track';
import { makeWeapon } from './rider';

const MAX_CARS = 48;
const o = new THREE.Object3D();
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export class Traffic {
  readonly group = new THREE.Group();
  private readonly body: THREE.InstancedMesh;
  private readonly cabin: THREE.InstancedMesh;
  private readonly base: THREE.InstancedMesh;
  private readonly lights: THREE.InstancedMesh;
  private readonly col = new THREE.Color();

  constructor() {
    const L = CAR.halfL * 2;
    const W = CAR.halfW * 2;
    const mk = (g: THREE.BufferGeometry, m: THREE.Material) => {
      const mesh = new THREE.InstancedMesh(g, m, MAX_CARS);
      mesh.count = 0;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      return mesh;
    };
    this.body = mk(new THREE.BoxGeometry(W, 0.7, L).translate(0, 0.62, 0), new THREE.MeshLambertMaterial());
    this.cabin = mk(new THREE.BoxGeometry(W * 0.86, 0.62, L * 0.5).translate(0, 1.27, -0.15), new THREE.MeshLambertMaterial({ color: 0x9fc6e6 }));
    this.base = mk(new THREE.BoxGeometry(W * 0.94, 0.42, L * 0.86).translate(0, 0.24, 0), new THREE.MeshLambertMaterial({ color: 0x1d1d22 }));
    this.lights = mk(new THREE.BoxGeometry(W * 0.9, 0.16, 0.06).translate(0, 0.72, -L / 2 - 0.02), new THREE.MeshBasicMaterial({ color: 0xff3a2a }));
    // Body colour comes per instance.
    this.body.setColorAt(0, this.col.set(0xffffff));
  }

  update(w: World, alpha: number): void {
    const n = Math.min(MAX_CARS, w.cars.length);
    for (let i = 0; i < n; i++) {
      const c = w.cars[i];
      place(o, c.x, 0, lerp(c.pz, c.z, alpha), c.speed < 0 ? Math.PI : 0);
      o.updateMatrix();
      this.body.setMatrixAt(i, o.matrix);
      this.cabin.setMatrixAt(i, o.matrix);
      this.base.setMatrixAt(i, o.matrix);
      this.lights.setMatrixAt(i, o.matrix);
      this.body.setColorAt(i, this.col.set(c.color));
    }
    for (const m of [this.body, this.cabin, this.base, this.lights]) {
      m.count = n;
      m.instanceMatrix.needsUpdate = true;
    }
    if (this.body.instanceColor) this.body.instanceColor.needsUpdate = true;
  }
}

/** The test-site security buggy: white with an orange stripe and a flashing light bar. */
export class PatrolView {
  readonly root = new THREE.Group();
  private readonly red: THREE.MeshBasicMaterial;
  private readonly blue: THREE.MeshBasicMaterial;
  private t = 0;

  constructor() {
    const white = new THREE.MeshLambertMaterial({ color: 0xf2f2ee });
    const orange = new THREE.MeshLambertMaterial({ color: 0xf07a20 });
    const dark = new THREE.MeshLambertMaterial({ color: 0x1d1d22 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.7, 3.2), white);
    body.position.y = 0.65;
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.84, 0.18, 3.0), orange);
    stripe.position.y = 0.7;
    const roll = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.9, 0.12), dark);
    roll.position.set(0, 1.4, -0.4);
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.4, 2.6), dark);
    base.position.y = 0.25;
    this.red = new THREE.MeshBasicMaterial({ color: 0xff2020 });
    this.blue = new THREE.MeshBasicMaterial({ color: 0x2a6fff });
    const l1 = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.2, 0.3), this.red);
    l1.position.set(0.4, 1.95, -0.4);
    const l2 = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.2, 0.3), this.blue);
    l2.position.set(-0.4, 1.95, -0.4);
    this.root.add(base, body, stripe, roll, l1, l2);
    this.root.visible = false;
  }

  update(w: World, alpha: number, dt: number): void {
    const pt = w.patrol;
    this.root.visible = pt.active && pt.mode !== 'off';
    if (!this.root.visible) return;
    this.t += dt * (pt.mode === 'warn' || pt.mode === 'dash' ? 14 : 7);
    const on = Math.sin(this.t) > 0;
    this.red.color.setHex(on ? 0xff2020 : 0x501010);
    this.blue.color.setHex(on ? 0x102050 : 0x2a6fff);
    place(this.root, lerp(pt.px, pt.x, alpha), 0, lerp(pt.pz, pt.z, alpha));
  }
}

export class Pickups {
  readonly group = new THREE.Group();
  private readonly views = new Map<number, THREE.Group>();
  private t = 0;

  update(w: World, dt: number): void {
    this.t += dt;
    const seen = new Set<number>();
    for (const k of w.pickups) {
      seen.add(k.id);
      let v = this.views.get(k.id);
      if (!v) {
        v = new THREE.Group();
        const wpn = makeWeapon(k.kind);
        wpn.scale.setScalar(1.8);
        wpn.position.set(0, 0, -0.7);
        const spin = new THREE.Group();
        spin.add(wpn);
        spin.name = 'spin';
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.08, 6, 24), new THREE.MeshBasicMaterial({ color: 0xf2c230 }));
        ring.rotation.x = Math.PI / 2;
        ring.position.y = 0.08;
        v.add(spin, ring);
        this.views.set(k.id, v);
        this.group.add(v);
      }
      place(v, k.x, 0, k.z);
      const spin = v.getObjectByName('spin')!;
      spin.position.y = 1 + Math.sin(this.t * 3 + k.id) * 0.15;
      spin.rotation.y = this.t * 2.5;
    }
    for (const [id, v] of this.views) {
      if (!seen.has(id)) { v.removeFromParent(); this.views.delete(id); }
    }
  }
}

/** Dark ellipses under riders, cars and the buggy, one instanced mesh. */
export class Shadows {
  readonly mesh: THREE.InstancedMesh;
  private n = 0;

  constructor(max = 80) {
    const g = new THREE.CircleGeometry(1, 16).rotateX(-Math.PI / 2);
    const m = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false });
    this.mesh = new THREE.InstancedMesh(g, m, max);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }

  begin(): void {
    this.n = 0;
  }

  add(x: number, z: number, w: number, l: number): void {
    if (this.n >= this.mesh.instanceMatrix.count) return;
    place(o, x, 0.03, z);
    o.scale.set(w, 1, l);
    o.updateMatrix();
    o.scale.set(1, 1, 1);
    this.mesh.setMatrixAt(this.n++, o.matrix);
  }

  end(): void {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
