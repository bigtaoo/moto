// Getting up, posed for the view-only ragdoll (ragdoll.ts): a slow climb from where the body came to rest
// (on all fours, on one knee, standing up with a wobble), then one of eight gags while the sim keeps the
// rider standing (DOWN.stand). Poses are built in the body's own frame in `L`; the ragdoll turns them to
// face the scooter and blends them in from the pose it lay in.

import * as THREE from 'three';

/** The ragdoll's points. */
export const HEAD = 0, SH_L = 1, SH_R = 2, PELVIS = 3, EL_L = 4, HAND_L = 5, EL_R = 6, HAND_R = 7, KNEE_L = 8, FOOT_L = 9, KNEE_R = 10, FOOT_R = 11;

// Posed while getting up, in the body's own frame (x across, -x its left; y up from the road; z the way it faces).
type Pose = readonly (readonly [number, number, number])[];
const STAND: Pose = [
  [0, 1.79, 0.08], [-0.27, 1.49, 0.03], [0.27, 1.49, 0.03], [0, 0.95, -0.03],
  [-0.31, 1.18, 0], [-0.33, 0.85, 0.06], [0.31, 1.18, 0], [0.33, 0.85, 0.06],
  [-0.11, 0.51, 0.02], [-0.11, 0.1, 0], [0.11, 0.51, 0.02], [0.11, 0.1, 0],
];
const ALL_FOURS: Pose = [
  [0, 0.85, 0.62], [-0.25, 0.7, 0.32], [0.25, 0.7, 0.32], [0, 0.55, -0.22],
  [-0.28, 0.4, 0.36], [-0.29, 0.08, 0.38], [0.28, 0.4, 0.36], [0.29, 0.08, 0.38],
  [-0.13, 0.09, -0.16], [-0.13, 0.1, -0.57], [0.13, 0.09, -0.16], [0.13, 0.1, -0.57],
];
/** On the left knee, the right foot planted, a hand on each knee to push up. */
const KNEEL: Pose = [
  [0, 1.35, 0.14], [-0.26, 1.06, 0.02], [0.26, 1.06, 0.02], [0, 0.55, -0.12],
  [-0.38, 0.78, 0.02], [-0.22, 0.56, 0.16], [0.3, 0.8, 0.22], [0.17, 0.56, 0.36],
  [-0.12, 0.09, -0.1], [-0.12, 0.1, -0.51], [0.13, 0.5, 0.32], [0.13, 0.1, 0.36],
];
/** Fallen on its backside, legs out in front, leaning back on its hands. */
const SIT: Pose = [
  [0, 0.97, -0.15], [-0.26, 0.68, -0.2], [0.26, 0.68, -0.2], [0, 0.18, -0.1],
  [-0.36, 0.42, -0.33], [-0.38, 0.09, -0.4], [0.36, 0.42, -0.33], [0.38, 0.09, -0.4],
  [-0.13, 0.42, 0.28], [-0.14, 0.1, 0.52], [0.13, 0.42, 0.28], [0.14, 0.1, 0.52],
];
/** Seconds into getting up: on all fours, on one knee, standing; then a gag until the sim lets it run. */
const RISE = [0.35, 0.6, 0.85];
const GAG_T = 0.85;
export const GAGS = 8;
const UPPER = [HEAD, SH_L, SH_R, EL_L, HAND_L, EL_R, HAND_R];
/** The pose being built, in the body's frame. */
export const L = Array.from({ length: 12 }, () => new THREE.Vector3());
const smooth = (k: number) => { k = Math.min(1, Math.max(0, k)); return k * k * (3 - 2 * k); };
const pose = (A: Pose, B: Pose, k: number) => {
  for (let i = 0; i < L.length; i++) L[i].set(A[i][0] + (B[i][0] - A[i][0]) * k, A[i][1] + (B[i][1] - A[i][1]) * k, A[i][2] + (B[i][2] - A[i][2]) * k);
};
const put = (i: number, x: number, y: number, z: number) => void L[i].set(x, y, z);
const shift = (idx: readonly number[], x: number, y: number, z: number) => { for (const i of idx) L[i].x += x, L[i].y += y, L[i].z += z; };
const lift = (y: number) => { for (const v of L) v.y += y; };
/** Both arms mirrored: the right elbow and hand given, the left one the same across. */
const arms = (ex: number, ey: number, ez: number, hx: number, hy: number, hz: number) => {
  put(EL_L, -ex, ey, ez); put(HAND_L, -hx, hy, hz); put(EL_R, ex, ey, ez); put(HAND_R, hx, hy, hz);
};
/** Keeps a share `k` of how far the pose is from standing. */
const fromStand = (k: number) => {
  for (let i = 0; i < L.length; i++) L[i].set(STAND[i][0] + (L[i].x - STAND[i][0]) * k, STAND[i][1] + (L[i].y - STAND[i][1]) * k, STAND[i][2] + (L[i].z - STAND[i][2]) * k);
};

