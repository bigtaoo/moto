// The road in 3D: the sim's straight road (x across, z along) bent into curves and hills, plus the test-site dressing.
// The whole course is built once per race (it is only ~2.5 km), so there is no chunk streaming yet.

import * as THREE from 'three';
import { ROAD_HALF, LANE_X } from '../sim/config';
import { Prng } from '../sim/rng';
import { makeCanvasTexture, testSymbolTexture } from './textures';

let phase = 0;

/** Sideways offset of the road centre at distance z. */
export function centreX(z: number): number {
  return 34 * Math.sin(z / 230 + phase) + 14 * Math.sin(z / 87 + phase * 2.3) - 34 * Math.sin(phase) - 14 * Math.sin(phase * 2.3);
}

/** Road height at distance z. */
export function heightAt(z: number): number {
  return 7 * Math.sin(z / 170 + phase * 1.7) + 2.2 * Math.sin(z / 57 + phase) - 7 * Math.sin(phase * 1.7) - 2.2 * Math.sin(phase);
}

/** Sim (x across, y up, z along) to world. Sim +x is the screen's right when looking down the road (+z). */
export function toWorld(x: number, y: number, z: number, out: THREE.Vector3): THREE.Vector3 {
  return out.set(-(centreX(z) + x), heightAt(z) + y, z);
}

/** Heading (rotation about y) and pitch of the road at z. */
export function yawAt(z: number): number {
  return Math.atan(-(centreX(z + 1) - centreX(z - 1)) / 2);
}
export function pitchAt(z: number): number {
  return Math.atan((heightAt(z + 1) - heightAt(z - 1)) / 2);
}

/** Put an object on the road at sim (x, y, z), facing down the road, with optional extra yaw. */
export function place(o: THREE.Object3D, x: number, y: number, z: number, yaw = 0): void {
  toWorld(x, y, z, o.position);
  o.rotation.set(-pitchAt(z), yawAt(z) + yaw, 0, 'YXZ');
}

const SEG = 2;
const SHOULDER = 1.2;

export class Track {
  readonly group = new THREE.Group();
  private readonly owned: { dispose(): void }[] = [];

  constructor(readonly length: number, seed: number) {
    phase = (seed % 97) * 0.37;
    const from = -60;
    const to = length + 320;
    this.road(from, to);
    this.ground(from, to);
    this.barriers(from, to);
    this.trees(from, to, seed);
    this.signs(from, to);
    this.gate(12, false);
    this.gate(length, true);
  }

  dispose(): void {
    for (const o of this.owned) o.dispose();
    this.group.removeFromParent();
  }

  private keep<T extends { dispose(): void }>(o: T): T {
    this.owned.push(o);
    return o;
  }

