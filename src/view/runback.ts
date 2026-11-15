// How a dummy runs back to its scooter. The scurry used to be one hard-coded pose -- both arms up over the
// head, windmilling -- so every fall in the game looked the same once the get-up gag (getup.ts) was over.
// This picks one of six runs instead, never the same one twice running, and the pose for it: the arms,
// written in the body's own frame (x across, -x its left; y up from the road; z the way it faces), and the
// few numbers that give each run its gait.

/** How many runs there are to pick from. */
export const RUNS = 6;
/** Which run is on (also the last one used, so it is never the same twice running). */
export interface RunState { run: number }

/** A run other than the last one. */
export const nextRun = (st: RunState): void => {
  let r = Math.floor(Math.random() * (RUNS - 1));
  if (r >= st.run) r++;
  st.run = r;
};

/** The gait: how fast the legs go, how much the body bobs, leans and rolls, the knee lift, and a limp. */
export interface Gait {
  /** Strides a second, give or take: the legs are cartoon-fast whatever the body's pace. */
  rate: number;
  bob: number;
  lean: number;
  /** How far the body rolls from side to side (rad). */
  roll: number;
  /** How high the knees come up. */
  knee: number;
  /** 0 none; otherwise the share by which the right leg's step is cut, and the hitch it puts in the bob. */
  limp: number;
}

const GAITS: readonly Gait[] = [
  { rate: 13, bob: 0.1, lean: 0.18, roll: 0.3, knee: 1, limp: 0 }, // panic windmill
  { rate: 15, bob: 0.07, lean: 0.3, roll: 0.16, knee: 0.8, limp: 0 }, // sprint
  { rate: 10, bob: 0.13, lean: 0.1, roll: 0.26, knee: 0.75, limp: 0.55 }, // sore backside
  { rate: 12, bob: 0.12, lean: 0.14, roll: 0.34, knee: 1.05, limp: 0 }, // head in hands
  { rate: 16, bob: 0.05, lean: 0.38, roll: 0.12, knee: 0.9, limp: 0 }, // arms streaming behind
  { rate: 11, bob: 0.11, lean: 0.22, roll: 0.22, knee: 0.95, limp: 0 }, // reaching for the scooter
];

/** The gait of run `style`. */
export const gaitOf = (style: number): Gait => GAITS[style % GAITS.length];

// The shoulder the arm hangs from, in the body's frame, with the run's -0.15 drop already in it.
const SH_X = 0.27, SH_Y = 1.49, SH_Z = 0.05;
/** Upper arm and forearm lengths, handed in from the ragdoll's own rest pose. */
let upper = 0.33, fore = 0.33;
export const setArmLengths = (u: number, f: number): void => { upper = u; fore = f; };

/** Elbow then hand for one arm: [ex, ey, ez, hx, hy, hz]. */
const out = [0, 0, 0, 0, 0, 0];
const put = (sx: number, ux: number, uy: number, uz: number, vx: number, vy: number, vz: number): number[] => {
  const un = Math.hypot(ux, uy, uz) || 1;
  const ex = sx + (ux / un) * upper, ey = SH_Y + (uy / un) * upper, ez = SH_Z + (uz / un) * upper;
  const vn = Math.hypot(vx, vy, vz) || 1;
  out[0] = ex; out[1] = ey; out[2] = ez;
  out[3] = ex + (vx / vn) * fore; out[4] = ey + (vy / vn) * fore; out[5] = ez + (vz / vn) * fore;
  return out;
};

/**
 * One arm of run `style` at stride phase `ph`; `side` is -1 for the dummy's left arm, +1 for its right.
 * Returns [elbow x, y, z, hand x, y, z] in the body's frame -- the array is reused, so read it at once.
 */
export function runArm(style: number, side: number, ph: number): number[] {
  const sx = side * SH_X;
  switch (style % RUNS) {
    case 1: { // sprint: elbows in at the ribs, forearms pumping fore and aft against the legs
      const s = Math.sin(ph + (side > 0 ? 0 : Math.PI));
      return put(sx, side * 0.25, -0.75, 0.25 + s * 0.3, side * 0.12, 0.2, 0.65 + s * 0.55);
    }
    case 2: { // one hand rubbing the sore backside, the other pumping low and loose
      if (side > 0) return put(sx, 0.4, -0.7, -0.5, -0.5, -0.35, -0.75 + 0.2 * Math.sin(ph * 2));
      const s = Math.sin(ph);
      return put(sx, -0.3, -0.8, 0.2 + s * 0.25, -0.1, -0.3, 0.6 + s * 0.4);
    }
    case 3: { // both hands clapped to its helmet, elbows out wide
      const f = 0.06 * Math.sin(ph * 1.6 + (side > 0 ? 0 : 1.1));
      return put(sx, side * 0.95, 0.45 + f, -0.1, -side * 0.55, 0.78 + f, 0.18);
    }
    case 4: { // arms streaming straight out behind, flapping
      const f = 0.18 * Math.sin(ph * 1.3 + (side > 0 ? 0 : 1.7));
      return put(sx, side * 0.35, -0.1 + f, -0.9, side * 0.25, 0.05 + f, -0.95);
    }
    case 5: { // both arms stretched out for the scooter, fingers grasping
      const f = 0.12 * Math.sin(ph * 2 + (side > 0 ? 0 : 0.9));
      return put(sx, side * 0.3, 0.25 + f, 0.85, side * 0.16, 0.12 - f, 0.95);
    }
    default: { // the old one: both arms over the head, windmilling out of step with each other
      const t = ph * 0.8 + (side > 0 ? 0 : 2.2);
      return put(sx, side * 0.55, 0.72 + 0.2 * Math.sin(t), 0.4 * Math.cos(t),
        side * (0.25 + 0.35 * Math.sin(t * 1.7)), 0.85, 0.5 * Math.sin(t + 1.3));
    }
  }
}
