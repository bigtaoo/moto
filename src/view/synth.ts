// The round-4 effects (a cow's moo, a hydrant's hiss, oil glugging out and a rider slipping on it, a
// tumbleweed's rustle, the taunt's boing, the boss's fanfare, bowling pins, a crate cracking, a barrel's
// clang) made from code into sample buffers once audio unlocks: no files to fetch, nothing on the bundle
// but this. Each is a function of the sample rate returning mono samples in -1..1.

const TAU = Math.PI * 2;
type Gen = (sr: number) => Float32Array;

/** `secs` of samples, each from `f(t, i)`, faded out over the last 15 ms so none ends on a click. */
function make(sr: number, secs: number, f: (t: number, i: number) => number): Float32Array {
  const out = new Float32Array(Math.ceil(sr * secs));
  const fade = Math.ceil(sr * 0.015);
  for (let i = 0; i < out.length; i++) out[i] = f(i / sr, i) * Math.min(1, (out.length - 1 - i) / fade);
  return out;
}

/** Rise over `a` seconds, then fall away with time constant `d`. */
const env = (t: number, a: number, d: number) => (t < a ? t / a : Math.exp(-(t - a) / d));
const noise = () => Math.random() * 2 - 1;

/** A one-pole low-pass, `k` 0..1 per sample (higher: brighter). */
function lowpass() {
  let y = 0;
  return (x: number, k: number) => (y += k * (x - y));
}

/** Scale to a peak of `peak`. */
function norm(s: Float32Array, peak = 0.9): Float32Array {
  let m = 0;
  for (const v of s) m = Math.max(m, Math.abs(v));
  if (m > 0) for (let i = 0; i < s.length; i++) s[i] *= peak / m;
  return s;
}

/** Decaying sine partials [freq, gain, decay], struck at `at` seconds. */
function strike(t: number, at: number, parts: readonly (readonly [number, number, number])[]): number {
  const u = t - at;
  if (u < 0) return 0;
  let v = 0;
  for (const [f, g, d] of parts) v += Math.sin(TAU * f * u) * g * Math.exp(-u / d);
  return v * Math.min(1, u * 2000);
}

export const SYNTHS = {
  /** A low sawtooth that sags in pitch, through a filter that opens and closes: mmmOOOoo. */
  moo: (sr) => {
    const lp = lowpass();
    let ph = 0;
    return norm(make(sr, 1.1, (t) => {
      const f = 150 - 40 * t + 3 * Math.sin(TAU * 5 * t);
      ph = (ph + f / sr) % 1;
      const open = 0.02 + 0.06 * Math.sin(Math.PI * Math.min(1, t / 1.0));
      const a = t < 0.12 ? t / 0.12 : t > 0.85 ? Math.max(0, (1.1 - t) / 0.25) : 1;
      return lp(ph * 2 - 1, open) * a;
    }));
  },
  /** Hiss that bursts and settles, with a splashy flutter. */
  spray: (sr) => {
    const lp = lowpass();
    return norm(make(sr, 0.9, (t) => {
      const n = noise();
      const hi = n - lp(n, 0.25);
      return hi * env(t, 0.04, 0.35) * (0.8 + 0.2 * Math.sin(TAU * 23 * t));
    }), 0.7);
  },
  /** Three bubbles rising out of a can. */
  glug: (sr) => norm(make(sr, 0.5, (t) => {
    let v = 0;
    for (let k = 0; k < 3; k++) {
      const u = t - k * 0.13;
      if (u < 0 || u > 0.12) continue;
      const f = 180 + k * 40 + 900 * u;
      v += Math.sin(TAU * f * u) * Math.sin((Math.PI * u) / 0.12);
    }
    return v;
  })),
  /** A slide whistle falling away: a foot gone on the oil. */
  slip: (sr) => {
    let ph = 0;
    return norm(make(sr, 0.55, (t) => {
      const f = 1400 * Math.exp(-t * 3.2) + 250 + 18 * Math.sin(TAU * 7 * t);
      ph += f / sr;
      return Math.sin(TAU * ph) * env(t, 0.02, 0.3);
    }), 0.6);
  },
  /** Dry twigs crackling: sparse clicks in a soft brush of noise. */
  rustle: (sr) => {
    const lp = lowpass();
    return norm(make(sr, 0.45, (t) => {
      const n = noise();
      const click = Math.random() < 0.006 ? noise() * 1.2 : 0;
      return (lp(n, 0.4) + click) * env(t, 0.03, 0.15);
    }), 0.7);
  },
  /** A spring boing that wobbles up: the taunt. */
  boing: (sr) => {
    let ph = 0;
    return norm(make(sr, 0.6, (t) => {
      const f = 260 + 260 * t + 90 * Math.sin(TAU * 14 * t) * Math.exp(-t * 4);
      ph += f / sr;
      return Math.sin(TAU * ph) * env(t, 0.005, 0.25);
    }), 0.7);
  },
  /** Four square-wave notes up the chord, the last held: the boss is down. */
  fanfare: (sr) => {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    return norm(make(sr, 0.85, (t) => {
      const k = Math.min(3, Math.floor(t / 0.09));
      const u = t - k * 0.09;
      const sq = Math.sin(TAU * notes[k] * u) > 0 ? 1 : -1;
      const a = k < 3 ? (u < 0.07 ? 1 : 0.2) : Math.exp(-u / 0.3);
      return sq * a * Math.min(1, u * 400) * 0.5;
    }), 0.5);
  },
  /** Five wooden pins knocking into each other. */
  pins: (sr) => {
    const hits = [0, 0.035, 0.07, 0.12, 0.19].map((at, k) => [at, 1 - k * 0.12, 1 + k * 0.07] as const);
    return norm(make(sr, 0.5, (t) => {
      let v = 0;
      for (const [at, g, s] of hits) {
        v += strike(t, at, [[780 * s, 0.6, 0.05], [1270 * s, 0.4, 0.035], [2050 * s, 0.25, 0.02]]) * g;
        if (t >= at && t - at < 0.01) v += noise() * 0.5 * g;
      }
      return v;
    }));
  },
  /** Planks snapping: a hard noise crack over a hollow knock. */
  crack: (sr) => {
    const lp = lowpass();
    return norm(make(sr, 0.35, (t) => {
      const n = noise();
      return (n - lp(n, 0.1)) * env(t, 0.001, 0.03) + strike(t, 0, [[190, 0.7, 0.07], [430, 0.3, 0.04]]);
    }));
  },
  /** A steel drum's inharmonic ring. */
  clang: (sr) => norm(make(sr, 0.9, (t) =>
    strike(t, 0, [[310, 0.6, 0.35], [833, 0.45, 0.22], [1297, 0.35, 0.15], [1980, 0.25, 0.09]]) + (t < 0.006 ? noise() * 0.6 : 0))),
} satisfies Record<string, Gen>;

export type SynthName = keyof typeof SYNTHS;
