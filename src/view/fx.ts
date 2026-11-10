// Hit sparks and crash dust: one instanced mesh of small cubes moving in sim space. Plus the comic
// "pow" burst where a blow lands: a flat spiky star facing the camera that pops and fades.

import * as THREE from 'three';
import { toWorld } from './track';
import { Kit, INK, cached, shared } from './toon';

const MAX = 160;
const POWS = 6;
const POW_LIFE = 0.3;

/** A spiky burst in the xy plane: ink rim, colour, white core. */
function burst(fill: number): THREE.BufferGeometry {
  const star = (r: number, z: number) => {
    const sh = new THREE.Shape();
    const spikes = [1, 0.78, 0.95, 0.7, 1, 0.85, 0.92, 0.74, 1, 0.8];
    for (let i = 0; i < spikes.length * 2; i++) {
      const a = (i / (spikes.length * 2)) * Math.PI * 2;
      const l = i % 2 ? r * 0.5 : r * spikes[i / 2];
      if (i) sh.lineTo(Math.cos(a) * l, Math.sin(a) * l);
      else sh.moveTo(Math.cos(a) * l, Math.sin(a) * l);
    }
    return new THREE.ShapeGeometry(sh).translate(0, 0, z);
  };
  return new Kit(0)
    .add(star(1.18, 0), INK, { ink: false })
    .add(star(1, 0.01), fill, { ink: false })
    .add(star(0.45, 0.02), 0xffffff, { ink: false })
    .build();
}

interface Pow { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; life: number; size: number; spin: number }

/** One particle; a fixed pool of these is reused, so a hit allocates nothing. */
interface Bit {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number; max: number; size: number; color: number;
}

let cube: THREE.BufferGeometry | null = null;

export class Fx {
  readonly mesh: THREE.InstancedMesh;
  /** Share of particles thrown (the quality tier's `fx`). */
  scale = 1;
  private readonly bits: Bit[] = [];
  /** The slot the next particle takes: the oldest, once the pool is full. */
  private next = 0;
  private readonly o = new THREE.Object3D();
  private readonly col = new THREE.Color();
  readonly pows = new THREE.Group();
  private readonly powList: Pow[] = [];
  private readonly powGeo: [THREE.BufferGeometry, THREE.BufferGeometry];
  private nextPow = 0;

