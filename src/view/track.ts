// The road in 3D: the sim's straight road (x across, z along) bent into curves and hills, plus the test-site
// dressing -- ground, barriers, trees, target boards, trails, ramps, the start and finish arches. The whole
// course is built once per race (it is only ~2.5 km) into a Chunks (chunks.ts), which cuts the long pieces
// into slices the camera can drop; the construction zones are a piece of their own (roadworks.ts).

import * as THREE from 'three';
import { ROAD_HALF, LANE_X, CUT, RAMP } from '../sim/config';
import { Prng } from '../sim/rng';
import type { Road } from '../sim/road';
import { makeCanvasTexture, testSymbolTexture } from './textures';
import type { Env } from './env';
import { toonMaterial } from './toon';
import { Chunks } from './chunks';
import { Roadworks } from './roadworks';
import { toWorld, place, setRoadPhase, wedge, RAMP_LOOK } from './road';

const SHOULDER = 1.2;
const BARRIER_X = ROAD_HALF + SHOULDER + 0.3;

export class Track {
  private readonly C = new Chunks();
  private readonly works: Roadworks;
  readonly group: THREE.Group;

  /** `startGate`: the arch 12 m past the line. The dummy launch has its ramp there, so it asks for none. */
  constructor(readonly length: number, seed: number, private readonly env: Env, private readonly R: Road, startGate = true) {
    this.group = this.C.group;
    setRoadPhase((seed % 97) * 0.37);
    const from = -60;
    const to = length + 320;
    this.road(from, to);
    this.ground(from, to);
    this.barriers(from, to);
    this.trees(from, to, seed);
    this.signs(from, to);
    if (startGate) this.gate(12, false);
    this.gate(length, true);
    this.works = new Roadworks(R, this.C);
    this.trails();
    this.ramps();
    this.C.seal();
  }

  /** Knock over the cones near a crash at sim (x, z). */
  scatterCones(x: number, z: number, rnd: () => number): void {
    this.works.scatter(x, z, rnd);
  }

  /**
   * Adds what this track made and nothing else frees (its textures, materials, geometries) to `bin`; the
   * race view frees it all once the next race is drawn (Stage.retire).
   */
  collect(bin: Set<{ dispose(): void }>): void {
    this.C.collect(bin);
  }

  /** Is (x, z) on or by a trail (keep trees and signs off it)? */
  private onTrail(x: number, z: number, margin: number): boolean {
    for (const c of this.R.cuts) if (z > c.z0 - margin && z < c.z1 + margin && x * c.side > ROAD_HALF) return true;
    return false;
  }

