// A crash-test dummy on its ride (a kick scooter, or one of the garage's: C.VEHICLES), built in code
// from rounded parts (see toon.ts for the look). Each moving piece is one merged mesh: ride, legs +
// pelvis, torso + head, and each arm. That is 5 draw calls per rider, outlines included.
// Local axes: +z forward, +y up. Sim +x (screen right) is local -x, because the world mirrors x (track.ts).

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { WeaponKind } from '../sim/config';
import { Kit, kitMaterial, shared, toonMaterial } from './toon';

export const JOINT = 0x34343c;
const TYRE = 0x232327;
const HUB = 0xa8aeb6;
const STEEL = 0x8c939c;
export const TARGET = 0xf4d23c;
export const INK_W = 0.024;

export const rbox = (w: number, h: number, d: number, r = Math.min(w, h, d) * 0.3) => new RoundedBoxGeometry(w, h, d, 1, r);
export const ball = (r: number, seg = 8) => new THREE.SphereGeometry(r, seg, Math.round(seg * 0.75));
/** A capsule along z. */
export const rod = (r: number, len: number) => new THREE.CapsuleGeometry(r, Math.max(0.001, len - 2 * r), 2, 8).rotateX(Math.PI / 2);
const wheel = (r: number, w: number) => new THREE.CylinderGeometry(r, r, w, 12).rotateZ(Math.PI / 2);
const PORCELAIN = 0xf1efe8;
const FLAME = 0xff8a2a;
const BRASS = 0xd4b04a;

/**
 * The ride as a kit, in `ride` colour where it has paint, and where the dummy sits: the hip height for
 * a seat, or null to stand on a deck at the scooter's height (feet at 0.23, hands on a bar at 1.18 by 0.5).
 */
function buildRide(v: number, ride: number): { kit: Kit; seat: number | null } {
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
    weaponGeo.set(kind, (geo = shared(k.build())));
  }
  const g = new THREE.Group();
  g.add(new THREE.Mesh(geo, kitMaterial()));
  return g;
}

interface Parts { ride: THREE.BufferGeometry; legs: THREE.BufferGeometry; top: THREE.BufferGeometry; arm: THREE.BufferGeometry; torsoY: number }
const partsBuilt = new Map<string, Parts>();

/**
 * A rider's merged meshes, built once per ride and colours and kept across races (see `shared` in
 * toon.ts): the outlines make building them the dearest part of starting a race.
 */
function riderParts(vehicle: number, body: number, ride: number, mark: number): Parts {
  const key = `${vehicle}:${body}:${ride}:${mark}`;
  const done = partsBuilt.get(key);
  if (done) return done;
  const { kit: sc, seat } = buildRide(vehicle, ride);

  // legs and pelvis: standing on the deck, or sitting with the thighs forward and the shins down
  const legs = new Kit(INK_W);
  let torsoY: number;
  if (seat === null) {
    for (const x of [-0.11, 0.11]) {
      legs.add(rod(0.08, 0.44), body, { at: [x, 0.88, -0.08], rot: [Math.PI / 2, 0, 0] })
        .add(rod(0.07, 0.42), body, { at: [x, 0.45, -0.04], rot: [Math.PI / 2, 0, 0] })
        .add(ball(0.072), JOINT, { at: [x, 0.66, -0.03], ink: false })
        .add(rbox(0.15, 0.1, 0.28, 0.04), JOINT, { at: [x, 0.28, 0] });
    }
    legs.add(rbox(0.4, 0.22, 0.27), ride, { at: [0, 1.1, -0.08] });
    torsoY = 1.18;
  } else {
    const kn = seat + 0.03;
    for (const x of [-0.12, 0.12]) {
      legs.add(rod(0.08, 0.44), body, { at: [x, seat + 0.04, 0.12] })
        .add(ball(0.072), JOINT, { at: [x, kn, 0.34], ink: false })
        .add(rod(0.07, 0.42), body, { at: [x, kn - 0.2, 0.38], rot: [Math.PI / 2 - 0.12, 0, 0] })
        .add(rbox(0.15, 0.1, 0.28, 0.04), JOINT, { at: [x, kn - 0.42, 0.46] });
    }
    legs.add(rbox(0.4, 0.22, 0.27), ride, { at: [0, seat + 0.08, -0.08] });
    torsoY = seat + 0.16;
  }

  // torso, neck and head, in the torso pivot's frame
  const top = new Kit(INK_W)
    .add(rbox(0.46, 0.54, 0.29, 0.09), body, { at: [0, 0.27, 0] })
    .add(rbox(0.48, 0.06, 0.31, 0.02), JOINT, { at: [0, 0.06, 0], ink: false })
    .add(new THREE.CylinderGeometry(0.055, 0.065, 0.14, 8), JOINT, { at: [0, 0.59, 0], ink: false })
    .add(ball(0.175, 12), body, { at: [0, 0.76, 0.01], scale: [0.95, 1.06, 1] })
    .decal(0.085, mark, { at: [0, 0.34, 0.151] })
    .decal(0.085, mark, { at: [0, 0.34, -0.151], rot: [0, Math.PI, 0] });
  for (const s of [-1, 1]) top.decal(0.06, mark, { at: [s * 0.172, 0.77, 0.01], rot: [0, (s * Math.PI) / 2, 0] });

  // one arm, in its shoulder pivot's frame: both sides use it
  const arm = new Kit(INK_W)
    .add(ball(0.075), JOINT, { ink: false })
    .add(rod(0.06, 0.32), body, { at: [0, 0, 0.16] })
    .add(ball(0.062), JOINT, { at: [0, 0, 0.32], ink: false })
    .add(rod(0.055, 0.3), body, { at: [0, 0, 0.47] })
    .add(ball(0.078), JOINT, { at: [0, 0, 0.64] });

  const p = { ride: shared(sc.build()), legs: shared(legs.build()), top: shared(top.build()), arm: shared(arm.build()), torsoY };
  partsBuilt.set(key, p);
  return p;
}

