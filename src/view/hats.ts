// Hats for the dummy (src/shop.ts HATS) and the cup boss' crown, built from parts. Each sits on top of the
// head (y = 0 is the crown of the head, front +z) and wobbles a little on a spring as the rider moves.

import * as THREE from 'three';
import type { Hat } from '../shop';
import { rbox, ball } from './rider';
import { Kit, cached, kitMaterial } from './toon';

const cyl = (r1: number, r2: number, h: number, n = 14) => new THREE.CylinderGeometry(r1, r2, h, n);

function build(kind: Hat | 'crown'): THREE.BufferGeometry {
  const k = new Kit(0.018);
  switch (kind) {
    case 'cap':
      k.add(ball(0.19, 14).scale(1, 0.55, 1.05), 0x2f6fd8, { at: [0, -0.03, 0] })
        .add(cyl(0.16, 0.16, 0.02).scale(1, 1, 1.1), 0x2f6fd8, { at: [0, -0.06, 0.15] })
        .add(ball(0.025), 0xffffff, { at: [0, 0.075, 0], ink: false });
      break;
    case 'party':
      k.add(new THREE.ConeGeometry(0.13, 0.36, 14), 0xe8408a, { at: [0, 0.15, 0] })
        .add(new THREE.TorusGeometry(0.115, 0.02, 4, 14).rotateX(Math.PI / 2), 0xf4d23c, { at: [0, 0.05, 0], ink: false })
        .add(ball(0.045), 0x5fd0ff, { at: [0, 0.34, 0] });
      break;
    case 'top':
      k.add(cyl(0.26, 0.26, 0.025, 18), 0x1d1d24, { at: [0, -0.01, 0] })
        .add(cyl(0.15, 0.15, 0.32, 16), 0x1d1d24, { at: [0, 0.16, 0] })
        .add(cyl(0.152, 0.152, 0.06, 16), 0xc8322a, { at: [0, 0.04, 0], ink: false });
      break;
    case 'cowboy':
      k.add(cyl(0.34, 0.34, 0.025, 20).scale(1, 1, 0.85), 0x9a6a3a, { at: [0, -0.01, 0] })
        .add(rbox(0.26, 0.18, 0.3, 0.07), 0x9a6a3a, { at: [0, 0.08, 0] })
        .add(cyl(0.15, 0.15, 0.04, 14), 0x4a3020, { at: [0, 0.02, 0], ink: false });
      for (const s of [-1, 1]) k.add(rbox(0.06, 0.04, 0.6, 0.02), 0x9a6a3a, { at: [s * 0.3, 0.035, 0], rot: [0, 0, s * 0.5] });
      break;
    case 'viking':
      k.add(ball(0.2, 14).scale(1, 0.7, 1), 0x9aa2ac, { at: [0, -0.05, 0] })
        .add(new THREE.TorusGeometry(0.19, 0.025, 4, 16).rotateX(Math.PI / 2), 0xc8a040, { at: [0, -0.06, 0], ink: false });
      for (const s of [-1, 1]) {
        k.add(new THREE.ConeGeometry(0.05, 0.24, 8), 0xf0e6c8, { at: [s * 0.22, 0.06, 0], rot: [0, 0, -s * 0.9] })
          .add(new THREE.ConeGeometry(0.035, 0.14, 8), 0xf0e6c8, { at: [s * 0.29, 0.2, 0], rot: [0, 0, -s * 0.2] });
      }
      break;
    case 'cone':
      k.add(new THREE.ConeGeometry(0.17, 0.48, 14), 0xf26a1e, { at: [0, 0.22, 0] })
        .add(cyl(0.135, 0.15, 0.07, 14), 0xf6f6f0, { at: [0, 0.12, 0], ink: false })
        .add(rbox(0.36, 0.04, 0.36, 0.02), 0xf26a1e, { at: [0, -0.01, 0] });
      break;
    case 'crown':
      k.add(cyl(0.17, 0.15, 0.12, 16), 0xf2c230, { at: [0, 0.04, 0] });
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        k.add(new THREE.ConeGeometry(0.045, 0.12, 6), 0xf2c230, { at: [Math.sin(a) * 0.15, 0.15, Math.cos(a) * 0.15] })
          .add(ball(0.025), i % 2 ? 0xe23b3b : 0x3b7be2, { at: [Math.sin(a) * 0.165, 0.05, Math.cos(a) * 0.165], ink: false });
      }
      break;
    default:
      break;
  }
  return k.build();
}

/** A hat to put on a head (null: bare-headed). */
export function makeHat(kind: Hat | 'crown'): THREE.Object3D | null {
  if (kind === 'none') return null;
  return new THREE.Mesh(cached(`hat:${kind}`, () => build(kind)), kitMaterial());
}

/** A hat's wobble: a spring on its tilt, kicked by the head's sideways and forward jolts. */
export class Wobble {
  private x = 0;
  private z = 0;
  private vx = 0;
  private vz = 0;

  constructor(readonly hat: THREE.Object3D) {}

  /** `ax`, `az`: the head's acceleration this frame (any units: it is scaled down). */
  update(dt: number, ax: number, az: number): void {
    const h = Math.min(dt, 0.05);
    const k = 160;
    const c = 7;
    this.vx += (-k * this.x - c * this.vx - ax * 0.02) * h;
    this.vz += (-k * this.z - c * this.vz + az * 0.02) * h;
    this.x = Math.max(-0.6, Math.min(0.6, this.x + this.vx * h));
    this.z = Math.max(-0.6, Math.min(0.6, this.z + this.vz * h));
    this.hat.rotation.set(this.z, 0, this.x);
  }
}
