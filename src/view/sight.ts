// What a rival is allowed to hide.
//
// Three rules, all raised by the same player from the same seat, each one a case the rule before it did
// not cover (doc 3.3.66, 3.3.78, 3.3.84):
//
// - `blocking`: a rival standing on the stretch of road the player is reading, worse the nearer the
//   camera it is -- the original rule, which asks how much road one body covers.
// - `cover`: a rival drawn over the player's own dummy. One between the player and the camera is drawn
//   several times their size, so a metre of road between the two is enough for it to sit on top of them.
// - `pack`: several rivals abreast ten or fifteen metres up. Each hides almost nothing on its own and
//   the first rule rightly leaves each alone; together they wall off the lane and whatever comes down it.
//
// Whichever is worst decides how far that rival is drawn see-through (`RiderView.ghost`). None of them
// ever takes a rival off the screen: the rivals are what the race is about, and a wall you can read the
// road through is still a wall.

import type { World } from '../sim/world';
import type { Stage } from './stage';

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** A drawn body on the screen: its middle, the rows its head and its wheels are on, and half its width. */
export interface Box { x: number; top: number; bot: number; half: number; ok: boolean }

const box = (): Box => ({ x: 0, top: 0, bot: 0, half: 0, ok: false });

/**
 * A rival is only in the way while it is within BLOCK_W metres of the player's own line across the road;
 * further over it stands beside the lane, not on it. BLOCK_T is how near the camera one has to be to blank
 * the view outright -- how much of the screen it eats goes as one over its distance from the camera.
 */
const BLOCK_W = 1.6;
const BLOCK_T = 2.6;

/**
 * The drawn dummy as a box on the screen: how tall it stands in metres, and how wide half of it is as a
 * share of the height it draws at. A dummy on its ride is about 1.9 m to the top of the head and a bit
 * over a metre across with its arms out, which is the 0.3 -- close enough to say what covers what.
 */
const BODY_H = 1.9;
const BODY_W = 0.3;
/**
 * How much of the player's own column a rival has to put itself over before it is thinned as far as
 * `ghost` goes. Measured, not guessed: a rival squarely in front of the player covers 0.72 of the column
 * at a metre back and 0.39 at three metres, the dip being the band where its head draws just under the
 * player's and its legs run off the foot of the screen. The scale has to top out inside that dip or the
 * worst case -- the one the player reported -- is the one it thins least, so it tops out at 0.35.
 */
const COVER_FULL = 0.35;

/**
 * The pack in front. PACK_W is the band of road the player reads: their own line and a little either
 * side, wider than BLOCK_W because what they are about to steer into counts as well as what they are on.
 * RIDER_W is half a drawn body. A rival nearer than PACK_OUT is the fight rather than the road and is
 * left out of this entirely, its weight coming in by PACK_IN; past PACK_FAR they are specks by the
 * horizon, thinning out over the PACK_FADE before it. The widths are summed rather than unioned, since
 * two bodies on one line are two deep -- more opaque than one, not the same.
 */
const PACK_W = 2.5;
const RIDER_W = BODY_H * BODY_W;
const PACK_OUT = 4;
const PACK_IN = 8;
const PACK_FAR = 30;
const PACK_FADE = 6;
/**
 * How much of that band the pack has to cover before it is thinned at all, where the thinning tops out,
 * and how far it goes. One rival dead ahead covers 0.23 of the band and is left alone; two abreast 0.46;
 * the three the player reported, 0.69. PACK_MAX is half of what `ghost` allows -- far enough that the
 * lane and the oncoming car read through the wall, not so far that the wall stops being riders.
 */
const PACK_LO = 0.3;
const PACK_HI = 0.75;
const PACK_MAX = 0.5;

/** The three rules above: measured once a frame, then asked once per rival. */
export class Sight {
  /** The player's own drawn body, measured at the top of the rider loop; `ok` false until it has been. */
  readonly pbox: Box = box();
  private readonly rbox: Box = box();
  private readonly pt = { x: 0, y: 0 };
  /** Each rival's share of the pack in front this frame, 0 for one that is not in it (see PACK_W). */
  private readonly packW: number[] = [];
  /** How far that pack is thinned this frame; every rival in it is thinned by its own share of this. */
  private packHide = 0;
  /** Metres from the camera back to the player, which is what `blocking` measures distance from. */
  private back = 0;

  constructor(
    private readonly stage: Stage,
    /** Rider `i`'s drawn position h metres up, in screen px; false when it is behind the camera. */
    private readonly projectRider: (i: number, h: number, out: { x: number; y: number }) => boolean,
  ) {}

