// A crash-test dummy on a kick scooter, built from boxes and spheres.
// Local axes: +z forward, +y up. Sim +x (screen right) is local -x, because the world mirrors x (track.ts).

import * as THREE from 'three';
import type { WeaponKind } from '../sim/config';
import { decalTexture } from './textures';

const JOINT = new THREE.MeshLambertMaterial({ color: 0x1c1c20 });
const TYRE = new THREE.MeshLambertMaterial({ color: 0x18181b });
const decalMat = () => new THREE.MeshBasicMaterial({ map: decalTexture(), transparent: true, depthWrite: false });

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const geo = {
  deck: box(0.24, 0.06, 0.95),
  stem: box(0.06, 1.0, 0.06),
  bar: box(0.62, 0.06, 0.06),
  wheel: new THREE.CylinderGeometry(0.13, 0.13, 0.08, 10).rotateZ(Math.PI / 2),
  leg: box(0.14, 0.84, 0.15),
  foot: box(0.14, 0.08, 0.26),
  pelvis: box(0.36, 0.2, 0.24),
  torso: box(0.42, 0.52, 0.26),
  head: new THREE.SphereGeometry(0.16, 12, 9),
  neck: new THREE.CylinderGeometry(0.05, 0.05, 0.12, 6),
  joint: new THREE.SphereGeometry(0.075, 8, 6),
  arm: box(0.1, 0.1, 0.62).translate(0, 0, 0.31),
  hand: new THREE.SphereGeometry(0.07, 8, 6),
  decal: new THREE.CircleGeometry(0.1, 16),
  pan: new THREE.CylinderGeometry(0.19, 0.17, 0.05, 14),
  handle: box(0.04, 0.04, 0.32),
  bat: new THREE.CylinderGeometry(0.055, 0.03, 0.8, 8).rotateX(Math.PI / 2),
};

export function makeWeapon(kind: WeaponKind): THREE.Group {
  const g = new THREE.Group();
  if (kind === 'pan') {
    const pan = new THREE.Mesh(geo.pan, new THREE.MeshLambertMaterial({ color: 0x33363d }));
    pan.position.z = 0.42;
    pan.rotation.x = Math.PI / 2;
    const handle = new THREE.Mesh(geo.handle, new THREE.MeshLambertMaterial({ color: 0x7a4a2a }));
    handle.position.z = 0.12;
    g.add(pan, handle);
  } else {
    const bat = new THREE.Mesh(geo.bat, new THREE.MeshLambertMaterial({ color: 0xc89a5a }));
    bat.position.z = 0.4;
    g.add(bat);
  }
  return g;
}

export class RiderView {
  readonly root = new THREE.Group();
  /** Everything that leans with the rider. */
  private readonly lean = new THREE.Group();
  private readonly dummy = new THREE.Group();
  private readonly scooter = new THREE.Group();
  private readonly arms: [THREE.Group, THREE.Group]; // [sim left, sim right]
  private readonly hands: [THREE.Object3D, THREE.Object3D];
  private readonly torso = new THREE.Group();
  private readonly wheels: THREE.Mesh[] = [];
  readonly bodyMat: THREE.MeshLambertMaterial;
  private weapon: THREE.Group | null = null;
  private weaponKind: WeaponKind | null = null;
  private swingT = 0;
  private swingSide: 1 | -1 = 1;
  private flash = 0;
  private bank = 0;
  private down = false;
  private tip = 0;

  constructor(readonly body: number, ride: number) {
    this.bodyMat = new THREE.MeshLambertMaterial({ color: body, emissive: 0xffffff, emissiveIntensity: 0 });
    const rideMat = new THREE.MeshLambertMaterial({ color: ride });
    // scooter
    const deck = new THREE.Mesh(geo.deck, rideMat);
    deck.position.y = 0.2;
    const stem = new THREE.Mesh(geo.stem, rideMat);
    stem.position.set(0, 0.7, 0.44);
    stem.rotation.x = -0.12;
    const bar = new THREE.Mesh(geo.bar, JOINT);
    bar.position.set(0, 1.18, 0.5);
    for (const z of [-0.42, 0.46]) {
      const w = new THREE.Mesh(geo.wheel, TYRE);
      w.position.set(0, 0.13, z);
      this.wheels.push(w);
      this.scooter.add(w);
    }
    this.scooter.add(deck, stem, bar);
    // dummy
    const m = this.bodyMat;
    for (const x of [-0.1, 0.1]) {
      const leg = new THREE.Mesh(geo.leg, m);
      leg.position.set(x, 0.66, -0.08);
      const knee = new THREE.Mesh(geo.joint, JOINT);
      knee.position.set(x, 0.66, -0.01);
      const foot = new THREE.Mesh(geo.foot, JOINT);
      foot.position.set(x, 0.27, -0.02);
      this.dummy.add(leg, knee, foot);
    }
    const pelvis = new THREE.Mesh(geo.pelvis, m);
    pelvis.position.set(0, 1.1, -0.08);
    this.torso.position.set(0, 1.18, -0.06);
    this.torso.rotation.x = 0.18;
    const chest = new THREE.Mesh(geo.torso, m);
    chest.position.y = 0.26;
    const chestDecal = new THREE.Mesh(geo.decal, decalMat());
    chestDecal.position.set(0, 0.32, 0.135);
    const neck = new THREE.Mesh(geo.neck, JOINT);
    neck.position.y = 0.58;
    const head = new THREE.Mesh(geo.head, m);
    head.position.y = 0.72;
    for (const s of [-1, 1]) {
      const d = new THREE.Mesh(geo.decal, decalMat());
      d.scale.setScalar(0.7);
      d.position.set(s * 0.161, 0.74, 0);
      d.rotation.y = (s * Math.PI) / 2;
      this.torso.add(d);
    }
    this.torso.add(chest, chestDecal, neck, head);
    const mkArm = (simSide: 1 | -1) => {
      const pivot = new THREE.Group();
      pivot.position.set(-simSide * 0.26, 0.46, 0);
      const arm = new THREE.Mesh(geo.arm, m);
      const elbow = new THREE.Mesh(geo.joint, JOINT);
      elbow.position.z = 0.3;
      const hand = new THREE.Mesh(geo.hand, JOINT);
      hand.position.z = 0.63;
      pivot.add(arm, elbow, hand);
      this.torso.add(pivot);
      return [pivot, hand] as const;
    };
    const [l, lh] = mkArm(-1);
    const [r, rh] = mkArm(1);
    this.arms = [l, r];
    this.hands = [lh, rh];
    this.dummy.add(pelvis, this.torso);
    this.lean.add(this.scooter, this.dummy);
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
  update(dt: number, speed: number, lateral: number, rub = 0): void {
    for (const w of this.wheels) w.rotation.x += (speed * dt) / 0.13;
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
      this.bodyMat.emissiveIntensity = this.flash * 0.8;
    }
  }
}