  private road(from: number, to: number): void {
    const w = ROAD_HALF + SHOULDER;
    const tex = this.C.keep(makeCanvasTexture(256, 256, (g, W, H) => {
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
    this.C.strips(from, to, this.C.keep(new THREE.MeshLambertMaterial({ map: tex })), [-w, w], () => 0);
  }

  private ground(from: number, to: number): void {
    const xs = [-160, -70, -30, -14, -ROAD_HALF - SHOULDER + 0.05, ROAD_HALF + SHOULDER - 0.05, 14, 30, 70, 160];
    const a = new THREE.Color(this.env.ground[0]);
    const b = new THREE.Color(this.env.ground[1]);
    const k = new THREE.Color();
    this.C.strips(from, to, this.C.keep(new THREE.MeshLambertMaterial({ vertexColors: true })), xs, (x) => -0.04 + Math.max(0, Math.abs(x) - 20) * 0.08, (x, z) => {
      const n = 0.5 + 0.5 * Math.sin(z * 0.05 + x * 0.11) * Math.sin(z * 0.013 - x * 0.07);
      return k.copy(a).lerp(b, n);
    });
  }

  /** Yellow/black crash barriers along both edges, instanced per course slice. */
  private barriers(from: number, to: number): void {
    const step = 5;
    const geo = this.C.keep(new THREE.BoxGeometry(0.5, 0.75, step * 0.92));
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
    this.C.sliced(geo, this.C.keep(toonMaterial()), items);
  }

  private trees(from: number, to: number, seed: number): void {
    const rnd = new Prng(seed * 31 + 7);
    const n = Math.round(((to - from) / 6) * this.env.trees);
    const trunkGeo = this.C.keep(new THREE.CylinderGeometry(0.18, 0.25, 1.6, 5));
    trunkGeo.translate(0, 0.8, 0);
    const leafGeo = this.C.keep(new THREE.ConeGeometry(1.4, 3.6, 6));
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
    this.C.sliced(trunkGeo, this.C.keep(toonMaterial({ color: this.env.trunk })), items.map(({ z, m }) => ({ z, m })));
    this.C.sliced(leafGeo, this.C.keep(toonMaterial({ color: 0xffffff })), items);
  }

  /** Crash-test target boards on poles, every 120 m on alternating sides. */
  private signs(from: number, to: number): void {
    const n = Math.ceil((to - from) / 120);
    const poleGeo = this.C.keep(new THREE.BoxGeometry(0.2, 4, 0.2));
    poleGeo.translate(0, 2, 0);
    const boardGeo = this.C.keep(new THREE.PlaneGeometry(3.2, 3.2));
    boardGeo.translate(0, 5.2, 0);
    const poles = new THREE.InstancedMesh(poleGeo, this.C.keep(toonMaterial({ color: 0x2a2a2e })), n * 2);
    const board = new THREE.InstancedMesh(boardGeo, this.C.keep(new THREE.MeshBasicMaterial({ map: this.C.keep(testSymbolTexture()), side: THREE.DoubleSide })), n);
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
    this.C.add(poles, board);
  }

  /** Shortcut trails: a dirt track behind the barrier with tyre stacks along its far side. */
  private trails(): void {
    if (this.R.cuts.length === 0) return;
    const mat = this.C.keep(new THREE.MeshLambertMaterial({ color: this.env.dirt }));
    const tyre = this.C.keep(new THREE.CylinderGeometry(0.42, 0.42, 0.75, 10));
    tyre.translate(0, 0.375, 0);
    const spots: [number, number][] = [];
    for (const c of this.R.cuts) {
      const xs = c.side > 0 ? [ROAD_HALF + 0.9, CUT.outer + 0.9] : [-CUT.outer - 0.9, -ROAD_HALF - 0.9];
      this.C.add(new THREE.Mesh(this.C.strip(c.z0 - 4, c.z1 + 4, xs, () => 0.015), mat));
      for (let z = c.z0 + CUT.gap; z <= c.z1 - CUT.merge; z += 3) spots.push([c.side * (CUT.outer + 1.1), z]);
    }
    const tyres = new THREE.InstancedMesh(tyre, this.C.keep(toonMaterial({ color: 0x26262b })), spots.length);
    const o = new THREE.Object3D();
    spots.forEach(([x, z], i) => {
      place(o, x, 0, z);
      o.updateMatrix();
      tyres.setMatrixAt(i, o.matrix);
    });
    this.C.add(tyres);
  }

  /** Ramps: yellow-and-black kickers in a lane, dirt mounds on the trails. */
  private ramps(): void {
    const road = this.C.keep(wedge(RAMP.halfW, RAMP_LOOK.roadL, RAMP_LOOK.roadH));
    const mound = this.C.keep(wedge(RAMP.trailHalfW, RAMP_LOOK.trailL, RAMP_LOOK.trailH));
    const stripes = this.C.keep(makeCanvasTexture(64, 64, (g, W, H) => {
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
    const roadMat = this.C.keep(new THREE.MeshLambertMaterial({ map: stripes }));
    const moundMat = this.C.keep(new THREE.MeshLambertMaterial({ color: new THREE.Color(this.env.dirt).multiplyScalar(0.85) }));
    for (const r of this.R.ramps) {
      const m = new THREE.Mesh(r.trail ? mound : road, r.trail ? moundMat : roadMat);
      place(m, r.x, 0, r.z);
      this.C.add(m);
    }
  }

  private gate(z: number, finish: boolean): void {
    const checker = this.C.keep(makeCanvasTexture(256, 32, (g, W, H) => {
      const s = H / 2;
      for (let x = 0; x < W / s; x++) for (let y = 0; y < 2; y++) {
        g.fillStyle = (x + y) % 2 ? '#111' : '#f4f4f0';
        g.fillRect(x * s, y * s, s, s);
      }
    }));
    const span = 2 * (ROAD_HALF + SHOULDER);
    const line = new THREE.Mesh(this.C.keep(new THREE.PlaneGeometry(span, 1.6)), this.C.keep(new THREE.MeshLambertMaterial({ map: checker })));
    line.rotation.x = -Math.PI / 2;
    const lineHolder = new THREE.Group();
    lineHolder.add(line);
    place(lineHolder, 0, 0.03, z);
    const mat = this.C.keep(toonMaterial({ color: finish ? 0xf2c230 : 0xdedede }));
    // 3.3.66: the posts stood on the barrier line, 0.3 m past the road's edge. Once they were being drawn
    // where they belong (see Chunks.seal), a player hugging the outside lane still had the near post
    // 1.5 m off axis and six metres tall in the opening frame. OUT is how far past the barrier they stand
    // now: at 2.6 m the nearest a post comes to the camera's axis at the line is 3.8 m over 20 m, which
    // puts it at the very edge of a portrait frustum rather than across the road ahead.
    const OUT = 2.6;
    const post = this.C.keep(new THREE.BoxGeometry(0.6, 6, 0.6));
    post.translate(0, 3, 0);
    const beam = new THREE.Mesh(this.C.keep(new THREE.BoxGeometry(span + 2 * OUT + 1.2, 1.4, 0.5)), this.C.keep(toonMaterial({ map: checker })));
    beam.position.y = 6.2;
    const g = new THREE.Group();
    const l = new THREE.Mesh(post, mat);
    const r = new THREE.Mesh(post, mat);
    l.position.x = span / 2 + OUT;
    r.position.x = -span / 2 - OUT;
    g.add(l, r, beam);
    place(g, 0, 0, z);
    this.C.add(lineHolder, g);
  }
}
