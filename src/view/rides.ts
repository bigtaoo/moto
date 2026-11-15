// Every ride in the garage (C.VEHICLES) as a kit of rounded parts, and where the dummy sits on it.
// Split out of rider.ts in 3.3.34, which had grown to twenty-one lines under the 500-line cap.

import * as THREE from 'three';
import { Kit } from './toon';
import { INK_W, JOINT, TARGET, rbox, ball } from './rider';

const TYRE = 0x232327;
const HUB = 0xa8aeb6;
const STEEL = 0x8c939c;
const wheel = (r: number, w: number) => new THREE.CylinderGeometry(r, r, w, 12).rotateZ(Math.PI / 2);
const PORCELAIN = 0xf1efe8;
const FLAME = 0xff8a2a;
const BRASS = 0xd4b04a;

/**
 * The ride as a kit, in `ride` colour where it has paint, and where the dummy sits: the hip height for
 * a seat, or null to stand on a deck at the scooter's height (feet at 0.23, hands on a bar at 1.18 by 0.5).
 */
export function buildRide(v: number, ride: number): { kit: Kit; seat: number | null } {
  const k = new Kit(INK_W);
  const caster = (x: number, z: number, r = 0.07, y = r) => k.add(wheel(r, r * 0.8), TYRE, { at: [x, y, z] });
  const pole = (r: number, a: [number, number, number], b: [number, number, number], color = STEEL) => {
    const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const len = d.length();
    const geo = new THREE.CylinderGeometry(r, r, len, 6);
    geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
    k.add(geo, color, { at: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2] });
  };
  switch (v) {
    case 1: {
      // shopping cart: stand on a footboard at the back, push the handle, the basket out in front
      k.add(rbox(0.66, 0.06, 0.06, 0.025), ride, { at: [0, 1.18, 0.5] });
      for (const x of [-0.3, 0.3]) {
        pole(0.018, [x, 1.16, 0.5], [x, 0.58, 0.58]);
        pole(0.018, [x, 0.55, 0.58], [x, 0.12, 0.58]);
        pole(0.018, [x, 0.55, 1.36], [x, 0.12, 1.36]);
        k.add(rbox(0.03, 0.46, 0.86, 0.01), STEEL, { at: [x, 0.8, 0.97] });
        caster(x * 0.85, 0.58);
        caster(x * 0.85, 1.36);
        caster(x * 0.6, -0.2, 0.06);
      }
      k.add(rbox(0.63, 0.03, 0.86, 0.01), STEEL, { at: [0, 0.56, 0.97] })
        .add(rbox(0.63, 0.46, 0.03, 0.01), STEEL, { at: [0, 0.8, 1.39] })
        .add(rbox(0.63, 0.4, 0.03, 0.01), STEEL, { at: [0, 0.83, 0.56] })
        .add(rbox(0.52, 0.03, 0.78, 0.01), STEEL, { at: [0, 0.2, 0.97] })
        .add(rbox(0.34, 0.04, 0.44, 0.015), ride, { at: [0, 0.21, -0.04] });
      for (const z of [0.72, 0.9, 1.08, 1.26]) k.add(rbox(0.65, 0.02, 0.02, 0.008), JOINT, { at: [0, 0.82, z], ink: false });
      pole(0.02, [-0.12, 0.2, 0.15], [-0.12, 0.2, 0.58]);
      pole(0.02, [0.12, 0.2, 0.15], [0.12, 0.2, 0.58]);
      return { kit: k, seat: null };
    }
    case 2: {
      // office chair: five-star base on casters, gas lift, seat, back and arms
      k.add(rbox(0.5, 0.1, 0.48, 0.04), ride, { at: [0, 0.53, 0] })
        .add(rbox(0.46, 0.56, 0.08, 0.04), ride, { at: [0, 0.98, -0.31], rot: [-0.1, 0, 0] })
        .add(rbox(0.08, 0.36, 0.05, 0.02), JOINT, { at: [0, 0.62, -0.28] })
        .add(new THREE.CylinderGeometry(0.04, 0.04, 0.3, 8), STEEL, { at: [0, 0.34, 0] })
        .add(new THREE.CylinderGeometry(0.06, 0.06, 0.08, 8), JOINT, { at: [0, 0.18, 0] });
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 + 0.3;
        const x = Math.sin(a) * 0.3;
        const z = Math.cos(a) * 0.3;
        k.add(rbox(0.05, 0.04, 0.32, 0.015), JOINT, { at: [x / 2, 0.14, z / 2], rot: [0, a, 0] });
        caster(x, z, 0.05);
      }
      for (const x of [-0.29, 0.29]) {
        k.add(rbox(0.06, 0.04, 0.3, 0.015), JOINT, { at: [x, 0.8, 0.02] })
          .add(rbox(0.04, 0.22, 0.04, 0.01), JOINT, { at: [x, 0.68, -0.06] });
      }
      return { kit: k, seat: 0.62 };
    }
    case 3: {
      // mobility scooter: a long tub on four wheels, a tiller, a padded seat, a basket and a flag
      k.add(rbox(0.6, 0.18, 1.3, 0.07), ride, { at: [0, 0.3, 0.12] })
        .add(rbox(0.56, 0.36, 0.36, 0.1), ride, { at: [0, 0.48, 0.66] })
        .add(rbox(0.5, 0.12, 0.46, 0.05), JOINT, { at: [0, 0.6, -0.08] })
        .add(rbox(0.46, 0.46, 0.1, 0.05), JOINT, { at: [0, 0.92, -0.36] })
        .add(new THREE.CylinderGeometry(0.05, 0.05, 0.3, 8), STEEL, { at: [0, 0.45, -0.08] })
        .add(rbox(0.4, 0.22, 0.24, 0.02), STEEL, { at: [0, 0.78, 0.92] })
        .add(new THREE.CylinderGeometry(0.03, 0.03, 0.62, 8).rotateZ(Math.PI / 2), STEEL, { at: [0, 1.0, 0.5] })
        .add(new THREE.CircleGeometry(0.05, 8), 0xfff4c0, { at: [0, 0.52, 0.845], ink: false });
      pole(0.035, [0, 0.62, 0.74], [0, 1.0, 0.52]);
      for (const x of [-0.3, 0.3]) for (const z of [-0.36, 0.62]) caster(x, z, 0.16);
      pole(0.012, [-0.24, 0.38, -0.5], [-0.24, 1.75, -0.56]);
      k.add(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -0.2, 0), new THREE.Vector3(0, -0.1, -0.3)]).toNonIndexed(),
        FLAME, { at: [-0.24, 1.75, -0.56], ink: false });
      return { kit: k, seat: 0.72 };
    }
    case 4: {
      // toilet rocket: bowl and seat, the tank as the backrest, a booster underneath with its flame
      k.add(new THREE.CylinderGeometry(0.27, 0.19, 0.4, 14), PORCELAIN, { at: [0, 0.36, 0.08], scale: [0.9, 1, 1.15] })
        .add(new THREE.TorusGeometry(0.22, 0.045, 6, 16).rotateX(Math.PI / 2), ride, { at: [0, 0.58, 0.08], scale: [0.9, 1, 1.15] })
        .add(rbox(0.5, 0.46, 0.2, 0.06), PORCELAIN, { at: [0, 0.84, -0.36] })
        .add(rbox(0.54, 0.05, 0.24, 0.02), ride, { at: [0, 1.08, -0.36] })
        .add(rbox(0.08, 0.03, 0.03, 0.01), STEEL, { at: [0.2, 0.98, -0.25], ink: false })
        .add(new THREE.CylinderGeometry(0.16, 0.16, 0.8, 12).rotateX(Math.PI / 2), STEEL, { at: [0, 0.22, -0.3] })
        .add(new THREE.CylinderGeometry(0.12, 0.17, 0.18, 12).rotateX(Math.PI / 2), JOINT, { at: [0, 0.22, -0.78] })
        .add(new THREE.ConeGeometry(0.12, 0.55, 10).rotateX(-Math.PI / 2), FLAME, { at: [0, 0.22, -1.14], ink: false })
        .add(new THREE.ConeGeometry(0.06, 0.32, 8).rotateX(-Math.PI / 2), 0xfff0a0, { at: [0, 0.22, -1.0], ink: false });
      for (const x of [-0.22, 0.22]) caster(x, 0.3, 0.09);
      caster(0, -0.62, 0.08);
      return { kit: k, seat: 0.62 };
    }
    case 5: {
      // jet bathtub: a clawfoot tub full of water (the dummy sits in it), a jet engine strapped on behind
      k.add(rbox(0.82, 0.52, 1.5, 0.2), PORCELAIN, { at: [0, 0.5, 0.06] })
        .add(rbox(0.86, 0.06, 1.54, 0.03), ride, { at: [0, 0.76, 0.06] })
        .add(rbox(0.68, 0.02, 1.34, 0.01), 0x6ec6f0, { at: [0, 0.795, 0.06], ink: false })
        .add(new THREE.CylinderGeometry(0.2, 0.25, 0.8, 12).rotateX(Math.PI / 2), STEEL, { at: [0, 0.62, -0.98] })
        .add(new THREE.CylinderGeometry(0.15, 0.15, 0.02, 12).rotateX(Math.PI / 2), JOINT, { at: [0, 0.62, -0.57], ink: false })
        .add(new THREE.ConeGeometry(0.17, 0.7, 10).rotateX(-Math.PI / 2), FLAME, { at: [0, 0.62, -1.73], ink: false })
        .add(new THREE.ConeGeometry(0.08, 0.4, 8).rotateX(-Math.PI / 2), 0xfff0a0, { at: [0, 0.62, -1.55], ink: false })
        .add(ball(0.07), TARGET, { at: [0.26, 0.86, 0.66] })
        .add(ball(0.045), TARGET, { at: [0.26, 0.95, 0.7] })
        .add(rbox(0.04, 0.02, 0.05, 0.01), FLAME, { at: [0.26, 0.95, 0.75], ink: false });
      pole(0.025, [0, 0.76, 0.76], [0, 0.98, 0.76]);
      pole(0.025, [0, 0.98, 0.76], [0, 0.95, 0.6]);
      for (const x of [-0.3, 0.3]) for (const z of [-0.5, 0.62]) k.add(ball(0.08), BRASS, { at: [x, 0.13, z], scale: [1, 1.4, 1] });
      return { kit: k, seat: 0.6 };
    }
    default: {
      // kick scooter
      k.add(rbox(0.26, 0.07, 0.98, 0.03), ride, { at: [0, 0.2, 0] })
        .add(rbox(0.2, 0.02, 0.7, 0.008), JOINT, { at: [0, 0.24, -0.04], ink: false })
        .add(new THREE.CylinderGeometry(0.038, 0.038, 1.0, 8), STEEL, { at: [0, 0.7, 0.44], rot: [-0.12, 0, 0] })
        .add(rbox(0.12, 0.12, 0.08, 0.03), ride, { at: [0, 1.0, 0.5], rot: [-0.12, 0, 0] })
        .add(new THREE.CircleGeometry(0.035, 8), 0xfff4c0, { at: [0, 1.0, 0.545], ink: false })
        .add(new THREE.CylinderGeometry(0.03, 0.03, 0.62, 8).rotateZ(Math.PI / 2), STEEL, { at: [0, 1.18, 0.5] });
      for (const x of [-0.27, 0.27]) k.add(new THREE.CylinderGeometry(0.042, 0.042, 0.13, 8).rotateZ(Math.PI / 2), JOINT, { at: [x, 1.18, 0.5] });
      for (const z of [-0.44, 0.47]) {
        k.add(wheel(0.15, 0.1), TYRE, { at: [0, 0.15, z] })
          .add(wheel(0.07, 0.11), HUB, { at: [0, 0.15, z], ink: false });
      }
      k.add(rbox(0.14, 0.04, 0.3, 0.015), ride, { at: [0, 0.31, -0.42], rot: [0.25, 0, 0] });
      return { kit: k, seat: null };
    }
  }
}
