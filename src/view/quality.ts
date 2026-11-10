// Quality tiers and the governor that moves between them. Six tiers, 0 the cheapest and 5 the best. What
// costs frames in this game is filling pixels (a toon shader with outlines, over a whole phone screen), so
// a tier is mostly a cap on the pixel ratio; the two bottom tiers also throw fewer sparks and dust bits, and
// the three bottom ones see less far: the fog closes in and the far plane with it, so the trees stacked up
// along the horizon (the worst overdraw on screen) aren't drawn and riders and cars far ahead are culled.
// MSAA can only be chosen when the WebGL context is made, so it is decided once per device, not per tier.
//
// The governor is fed frame times and is plain arithmetic (no DOM), so it is unit tested. Rules (see
// docs §3.4): under 40 fps for 3 s steps down one tier, and if those 3 s averaged under 15 fps straight to
// the bottom; over 57 fps for 30 s steps up, at most once a race; if after a step up it can't hold 54 fps
// it steps back and never steps up again.

export interface Tier {
  /** Highest pixel ratio drawn (the screen's own is used when lower). */
  dpr: number;
  /** Share of spark and dust particles kept. */
  fx: number;
  /** Share of the environment's fog distance (and so of the view distance) kept. */
  view: number;
}

export const TIERS: readonly Tier[] = [
  { dpr: 0.5, fx: 0.5, view: 0.6 },
  { dpr: 0.75, fx: 0.5, view: 0.75 },
  { dpr: 1, fx: 1, view: 0.9 },
  { dpr: 1.25, fx: 1, view: 1 },
  { dpr: 1.5, fx: 1, view: 1 },
  { dpr: 2, fx: 1, view: 1 },
];
export const TOP = TIERS.length - 1;

export type QualityMode = 'auto' | 'low' | 'high';

/** Frame rates (fps) and spans (ms) of the rules above. */
const RULE = { down: 40, floor: 15, up: 57, hold: 54, slowFor: 3000, fastFor: 30000, probe: 5000, probeBad: 1000 };
/** Frames are judged in windows of this many ms, so one long frame (a GC, a tab switch) is not a trend. */
const WINDOW = 500;
/** A frame this long is a gap (the page was hidden, a dialog was up), not a slow frame. */
const GAP = 1000;

export class Governor {
  tier: number;
  /** A step up failed: no more stepping up this session. */
  locked = false;
  private upUsed = false;
  private winT = 0;
  private winN = 0;
  private slowT = 0;
  private slowN = 0;
  private fastT = 0;
  /** ms into the trial after a step up (-1: none), and how long it has run under 54 fps. */
  private probeT = -1;
  private probeBad = 0;
  private from = 0;
  /** Skip the first window after a change: resizing the drawing buffer costs a frame of its own. */
  private settle = false;

  /**
   * `same(a, b)`: tiers a and b look and cost the same on this device (e.g. a pixel-ratio cap above the
   * screen's own). Steps skip over such tiers, so a step always changes something.
   */
  constructor(tier: number, private readonly same: (a: number, b: number) => boolean = (a, b) => a === b) {
    this.tier = tier;
  }

  /** A new race: the one step up a race is allowed again. */
  raceStart(): void {
    this.upUsed = false;
  }

  /** Jump to `tier` (a player setting changed), starting the timing over. */
  reset(tier: number): void {
    this.tier = tier;
    this.probeT = -1;
    this.clear();
  }

  /** One frame of `ms`. `active` false (paused, a menu, hidden) and gaps are not timed. True when the tier changed. */
  frame(ms: number, active: boolean): boolean {
    if (!active || !(ms > 0) || ms >= GAP) {
      this.clear();
      return false;
    }
    this.winT += ms;
    this.winN++;
    if (this.winT < WINDOW) return false;
    const t = this.winT;
    const n = this.winN;
    this.winT = this.winN = 0;
    if (this.settle) {
      this.settle = false;
      return false;
    }
    return this.judge((n * 1000) / t, t, n);
  }

  private judge(fps: number, t: number, n: number): boolean {
    if (this.probeT >= 0) {
      this.probeT += t;
      this.probeBad = fps < RULE.hold ? this.probeBad + t : 0;
      if (this.probeBad >= RULE.probeBad) {
        this.locked = true;
        this.probeT = -1;
        return this.set(this.from);
      }
      if (this.probeT >= RULE.probe) this.probeT = -1;
    }
    if (fps < RULE.down) {
      this.slowT += t;
      this.slowN += n;
      this.fastT = 0;
    } else {
      this.slowT = this.slowN = 0;
      this.fastT = fps > RULE.up ? this.fastT + t : 0;
    }
    if (this.slowT >= RULE.slowFor) {
      const avg = (this.slowN * 1000) / this.slowT;
      return this.set(avg < RULE.floor ? 0 : this.below());
    }
    if (this.fastT >= RULE.fastFor && !this.upUsed && !this.locked && this.probeT < 0) {
      this.fastT = 0;
      const up = this.above();
      if (up === this.tier) return false;
      this.upUsed = true;
      this.from = this.tier;
      this.set(up);
      this.probeT = this.probeBad = 0;
      return true;
    }
    return false;
  }

  private below(): number {
    let b = this.tier - 1;
    while (b > 0 && this.same(b, this.tier)) b--;
    return Math.max(0, b);
  }

  private above(): number {
    for (let u = this.tier + 1; u <= TOP; u++) if (!this.same(u, this.tier)) return u;
    return this.tier;
  }

  private set(tier: number): boolean {
    this.clear();
    if (tier === this.tier) return false;
    this.tier = tier;
    this.settle = true;
    return true;
  }

  private clear(): void {
    this.winT = this.winN = 0;
    this.slowT = this.slowN = this.fastT = 0;
  }
}

/** What the device is, as far as choosing a start tier goes. */
export interface Device {
  /** A phone or tablet (coarse pointer). */
  touch: boolean;
  /** The GPU string (WEBGL_debug_renderer_info), '' when unknown. */
  gpu: string;
}

/** WebGL drawn on the CPU: SwiftShader, llvmpipe/softpipe/lavapipe, Windows' WARP. */
export const isSoftware = (gpu: string) => /swiftshader|llvmpipe|softpipe|lavapipe|software|basic render/i.test(gpu);

/** Where a device starts: software GL at the bottom, phones in the middle (they also get no MSAA), desktops at the top. */
export function startTier(d: Device): number {
  if (isSoftware(d.gpu)) return 0;
  return d.touch ? 3 : TOP;
}

/** `?quality=0..5`, or null. */
export function forcedTier(search: string): number | null {
  const q = new URLSearchParams(search).get('quality');
  if (q === null || !/^\d$/.test(q)) return null;
  const n = Number(q);
  return n <= TOP ? n : null;
}

/**
 * Looks at the device before the real context is made (MSAA has to be chosen then): a throwaway WebGL2
 * context, asked for the GPU's name and dropped at once.
 */
export function probeDevice(): Device {
  const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  let gpu = '';
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (gl) {
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      gpu = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '');
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  } catch {
    // no answer: treated as an ordinary GPU
  }
  return { touch, gpu };
}
