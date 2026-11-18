// A crash-test dummy on its ride (a kick scooter, or one of the garage's: C.VEHICLES), built in code
// from rounded parts (see toon.ts for the look). Each moving piece (ride, legs + pelvis, torso + head, each
// arm) is a group posed as before, and all five are the bones of ONE skinned mesh: 1 draw call per rider,
// outlines included (it was 5, and riders were the biggest share of the phone budget).
// Local axes: +z forward, +y up. Sim +x (screen right) is local -x, because the world mirrors x (track.ts).

import * as THREE from 'three';
import type { WeaponKind } from '../sim/config';
import { Kit, cached, kitMaterial, prim, rigidMesh, rigidParts, roundedBox, shared, toonMaterial } from './toon';
import { Wobble } from './hats';

export const JOINT = 0x34343c;
export const TARGET = 0xf4d23c;
export const INK_W = 0.024;

export const rbox = (w: number, h: number, d: number, r = Math.min(w, h, d) * 0.3) => prim(`rb:${w},${h},${d},${r}`, () => roundedBox(w, h, d, r));
export const ball = (r: number, seg = 8) => new THREE.SphereGeometry(r, seg, Math.round(seg * 0.75));
/** A capsule along z. */
export const rod = (r: number, len: number) => new THREE.CapsuleGeometry(r, Math.max(0.001, len - 2 * r), 2, 8).rotateX(Math.PI / 2);

import { buildRide } from './rides';

const weaponGeo = new Map<WeaponKind, THREE.BufferGeometry>();

/** A weapon as held: the grip at the origin, pointing along +z. */
/** The head on its own (the ragdoll's, and the big-heads week's), centred on the origin. */
export function headKit(body: number, mark: number): Kit {
  const head = new Kit(INK_W).add(ball(0.175, 12), body, { scale: [0.95, 1.06, 1] });
  for (const s of [-1, 1]) head.decal(0.06, mark, { at: [s * 0.172, 0.01, 0], rot: [0, (s * Math.PI) / 2, 0] });
  return head;
}

export function makeWeapon(kind: WeaponKind): THREE.Group {
  let geo = weaponGeo.get(kind);
  if (!geo) {
    const k = new Kit(0.02);
    if (kind === 'pan') {
      k.add(new THREE.CylinderGeometry(0.2, 0.17, 0.06, 14), 0x3a3e46, { at: [0, 0, 0.44], rot: [Math.PI / 2, 0, 0] })
        .add(new THREE.CylinderGeometry(0.15, 0.15, 0.065, 14), 0x5a606a, { at: [0, 0, 0.44], rot: [Math.PI / 2, 0, 0], ink: false })
        .add(rbox(0.05, 0.05, 0.34), 0x7a4a2a, { at: [0, 0, 0.12] });
    } else if (kind === 'oil') {
      // an oil can, spout forward
      k.add(new THREE.CylinderGeometry(0.13, 0.13, 0.3, 12), 0x3f8a3a, { at: [0, 0, 0.2] })
        .add(new THREE.CylinderGeometry(0.135, 0.135, 0.05, 12), 0xd8c23a, { at: [0, 0.06, 0.2], ink: false })
        .add(new THREE.CylinderGeometry(0.02, 0.035, 0.32, 6), 0x9aa0a8, { at: [0, 0.2, 0.32], rot: [0.9, 0, 0] })
        .add(new THREE.TorusGeometry(0.08, 0.018, 4, 10, Math.PI), 0x2a2a30, { at: [0, 0.15, 0.13], rot: [0, Math.PI / 2, 0], ink: false });
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

/** The rider as one skinned geometry, bones: ride, legs, torso, left arm, right arm. `reach`: bounding radius about BODY_C. */
interface Parts { skin: THREE.BufferGeometry; reach: number; torsoY: number }
const BODY_C = new THREE.Vector3(0, 0.9, 0);
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

  const rideG = sc.build();
  const armG = arm.build();
  const rs = rideG.boundingSphere!;
  const p = { skin: shared(rigidParts([rideG, legs.build(), top.build(), armG, armG])), reach: Math.max(2.2, rs.center.distanceTo(BODY_C) + rs.radius), torsoY };
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
  /** The player's haymaker wind-up, 0..1 (set by the scene): the arm cocks back and shakes harder as it fills. */
  charge = 0;
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

    const mkArm = (simSide: 1 | -1) => {
      const pivot = new THREE.Group();
      pivot.position.set(-simSide * 0.27, 0.46, 0);
      const hand = new THREE.Object3D();
      hand.position.z = 0.64;
      pivot.add(hand);
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
    this.dummy.add(this.torso, this.trail);
    this.lean.add(this.dummy);
    const skin = rigidMesh(p.skin, this.mat, [this.lean, this.dummy, this.torso, l, r], new THREE.Sphere(BODY_C.clone(), p.reach));
    this.root.add(this.lean, skin);
    this.restArms();
  }

  private wobble: Wobble | null = null;
  private lastLat = 0;
  private lastSpeed = 0;

  /** A hat (wobbling on its spring) and a head `scale` times the size (the big-heads week, the boss' crown). */
  dress(hat: THREE.Object3D | null, scale = 1): void {
    if (!hat && scale === 1) return;
    // where the head is, in the torso's frame
    const g = new THREE.Group();
    g.position.set(0, 0.76, 0.01);
    if (scale !== 1) {
      g.add(new THREE.Mesh(cached(`rag-head:${this.body}:${this.mark}`, () => headKit(this.body, this.mark).build()), this.mat));
      g.scale.setScalar(scale);
    }
    if (hat) {
      hat.position.y = 0.17;
      g.add(hat);
      this.wobble = new Wobble(hat);
    }
    this.torso.add(g);
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
    this.dummy.visible = !down; // the hat, weapon and swoosh; the body's own parts fold away in update
    if (down) this.dummy.scale.setScalar(0);
    if (!down) this.tip = this.yaw = 0;
  }

  /** `rub` is the side (-1/1) of a rider being pressed shoulder to shoulder, 0 when clear. */
  update(dt: number, speed: number, lateral: number, rub = 0): void {
    if (this.wobble && dt > 0) {
      this.wobble.update(dt, (lateral - this.lastLat) / dt + this.kickV * 3, (speed - this.lastSpeed) / dt);
      this.lastLat = lateral;
      this.lastSpeed = speed;
    }
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
    } else if (this.charge > 0 && this.swingT === 0) {
      const k = easeOut(this.charge);
      const shake = Math.sin(performance.now() * (this.charge >= 1 ? 0.09 : 0.05)) * (this.charge >= 1 ? 0.12 : 0.05) * k;
      this.arms[sw === 1 ? 1 : 0].rotation.set(0.55 - 1.7 * k + shake, sw * 0.9 * k, 0, 'YXZ');
      twist = sw * 0.65 * k;
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
    if (this.down) this.dummy.scale.setScalar(0); // off the ride: the ragdoll is drawn instead
    else this.dummy.scale.set(1 + 0.16 * sq, 1 - 0.2 * sq, 1 + 0.16 * sq);
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
