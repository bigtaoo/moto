// A crash-test dummy on a kick scooter, built in code from rounded parts (see toon.ts for the look).
// Each moving piece is one merged mesh: scooter, legs + pelvis, torso + head, and each arm. That is
// 5 draw calls per rider, outlines included.
// Local axes: +z forward, +y up. Sim +x (screen right) is local -x, because the world mirrors x (track.ts).

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { WeaponKind } from '../sim/config';
import { Kit, kitMaterial, toonMaterial } from './toon';

const JOINT = 0x34343c;
const TYRE = 0x232327;
const HUB = 0xa8aeb6;
const STEEL = 0x8c939c;
const TARGET = 0xf4d23c;
const INK_W = 0.024;

const rbox = (w: number, h: number, d: number, r = Math.min(w, h, d) * 0.3) => new RoundedBoxGeometry(w, h, d, 1, r);
const ball = (r: number, seg = 8) => new THREE.SphereGeometry(r, seg, Math.round(seg * 0.75));
/** A capsule along z. */
const rod = (r: number, len: number) => new THREE.CapsuleGeometry(r, Math.max(0.001, len - 2 * r), 2, 8).rotateX(Math.PI / 2);
const wheel = (r: number, w: number) => new THREE.CylinderGeometry(r, r, w, 12).rotateZ(Math.PI / 2);

const weaponGeo = new Map<WeaponKind, THREE.BufferGeometry>();

/** A weapon as held: the grip at the origin, pointing along +z. */
export function makeWeapon(kind: WeaponKind): THREE.Group {
  let geo = weaponGeo.get(kind);
  if (!geo) {
    const k = new Kit(0.02);
    if (kind === 'pan') {
      k.add(new THREE.CylinderGeometry(0.2, 0.17, 0.06, 14), 0x3a3e46, { at: [0, 0, 0.44], rot: [Math.PI / 2, 0, 0] })
        .add(new THREE.CylinderGeometry(0.15, 0.15, 0.065, 14), 0x5a606a, { at: [0, 0, 0.44], rot: [Math.PI / 2, 0, 0], ink: false })
        .add(rbox(0.05, 0.05, 0.34), 0x7a4a2a, { at: [0, 0, 0.12] });
    } else {
      k.add(new THREE.CylinderGeometry(0.06, 0.032, 0.82, 10).rotateX(Math.PI / 2), 0xd0a060, { at: [0, 0, 0.4] })
        .add(new THREE.CylinderGeometry(0.036, 0.036, 0.16, 8).rotateX(Math.PI / 2), 0x2a2a30, { at: [0, 0, 0.06], ink: false });
    }
    weaponGeo.set(kind, (geo = k.build()));
  }
  const g = new THREE.Group();
  g.add(new THREE.Mesh(geo, kitMaterial()));
  return g;
}

export class RiderView {
  readonly root = new THREE.Group();
  /** Everything that leans with the rider. */
  private readonly lean = new THREE.Group();
  private readonly dummy = new THREE.Group();
  private readonly arms: [THREE.Group, THREE.Group]; // [sim left, sim right]
  private readonly hands: [THREE.Object3D, THREE.Object3D];
  private readonly torso = new THREE.Group();
  /** Vertex-coloured toon material for this rider (and its ragdoll); its emissive is the hit flash. */
  readonly mat: THREE.MeshToonMaterial;
  private weapon: THREE.Group | null = null;
  private weaponKind: WeaponKind | null = null;
  private swingT = 0;
  private swingSide: 1 | -1 = 1;
  private flash = 0;
  private bank = 0;
  private down = false;
  private tip = 0;

