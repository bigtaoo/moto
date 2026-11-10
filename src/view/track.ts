// The road in 3D: the sim's straight road (x across, z along) bent into curves and hills, plus the test-site dressing.
// The whole course is built once per race (it is only ~2.5 km); the long pieces (road, ground, barriers, trees)
// are cut into CHUNK-long slices so the camera's frustum and far plane drop the ones out of sight.

import * as THREE from 'three';
import { ROAD_HALF, LANE_X, CUT, WORKS, RAMP } from '../sim/config';
import { Prng } from '../sim/rng';
import type { Road, Ramp } from '../sim/road';
import { makeCanvasTexture, testSymbolTexture } from './textures';
import type { Env } from './env';
import { toonMaterial } from './toon';

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
/** Length of a course slice, in m (a multiple of SEG, so slices of a strip meet row on row). */
const CHUNK = 150;
const SHOULDER = 1.2;
const BARRIER_X = ROAD_HALF + SHOULDER + 0.3;
/** Drawn ramp sizes: length up the slope and height at the lip. */
export const RAMP_LOOK = { roadL: 4, roadH: 0.7, trailL: 5.5, trailH: 0.9 };

/** Height of the ramp surface under sim (x, z), 0 off every ramp. */
export function rampLift(ramps: readonly Ramp[], x: number, z: number): number {
  for (const r of ramps) {
    const L = r.trail ? RAMP_LOOK.trailL : RAMP_LOOK.roadL;
    const d = r.z - z;
    if (d < 0 || d > L || Math.abs(x - r.x) > r.halfW) continue;
    return (r.trail ? RAMP_LOOK.trailH : RAMP_LOOK.roadH) * (1 - d / L);
  }
  return 0;
}

/** A wedge rising along +z from 0 at z = -len to h at z = 0, 2*halfW wide. Non-indexed, flat-shaded. */
function wedge(halfW: number, len: number, h: number): THREE.BufferGeometry {
  const w = halfW;
  const A = [-w, 0, -len], B = [w, 0, -len], Cc = [-w, h, 0], D = [w, h, 0], E = [-w, 0, 0], F = [w, 0, 0];
  const tris = [A, D, B, A, Cc, D, E, F, D, E, D, Cc, A, E, Cc, B, D, F];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(tris.flat()), 3));
  g.computeVertexNormals();
  return g;
}

const spot = new THREE.Object3D();

export class Track {
  readonly group = new THREE.Group();
  private readonly owned: { dispose(): void }[] = [];
  private cones: THREE.InstancedMesh | null = null;
  private conePos: { x: number; z: number; down: boolean }[] = [];

  constructor(readonly length: number, seed: number, private readonly env: Env, private readonly R: Road) {
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
    this.works();
    this.trails();
    this.ramps();
  }

  /** Is (x, z) on or by a trail (keep trees and signs off it)? */
  private onTrail(x: number, z: number, margin: number): boolean {
    for (const c of this.R.cuts) if (z > c.z0 - margin && z < c.z1 + margin && x * c.side > ROAD_HALF) return true;
    return false;
  }

  /** Knock over the cones near a crash at sim (x, z). */
  scatterCones(x: number, z: number, rnd: () => number): void {
    const m = this.cones;
    if (!m) return;
    const o = spot;
    let any = false;
    this.conePos.forEach((c, i) => {
      if (c.down || Math.abs(c.z - z) > 4 || Math.abs(c.x - x) > 3) return;
      c.down = true;
      any = true;
      place(o, c.x + 0.6 + rnd() * 1.4, 0.2, c.z + 1 + rnd() * 4, rnd() * 6.28);
      o.rotateX(Math.PI / 2);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
    });
    if (any) m.instanceMatrix.needsUpdate = true;
  }

  /**
   * Adds what this track made and nothing else frees (its textures, materials, geometries) to `bin`; the
   * race view frees it all once the next race is drawn (Stage.retire).
   */
  collect(bin: Set<{ dispose(): void }>): void {
    for (const o of this.owned) bin.add(o);
  }

  private keep<T extends { dispose(): void }>(o: T): T {
    this.owned.push(o);
    return o;
  }

  /** Instances bucketed by z into one InstancedMesh per course slice. */
  private sliced(geo: THREE.BufferGeometry, mat: THREE.Material, items: { z: number; m: THREE.Matrix4; c?: THREE.Color }[]): void {
    const buckets = new Map<number, typeof items>();
    for (const it of items) {
      const b = Math.floor(it.z / CHUNK);
      if (!buckets.has(b)) buckets.set(b, []);
      buckets.get(b)!.push(it);
    }
    for (const list of buckets.values()) {
      const mesh = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((it, i) => { mesh.setMatrixAt(i, it.m); if (it.c) mesh.setColorAt(i, it.c); });
      this.group.add(mesh);
    }
  }

