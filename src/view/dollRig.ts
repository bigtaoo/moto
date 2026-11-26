// The thrown dummy's body as a drawing: one skinned mesh, built once per set of colours, with a bone per
// rigid part -- torso, head, eight limb pieces, three stars -- posed from the points dollBody.ts moves.
// Chunky parts rather than a skin, so it is the same dummy that rides the scooter (rider.ts).

import * as THREE from 'three';
import { REST, restDist } from './dollBody';
import { toWorld } from './road';
import { Kit, cached, rigidParts, rigidMesh } from './toon';
import { JOINT, TARGET, INK_W, rbox, ball, rod, headKit } from './rider';
import { HEAD, SH_L, SH_R, PELVIS, EL_L, HAND_L, EL_R, HAND_R, KNEE_L, FOOT_L, KNEE_R, FOOT_R } from './getup';
import { setArmLengths } from './runback';

// limb meshes: from point, to point, part (0 upper arm, 1 forearm, 2 thigh, 3 shin), hip offset (thighs start at the hip)
const LIMBS: [number, number, number, number][] = [
  [SH_L, EL_L, 0, 0], [EL_L, HAND_L, 1, 0], [SH_R, EL_R, 0, 0], [EL_R, HAND_R, 1, 0],
  [PELVIS, KNEE_L, 2, 0.11], [KNEE_L, FOOT_L, 3, 0], [PELVIS, KNEE_R, 2, -0.11], [KNEE_R, FOOT_R, 3, 0],
];
const LEN = [restDist(SH_L, EL_L), restDist(EL_L, HAND_L), restDist(PELVIS, KNEE_L), restDist(KNEE_L, FOOT_L)];
setArmLengths(LEN[0], LEN[1]);

const a = new THREE.Vector3();
const bx = new THREE.Vector3();
const by = new THREE.Vector3();
const bz = new THREE.Vector3();
const tx = new THREE.Vector3();
const m4 = new THREE.Matrix4();
const w = REST.map(() => new THREE.Vector3());

/** Parts along +y from 0 to the limb's length. */
const along = (g: THREE.BufferGeometry, len: number) => g.rotateX(-Math.PI / 2).translate(0, len / 2, 0);

/** The body from the hips to the neck, in the pelvis frame: y towards the shoulders, x to the dummy's left, z forward. */
function torsoKit(body: number, ride: number, mark: number): Kit {
  return new Kit(INK_W)
    .add(rbox(0.4, 0.22, 0.27), ride, { at: [0, 0, 0] })
    .add(rbox(0.46, 0.54, 0.29, 0.09), body, { at: [0, 0.33, 0] })
    .add(rbox(0.48, 0.06, 0.31, 0.02), JOINT, { at: [0, 0.12, 0], ink: false })
    .add(new THREE.CylinderGeometry(0.055, 0.065, 0.14, 8), JOINT, { at: [0, 0.64, 0], ink: false })
    .decal(0.085, mark, { at: [0, 0.4, 0.151] })
    .decal(0.085, mark, { at: [0, 0.4, -0.151], rot: [0, Math.PI, 0] });
}

/** A chunky five-pointed star (puffed out to a point front and back), for the ones circling a dazed head. */
function starGeo(): THREE.BufferGeometry {
  const at = (i: number) => { const r = i % 2 ? 0.045 : 0.11, t = (i / 10) * Math.PI * 2; return [Math.sin(t) * r, Math.cos(t) * r, 0]; };
  const pts: number[] = [];
  for (let i = 0; i < 10; i++) pts.push(0, 0, 0.035, ...at(i + 1), ...at(i), 0, 0, -0.035, ...at(i), ...at(i + 1));
  const g = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  g.computeVertexNormals();
  return new Kit(INK_W * 0.6).add(g, 0xffd23a).build();
}
const STARS = 3;

/** Upper arm, forearm, thigh, shin (LIMBS' part numbers). */
const LIMB_KITS: ((body: number) => Kit)[] = [
  (body) => new Kit(INK_W).add(ball(0.075), JOINT, { ink: false }).add(along(rod(0.06, LEN[0]), LEN[0]), body),
  (body) => new Kit(INK_W).add(ball(0.062), JOINT, { ink: false }).add(along(rod(0.055, LEN[1]), LEN[1]), body)
    .add(ball(0.078), JOINT, { at: [0, LEN[1], 0] }),
  (body) => new Kit(INK_W).add(along(rod(0.08, LEN[2]), LEN[2]), body),
  (body) => new Kit(INK_W).add(ball(0.072), JOINT, { ink: false }).add(along(rod(0.07, LEN[3]), LEN[3]), body)
    .add(rbox(0.15, 0.1, 0.28, 0.04), JOINT, { at: [0, LEN[3], 0.06] }),
];