/** Which gag (also the last one done, so it is never the same twice running) and the dust puffs made so far. */
export interface GagState { gag: number; puffs: number }
/** The pose built in `L`, plus how far to blend it in from lying (k), the turn about the body (yaw) and the head's roll. */
const out = { k: 1, yaw: 0, roll: 0 };

/** A gag other than the last one. */
export const nextGag = (st: GagState): void => {
  let g = Math.floor(Math.random() * (GAGS - 1));
  if (g >= st.gag) g++;
  st.gag = g;
  st.puffs = 0;
};

/** Poses `L` for `t` seconds into getting up; `puff(n)` throws up n bits of road dust where it stands. */
export function getUpPose(t: number, st: GagState, puff: (n: number) => void): typeof out {
  out.k = 1;
  out.yaw = 0;
  out.roll = 0;
  if (t < RISE[0]) {
    pose(ALL_FOURS, ALL_FOURS, 0);
    out.k = smooth(t / RISE[0]);
  } else if (t < RISE[1]) {
    pose(ALL_FOURS, KNEEL, smooth((t - RISE[0]) / (RISE[1] - RISE[0])));
    // a push or two: the arms give, the body sags and heaves
    lift(-0.04 * Math.abs(Math.sin((t - RISE[0]) * 25)));
  } else if (t < RISE[2]) {
    const u = (t - RISE[1]) / (RISE[2] - RISE[1]);
    pose(KNEEL, STAND, smooth(u));
    // up, and nearly over again
    const sway = Math.sin(u * Math.PI * 2.5) * (1 - u * 0.6);
    shift(UPPER, sway * 0.12, 0, 0);
    out.roll = -sway * 0.35;
  } else out.yaw = gagPose(Math.min(1, (t - RISE[2]) / GAG_T), st, puff);
  return out;
}