  /** A strip in slices sharing one material. */
  private strips(from: number, to: number, mat: THREE.Material, xs: number[], yOff: (x: number, z: number) => number, color?: (x: number, z: number) => THREE.Color): void {
    for (let z = from; z < to; z += CHUNK) this.group.add(new THREE.Mesh(this.strip(z, Math.min(z + CHUNK, to), xs, yOff, color), mat));
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
    this.strips(from, to, this.keep(new THREE.MeshLambertMaterial({ map: tex })), [-w, w], () => 0);
  }

  private ground(from: number, to: number): void {
    const xs = [-160, -70, -30, -14, -ROAD_HALF - SHOULDER + 0.05, ROAD_HALF + SHOULDER - 0.05, 14, 30, 70, 160];
    const a = new THREE.Color(this.env.ground[0]);
    const b = new THREE.Color(this.env.ground[1]);
    const k = new THREE.Color();
    this.strips(from, to, this.keep(new THREE.MeshLambertMaterial({ vertexColors: true })), xs, (x) => -0.04 + Math.max(0, Math.abs(x) - 20) * 0.08, (x, z) => {
      const n = 0.5 + 0.5 * Math.sin(z * 0.05 + x * 0.11) * Math.sin(z * 0.013 - x * 0.07);
      return k.copy(a).lerp(b, n);
    });
  }

  /** Yellow/black crash barriers along both edges, instanced per course slice. */
  private barriers(from: number, to: number): void {
    const step = 5;
    const geo = this.keep(new THREE.BoxGeometry(0.5, 0.75, step * 0.92));
    const o = new THREE.Object3D();
    const yellow = new THREE.Color(0xf2c230);
    const black = new THREE.Color(0x26262b);
    const items: { z: number; m: THREE.Matrix4; c: THREE.Color }[] = [];
    // open where a trail leaves the road and where it comes back
    const open = (s: number, z0: number, z1: number) =>
      this.R.cuts.some((c) => c.side === s && ((z1 > c.z0 && z0 < c.z0 + CUT.gap) || (z1 > c.z1 - CUT.merge && z0 < c.z1)));
    for (let z = from, j = 0; z < to; z += step, j++) {
      for (const s of [-1, 1]) {
        if (open(s, z, z + step)) continue;
        place(o, s * BARRIER_X, 0.37, z + step / 2);
        o.updateMatrix();
        items.push({ z, m: o.matrix.clone(), c: j % 2 ? yellow : black });
      }
    }
    this.sliced(geo, this.keep(toonMaterial()), items);
  }

  private trees(from: number, to: number, seed: number): void {
    const rnd = new Prng(seed * 31 + 7);
    const n = Math.round(((to - from) / 6) * this.env.trees);
    const trunkGeo = this.keep(new THREE.CylinderGeometry(0.18, 0.25, 1.6, 5));
    trunkGeo.translate(0, 0.8, 0);
    const leafGeo = this.keep(new THREE.ConeGeometry(1.4, 3.6, 6));
    leafGeo.translate(0, 3.1, 0);
    const o = new THREE.Object3D();
    const greens = this.env.leaves.map((c) => new THREE.Color(c));
    const items: { z: number; m: THREE.Matrix4; c: THREE.Color }[] = [];
    for (let i = 0; i < n; i++) {
      const z = from + rnd.float() * (to - from);
      const side = rnd.float() < 0.5 ? -1 : 1;
      const x = side * (13 + rnd.float() * rnd.float() * 60);
      if (Math.abs(x) < 18 && this.onTrail(x, z, 6)) continue;
      toWorld(x, -0.04 + Math.max(0, Math.abs(x) - 20) * 0.08, z, o.position);
      o.rotation.set(0, rnd.float() * 6.28, 0);
      const s = 0.7 + rnd.float() * 0.8;
      o.scale.set(s, s * (0.8 + rnd.float() * 0.5), s);
      o.updateMatrix();
      items.push({ z, m: o.matrix.clone(), c: greens[rnd.int(greens.length)] });
    }
    this.sliced(trunkGeo, this.keep(toonMaterial({ color: this.env.trunk })), items.map(({ z, m }) => ({ z, m })));
    this.sliced(leafGeo, this.keep(toonMaterial({ color: 0xffffff })), items);
  }