  constructor() {
    this.powGeo = [cached('pow', () => burst(0xffd23a)), cached('pow-ko', () => burst(0xff5a2a))];
    for (let i = 0; i < POWS; i++) {
      // flat and facing the camera: one pass is enough although it is see-through and two-sided
      const mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthTest: false, side: THREE.DoubleSide, forceSinglePass: true });
      const mesh = new THREE.Mesh(this.powGeo[0], mat);
      mesh.renderOrder = 10;
      mesh.visible = false;
      this.pows.add(mesh);
      this.powList.push({ mesh, mat, life: POW_LIFE, size: 1, spin: 0 });
    }
    for (let i = 0; i < MAX; i++) this.bits.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 1, max: 0, size: 0, color: 0 });
    cube ??= shared(new THREE.BoxGeometry(1, 1, 1));
    this.mesh = new THREE.InstancedMesh(cube, new THREE.MeshBasicMaterial(), MAX);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.setColorAt(0, this.col.set(0xffffff));
  }

  /** How many of `n` particles this quality tier throws. */
  private many(n: number): number {
    return Math.max(1, Math.round(n * this.scale));
  }

  /** Spark burst at sim position, thrown towards `side` (+1 = screen right). */
  sparks(x: number, y: number, z: number, side: number, big: boolean, rnd: () => number): void {
    const n = this.many(big ? 22 : 12);
    for (let i = 0; i < n; i++) {
      const sp = (big ? 7 : 5) * (0.5 + rnd());
      this.add(x, y, z, side * sp * (0.4 + rnd()), 1 + rnd() * 5, (rnd() - 0.3) * 6,
        0.25 + rnd() * 0.3, 0.09 + rnd() * 0.08, rnd() < 0.5 ? 0xffe066 : 0xffffff);
    }
  }

  /** Comic burst where a blow lands; bigger and red-orange for a knock-out. */
  pow(x: number, y: number, z: number, ko: boolean): void {
    const p = this.powList[this.nextPow++ % POWS];
    p.mesh.geometry = this.powGeo[ko ? 1 : 0];
    toWorld(x, y, z, p.mesh.position);
    p.life = 0;
    p.size = ko ? 0.95 : 0.6;
    p.spin = Math.random() * Math.PI;
    p.mesh.visible = true;
  }

  /** Small puff where a thrown dummy slams into the road. */
  puff(x: number, z: number, impact: number, rnd: () => number): void {
    const n = Math.min(10, Math.round(impact * 0.8 * this.scale));
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2;
      const sp = 1.5 + rnd() * 2.5;
      this.add(x, 0.15, z, Math.cos(a) * sp, 1 + rnd() * 2, Math.sin(a) * sp,
        0.35 + rnd() * 0.3, 0.2 + rnd() * 0.2, rnd() < 0.5 ? 0xc9c4b8 : 0xa8a49a);
    }
  }

  /** A few low sparks where two scooter decks grind together; left behind as the riders move on. */
  scrape(x: number, z: number, rnd: () => number): void {
    const n = this.many(5);
    for (let i = 0; i < n; i++) {
      this.add(x + (rnd() - 0.5) * 0.2, 0.25, z + rnd() * 0.6, (rnd() - 0.5) * 4, 0.5 + rnd() * 2.5, rnd() * 3,
        0.15 + rnd() * 0.15, 0.05 + rnd() * 0.05, rnd() < 0.6 ? 0xffd040 : 0xff8a30);
    }
  }

  /** Grey puff where something hits the tarmac. */
  dust(x: number, z: number, speed: number, rnd: () => number): void {
    const n = this.many(14);
    for (let i = 0; i < n; i++) {
      this.add(x + (rnd() - 0.5) * 1.2, 0.2, z + (rnd() - 0.5) * 1.5, (rnd() - 0.5) * 4, 1 + rnd() * 2.5, speed * 0.5 + (rnd() - 0.5) * 3,
        0.5 + rnd() * 0.4, 0.25 + rnd() * 0.25, rnd() < 0.5 ? 0xb9b4a8 : 0x9a968c);
    }
  }

  private add(x: number, y: number, z: number, vx: number, vy: number, vz: number, max: number, size: number, color: number): void {
    const b = this.bits[this.next];
    this.next = (this.next + 1) % MAX;
    b.x = x; b.y = y; b.z = z;
    b.vx = vx; b.vy = vy; b.vz = vz;
    b.life = 0; b.max = max; b.size = size; b.color = color;
  }

  update(dt: number, cam: THREE.Camera): void {
    for (const p of this.powList) {
      if (!p.mesh.visible) continue;
      p.life += dt;
      if (p.life >= POW_LIFE) { p.mesh.visible = false; continue; }
      const t = p.life;
      // pop past full size, settle, then shrink away
      const k = t < 0.05 ? (t / 0.05) * 1.3 : t < 0.12 ? 1.3 - ((t - 0.05) / 0.07) * 0.3 : 1 - ((t - 0.12) / (POW_LIFE - 0.12)) * 0.6;
      p.mesh.scale.setScalar(p.size * k);
      p.mat.opacity = t < 0.16 ? 1 : 1 - (t - 0.16) / (POW_LIFE - 0.16);
      p.mesh.quaternion.copy(cam.quaternion);
      p.mesh.rotateZ(p.spin + t * 2);
    }
    const { o } = this;
    let n = 0;
    for (const b of this.bits) {
      if (b.life >= b.max) continue;
      b.life += dt;
      if (b.life >= b.max) continue;
      b.vy -= 18 * dt;
      b.x += b.vx * dt;
      b.y = Math.max(0.05, b.y + b.vy * dt);
      b.z += b.vz * dt;
      toWorld(b.x, b.y, b.z, o.position);
      o.scale.setScalar(b.size * (1 - b.life / b.max));
      o.rotation.set(b.life * 9, b.life * 7, 0);
      o.updateMatrix();
      this.mesh.setMatrixAt(n, o.matrix);
      this.mesh.setColorAt(n, this.col.set(b.color));
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
