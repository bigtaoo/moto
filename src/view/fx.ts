// Hit sparks and crash dust: one instanced mesh of small cubes moving in sim space.

import * as THREE from 'three';
import { toWorld } from './track';

const MAX = 160;

interface Bit {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number; max: number; size: number;
}

export class Fx {
  readonly mesh: THREE.InstancedMesh;
  private readonly bits: Bit[] = [];
  private readonly o = new THREE.Object3D();
  private readonly col = new THREE.Color();
  private readonly colors: number[] = [];

  constructor() {
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial(), MAX);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.setColorAt(0, this.col.set(0xffffff));
  }

  /** Spark burst at sim position, thrown towards `side` (+1 = screen right). */
  sparks(x: number, y: number, z: number, side: number, big: boolean, rnd: () => number): void {
    const n = big ? 22 : 12;
    for (let i = 0; i < n; i++) {
      const sp = (big ? 7 : 5) * (0.5 + rnd());
      this.add({
        x, y, z,
        vx: side * sp * (0.4 + rnd()), vy: 1 + rnd() * 5, vz: (rnd() - 0.3) * 6,
        life: 0, max: 0.25 + rnd() * 0.3, size: 0.09 + rnd() * 0.08,
      }, rnd() < 0.5 ? 0xffe066 : 0xffffff);
    }
  }

  /** A few low sparks where two scooter decks grind together; left behind as the riders move on. */
  scrape(x: number, z: number, rnd: () => number): void {
    for (let i = 0; i < 5; i++) {
      this.add({
        x: x + (rnd() - 0.5) * 0.2, y: 0.25, z: z + rnd() * 0.6,
        vx: (rnd() - 0.5) * 4, vy: 0.5 + rnd() * 2.5, vz: rnd() * 3,
        life: 0, max: 0.15 + rnd() * 0.15, size: 0.05 + rnd() * 0.05,
      }, rnd() < 0.6 ? 0xffd040 : 0xff8a30);
    }
  }

  /** Grey puff where something hits the tarmac. */
  dust(x: number, z: number, speed: number, rnd: () => number): void {
    for (let i = 0; i < 14; i++) {
      this.add({
        x: x + (rnd() - 0.5) * 1.2, y: 0.2, z: z + (rnd() - 0.5) * 1.5,
        vx: (rnd() - 0.5) * 4, vy: 1 + rnd() * 2.5, vz: speed * 0.5 + (rnd() - 0.5) * 3,
        life: 0, max: 0.5 + rnd() * 0.4, size: 0.25 + rnd() * 0.25,
      }, rnd() < 0.5 ? 0xb9b4a8 : 0x9a968c);
    }
  }

  private add(b: Bit, color: number): void {
    if (this.bits.length >= MAX) { this.bits.shift(); this.colors.shift(); }
    this.bits.push(b);
    this.colors.push(color);
  }

  update(dt: number): void {
    const { o } = this;
    let n = 0;
    for (let i = this.bits.length - 1; i >= 0; i--) {
      const b = this.bits[i];
      b.life += dt;
      if (b.life >= b.max) { this.bits.splice(i, 1); this.colors.splice(i, 1); }
    }
    for (let i = 0; i < this.bits.length; i++) {
      const b = this.bits[i];
      b.vy -= 18 * dt;
      b.x += b.vx * dt;
      b.y = Math.max(0.05, b.y + b.vy * dt);
      b.z += b.vz * dt;
      toWorld(b.x, b.y, b.z, o.position);
      o.scale.setScalar(b.size * (1 - b.life / b.max));
      o.rotation.set(b.life * 9, b.life * 7, 0);
      o.updateMatrix();
      this.mesh.setMatrixAt(n, o.matrix);
      this.mesh.setColorAt(n, this.col.set(this.colors[i]));
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