let trail: THREE.BufferGeometry | null = null;
const trailGeo = () => (trail ??= shared(new THREE.RingGeometry(0.35, 1.5, 14, 1, Math.PI - 0.35, Math.PI / 2 + 0.75).rotateX(-Math.PI / 2)));

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
  /** Seconds the arm is held up before the whip (an AI rider's tell), and how long it has been up. */
  private holdT = 0;
  private holdFor = 0;
  /** The swoosh drawn along the swing, one per side (mirrored). */
  private readonly trail: THREE.Mesh;
  private readonly trailMat: THREE.MeshBasicMaterial;
  private flash = 0;
  /** Knock-back lean from a blow, as a spring, and its velocity. */
  private kick = 0;
  private kickV = 0;
  private squash = 0;
  private bank = 0;
  private down = false;
  private tip = 0;
  /** Down: the scooter slews round as it slides, towards this side. */
  private downSide: 1 | -1 = 1;
  /** Extra heading for the whole model (the slewed scooter), applied by the scene. */
  yaw = 0;
  /** Height of the torso pivot: lower when seated. */
  private readonly torsoY: number;

  /** `vehicle`: C.VEHICLES index of the ride drawn; `mark`: the colour of the target marks. */
  constructor(readonly body: number, readonly ride: number, readonly vehicle = 0, readonly mark = TARGET) {
    this.mat = toonMaterial({ vertexColors: true, emissive: 0xffffff, emissiveIntensity: 0 });
    const p = riderParts(vehicle, body, ride, mark);
    this.torsoY = p.torsoY;

    // torso, neck and head, in the torso pivot's frame
    this.torso.position.set(0, this.torsoY, -0.06);
    this.torso.rotation.x = 0.18;
    this.torso.add(new THREE.Mesh(p.top, this.mat));

    const mkArm = (simSide: 1 | -1) => {
      const pivot = new THREE.Group();
      pivot.position.set(-simSide * 0.27, 0.46, 0);
      const hand = new THREE.Object3D();
      hand.position.z = 0.64;
      pivot.add(new THREE.Mesh(p.arm, this.mat), hand);
      this.torso.add(pivot);
      return [pivot, hand] as const;
    };
    const [l, lh] = mkArm(-1);
    const [r, rh] = mkArm(1);
    this.arms = [l, r];
    this.hands = [lh, rh];
    // Swing swoosh: a flat arc round the right shoulder from in front out to the side, at hand height.
    // Flat, so one pass is enough even though it is see-through and two-sided.
    this.trailMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, forceSinglePass: true });
    this.trail = new THREE.Mesh(trailGeo(), this.trailMat);
    this.trail.visible = false;
    this.dummy.add(new THREE.Mesh(p.legs, this.mat), this.torso, this.trail);
    this.lean.add(new THREE.Mesh(p.ride, this.mat), this.dummy);
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

  /** `windup`: seconds from the swing starting to the blow landing (the player's is 4 ticks). */
  swing(side: 1 | -1, windup = 4 / 30): void {
    // the stock animation lands its blow 0.133 s in, 0.084 s of it raising the arm: hold the raise for the rest
    const hold = windup - 4 / 30;
    this.holdFor = hold > 0.02 ? hold + 0.084 : 0;
    this.holdT = 0;
    this.swingT = this.holdFor > 0 ? 0 : 0.001;
    this.swingSide = side;
    if (this.weapon) this.hands[side === 1 ? 1 : 0].add(this.weapon);
  }

  /** Struck from the other side and shoved towards `side`. */
  hit(side: 1 | -1 = 1, ko = false): void {
    this.flash = 1;
    this.kick = side * (ko ? 0.75 : 0.5);
    this.kickV = 0;
    this.squash = 1;
  }

  setDown(down: boolean, side: 1 | -1 = 1): void {
    this.down = down;
    this.downSide = side;
    this.dummy.visible = !down;
    if (!down) this.tip = this.yaw = 0;
  }

  /** `rub` is the side (-1/1) of a rider being pressed shoulder to shoulder, 0 when clear. */
  update(dt: number, _speed: number, lateral: number, rub = 0): void {
    const target = this.down ? 0 : Math.max(-0.4, Math.min(0.4, lateral * 0.06 + rub * 0.24));
    this.bank += (target - this.bank) * Math.min(1, dt * 8);
    if (this.down) {
      this.tip = Math.min(1.45, this.tip + dt * 5);
      this.yaw += (this.downSide * 0.9 - this.yaw) * Math.min(1, dt * 2.5);
    }
    // Swing (0.42 s): wind up across the body, whip out to the side (the sim lands the blow 4 ticks in,
    // late in the whip), follow through.
    const sw = this.swingSide;
    let twist = 0;
    let lunge = 0;
    if (this.holdFor > 0) {
      // the tell: the arm goes up high and back, and trembles
      this.holdT += dt;
      const k = easeOut(Math.min(1, this.holdT / (this.holdFor * 0.6)));
      const shake = Math.sin(this.holdT * 55) * 0.06 * k;
      this.arms[sw === 1 ? 1 : 0].rotation.set(0.55 - 1.55 * k + shake, sw * 0.75 * k, 0, 'YXZ');
      twist = sw * 0.55 * k;
      if (this.holdT >= this.holdFor) { this.holdFor = 0; this.swingT = 0.2; }
    } else if (this.swingT > 0) {
      this.swingT += dt / 0.42;
      const t = this.swingT;
      const arm = this.arms[sw === 1 ? 1 : 0];
      let ax: number, ay: number;
      if (t < 0.2) {
        const k = easeOut(t / 0.2);
        ax = 0.55 - 1.25 * k;
        ay = sw * 0.6 * k;
        twist = sw * 0.45 * k;
      } else if (t < 0.36) {
        const k = easeOut((t - 0.2) / 0.16);
        ax = -0.7 + 0.6 * k;
        ay = sw * (0.6 - 2.5 * k);
        twist = sw * (0.45 - 1.05 * k);
        lunge = k;
      } else {
        const k = easeInOut(Math.min(1, (t - 0.36) / 0.64));
        ax = -0.1 + 0.65 * k;
        ay = sw * (-1.9 + 2.02 * k);
        twist = sw * -0.6 * (1 - k);
        lunge = 1 - k;
      }
      arm.rotation.set(ax, ay, 0, 'YXZ');
      // swoosh: shown from the whip until shortly after, fading
      const tr = (t - 0.2) / 0.45;
      this.trail.visible = tr > 0 && tr < 1;
      if (this.trail.visible) {
        this.trailMat.opacity = 0.75 * (1 - tr) * Math.min(1, tr * 6);
        this.trail.position.set(-sw * 0.27, this.torsoY + 0.42, 0.02);
        this.trail.scale.set(sw, 1, 1);
        this.trail.rotation.y = twist;
      }
      if (t >= 1) {
        this.swingT = 0;
        this.trail.visible = false;
        this.restArms();
        if (this.weapon) this.hands[1].add(this.weapon);
      }
    }
    this.torso.rotation.y = twist;
    // knock-back: a stiff spring so the dummy rocks away from the blow and wobbles back
    this.kickV += (-170 * this.kick - 11 * this.kickV) * dt;
    this.kick += this.kickV * dt;
    this.squash = Math.max(0, this.squash - dt * 7);
    const sq = this.squash * this.squash;
    this.dummy.scale.set(1 + 0.16 * sq, 1 - 0.2 * sq, 1 + 0.16 * sq);
    this.torso.rotation.x = 0.18 - 0.4 * sq + 0.12 * lunge;
    this.lean.rotation.z = this.bank + this.tip + this.kick - sw * 0.12 * lunge;
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt * 6);
      this.mat.emissiveIntensity = this.flash * 0.8;
    }
  }
}

const easeOut = (t: number) => 1 - (1 - t) * (1 - t);
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t));