  private strip(from: number, to: number, xs: number[], yOff: (x: number, z: number) => number, color?: (x: number, z: number) => THREE.Color): THREE.BufferGeometry {
    const rows = Math.ceil((to - from) / SEG) + 1;
    const cols = xs.length;
    const pos = new Float32Array(rows * cols * 3);
    const uv = new Float32Array(rows * cols * 2);
    const col = color ? new Float32Array(rows * cols * 3) : null;
    const v = new THREE.Vector3();
    for (let r = 0; r < rows; r++) {
      const z = from + r * SEG;
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        toWorld(xs[c], yOff(xs[c], z), z, v);
        pos.set([v.x, v.y, v.z], i * 3);
        uv.set([c / (cols - 1), z / 8], i * 2);
        if (col && color) { const k = color(xs[c], z); col.set([k.r, k.g, k.b], i * 3); }
      }
    }
    const idx: number[] = [];
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const a = r * cols + c;
        const b = a + cols;
        idx.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    if (col) g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return this.keep(g);
  }

  private road(from: number, to: number): void {
    const w = ROAD_HALF + SHOULDER;
    const tex = this.keep(makeCanvasTexture(256, 256, (g, W, H) => {
      g.fillStyle = '#4a4e57';
      g.fillRect(0, 0, W, H);
      const rnd = new Prng(3);
      for (let i = 0; i < 1400; i++) {
        const s = 60 + rnd.int(40);
        g.fillStyle = `rgba(${s},${s},${s + 6},0.35)`;
        g.fillRect(rnd.int(W), rnd.int(H), 2, 2);
      }
      const u = (x: number) => ((x + w) / (2 * w)) * W;
      // shoulders
      g.fillStyle = '#5d5f63';
      g.fillRect(0, 0, u(-ROAD_HALF), H);
      g.fillRect(u(ROAD_HALF), 0, W - u(ROAD_HALF), H);
      // edge lines
      g.fillStyle = '#f4f4f0';
      g.fillRect(u(-ROAD_HALF) - 2, 0, 4, H);
      g.fillRect(u(ROAD_HALF) - 2, 0, 4, H);
      // double yellow between the oncoming lane and the rest
      const sep = (LANE_X[0] + LANE_X[1]) / 2;
      g.fillStyle = '#f2c230';
      g.fillRect(u(sep) - 5, 0, 3, H);
      g.fillRect(u(sep) + 2, 0, 3, H);
      // white dashes between the other lanes
      g.fillStyle = '#f4f4f0';
      for (let i = 1; i < LANE_X.length - 1; i++) {
        const x = (LANE_X[i] + LANE_X[i + 1]) / 2;
        g.fillRect(u(x) - 2, 0, 4, H * 0.5);
      }
    }));
    tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 4;
    const geo = this.strip(from, to, [-w, w], () => 0);
    const mat = this.keep(new THREE.MeshLambertMaterial({ map: tex }));
    this.group.add(new THREE.Mesh(geo, mat));
  }

  private ground(from: number, to: number): void {
    const xs = [-160, -70, -30, -14, -ROAD_HALF - SHOULDER + 0.05, ROAD_HALF + SHOULDER - 0.05, 14, 30, 70, 160];
    const a = new THREE.Color(0x7cc25a);
    const b = new THREE.Color(0x5fa847);
    const k = new THREE.Color();
    const geo = this.strip(from, to, xs, (x) => -0.04 + Math.max(0, Math.abs(x) - 20) * 0.08, (x, z) => {
      const n = 0.5 + 0.5 * Math.sin(z * 0.05 + x * 0.11) * Math.sin(z * 0.013 - x * 0.07);
      return k.copy(a).lerp(b, n);
    });
    const mat = this.keep(new THREE.MeshLambertMaterial({ vertexColors: true }));
    this.group.add(new THREE.Mesh(geo, mat));
  }

  /** Yellow/black crash barriers along both edges, one instanced mesh. */
  private barriers(from: number, to: number): void {
    const step = 5;
    const n = Math.ceil((to - from) / step) * 2;
    const geo = this.keep(new THREE.BoxGeometry(0.5, 0.75, step * 0.92));
    const mat = this.keep(new THREE.MeshLambertMaterial());
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    const o = new THREE.Object3D();
    const yellow = new THREE.Color(0xf2c230);
    const black = new THREE.Color(0x26262b);
    let i = 0;
    for (let z = from, j = 0; z < to; z += step, j++) {
      for (const s of [-1, 1]) {
        place(o, s * (ROAD_HALF + SHOULDER + 0.3), 0.37, z + step / 2);
        o.updateMatrix();
        mesh.setMatrixAt(i, o.matrix);
        mesh.setColorAt(i, j % 2 ? yellow : black);
        i++;
      }
    }
    mesh.count = i;
    this.group.add(mesh);
  }

  private trees(from: number, to: number, seed: number): void {
    const rnd = new Prng(seed * 31 + 7);
    const n = Math.round((to - from) / 6);
    const trunkGeo = this.keep(new THREE.CylinderGeometry(0.18, 0.25, 1.6, 5));
    trunkGeo.translate(0, 0.8, 0);
    const leafGeo = this.keep(new THREE.ConeGeometry(1.4, 3.6, 6));
    leafGeo.translate(0, 3.1, 0);
    const trunks = new THREE.InstancedMesh(trunkGeo, this.keep(new THREE.MeshLambertMaterial({ color: 0x7a5236 })), n);
    const leaves = new THREE.InstancedMesh(leafGeo, this.keep(new THREE.MeshLambertMaterial({ color: 0xffffff })), n);
    const o = new THREE.Object3D();
    const greens = [0x3f8f45, 0x4f9e3a, 0x2f7a4a, 0x6aa83c].map((c) => new THREE.Color(c));
    for (let i = 0; i < n; i++) {
      const z = from + rnd.float() * (to - from);
      const side = rnd.float() < 0.5 ? -1 : 1;
      const x = side * (13 + rnd.float() * rnd.float() * 60);
      toWorld(x, -0.04 + Math.max(0, Math.abs(x) - 20) * 0.08, z, o.position);
      o.rotation.set(0, rnd.float() * 6.28, 0);
      const s = 0.7 + rnd.float() * 0.8;
      o.scale.set(s, s * (0.8 + rnd.float() * 0.5), s);
      o.updateMatrix();
      trunks.setMatrixAt(i, o.matrix);
      leaves.setMatrixAt(i, o.matrix);
      leaves.setColorAt(i, greens[rnd.int(greens.length)]);
    }
    this.group.add(trunks, leaves);
  }

  /** Crash-test target boards on poles, every 120 m on alternating sides. */
  private signs(from: number, to: number): void {
    const n = Math.ceil((to - from) / 120);
    const poleGeo = this.keep(new THREE.BoxGeometry(0.2, 4, 0.2));
    poleGeo.translate(0, 2, 0);
    const boardGeo = this.keep(new THREE.PlaneGeometry(3.2, 3.2));
    boardGeo.translate(0, 5.2, 0);
    const poles = new THREE.InstancedMesh(poleGeo, this.keep(new THREE.MeshLambertMaterial({ color: 0x2a2a2e })), n * 2);
    const board = new THREE.InstancedMesh(boardGeo, this.keep(new THREE.MeshBasicMaterial({ map: this.keep(testSymbolTexture()), side: THREE.DoubleSide })), n);
    const o = new THREE.Object3D();
    let k = 0;
    for (let i = 0; i < n; i++) {
      const z = from + 60 + i * 120;
      const side = i % 2 ? 1 : -1;
      place(o, side * (ROAD_HALF + 4), 0, z, side * 0.5);
      o.updateMatrix();
      board.setMatrixAt(i, o.matrix);
      for (const dx of [-1.4, 1.4]) {
        place(o, side * (ROAD_HALF + 4) + dx * Math.cos(0.5), 0, z - side * dx * Math.sin(0.5), side * 0.5);
        o.updateMatrix();
        poles.setMatrixAt(k++, o.matrix);
      }
    }
    this.group.add(poles, board);
  }

  private gate(z: number, finish: boolean): void {
    const checker = this.keep(makeCanvasTexture(256, 32, (g, W, H) => {
      const s = H / 2;
      for (let x = 0; x < W / s; x++) for (let y = 0; y < 2; y++) {
        g.fillStyle = (x + y) % 2 ? '#111' : '#f4f4f0';
        g.fillRect(x * s, y * s, s, s);
      }
    }));
    const span = 2 * (ROAD_HALF + SHOULDER);
    const line = new THREE.Mesh(this.keep(new THREE.PlaneGeometry(span, 1.6)), this.keep(new THREE.MeshLambertMaterial({ map: checker })));
    line.rotation.x = -Math.PI / 2;
    const lineHolder = new THREE.Group();
    lineHolder.add(line);
    place(lineHolder, 0, 0.03, z);
    const mat = this.keep(new THREE.MeshLambertMaterial({ color: finish ? 0xf2c230 : 0xdedede }));
    const post = this.keep(new THREE.BoxGeometry(0.6, 6, 0.6));
    post.translate(0, 3, 0);
    const beam = new THREE.Mesh(this.keep(new THREE.BoxGeometry(span + 1.2, 1.4, 0.5)), this.keep(new THREE.MeshLambertMaterial({ map: checker })));
    beam.position.y = 6.2;
    const g = new THREE.Group();
    const l = new THREE.Mesh(post, mat);
    const r = new THREE.Mesh(post, mat);
    l.position.x = span / 2 + 0.3;
    r.position.x = -span / 2 - 0.3;
    g.add(l, r, beam);
    place(g, 0, 0, z);
    this.group.add(lineHolder, g);
  }
}