  /** Crash-test target boards on poles, every 120 m on alternating sides. */
  private signs(from: number, to: number): void {
    const n = Math.ceil((to - from) / 120);
    const poleGeo = this.keep(new THREE.BoxGeometry(0.2, 4, 0.2));
    poleGeo.translate(0, 2, 0);
    const boardGeo = this.keep(new THREE.PlaneGeometry(3.2, 3.2));
    boardGeo.translate(0, 5.2, 0);
    const poles = new THREE.InstancedMesh(poleGeo, this.keep(toonMaterial({ color: 0x2a2a2e })), n * 2);
    const board = new THREE.InstancedMesh(boardGeo, this.keep(new THREE.MeshBasicMaterial({ map: this.keep(testSymbolTexture()), side: THREE.DoubleSide })), n);
    const o = new THREE.Object3D();
    let k = 0;
    for (let i = 0; i < n; i++) {
      const z = from + 60 + i * 120;
      let side = i % 2 ? 1 : -1;
      if (this.onTrail(side * (ROAD_HALF + 4), z, 8)) side = -side;
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

  /** Construction zones: a warning sign, a line of cones tapering across lane 3, a parked roller. */
  private works(): void {
    if (this.R.works.length === 0) return;
    // traffic cones: orange with a white band
    const geo = this.keep(new THREE.ConeGeometry(0.24, 0.75, 8));
    geo.translate(0, 0.375, 0);
    const pos = geo.getAttribute('position');
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const white = y > 0.32 && y < 0.5;
      col.set(white ? [0.96, 0.96, 0.94] : [0.98, 0.42, 0.08], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    for (const w of this.R.works) {
      for (let z = w.z0 - WORKS.taper; z <= w.z1 + WORKS.out; z += 2.5) this.conePos.push({ x: this.R.worksHi(z) + 0.3, z, down: false });
      // and across the closed lane where the taper starts
      for (let x = LANE_X[3] - 1.2; x <= ROAD_HALF; x += 1.2) this.conePos.push({ x, z: w.z0 - WORKS.taper - 3, down: false });
    }
    const mesh = new THREE.InstancedMesh(geo, this.keep(toonMaterial({ vertexColors: true })), this.conePos.length);
    const o = new THREE.Object3D();
    this.conePos.forEach((c, i) => {
      place(o, c.x, 0, c.z);
      o.updateMatrix();
      mesh.setMatrixAt(i, o.matrix);
    });
    this.cones = mesh;
    this.group.add(mesh);
    const signTex = this.keep(makeCanvasTexture(128, 128, (g, W, H) => {
      g.fillStyle = '#f2c230';
      g.beginPath();
      g.moveTo(W / 2, 4); g.lineTo(W - 4, H / 2); g.lineTo(W / 2, H - 4); g.lineTo(4, H / 2);
      g.closePath();
      g.fill();
      g.lineWidth = 6;
      g.strokeStyle = '#16161a';
      g.stroke();
      g.fillStyle = '#16161a';
      g.font = 'bold 22px sans-serif';
      g.textAlign = 'center';
      g.fillText('ROAD', W / 2, H / 2 - 4);
      g.fillText('WORKS', W / 2, H / 2 + 20);
    }));
    const arrowTex = this.keep(makeCanvasTexture(128, 64, (g, W, H) => {
      g.fillStyle = '#16161a';
      g.fillRect(0, 0, W, H);
      g.fillStyle = '#f2c230';
      for (let i = 0; i < 3; i++) {
        const x = 18 + i * 36;
        g.beginPath();
        g.moveTo(x, H / 2); g.lineTo(x + 22, 8); g.lineTo(x + 34, 8); g.lineTo(x + 12, H / 2); g.lineTo(x + 34, H - 8); g.lineTo(x + 22, H - 8);
        g.closePath();
        g.fill();
      }
    }));
    const signGeo = this.keep(new THREE.PlaneGeometry(1.6, 1.6));
    signGeo.translate(0, 2.4, 0);
    const arrowGeo = this.keep(new THREE.PlaneGeometry(2.2, 1.1));
    arrowGeo.translate(0, 1.1, 0);
    const pole = this.keep(new THREE.BoxGeometry(0.12, 1.8, 0.12));
    pole.translate(0, 0.9, 0);
    const signMat = this.keep(new THREE.MeshBasicMaterial({ map: signTex, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide, forceSinglePass: true }));
    const arrowMat = this.keep(new THREE.MeshBasicMaterial({ map: arrowTex, side: THREE.DoubleSide }));
    const poleMat = this.keep(toonMaterial({ color: 0x2a2a2e }));
    // a road roller parked in the closed lane
    const yellow = this.keep(toonMaterial({ color: 0xf2b630 }));
    const dark = this.keep(toonMaterial({ color: 0x35353a }));
    const body = this.keep(new THREE.BoxGeometry(1.6, 1.3, 3));
    body.translate(0, 1.15, 0);
    const cab = this.keep(new THREE.BoxGeometry(1.4, 1, 1.2));
    cab.translate(0, 2.3, -0.6);
    const drum = this.keep(new THREE.CylinderGeometry(0.75, 0.75, 1.7, 12));
    drum.rotateZ(Math.PI / 2);
    for (const w of this.R.works) {
      const s = new THREE.Group();
      s.add(new THREE.Mesh(signGeo, signMat), new THREE.Mesh(pole, poleMat));
      place(s, ROAD_HALF + 1.6, 0, w.z0 - WORKS.taper - 50, Math.PI);
      const a = new THREE.Group();
      a.add(new THREE.Mesh(arrowGeo, arrowMat), new THREE.Mesh(pole, poleMat));
      a.children[1].scale.y = 0.4;
      place(a, LANE_X[3] + 0.4, 0, w.z0 - WORKS.taper + 4, Math.PI);
      const roller = new THREE.Group();
      const d1 = new THREE.Mesh(drum, dark);
      d1.position.set(0, 0.75, 1.6);
      const d2 = new THREE.Mesh(drum, dark);
      d2.position.set(0, 0.75, -1.6);
      roller.add(new THREE.Mesh(body, yellow), new THREE.Mesh(cab, yellow), d1, d2);
      place(roller, LANE_X[3] + 0.5, 0, (w.z0 + w.z1) / 2, 0.15);
      this.group.add(s, a, roller);
    }
  }

  /** Shortcut trails: a dirt track behind the barrier with tyre stacks along its far side. */
  private trails(): void {
    if (this.R.cuts.length === 0) return;
    const mat = this.keep(new THREE.MeshLambertMaterial({ color: this.env.dirt }));
    const tyre = this.keep(new THREE.CylinderGeometry(0.42, 0.42, 0.75, 10));
    tyre.translate(0, 0.375, 0);
    const spots: [number, number][] = [];
    for (const c of this.R.cuts) {
      const xs = c.side > 0 ? [ROAD_HALF + 0.9, CUT.outer + 0.9] : [-CUT.outer - 0.9, -ROAD_HALF - 0.9];
      this.group.add(new THREE.Mesh(this.strip(c.z0 - 4, c.z1 + 4, xs, () => 0.015), mat));
      for (let z = c.z0 + CUT.gap; z <= c.z1 - CUT.merge; z += 3) spots.push([c.side * (CUT.outer + 1.1), z]);
    }
    const tyres = new THREE.InstancedMesh(tyre, this.keep(toonMaterial({ color: 0x26262b })), spots.length);
    const o = new THREE.Object3D();
    spots.forEach(([x, z], i) => {
      place(o, x, 0, z);
      o.updateMatrix();
      tyres.setMatrixAt(i, o.matrix);
    });
    this.group.add(tyres);
  }

  /** Ramps: yellow-and-black kickers in a lane, dirt mounds on the trails. */
  private ramps(): void {
    const road = this.keep(wedge(RAMP.halfW, RAMP_LOOK.roadL, RAMP_LOOK.roadH));
    const mound = this.keep(wedge(RAMP.trailHalfW, RAMP_LOOK.trailL, RAMP_LOOK.trailH));
    const stripes = this.keep(makeCanvasTexture(64, 64, (g, W, H) => {
      g.fillStyle = '#f2c230';
      g.fillRect(0, 0, W, H);
      g.fillStyle = '#16161a';
      for (let i = -1; i < 4; i++) {
        g.beginPath();
        g.moveTo(i * 24, H); g.lineTo(i * 24 + 12, H); g.lineTo(i * 24 + 12 + H, 0); g.lineTo(i * 24 + H, 0);
        g.closePath();
        g.fill();
      }
    }));
    stripes.wrapS = stripes.wrapT = THREE.RepeatWrapping;
    // planar uvs over the wedge's footprint so the stripes run across the slope
    const pos = road.getAttribute('position');
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) uv.set([pos.getX(i) / 1.2, pos.getZ(i) / 1.2], i * 2);
    road.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    const roadMat = this.keep(new THREE.MeshLambertMaterial({ map: stripes }));
    const moundMat = this.keep(new THREE.MeshLambertMaterial({ color: new THREE.Color(this.env.dirt).multiplyScalar(0.85) }));
    for (const r of this.R.ramps) {
      const m = new THREE.Mesh(r.trail ? mound : road, r.trail ? moundMat : roadMat);
      place(m, r.x, 0, r.z);
      this.group.add(m);
    }
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
    const mat = this.keep(toonMaterial({ color: finish ? 0xf2c230 : 0xdedede }));
    const post = this.keep(new THREE.BoxGeometry(0.6, 6, 0.6));
    post.translate(0, 3, 0);
    const beam = new THREE.Mesh(this.keep(new THREE.BoxGeometry(span + 1.2, 1.4, 0.5)), this.keep(toonMaterial({ map: checker })));
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