/** The gag at `g` (0..1) into the pose being built, easing in from and back out to standing; returns the turn. */
function gagPose(g: number, st: GagState, puff: (n: number) => void): number {
  const T = Math.PI * 2;
  // in and out over the first and last 15%, so it starts from the stand and ends ready to run
  const e = smooth(g / 0.15) * smooth((1 - g) / 0.15);
  pose(STAND, STAND, 0);
  let yaw = 0;
  let roll = 0;
  switch (st.gag) {
    case 0: { // dizzy: the top half circling over the hips, arms out, feet stumbling about
      const c = g * T * 2;
      shift(UPPER, Math.sin(c) * 0.15, 0, Math.cos(c) * 0.12);
      L[HEAD].x += Math.sin(c - 0.6) * 0.08;
      arms(0.5, 1.3, 0.05, 0.72, 1.18, 0.1);
      L[FOOT_L].x += Math.sin(c) * 0.08;
      L[FOOT_R].x += Math.sin(c + 1) * 0.08;
      roll = Math.sin(c) * 0.45;
      break;
    }
    case 1: { // turns round and shakes a fist at whoever did it (the camera, more often than not)
      yaw = Math.PI;
      const s = Math.sin(g * 42);
      put(EL_R, 0.55, 1.55, 0.1);
      put(HAND_R, 0.52, 1.86 + s * 0.06, 0.16 + s * 0.06);
      put(EL_L, -0.45, 1.22, -0.02);
      put(HAND_L, -0.22, 0.98, 0.05);
      shift([HEAD, SH_L, SH_R], 0, 0, 0.06);
      L[HEAD].z += 0.05;
      roll = s * 0.12;
      break;
    }
    case 2: { // side-on to the camera, dusts itself off: chest, thighs, chest, a puff of road dust each pat
      yaw = Math.PI / 2;
      shift(UPPER, 0, -0.05, 0.1);
      L[HEAD].z += 0.05;
      const u = (Math.sin(g * T * 4) + 1) / 2;
      put(EL_L, -0.38, 1.12, 0.14);
      put(EL_R, 0.38, 1.12, 0.14);
      put(HAND_L, -0.13, 0.72 + u * 0.5, 0.2);
      put(HAND_R, 0.13, 1.22 - u * 0.5, 0.2);
      roll = Math.sin(g * T * 2) * 0.15;
      const pat = Math.floor(g * 4 + 0.25);
      if (pat > st.puffs && g < 0.85) {
        st.puffs = pat;
        puff(3);
      }
      break;
    }
    case 3: { // hand over its eyes, looks left and right for the scooter, spots it, points, hops
      if (g < 0.6) {
        yaw = Math.sin((g / 0.6) * T) * 0.7;
        put(EL_R, 0.42, 1.62, 0.18);
        put(HAND_R, 0.1, 1.8, 0.25);
        roll = -yaw * 0.3;
      } else {
        const u = (g - 0.6) / 0.4;
        put(EL_R, 0.29, 1.52, 0.33);
        put(HAND_R, 0.3, 1.56, 0.67);
        put(EL_L, -0.45, 1.22, -0.02);
        put(HAND_L, -0.22, 0.98, 0.05);
        lift(Math.sin(Math.min(1, u * 1.6) * Math.PI) * 0.18);
      }
      break;
    }
    case 4: { // trips over its own feet: down on its backside, feet in the air, and bounces up
      if (g < 0.15) {
        pose(STAND, SIT, smooth(g / 0.15));
        L[FOOT_L].y += 0.4 * (g / 0.15);
        L[FOOT_R].y += 0.45 * (g / 0.15);
      } else if (g < 0.45) {
        pose(SIT, SIT, 0);
        const u = 1 - (g - 0.15) / 0.3;
        L[FOOT_L].y += 0.4 * u * u;
        L[FOOT_R].y += 0.45 * u * u;
        out.roll = Math.sin(g * 40) * 0.2 * u;
        if (st.puffs === 0) {
          st.puffs = 1;
          puff(6);
        }
      } else if (g < 0.75) pose(SIT, STAND, smooth((g - 0.45) / 0.3));
      else {
        // arms out, steadying itself
        arms(0.55, 1.42, 0.02, 0.85, 1.4, 0.05);
        shift(UPPER, Math.sin(g * 30) * 0.2 * (1 - g), 0, 0);
        fromStand(smooth((1 - g) / 0.25));
      }
      return 0; // starts and ends standing by itself
    }
    case 5: { // hurt foot: hops about on the other one, clutching it
      shift(UPPER, 0, -0.09, 0.12);
      L[HEAD].z += 0.1;
      put(KNEE_R, 0.13, 0.72, 0.3);
      put(FOOT_R, 0.13, 0.55, -0.05);
      put(EL_R, 0.36, 1.1, 0.18);
      put(HAND_R, 0.2, 0.8, 0.22);
      put(EL_L, -0.12, 1.12, 0.25);
      put(HAND_L, 0.06, 0.84, 0.25);
      lift(Math.abs(Math.sin(g * Math.PI * 4)) * 0.14);
      for (const v of L) v.x += Math.sin(g * T) * 0.12;
      roll = Math.sin(g * Math.PI * 4) * 0.25;
      break;
    }
    case 6: { // turns to the camera, "I'm fine": a double-biceps flex, chest out, a pump or two, then a head tilt
      yaw = Math.PI;
      const pump = Math.max(0, Math.sin(g * 26));
      arms(0.6, 1.5 + pump * 0.04, 0, 0.62 - pump * 0.1, 1.82 + pump * 0.02, 0.02);
      shift([HEAD, SH_L, SH_R], 0, 0.03, -0.04);
      lift(-Math.abs(Math.sin(g * 13)) * 0.05);
      roll = g > 0.55 ? 0.3 : 0;
      break;
    }
    default: { // a tantrum: stamping, fists pumping, head shaking
      const s = g * T * 4;
      const up = (ph: number) => Math.max(0, Math.sin(s + ph));
      L[KNEE_L].y += up(0) * 0.18; L[KNEE_L].z += up(0) * 0.12; L[FOOT_L].y += up(0) * 0.2;
      L[KNEE_R].y += up(Math.PI) * 0.18; L[KNEE_R].z += up(Math.PI) * 0.12; L[FOOT_R].y += up(Math.PI) * 0.2;
      // fists beating the air, elbows out
      const fist = (ph: number) => Math.sin(s * 1.5 + ph);
      put(EL_L, -0.5, 1.3 + fist(Math.PI) * 0.1, 0.1);
      put(HAND_L, -0.42, 1.25 + fist(Math.PI) * 0.3, 0.3);
      put(EL_R, 0.5, 1.3 + fist(0) * 0.1, 0.1);
      put(HAND_R, 0.42, 1.25 + fist(0) * 0.3, 0.3);
      shift([HEAD, SH_L, SH_R], 0, 0, 0.05);
      lift(-Math.abs(Math.sin(s)) * 0.06);
      roll = Math.sin(g * T * 5) * 0.4;
    }
  }
  fromStand(e);
  out.roll = roll * e;
  return yaw * e;
}
