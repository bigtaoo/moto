// What each division's roadside hazard looks like (cows, tumbleweeds, leaves, ice, a burst hydrant), and the
// oil slicks poured from the oil can. Built from parts like everything else; the sim decides where they are.

import * as THREE from 'three';
import type { World } from '../sim/world';
import type { Hazard } from '../sim/types';
import { HAZARD as H, OIL } from '../sim/fun';
import { spraying } from '../sim/hazards';
import { ROAD_HALF } from '../sim/config';
import { place } from './track';
import { rbox, ball } from './rider';
import { Kit, cached, kitMaterial, toonMaterial } from './toon';

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const o = new THREE.Object3D();

/** A black-and-white cow, front +z, standing on y = 0. */
function cowGeo(): THREE.BufferGeometry {
  return cached('cow', () => {
    const k = new Kit(0.03)
      .add(rbox(0.9, 0.75, 1.7, 0.22), 0xf4f1ea, { at: [0, 1.05, 0] })
      .add(rbox(0.5, 0.5, 0.62, 0.15), 0xf4f1ea, { at: [0, 1.32, 1.05] })
      .add(rbox(0.44, 0.3, 0.26, 0.1), 0xf2a6a6, { at: [0, 1.2, 1.4] })
      .add(rbox(0.36, 0.3, 0.4, 0.1), 0x24242a, { at: [0.32, 1.25, -0.2], ink: false })
      .add(rbox(0.3, 0.36, 0.5, 0.1), 0x24242a, { at: [-0.3, 1.0, 0.35], ink: false })
      .add(rbox(0.25, 0.25, 0.3, 0.08), 0x24242a, { at: [0.2, 1.5, 1.05], ink: false })
      .add(rbox(0.3, 0.2, 0.3, 0.08), 0xf2a6a6, { at: [0, 0.68, -0.35] });
    for (const s of [-1, 1]) {
      k.add(new THREE.ConeGeometry(0.06, 0.2, 6), 0xe8dcb8, { at: [s * 0.2, 1.65, 1.0], rot: [0, 0, -s * 0.5] })
        .add(rbox(0.22, 0.08, 0.12, 0.03), 0x24242a, { at: [s * 0.32, 1.45, 0.95], ink: false })
        .add(ball(0.05), 0x111114, { at: [s * 0.2, 1.42, 1.34], ink: false });
      for (const z of [-0.6, 0.6]) k.add(rbox(0.18, 0.7, 0.18, 0.06), 0xf4f1ea, { at: [s * 0.28, 0.35, z] }).add(rbox(0.2, 0.12, 0.2, 0.04), 0x2a2622, { at: [s * 0.28, 0.06, z] });
    }
    k.add(new THREE.CylinderGeometry(0.03, 0.03, 0.6, 5), 0x24242a, { at: [0, 0.95, -0.95], rot: [0.4, 0, 0], ink: false });
    return k.build();
  });
}

/** A tumbleweed: a loose ball of twigs, on y = 0. */
function weedGeo(): THREE.BufferGeometry {
  return cached('weed', () => {
    const k = new Kit(0.02);
    const r = H.weed.r;
    k.add(new THREE.IcosahedronGeometry(r * 0.8, 0), 0xb08a52, { at: [0, 0, 0] });
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      k.add(new THREE.TorusGeometry(r * 0.85, 0.025, 4, 10), i % 2 ? 0x9a7444 : 0xc49a5c, { rot: [a, a * 1.7, 0], ink: false });
    }
    return k.build();
  });
}

/** A red fire hydrant, on y = 0. */
function hydrantGeo(): THREE.BufferGeometry {
  return cached('hydrant', () => new Kit(0.025)
    .add(new THREE.CylinderGeometry(0.2, 0.24, 0.7, 12), 0xd8322a, { at: [0, 0.35, 0] })
    .add(ball(0.2, 12), 0xd8322a, { at: [0, 0.72, 0] })
    .add(new THREE.CylinderGeometry(0.09, 0.09, 0.5, 8).rotateZ(Math.PI / 2), 0xb0241e, { at: [0, 0.52, 0] })
    .add(new THREE.CylinderGeometry(0.28, 0.28, 0.08, 12), 0xb0241e, { at: [0, 0.04, 0] })
    .build());
}

/** The spray: a cone from the hydrant's nozzle out across the road, +x along it. */
function sprayGeo(): THREE.BufferGeometry {
  return cached('spray', () => new THREE.ConeGeometry(0.9, H.hydrant.reach, 10, 1, true).translate(0, -H.hydrant.reach / 2, 0).rotateZ(Math.PI / 2));
}

interface View { root: THREE.Object3D; spin?: THREE.Object3D; spray?: THREE.Mesh }

export class HazardView {
  readonly group = new THREE.Group();
  private readonly views = new Map<number, View>();
  private readonly slicks = new Map<number, THREE.Mesh>();
  private readonly sprayMat = new THREE.MeshBasicMaterial({ color: 0xd8f0ff, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide });
  private readonly slickMat = new THREE.MeshBasicMaterial({ color: 0x14141c, transparent: true, opacity: 0.88, depthWrite: false });
  private readonly sheenMat = new THREE.MeshBasicMaterial({ color: 0x6a5aa8, transparent: true, opacity: 0.45, depthWrite: false });
  private t = 0;
  /** This race's own materials (freed with the race). */
  get materials(): THREE.Material[] { return [this.sprayMat, this.slickMat, this.sheenMat, ...this.own]; }
  private readonly own: THREE.Material[] = [];