  constructor(readonly body: number, ride: number) {
    this.mat = toonMaterial({ vertexColors: true, emissive: 0xffffff, emissiveIntensity: 0 });
    const mesh = (k: Kit) => new THREE.Mesh(k.build(), this.mat);

    // scooter
    const sc = new Kit(INK_W)
      .add(rbox(0.26, 0.07, 0.98, 0.03), ride, { at: [0, 0.2, 0] })
      .add(rbox(0.2, 0.02, 0.7, 0.008), JOINT, { at: [0, 0.24, -0.04], ink: false })
      .add(new THREE.CylinderGeometry(0.038, 0.038, 1.0, 8), STEEL, { at: [0, 0.7, 0.44], rot: [-0.12, 0, 0] })
      .add(rbox(0.12, 0.12, 0.08, 0.03), ride, { at: [0, 1.0, 0.5], rot: [-0.12, 0, 0] })
      .add(new THREE.CircleGeometry(0.035, 8), 0xfff4c0, { at: [0, 1.0, 0.545], ink: false })
      .add(new THREE.CylinderGeometry(0.03, 0.03, 0.62, 8).rotateZ(Math.PI / 2), STEEL, { at: [0, 1.18, 0.5] });
    for (const x of [-0.27, 0.27]) sc.add(new THREE.CylinderGeometry(0.042, 0.042, 0.13, 8).rotateZ(Math.PI / 2), JOINT, { at: [x, 1.18, 0.5] });
    for (const z of [-0.44, 0.47]) {
      sc.add(wheel(0.15, 0.1), TYRE, { at: [0, 0.15, z] })
        .add(wheel(0.07, 0.11), HUB, { at: [0, 0.15, z], ink: false });
    }
    sc.add(rbox(0.14, 0.04, 0.3, 0.015), ride, { at: [0, 0.31, -0.42], rot: [0.25, 0, 0] });

    // legs and pelvis
    const legs = new Kit(INK_W);
    for (const x of [-0.11, 0.11]) {
      legs.add(rod(0.08, 0.44), body, { at: [x, 0.88, -0.08], rot: [Math.PI / 2, 0, 0] })
        .add(rod(0.07, 0.42), body, { at: [x, 0.45, -0.04], rot: [Math.PI / 2, 0, 0] })
        .add(ball(0.072), JOINT, { at: [x, 0.66, -0.03], ink: false })
        .add(rbox(0.15, 0.1, 0.28, 0.04), JOINT, { at: [x, 0.28, 0] });
    }
    legs.add(rbox(0.4, 0.22, 0.27), ride, { at: [0, 1.1, -0.08] });

    // torso, neck and head, in the torso pivot's frame
    this.torso.position.set(0, 1.18, -0.06);
    this.torso.rotation.x = 0.18;
    const top = new Kit(INK_W)
      .add(rbox(0.46, 0.54, 0.29, 0.09), body, { at: [0, 0.27, 0] })
      .add(rbox(0.48, 0.06, 0.31, 0.02), JOINT, { at: [0, 0.06, 0], ink: false })
      .add(new THREE.CylinderGeometry(0.055, 0.065, 0.14, 8), JOINT, { at: [0, 0.59, 0], ink: false })
      .add(ball(0.175, 12), body, { at: [0, 0.76, 0.01], scale: [0.95, 1.06, 1] })
      .decal(0.085, TARGET, { at: [0, 0.34, 0.151] })
      .decal(0.085, TARGET, { at: [0, 0.34, -0.151], rot: [0, Math.PI, 0] });
    for (const s of [-1, 1]) top.decal(0.06, TARGET, { at: [s * 0.172, 0.77, 0.01], rot: [0, (s * Math.PI) / 2, 0] });
    this.torso.add(mesh(top));

    const mkArm = (simSide: 1 | -1) => {
      const pivot = new THREE.Group();
      pivot.position.set(-simSide * 0.27, 0.46, 0);
      const arm = new Kit(INK_W)
        .add(ball(0.075), JOINT, { ink: false })
        .add(rod(0.06, 0.32), body, { at: [0, 0, 0.16] })
        .add(ball(0.062), JOINT, { at: [0, 0, 0.32], ink: false })
        .add(rod(0.055, 0.3), body, { at: [0, 0, 0.47] })
        .add(ball(0.078), JOINT, { at: [0, 0, 0.64] });
      const hand = new THREE.Object3D();
      hand.position.z = 0.64;
      pivot.add(mesh(arm), hand);
      this.torso.add(pivot);
      return [pivot, hand] as const;
    };
    const [l, lh] = mkArm(-1);
    const [r, rh] = mkArm(1);
    this.arms = [l, r];
    this.hands = [lh, rh];
    this.dummy.add(mesh(legs), this.torso);
    this.lean.add(mesh(sc), this.dummy);
    this.root.add(this.lean);
    this.restArms();
  }

  private restArms(): void {
    for (const [i, a] of this.arms.entries()) a.rotation.set(0.55, (i ? 1 : -1) * 0.12, 0, 'YXZ');
  }

  setWeapon(kind: WeaponKind | null): void {
    if (kind === this.weaponKind) return;
    this.weapon?.removeFromParent();
    this.weapon = kind ? makeWeapon(kind) : null;
    this.weaponKind = kind;
    if (this.weapon) this.hands[1].add(this.weapon);
  }

  swing(side: 1 | -1): void {
    this.swingT = 0.001;
    this.swingSide = side;
    if (this.weapon) this.hands[side === 1 ? 1 : 0].add(this.weapon);
  }

  hit(): void {
    this.flash = 1;
  }

  setDown(down: boolean): void {
    this.down = down;
    this.dummy.visible = !down;
    if (!down) this.tip = 0;
  }

  /** `rub` is the side (-1/1) of a rider being pressed shoulder to shoulder, 0 when clear. */
  update(dt: number, _speed: number, lateral: number, rub = 0): void {
    const target = this.down ? 0 : Math.max(-0.4, Math.min(0.4, lateral * 0.06 + rub * 0.24));
    this.bank += (target - this.bank) * Math.min(1, dt * 8);
    if (this.down) this.tip = Math.min(1.45, this.tip + dt * 5);
    this.lean.rotation.z = this.bank + this.tip;
    // Swing: wind out to the side, snap back.
    if (this.swingT > 0) {
      this.swingT += dt / 0.3;
      const p = this.swingT < 0.45 ? this.swingT / 0.45 : Math.max(0, 1 - (this.swingT - 0.45) / 0.55);
      const arm = this.arms[this.swingSide === 1 ? 1 : 0];
      arm.rotation.set(0.55 - 0.7 * p, -this.swingSide * 1.5 * p, 0, 'YXZ');
      this.torso.rotation.y = -this.swingSide * 0.35 * p;
      if (this.swingT >= 1) {
        this.swingT = 0;
        this.torso.rotation.y = 0;
        this.restArms();
        if (this.weapon) this.hands[1].add(this.weapon);
      }
    }
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt * 6);
      this.mat.emissiveIntensity = this.flash * 0.8;
    }
  }
}
