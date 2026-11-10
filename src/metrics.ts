// The pure half of the analytics (src/telemetry.ts sends them): the `performance_sample` window and a
// race's own stutter count, as Playgama's telemetry guide defines them (the same as Holy Kicker's), and the
// bounded dimensions: the career bucket, the progression step, the device. No DOM here, so it is tested.

import * as C from './sim/config';

export type Props = Record<string, string | number | boolean>;

/** The frame rate the game aims for. */
export const TARGET_FPS = 60;
/** Active racing ms in one sample. */
export const SAMPLE_MS = 30_000;
/** A shorter stretch, left over as a race ends or the game goes to the background, is not sent. */
export const SAMPLE_MIN_MS = 5_000;
/** A frame this long is a gap the page did not report (hidden, throttled), not a frame. */
export const GAP_MS = 5_000;
/** A frame this long in a race is a stall worth an error report. */
export const STALL_MS = 1_000;
const OVER = [50, 100, 250, 500, 1000] as const;

/** The value at fraction `q` of the sorted list (nearest rank). */
export function at(sorted: readonly number[], q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))];
}

const round1 = (x: number) => Math.round(x * 10) / 10;

/** Frames of `ms` or longer in a sorted list. */
function countOver(sorted: readonly number[], ms: number): number {
  const i = sorted.findIndex((x) => x >= ms);
  return i < 0 ? 0 : sorted.length - i;
}

/** Collects race frames into `performance_sample` windows (the required fields; the optional ones are the caller's). */
export class PerfSampler {
  private frames: number[] = [];
  private active = 0;
  private start = 0;
  private skip = false;

  constructor(
    private readonly build: string,
    /** Wall clock in ms (performance.now in the game). */
    private readonly now: () => number,
  ) {}

  /** One race frame's length; the full sample once SAMPLE_MS of them are in, else null. */
  frame(ms: number): Props | null {
    if (this.skip) return (this.skip = false), null;
    if (!(ms > 0) || ms >= GAP_MS) return null;
    if (this.frames.length === 0) this.start = this.now() - ms;
    this.frames.push(ms);
    this.active += ms;
    return this.active >= SAMPLE_MS ? this.take() : null;
  }

  /**
   * What is measured so far, if at least SAMPLE_MIN_MS (a race ended, the game was hidden or paused); starts
   * afresh either way, leaving out the next frame, which may span the time the game was away.
   */
  flush(): Props | null {
    this.skip = true;
    return this.active >= SAMPLE_MIN_MS ? this.take() : (this.reset(), null);
  }

  private take(): Props {
    const sorted = [...this.frames].sort((a, b) => a - b);
    const n = sorted.length;
    const props: Props = {
      target_fps: TARGET_FPS,
      window_ms: Math.round(Math.max(this.now() - this.start, this.active)),
      active_ms: Math.round(this.active),
      frame_count: n,
      fps_avg: round1((n * 1000) / this.active),
      fps_p10: round1(1000 / at(sorted, 0.9)),
      frame_time_p50_ms: round1(at(sorted, 0.5)),
      frame_time_p95_ms: round1(at(sorted, 0.95)),
      frame_time_p99_ms: round1(at(sorted, 0.99)),
      frame_time_max_ms: round1(sorted[n - 1]),
      build_version: this.build,
    };
    for (const o of OVER) props[`frames_over_${o}ms`] = countOver(sorted, o);
    this.reset();
    return props;
  }

  private reset(): void {
    this.frames = [];
    this.active = 0;
  }
}

/**
 * One race's frames as fields on its progression_completed / progression_failed: how many, their mean
 * rate, the longest, and how many took 100 ms or more up to 1 s or more, so a race's stutters sit next to
 * how it ended. Gaps and the frame after the game was away are left out as in PerfSampler.
 */
export class RunStutter {
  private count = 0;
  private active = 0;
  private max = 0;
  private over = OVER.map(() => 0);
  private skip = false;

  reset(): void {
    this.count = this.active = this.max = 0;
    this.over = OVER.map(() => 0);
    this.skip = false;
  }

  frame(ms: number): void {
    if (this.skip) return void (this.skip = false);
    if (!(ms > 0) || ms >= GAP_MS) return;
    this.count++;
    this.active += ms;
    this.max = Math.max(this.max, ms);
    OVER.forEach((o, i) => ms >= o && this.over[i]++);
  }

  /** The game was away (hidden, paused): its next frame may span that time. */
  away(): void {
    this.skip = true;
  }

  fields(): Props {
    const props: Props = {
      run_frame_count: this.count,
      run_fps_avg: this.active > 0 ? round1((this.count * 1000) / this.active) : 0,
      run_frame_max_ms: round1(this.max),
    };
    OVER.forEach((o, i) => o >= 100 && (props[`run_frames_over_${o}ms`] = this.over[i]));
    return props;
  }
}

/** Races in the career as a bounded bucket: the cohort on every event. */
export function careerBucket(races: number): string {
  return races <= 0 ? '0' : races < 5 ? '1-4' : races < 20 ? '5-19' : races < 50 ? '20-49' : races < 100 ? '50-99' : '100+';
}

/** A division of a season as one bounded step: `amateur_rookie_cup`, `legend_neon_coast` (15 of them). */
export function stepId(div: number, tier: number): string {
  const d = C.DIVISIONS[Math.max(0, Math.min(C.DIVISIONS.length - 1, div))];
  const t = C.TIERS[Math.max(0, Math.min(C.TIERS.length - 1, tier))];
  return `${t.name}_${d.name}`.toLowerCase().replace(/\s+/g, '_');
}

/** The step and the race in its cup as the ordered position on the whole ladder, 1 the career's first race. */
export function stepIndex(div: number, tier: number, cupRace: number, cupRaces: number): number {
  return C.rung(div, tier) * cupRaces + cupRace;
}

/**
 * Where the player plays: `device` the system family (`ios`, `android`, `desktop` for Windows, Mac, Linux
 * and ChromeOS, else `other`), `form` Bridge's device type (`unknown` when it does not say) and `touch`
 * whether the screen takes touches. An iPad passes for a Mac but has touch points.
 */
export function deviceFields(ua: string, touchPoints: number, bridgeType: string | null): Props {
  const ipad = /iPad/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1);
  const device = ipad || /iPhone|iPod/.test(ua) ? 'ios'
    : /Android/.test(ua) ? 'android'
    : /Windows|Macintosh|Linux|CrOS/.test(ua) ? 'desktop'
    : 'other';
  const form = bridgeType === 'mobile' || bridgeType === 'tablet' || bridgeType === 'desktop' ? bridgeType : 'unknown';
  return { device, form, touch: touchPoints > 0 };
}

/** UTC day number (days since 1970), for days since the first session. */
export const dayOf = (ms: number): number => Math.floor(ms / 86_400_000);
