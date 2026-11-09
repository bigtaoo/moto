// Traffic (instanced, five car shapes), the security buggy, weapon pickups and blob shadows.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { World } from '../sim/world';
import { place } from './track';
import { makeWeapon } from './rider';
import { Kit, kitMaterial, paintedMaterial } from './toon';

const MAX_CARS = 48;
const o = new THREE.Object3D();
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// Car parts. Front is +z; the camera mostly sees the back, so that is where the detail goes.
const GLASS = 0x7fa8c8;
const DARK = 0x26262c;
const TAIL = 0xff4a36;
const HEAD = 0xfff2c0;
const HUB = 0xb4bac2;
const PAINT = { paint: 1 } as const;
const CAR_INK = 0.045;
/** A chamfered box: rounded corners with one segment, cheap enough for a street full of cars. */
const cbox = (w: number, h: number, d: number, r = 0.08) => new RoundedBoxGeometry(w, h, d, 1, r);
const tyre = (r: number, w: number) => new THREE.CylinderGeometry(r, r, w, 12).rotateZ(Math.PI / 2);
const hub = (r: number, w: number) => new THREE.CylinderGeometry(r, r, w, 8).rotateZ(Math.PI / 2);

/** Wheels, bumpers, lights and plate shared by every car type; `len` is the body length, `y` its middle. */
function chassis(k: Kit, len: number, y = 0.72): Kit {
  const zr = -len / 2;
  const zf = len / 2;
  for (const z of [zr + 0.85, zf - 0.85]) {
    for (const x of [-0.8, 0.8]) k.add(tyre(0.4, 0.34), DARK, { at: [x, 0.4, z] }).add(hub(0.19, 0.36), HUB, { at: [x, 0.4, z], ink: false });
  }
  k.add(cbox(1.78, 0.2, 0.2, 0.06), DARK, { at: [0, y - 0.28, zr - 0.02] })
    .add(cbox(1.78, 0.2, 0.2, 0.06), DARK, { at: [0, y - 0.28, zf + 0.02] })
    .add(cbox(0.42, 0.14, 0.04, 0.02), 0xf2f0e4, { at: [0, y - 0.04, zr - 0.01], ink: false });
  for (const x of [-0.62, 0.62]) {
    k.add(cbox(0.36, 0.17, 0.05, 0.03), TAIL, { at: [x, y + 0.12, zr - 0.01], ink: false })
      .add(cbox(0.32, 0.15, 0.05, 0.03), HEAD, { at: [x, y + 0.08, zf + 0.01], ink: false });
  }
  return k;
}

/** Lower body, a glass cabin with painted pillars, and a painted roof slab. */
function saloon(len: number, cabLen: number, cabZ: number, cabH = 0.54): Kit {
  const k = new Kit(CAR_INK)
    .add(cbox(1.72, 0.6, len, 0.14), 0xffffff, { at: [0, 0.72, 0], ...PAINT })
    .add(cbox(1.58, cabH, cabLen, 0.1), GLASS, { at: [0, 1.02 + cabH / 2, cabZ] })
    .add(cbox(1.66, 0.11, cabLen + 0.06, 0.05), 0xffffff, { at: [0, 1.04 + cabH, cabZ], ...PAINT });
  for (const x of [-0.8, 0.8]) k.add(cbox(0.06, cabH, 0.14, 0.02), 0xffffff, { at: [x, 1.02 + cabH / 2, cabZ - 0.1], ink: false, ...PAINT });
  return chassis(k, len);
}

/** Five car shapes, all inside the sim's 1.9 x 4.4 m footprint. */
const CAR_KITS: (() => Kit)[] = [
  // hatchback
  () => saloon(3.8, 2.0, -0.45, 0.58),
  // three-box saloon
  () => saloon(4.4, 2.0, -0.15),
  // van
  () => chassis(new Kit(CAR_INK)
    .add(cbox(1.76, 1.42, 3.5, 0.16), 0xffffff, { at: [0, 1.13, -0.42], ...PAINT })
    .add(cbox(1.72, 0.62, 0.95, 0.14), 0xffffff, { at: [0, 0.73, 1.68], ...PAINT })
    .add(cbox(1.6, 0.6, 0.5, 0.1), GLASS, { at: [0, 1.3, 1.25], rot: [-0.5, 0, 0] })
    .add(cbox(1.8, 0.36, 2.3, 0.06), GLASS, { at: [0, 1.5, -0.1], ink: false })
    .add(cbox(1.3, 0.4, 0.04, 0.03), GLASS, { at: [0, 1.48, -2.18], ink: false })
    .add(cbox(0.06, 1.2, 0.04, 0.02), DARK, { at: [0, 1.15, -2.2], ink: false }), 4.3),
  // pickup with a crate in the bed
  () => chassis(new Kit(CAR_INK)
    .add(cbox(1.72, 0.6, 4.4, 0.14), 0xffffff, { at: [0, 0.72, 0], ...PAINT })
    .add(cbox(1.58, 0.56, 1.25, 0.1), GLASS, { at: [0, 1.3, 0.55] })
    .add(cbox(1.66, 0.11, 1.32, 0.05), 0xffffff, { at: [0, 1.62, 0.55], ...PAINT })
    .add(cbox(1.5, 0.04, 2.1, 0.01), DARK, { at: [0, 1.03, -1.1], ink: false })
    .add(cbox(0.1, 0.34, 2.2, 0.04), 0xffffff, { at: [0.81, 1.18, -1.1], ...PAINT })
    .add(cbox(0.1, 0.34, 2.2, 0.04), 0xffffff, { at: [-0.81, 1.18, -1.1], ...PAINT })
    .add(cbox(1.72, 0.34, 0.1, 0.04), 0xffffff, { at: [0, 1.18, -2.15], ...PAINT })
    .add(cbox(0.8, 0.62, 0.8, 0.06), 0xc0904e, { at: [0.15, 1.34, -1.1], rot: [0, 0.3, 0] }), 4.4),
  // SUV with a roof rack and a spare wheel
  () => chassis(new Kit(CAR_INK)
    .add(cbox(1.76, 0.72, 4.3, 0.16), 0xffffff, { at: [0, 0.8, 0], ...PAINT })
    .add(cbox(1.62, 0.6, 2.8, 0.1), GLASS, { at: [0, 1.46, -0.3] })
    .add(cbox(1.7, 0.12, 2.9, 0.05), 0xffffff, { at: [0, 1.8, -0.3], ...PAINT })
    .add(cbox(0.08, 0.08, 2.4, 0.02), DARK, { at: [0.66, 1.92, -0.3] })
    .add(cbox(0.08, 0.08, 2.4, 0.02), DARK, { at: [-0.66, 1.92, -0.3] })
    .add(cbox(0.06, 0.6, 0.14, 0.02), 0xffffff, { at: [0.8, 1.46, -1.6], ink: false, ...PAINT })
    .add(cbox(0.06, 0.6, 0.14, 0.02), 0xffffff, { at: [-0.8, 1.46, -1.6], ink: false, ...PAINT })
    .add(new THREE.CylinderGeometry(0.38, 0.38, 0.26, 12).rotateX(Math.PI / 2), DARK, { at: [0, 1.0, -2.3] })
    .add(new THREE.CylinderGeometry(0.18, 0.18, 0.28, 8).rotateX(Math.PI / 2), 0xffffff, { at: [0, 1.0, -2.3], ink: false, ...PAINT }), 4.3, 0.8),
];