  constructor(w: World) {
    const patches = w.hazards.filter((h) => h.kind === 'leaves' || h.kind === 'ice');
    if (patches.length) this.group.add(this.patchMesh(patches));
    for (const h of w.hazards) {
      if (h.kind === 'cow') this.add(h, { root: new THREE.Mesh(cowGeo(), kitMaterial()) });
      else if (h.kind === 'weed') {
        const spin = new THREE.Mesh(weedGeo(), kitMaterial());
        spin.position.y = H.weed.r;
        const root = new THREE.Group();
        root.add(spin);
        this.add(h, { root, spin });
      } else if (h.kind === 'hydrant') {
        const root = new THREE.Group();
        const spray = new THREE.Mesh(sprayGeo(), this.sprayMat);
        spray.position.y = 0.52;
        // +x of the cone is sim -side (towards the road): world x is sim -x
        spray.rotation.y = h.side > 0 ? 0 : Math.PI;
        root.add(new THREE.Mesh(hydrantGeo(), kitMaterial()), spray);
        place(root, h.x, 0, h.z);
        this.add(h, { root, spray });
      }
    }
  }

  private add(h: Hazard, v: View): void {
    this.views.set(h.id, v);
    this.group.add(v.root);
  }

  /** Every leaf or ice slab of every patch, in one instanced mesh, laid along the road's curve. */
  private patchMesh(ps: Hazard[]): THREE.InstancedMesh {
    const ice = ps[0].kind === 'ice';
    let rnd = 12345;
    const r = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647);
    const parts: { x: number; z: number; yaw: number; c: number }[] = [];
    for (const h of ps) {
      const len = H[h.kind as 'leaves' | 'ice'].len;
      if (ice) for (let z = 0; z < len; z += 2) parts.push({ x: h.cx, z: h.z + z + 1, yaw: 0, c: z % 4 ? 0xcfeeff : 0xe4f6ff });
      else for (let i = 0; i < len * 4; i++) parts.push({ x: h.cx + (r() - 0.5) * h.w, z: h.z + r() * len, yaw: r() * 6.3, c: [0xe2762a, 0xc8462a, 0xf0b23a, 0xa8562a][i % 4] });
    }
    const geo = ice ? new THREE.BoxGeometry(7, 0.03, 2.02) : new THREE.CircleGeometry(0.2, 5).rotateX(-Math.PI / 2).scale(1, 1, 0.65);
    const mat = toonMaterial(ice ? { transparent: true, opacity: 0.8 } : {});
    this.own.push(mat);
    const m = new THREE.InstancedMesh(geo, mat, parts.length);
    const c = new THREE.Color();
    parts.forEach((p, i) => {
      place(o, p.x, ice ? 0.02 : 0.03 + (i % 3) * 0.004, p.z, p.yaw);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
      m.setColorAt(i, c.setHex(p.c));
    });
    m.frustumCulled = false;
    return m;
  }

  update(w: World, dt: number, alpha: number): void {
    this.t += dt;
    for (const h of w.hazards) {
      const v = this.views.get(h.id);
      if (!v) continue;
      if (h.kind === 'cow') {
        const x = lerp(h.px, h.x, alpha);
        place(v.root, x, Math.abs(Math.sin(this.t * 5 + h.id)) * 0.05, h.z, -h.side * Math.PI / 2);
      } else if (h.kind === 'weed') {
        const x = Math.abs(h.x - h.px) > 2 ? h.x : lerp(h.px, h.x, alpha);
        v.root.visible = h.t === 0 && Math.abs(x) < ROAD_HALF + 1.8;
        place(v.root, x, Math.abs(Math.sin(this.t * 6 + h.id)) * 0.35, h.z);
        v.spin!.rotation.z = x / H.weed.r;
      } else if (h.kind === 'hydrant') {
        const on = spraying(w, h);
        v.spray!.visible = on;
        if (on) v.spray!.scale.set(0.9 + Math.random() * 0.15, 1 + Math.random() * 0.25, 1 + Math.random() * 0.25);
      }
    }
    const seen = new Set<number>();
    for (const s of w.slicks) {
      seen.add(s.id);
      let m = this.slicks.get(s.id);
      if (!m) {
        m = new THREE.Mesh(cached('slick', () => new THREE.CircleGeometry(1, 18).rotateX(-Math.PI / 2)), this.slickMat);
        const sheen = new THREE.Mesh(cached('sheen', () => new THREE.RingGeometry(0.3, 0.42, 14).rotateX(-Math.PI / 2)), this.sheenMat);
        sheen.position.set(0.15, 0.005, 0.1);
        m.add(sheen);
        m.scale.set(OIL.halfW, 1, OIL.halfZ);
        this.slicks.set(s.id, m);
        this.group.add(m);
      }
      place(m, s.x, 0.03, s.z);
      // pours out over a few frames
      const grow = Math.min(1, (OIL.life - s.t + 1) / 8);
      m.scale.set(OIL.halfW * 1.15 * grow, 1, OIL.halfZ * 1.15 * grow);
    }
    for (const [id, m] of this.slicks) if (!seen.has(id)) { m.removeFromParent(); this.slicks.delete(id); }
  }
}
