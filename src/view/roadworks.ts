// The construction zones the sim puts on the road (Road.works): a warning sign well before each one, a line
// of cones tapering across the closed lane, and a road roller parked in it. Owns the cones after they are
// built, because they are the one thing on a course that moves -- a crash knocks the nearby ones flat.

import * as THREE from 'three';
import { ROAD_HALF, LANE_X, WORKS } from '../sim/config';
import type { Road } from '../sim/road';
import { place } from './road';
import { makeCanvasTexture } from './textures';
import { toonMaterial } from './toon';
import type { Chunks } from './chunks';

const spot = new THREE.Object3D();

/** The diamond ROAD WORKS board. */
function signTexture(): THREE.Texture {
  return makeCanvasTexture(128, 128, (g, W, H) => {
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
  });
}

/** Three chevrons pointing the way round the closed lane. */
function arrowTexture(): THREE.Texture {
  return makeCanvasTexture(128, 64, (g, W, H) => {
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
  });
}

/** One cone: orange with a white band, coloured through its vertices so they all share a material. */
function coneGeo(): THREE.BufferGeometry {
  const geo = new THREE.ConeGeometry(0.24, 0.75, 8);
  geo.translate(0, 0.375, 0);
  const pos = geo.getAttribute('position');
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const white = y > 0.32 && y < 0.5;
    col.set(white ? [0.96, 0.96, 0.94] : [0.98, 0.42, 0.08], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

export class Roadworks {
  private cones: THREE.InstancedMesh | null = null;
  private at: { x: number; z: number; down: boolean }[] = [];

  /** Builds every zone `R` has into `C`; a road with no works builds nothing. */
  constructor(R: Road, C: Chunks) {
    if (R.works.length === 0) return;
    for (const w of R.works) {
      for (let z = w.z0 - WORKS.taper; z <= w.z1 + WORKS.out; z += 2.5) this.at.push({ x: R.worksHi(z) + 0.3, z, down: false });
      // and across the closed lane where the taper starts
      for (let x = LANE_X[3] - 1.2; x <= ROAD_HALF; x += 1.2) this.at.push({ x, z: w.z0 - WORKS.taper - 3, down: false });
    }
    const mesh = new THREE.InstancedMesh(C.keep(coneGeo()), C.keep(toonMaterial({ vertexColors: true })), this.at.length);
    const o = new THREE.Object3D();
    this.at.forEach((c, i) => {
      place(o, c.x, 0, c.z);
      o.updateMatrix();
      mesh.setMatrixAt(i, o.matrix);
    });
    this.cones = mesh;
    C.add(mesh);
    const signGeo = C.keep(new THREE.PlaneGeometry(1.6, 1.6));
    signGeo.translate(0, 2.4, 0);
    const arrowGeo = C.keep(new THREE.PlaneGeometry(2.2, 1.1));
    arrowGeo.translate(0, 1.1, 0);
    const pole = C.keep(new THREE.BoxGeometry(0.12, 1.8, 0.12));
    pole.translate(0, 0.9, 0);
    const signMat = C.keep(new THREE.MeshBasicMaterial({ map: C.keep(signTexture()), transparent: true, alphaTest: 0.5, side: THREE.DoubleSide, forceSinglePass: true }));
    const arrowMat = C.keep(new THREE.MeshBasicMaterial({ map: C.keep(arrowTexture()), side: THREE.DoubleSide }));
    const poleMat = C.keep(toonMaterial({ color: 0x2a2a2e }));
    // a road roller parked in the closed lane
    const yellow = C.keep(toonMaterial({ color: 0xf2b630 }));
    const dark = C.keep(toonMaterial({ color: 0x35353a }));
    const body = C.keep(new THREE.BoxGeometry(1.6, 1.3, 3));
    body.translate(0, 1.15, 0);
    const cab = C.keep(new THREE.BoxGeometry(1.4, 1, 1.2));
    cab.translate(0, 2.3, -0.6);
    const drum = C.keep(new THREE.CylinderGeometry(0.75, 0.75, 1.7, 12));
    drum.rotateZ(Math.PI / 2);
    for (const w of R.works) {
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
      C.add(s, a, roller);
    }
  }

  /** Knock over the cones near a crash at sim (x, z). */
  scatter(x: number, z: number, rnd: () => number): void {
    const m = this.cones;
    if (!m) return;
    const o = spot;
    let any = false;
    this.at.forEach((c, i) => {
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
}