/** A car's shape: fixed by its id, so it never changes mid-race, and the sim never hears of it. */
const carType = (id: number) => (Math.imul(id, 2654435761) >>> 0) % CAR_KITS.length;

export class Traffic {
  readonly group = new THREE.Group();
  private readonly meshes: THREE.InstancedMesh[];
  private readonly n: number[];
  private readonly col = new THREE.Color();

  constructor() {
    this.meshes = CAR_KITS.map((kit) => {
      const mesh = new THREE.InstancedMesh(kit().build(), paintedMaterial(), MAX_CARS);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.setColorAt(0, this.col.set(0xffffff));
      this.group.add(mesh);
      return mesh;
    });
    this.n = this.meshes.map(() => 0);
  }

  update(w: World, alpha: number): void {
    this.n.fill(0);
    for (const c of w.cars) {
      const t = carType(c.id);
      const i = this.n[t];
      if (i >= MAX_CARS) continue;
      this.n[t]++;
      place(o, c.x, 0, lerp(c.pz, c.z, alpha), c.speed < 0 ? Math.PI : 0);
      o.updateMatrix();
      this.meshes[t].setMatrixAt(i, o.matrix);
      this.meshes[t].setColorAt(i, this.col.set(c.color));
    }
    for (const [t, m] of this.meshes.entries()) {
      m.count = this.n[t];
      m.visible = m.count > 0;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }
}

/** The test-site security buggy: white with an orange stripe, a roll cage and a flashing light bar. */
export class PatrolView {
  readonly root = new THREE.Group();
  private readonly red: THREE.MeshBasicMaterial;
  private readonly blue: THREE.MeshBasicMaterial;
  private t = 0;

  constructor() {
    const k = new Kit(CAR_INK)
      .add(cbox(1.78, 0.72, 3.3, 0.16), 0xf2f2ee, { at: [0, 0.72, 0] })
      .add(cbox(1.82, 0.18, 3.0, 0.05), 0xf07a20, { at: [0, 0.78, 0], ink: false })
      .add(cbox(1.6, 0.06, 1.2, 0.02), DARK, { at: [0, 1.09, -0.5], ink: false })
      .add(cbox(1.56, 0.08, 0.08, 0.02), DARK, { at: [0, 2.05, -0.45] })
      .decal(0.2, 0xf4d23c, { at: [0, 0.82, -1.69], rot: [0, Math.PI, 0] });
    for (const x of [-0.72, 0.72]) {
      k.add(new THREE.CylinderGeometry(0.05, 0.05, 1.0, 6), DARK, { at: [x, 1.55, -0.45] })
        .add(new THREE.CylinderGeometry(0.05, 0.05, 1.3, 6), DARK, { at: [x, 1.45, 0.25], rot: [0.75, 0, 0] });
      for (const z of [-1.05, 1.05]) k.add(tyre(0.42, 0.36), DARK, { at: [x * 1.12, 0.42, z] }).add(hub(0.2, 0.38), HUB, { at: [x * 1.12, 0.42, z], ink: false });
    }
    this.root.add(new THREE.Mesh(k.build(), kitMaterial()));
    this.red = new THREE.MeshBasicMaterial({ color: 0xff2020 });
    this.blue = new THREE.MeshBasicMaterial({ color: 0x2a6fff });
    const lamp = cbox(0.6, 0.2, 0.3, 0.05);
    const l1 = new THREE.Mesh(lamp, this.red);
    l1.position.set(0.4, 2.18, -0.45);
    const l2 = new THREE.Mesh(lamp, this.blue);
    l2.position.set(-0.4, 2.18, -0.45);
    this.root.add(l1, l2);
    this.root.visible = false;
  }

  update(w: World, alpha: number, dt: number): void {
    const pt = w.patrol;
    this.root.visible = pt.active;
    if (!this.root.visible) return;
    this.t += dt * (pt.mode === 'block' || pt.mode === 'squeeze' || pt.mode === 'halt' ? 14 : 7);
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