  /**
   * Everything measured once a frame rather than once per rival: the pack in front, and the player's own
   * box put out of date until the loop below places them. `px`/`pz` are the player's drawn position, and
   * `drawX` every rider's drawn line across the road -- the springs scene.ts places the bodies on, so the
   * band is measured where the pack is seen rather than where the sim has it. A rider with no entry there
   * yet (the first frame after it joins, or after it comes back from `away`) falls back to the sim's own.
   */
  begin(w: World, drawX: readonly number[], px: number, pz: number, alpha: number, back: number): void {
    this.back = back;
    this.pbox.ok = false;
    let cover = 0;
    for (let i = 1; i < w.riders.length; i++) {
      const r = w.riders[i];
      const dz = lerp(r.pz, r.z, alpha) - pz;
      const x = drawX[i] ?? lerp(r.px, r.x, alpha);
      // Worked out from the sim's own metres rather than from the screen: a body and the road it stands
      // on are drawn at the same scale at the same distance, so the share of the band one covers is the
      // same number either way. Every edge of it is a ramp rather than a line: a rival drifting out of
      // the band sideways, or riding out to PACK_FAR, would otherwise take a whole body's worth of
      // thinning off the pack between one frame and the next, and the wall would flicker as it rode.
      const span = Math.min(px + PACK_W, x + RIDER_W) - Math.max(px - PACK_W, x - RIDER_W);
      const near = clamp((dz - PACK_OUT) / (PACK_IN - PACK_OUT));
      const far = clamp((PACK_FAR - dz) / PACK_FADE);
      // A body squarely inside the band is a whole one; half of it over the edge counts half.
      const wt = r.state === 'ride' ? near * far * clamp(span / (RIDER_W * 2)) : 0;
      this.packW[i] = wt;
      cover += ((RIDER_W * 2) / (PACK_W * 2)) * wt;
    }
    this.packHide = clamp((cover - PACK_LO) / (PACK_HI - PACK_LO)) * PACK_MAX;
  }

  /** The player's own box, once they have been placed: every rival after it is measured against this. */
  player(): void {
    this.pbox.ok = this.measure(0, this.pbox);
  }

  /**
   * How far rival `i`, drawn at (x, z) with the player at `pz`, is thinned this frame: 0 solid, 1 as far
   * as `ghost` goes. `playerX` is the player's own drawn line across the road.
   */
  hide(i: number, x: number, z: number, pz: number, playerX: number): number {
    return Math.max(
      this.blocking(x, z, pz, playerX),
      this.packHide * (this.packW[i] ?? 0),
      // only a rival nearer the camera than the player is drawn over them
      z < pz ? Math.min(1, this.cover(i) / COVER_FULL) : 0,
    );
  }

  /**
   * Rider `i`'s drawn body as a screen box, false when it is behind the camera. Two projections: the
   * ground it stands on and the top of its head, which give the rows it covers and -- through BODY_W --
   * how wide it is at that distance, without a bounding box walk over its forty-odd parts.
   */
  measure(i: number, out: Box): boolean {
    if (!this.projectRider(i, 0, this.pt)) return false;
    out.x = this.pt.x;
    out.bot = this.pt.y;
    if (!this.projectRider(i, BODY_H, this.pt)) return false;
    out.x = (out.x + this.pt.x) / 2;
    out.top = this.pt.y;
    out.half = (out.bot - out.top) * BODY_W;
    out.ok = out.half > 0.5;
    return out.ok;
  }

  /**
   * How much of the player's own column rival `i` stands in, 0 to 1. The column is the player's own box
   * widened downwards to the foot of the screen, because a rival in front of them does not have to land
   * on the dummy itself to blind them -- the rows between the dummy and the bottom edge are the road
   * they are about to be standing on.
   */
  private cover(i: number): number {
    const p = this.pbox;
    if (!p.ok || !this.measure(i, this.rbox)) return 0;
    const b = this.rbox;
    const foot = Math.max(p.bot, this.stage.cssH);
    const ox = Math.min(p.x + p.half, b.x + b.half) - Math.max(p.x - p.half, b.x - b.half);
    const oy = Math.min(foot, b.bot) - Math.max(p.top, b.top);
    if (ox <= 0 || oy <= 0) return 0;
    return (ox / (p.half * 2)) * (oy / (foot - p.top));
  }

  /** How much of the road ahead a rival at (x, z) covers, 0 to 1. */
  private blocking(x: number, z: number, pz: number, playerX: number): number {
    const t = z - pz + this.back; // metres in front of the camera
    if (t < 0.3) return 0;
    const side = 1 - Math.abs(x - playerX) / BLOCK_W;
    return side <= 0 ? 0 : side * Math.min(1, BLOCK_T / t);
  }
}
