// Dummy launch, a side mode next to the cup: ride the run-up, let go at the ramp's lip and the dummy flies
// off, steered a little in the air, through a field of crates, barrels and cars. The score is the distance
// past the lip plus what it smashed, paid in cash. Deterministic on ticks like the race (so it can be tested),
// but nothing is recorded: a round is ten to twenty seconds and pays only the cash it shows.

import { DT, ROAD_HALF } from './config';
import { Prng } from './rng';

export const LAUNCH = {
  /** Career races before it opens. */
  unlock: 2,
  /** z of the ramp's lip (the run-up starts at 0), the ramp's length up to it and its height there. */
  lip: 90,
  rampL: 12,
  rampH: 3,
  accel: 7,
  top: 30,
  /** A release this far (m) before the lip is timed (`timing`); the best is `sweet` before it. */
  timing: 14,
  sweet: 2,
  /** Power when let go before the window, and when never let go (the dummy goes over the bars). */
  early: 0.2,
  late: 0.3,
  /** The take-off angle (35°) as numbers: no trig in the sim. */
  cos: 0.8192,
  sin: 0.5736,
  /** The ragdoll's (view/ragdoll.ts), so the drawn body flies the arc the sim does. */
  gravity: 20,
  steerRun: 3,
  steerAir: 8,
  steerGround: 3,
  maxVx: 6,
  halfX: ROAD_HALF + 1,
  /** A landing keeps this much of the fall (bouncing up) and of the forward speed. */
  bounce: 0.38,
  skid: 0.72,
  /** Slower than this (m/s) down, a landing is a slide, not a bounce. */
  bounceMin: 3,
  /** m/s² of drag sliding along the ground; under `stopV` the round is over. */
  slide: 10,
  stopV: 1.2,
  maxT: 20,
  /** Cash per point of score, times the stage's prize. */
  cash: 0.25,
  field: { from: 110, to: 290, n: 32 },
} as const;

export type PropKind = 'crate' | 'barrel' | 'car';
export const PROP_KINDS: readonly PropKind[] = ['crate', 'barrel', 'car'];
/** r, h: the size hit; pts; keep: the share of forward speed kept going through; kick: the pop up (m/s). */
export const PROPS: Record<PropKind, { r: number; h: number; pts: number; keep: number; kick: number; odds: number }> = {
  crate: { r: 0.8, h: 1.3, pts: 15, keep: 0.9, kick: 3, odds: 0.5 },
  barrel: { r: 0.6, h: 1.4, pts: 25, keep: 0.93, kick: 6, odds: 0.3 },
  car: { r: 1.5, h: 1.6, pts: 60, keep: 0.8, kick: 5, odds: 0.2 },
};

export interface Prop {
  id: number;
  kind: PropKind;
  x: number;
  z: number;
  hit: boolean;
}

export type LaunchEvent =
  | { type: 'release'; power: number; timed: boolean }
  | { type: 'smash'; prop: number; pts: number; combo: number }
  | { type: 'land'; speed: number }
  | { type: 'done' };

export class Launch {
  phase: 'run' | 'fly' | 'done' = 'run';
  tick = 0;
  /** The rider on the run-up; the dummy once let go (sim metres, y up). */
  x = 0;
  y = 0;
  z = 0;
  vx = 0;
  vy = 0;
  vz = 0;
  px = 0;
  py = 0;
  pz = 0;
  /** Run-up speed, and where the scooter was let go. */
  speed = 0;
  power = 0;
  pts = 0;
  smashed = 0;
  /** Props smashed since the last time it touched the ground: each one pays more. */
  combo = 0;
  readonly props: Prop[] = [];
  readonly events: LaunchEvent[] = [];
  readonly input = { release: false, steer: 0 };

  constructor(seed: number) {
    const rng = new Prng(seed * 31 + 9);
    const { from, to, n } = LAUNCH.field;
    for (let i = 0; i < n; i++) {
      const roll = rng.int(1000) / 1000;
      const kind: PropKind = roll < PROPS.crate.odds ? 'crate' : roll < PROPS.crate.odds + PROPS.barrel.odds ? 'barrel' : 'car';
      const z = from + ((to - from) * (i + rng.int(1000) / 1000)) / n;
      const x = (rng.int(1000) / 1000 - 0.5) * 2 * (ROAD_HALF - 1.5);
      this.props.push({ id: i, kind, x, z, hit: false });
    }
  }