/** Bones, one per rigid part: the torso, the head, the limbs (LIMBS' order), the stars. */
const TORSO = 0, HEADB = 1, LIMB0 = 2, STAR0 = LIMB0 + LIMBS.length, BONES = STAR0 + STARS;

/** The whole body as one skinned geometry (see rigidParts), bone order as above. */
function bodyGeo(body: number, ride: number, mark: number): THREE.BufferGeometry {
  const limb = LIMB_KITS.map((kit) => kit(body).build());
  const star = starGeo();
  return rigidParts([torsoKit(body, ride, mark).build(), headKit(body, mark).build(),
    ...LIMBS.map(([, , part]) => limb[part]), ...Array.from({ length: STARS }, () => star)]);
}

export class DollRig {
  readonly group = new THREE.Group();
  private readonly mesh: THREE.SkinnedMesh;
  private readonly bones = Array.from({ length: BONES }, () => new THREE.Bone());
  private readonly torso = this.bones[TORSO];
  private readonly head = this.bones[HEADB];
  private readonly limbs = this.bones.slice(LIMB0, STAR0);
  private readonly stars = this.bones.slice(STAR0);

  /** `mat` is the rider's own vertex-coloured toon material, so a hit flash shows here too. */
  constructor(body: number, ride: number, mat: THREE.Material, mark = TARGET) {
    // One draw call for the whole body instead of 13 (two thrown dummies were a quarter of the phone
    // budget); built once per colours and kept across races (see `cached` in toon.ts).
    this.mesh = rigidMesh(cached(`rag:${body}:${ride}:${mark}`, () => bodyGeo(body, ride, mark)), mat, this.bones, new THREE.Sphere(new THREE.Vector3(), 2.4));
    this.group.add(this.mesh, ...this.bones);
    this.show(false);
  }

  /** A hat on the head, and a head `scale` times the size (the big-heads week). */
  dress(hat: THREE.Object3D | null, scale = 1): void {
    this.head.scale.setScalar(scale);
    this.mesh.boundingSphere!.radius = 2.4 + scale - 1;
    if (!hat) return;
    hat.position.y = 0.17;
    this.head.add(hat);
  }

  /**
   * Out on the road or put away. A body put away also drops out of the renderer's matrix walk, so its
   * fourteen bones cost nothing while it waits; the walk picks them up again the frame it is thrown.
   */
  show(on: boolean): void {
    this.group.visible = on;
    this.group.matrixWorldAutoUpdate = on;
  }

  /**
   * Put the bones on the points `p` (sim space). `roll` is the head's own roll on top of the torso's turn
   * (the wobble while running), `age` the seconds since the throw, which the stars circle on.
   */
  pose(p: THREE.Vector3[], roll: number, age: number): void {
    for (let i = 0; i < REST.length; i++) toWorld(p[i].x, p[i].y, p[i].z, w[i]);
    // Torso frame: x from the right shoulder to the left, y from the pelvis up to between the shoulders.
    by.copy(w[SH_L]).add(w[SH_R]).multiplyScalar(0.5).sub(w[PELVIS]).normalize();
    bx.copy(w[SH_L]).sub(w[SH_R]);
    bx.addScaledVector(by, -bx.dot(by)).normalize();
    bz.crossVectors(bx, by);
    m4.makeBasis(bx, by, bz);
    this.torso.position.copy(w[PELVIS]);
    this.torso.quaternion.setFromRotationMatrix(m4);
    this.head.position.copy(w[HEAD]);
    this.mesh.boundingSphere!.center.copy(w[PELVIS]);
    this.head.quaternion.copy(this.torso.quaternion);
    if (roll) this.head.rotateZ(roll);
    // dazed: stars round the head once the body has hit the road
    const dazed = age > 0.5;
    for (let k = 0; k < STARS; k++) {
      const st = this.stars[k];
      st.scale.setScalar(dazed ? 1 : 0);
      if (!dazed) continue;
      const t = age * 5 + (k / STARS) * Math.PI * 2;
      const h = p[HEAD];
      toWorld(h.x + Math.cos(t) * 0.3, h.y + 0.32 + Math.sin(t * 2) * 0.03, h.z + Math.sin(t) * 0.3, st.position);
      st.rotation.set(0, t * 1.5, 0);
    }
    const fwd = a.copy(bz);
    tx.copy(bx);
    for (let k = 0; k < LIMBS.length; k++) {
      const [i, j, , hip] = LIMBS[k];
      const m = this.limbs[k];
      m.position.copy(w[i]).addScaledVector(tx, hip);
      by.copy(w[j]).sub(m.position).normalize();
      // keep feet and hands facing the way the body faces
      bz.copy(fwd).addScaledVector(by, -fwd.dot(by));
      if (bz.lengthSq() < 1e-6) bz.set(0, 0, 1);
      bz.normalize();
      bx.crossVectors(by, bz);
      m4.makeBasis(bx, by, bz);
      m.quaternion.setFromRotationMatrix(m4);
    }
  }
}