  /** Metres past the lip. */
  get dist(): number {
    return Math.max(0, this.z - LAUNCH.lip);
  }

  get score(): number {
    return Math.round(this.dist) + this.pts;
  }

  /** Height of the run-up under z. */
  static ramp(z: number): number {
    const k = (z - (LAUNCH.lip - LAUNCH.rampL)) / LAUNCH.rampL;
    return k <= 0 || k > 1 ? 0 : LAUNCH.rampH * k;
  }

  step(): void {
    if (this.phase === 'done') return;
    this.px = this.x;
    this.py = this.y;
    this.pz = this.z;
    this.tick++;
    const steer = Math.max(-1, Math.min(1, this.input.steer));
    if (this.phase === 'run') this.run(steer);
    else this.fly(steer);
    this.input.release = false;
    if (this.phase === 'fly' && this.tick * DT >= LAUNCH.maxT) this.finish();
  }

  private run(steer: number): void {
    const L = LAUNCH;
    this.speed = Math.min(L.top, this.speed + L.accel * DT);
    this.z += this.speed * DT;
    this.x = Math.max(-1.2, Math.min(1.2, this.x + steer * L.steerRun * DT));
    this.y = Launch.ramp(this.z);
    const before = L.lip - this.z;
    if (this.input.release || before <= 0) {
      let power: number = L.late;
      const timed = this.input.release && before > 0 && before <= L.timing;
      if (timed) power = 0.45 + 0.55 * (1 - Math.abs(before - L.sweet) / L.timing);
      else if (this.input.release && before > L.timing) power = L.early;
      this.power = power;
      const v = this.speed * (0.55 + 0.75 * power);
      // off the ramp at its angle; let go on the flat, the dummy just hops off
      const up = this.y > 0 || before <= 0 ? L.sin : 0.35;
      this.vz = v * (up === L.sin ? L.cos : 0.94);
      this.vy = v * up;
      this.vx = 0;
      this.phase = 'fly';
      this.events.push({ type: 'release', power, timed });
    }
  }

  private fly(steer: number): void {
    const L = LAUNCH;
    const air = this.y > 0 || this.vy > 0;
    this.vx = Math.max(-L.maxVx, Math.min(L.maxVx, this.vx + steer * (air ? L.steerAir : L.steerGround) * DT));
    if (air) this.vy -= L.gravity * DT;
    this.x += this.vx * DT;
    this.y += this.vy * DT;
    this.z += this.vz * DT;
    if (Math.abs(this.x) > L.halfX) {
      this.x = Math.sign(this.x) * L.halfX;
      this.vx = -this.vx * 0.4;
    }
    if (this.y <= 0) {
      this.y = 0;
      if (this.vy < -L.bounceMin) {
        this.events.push({ type: 'land', speed: -this.vy });
        this.vy = -this.vy * L.bounce;
        this.vz *= L.skid;
      } else {
        this.vy = 0;
        this.vz = Math.max(0, this.vz - L.slide * DT);
        this.vx *= 0.95;
      }
      this.combo = 0;
    }
    this.smash();
    if (this.y === 0 && this.vy === 0 && this.vz < L.stopV) this.finish();
  }

  private smash(): void {
    for (const p of this.props) {
      if (p.hit || Math.abs(p.z - this.z) > 2) continue;
      const k = PROPS[p.kind];
      const dx = this.x - p.x;
      const dz = this.z - p.z;
      const r = k.r + 0.4;
      if (dx * dx + dz * dz > r * r || this.y > k.h) continue;
      p.hit = true;
      this.combo++;
      const pts = k.pts * this.combo;
      this.pts += pts;
      this.smashed++;
      this.vz *= k.keep;
      this.vy = Math.max(this.vy, k.kick);
      this.vx += (dx >= 0 ? 1 : -1) * 1.5;
      this.events.push({ type: 'smash', prop: p.id, pts, combo: this.combo });
    }
  }

  private finish(): void {
    this.phase = 'done';
    this.vx = this.vy = this.vz = 0;
    this.events.push({ type: 'done' });
  }
}

/** The cash a round pays, at the stage's prize. */
export const launchCash = (l: Launch, prize: number): number => Math.round(l.score * LAUNCH.cash * prize);
