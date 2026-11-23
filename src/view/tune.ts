// Race music made in code: a 16-bar loop per seed (a lead, a bass, an arpeggio and drums), so a three-hour
// career doesn't run on three tracks and nothing more is downloaded. Built from safe parts: a known chord
// loop, a lead that lands on chord tones on the beat and steps through the scale between, a motif that comes
// back, and a second half that climbs. `compose` is the score; `Renderer` turns it into samples a slice at a
// time, so the race's countdown doesn't stall while it is made.
// 3.3.74: the band is a circus band now -- piccolo, tuba, banjo, marching snare, woodblock -- not a chiptune
// one. The score barely changed; what wore a listener down was the timbre (a pulse wave's edge for two
// minutes) and the groove (a bass on six of eight eighths). The tuba plays oom-pah on the quarters instead.
// Then: "the accent is too strong" -- and, once they had heard the parts separately, "it's the tuba". It
// was: beats 1 and 3 peaked 5.3 dB over 2 and 4, and a ladder of five renders put the blame on the
// oom-pah bounce rather than the tuba's volume. They chose the end of the ladder, so the tuba is gone.

/** A small seeded generator (mulberry32): the same seed, the same tune. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Voice = 'lead' | 'arp' | 'kick' | 'snare' | 'hat';
export interface Note { v: Voice; at: number; len: number; midi: number; vel: number }
export interface Song { bpm: number; secs: number; notes: Note[] }

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];
/** Chord loops as scale degrees (0 = the tonic), two bars each... four chords, eight bars, twice. */
const LOOPS: Record<'major' | 'minor', number[][]> = {
  major: [[0, 4, 5, 3], [0, 5, 3, 4], [3, 4, 0, 5], [0, 3, 4, 4]],
  minor: [[0, 5, 2, 6], [0, 6, 5, 6], [0, 3, 6, 2], [0, 5, 3, 4]],
};
/** One-bar lead rhythms in eighths: 1 starts a note, 0 holds or rests (the note runs to the next 1, max 3). */
const RHYTHMS = [
  [1, 0, 1, 1, 1, 0, 1, 0],
  [1, 1, 0, 1, 1, 0, 1, 1],
  [1, 0, 0, 1, 0, 1, 1, 0],
  [1, 1, 1, 0, 1, 0, 0, 0],
  [1, 0, 1, 0, 1, 1, 1, 1],
];
/** Drum bars in sixteenths: k kick, s snare, h hat, x snare and hat. Sparse first, busy last: the loop's
 *  first half draws from the calm end (3.3.68), so there is somewhere for the second half to go. */
const BEATS = [
  'k...s...k...s...',
  'k.h.s...k.h.s.h.',
  'k.h.s.h.k.hkx.h.',
  'k.h.s.hkk.h.s.hh',
  'k.hhs.h.k.k.s.h.',
];

export interface TuneOpts { seed: number; /** a boss race: faster and in minor */ boss?: boolean }

export function compose({ seed, boss }: TuneOpts): Song {
  const r = rng(seed * 2654435761 + 1);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
  const mode = boss || r() < 0.45 ? 'minor' : 'major';
  const scale = mode === 'major' ? MAJOR : MINOR;
  const root = 45 + Math.floor(r() * 8); // A2..E3
  // 3.3.68: 138-156 (boss 164-182) was a sprint, and a sprint is tiring to sit next to for a whole race.
  // The loop is 16 bars either way, so slowing it also makes it 30-34 s instead of 23-27 and comes round
  // fewer times.
  const bpm = Math.round((boss ? 132 : 112) + r() * 16);
  const loop = pick(LOOPS[mode]);
  const beat = pick(BEATS.slice(0, 3));
  const beatB = pick(BEATS.slice(1));
  const eighth = 30 / bpm;
  const bar = eighth * 8;
  const notes: Note[] = [];
  /** MIDI note of scale degree d (any integer: 7 is the octave up). */
  const deg = (d: number, base = root) => base + 12 * Math.floor(d / 7) + scale[((d % 7) + 7) % 7];
  const chordAt = (b: number) => loop[Math.floor(b / 2) % 4];

  // the lead: two motifs (a, b) over bars, as degree offsets; section B plays it a third higher
  const motif = () => {
    const rh = pick(RHYTHMS);
    const steps: number[] = [];
    let d = 0;
    for (let i = 0; i < 8; i++) if (rh[i]) { steps.push(d); d += pick([-2, -1, -1, 1, 1, 2, 0]); }
    return { rh, steps };
  };
  const a = motif(), b = motif(), c = motif();
  const plan = [a, b, a, c, a, b, c, a];
  let prev = -1;
  for (let bi = 0; bi < 16; bi++) {
    const m = plan[bi % 8];
    const ch = chordAt(bi);
    const lift = bi >= 8 ? 2 : 0;
    const t0 = bi * bar;
    let k = 0;
    for (let i = 0; i < 8; i++) {
      if (!m.rh[i]) continue;
      let j = i + 1;
      while (j < 8 && !m.rh[j] && j - i < 3) j++;
      let d = 7 + ch + lift + m.steps[k++];
      // on the beat, the nearest chord tone (root, third, fifth of this chord)
      if (i % 2 === 0) {
        const tones = [ch, ch + 2, ch + 4].flatMap((x) => [x, x + 7, x + 14]);
        d = tones.reduce((best, x) => (Math.abs(x - d) < Math.abs(best - d) ? x : best), tones[0]);
      }
      // the last bar of each half ends on the tonic, held
      const end = bi % 8 === 7 && i >= 4;
      if (end) d = lift ? 14 : 7;
      // of its octaves inside the lead's range, the one nearest the last note: no wild leaps
      const aim = prev >= 0 ? prev : root + 19;
      let best = d;
      for (let k = -3; k <= 3; k++) {
        const m = deg(d + 7 * k);
        if (m < root + 7 || m > root + 31) continue;
        if (deg(best) < root + 7 || deg(best) > root + 31 || Math.abs(m - aim) < Math.abs(deg(best) - aim)) best = d + 7 * k;
      }
      d = best;
      prev = deg(d);
      notes.push({ v: 'lead', at: t0 + i * eighth, len: (end ? 8 - i : j - i) * eighth * (end ? 0.9 : 0.82), midi: prev, vel: end ? 0.9 : i % 4 === 0 ? 1.0 : 0.8 });
      if (end) break;
    }
    // No bass. The circus band had a tuba playing oom-pah on the quarters, and that bounce is what the
    // player kept hearing as "the accent": measured, it put beats 1 and 3 five decibels over 2 and 4, and
    // taking the tuba out was the only version of less that they liked. It costs the low end -- until the
    // banjo arrives at bar 12 there is a piccolo and drums and nothing underneath -- which is the trade
    // they chose after hearing both. `git show 8ecdb08^:src/view/tune.ts` has the tuba if it is ever wanted.
    // arpeggio over the climb: chord tones up in sixteenths. It used to run from bar 8, which put
    // sixteenths under the lead for half of every loop; four bars make it the lift it was meant to be.
    if (bi >= 12) for (let i = 0; i < 16; i++) {
      const d = ch + [0, 2, 4, 7][i % 4];
      notes.push({ v: 'arp', at: t0 + (i * eighth) / 2, len: eighth * 0.4, midi: deg(d, root + 12), vel: 0.5 });
    }
    // drums: the second half's pattern from bar 8, a fill on each half's last bar
    const pat = bi >= 8 ? beatB : beat;
    for (let i = 0; i < 16; i++) {
      const at = t0 + (i * eighth) / 2;
      const ch2 = bi % 8 === 7 && i >= 12 ? 's' : pat[i];
      if (ch2 === 'k') notes.push({ v: 'kick', at, len: 0.18, midi: 0, vel: 1 });
      if (ch2 === 's' || ch2 === 'x') notes.push({ v: 'snare', at, len: 0.14, midi: 0, vel: bi % 8 === 7 && i >= 12 ? 0.6 + 0.1 * (i - 12) : 1 });
      // the hat is a woodblock now, and a woodblock on the sixteenth off-beats is a rattle: only on eighths.
      if ((ch2 === 'h' || ch2 === 'x') && i % 2 === 0) notes.push({ v: 'hat', at, len: 0.04, midi: 0, vel: 0.55 });
    }
  }
  notes.sort((x, y) => x.at - y.at);
  return { bpm, secs: bar * 16, notes };
}

const hz = (m: number) => 440 * 2 ** ((m - 69) / 12);

/** The band: a piccolo on the lead, a banjo on the arpeggio, a marching snare and a woodblock -- and
 *  nothing on the bass at all. Every drum pattern puts the kick on beats 1 and 3 and the snare on 2 and 4,
 *  so the gap between these two numbers *is* the accent the player kept hearing: at 0.6 against 0.3 the odd
 *  beats peaked 5.9 dB over the even ones, averaged over all 84 tunes. Levelling the two is a fader move,
 *  not a rewrite -- the melody and the patterns are untouched, the beat just stops leaning. See 3.3.75. */
const GAIN: Record<Voice, number> = { lead: 0.2, arp: 0.12, kick: 0.36, snare: 0.38, hat: 0.15 };

/** Straight through under 0.7, rounded over it towards a 0.94 ceiling: a peak limiter rather than a
 *  shaper on everything. */
const knee = (v: number): number => {
  const a = Math.abs(v);
  return a <= 0.7 ? v : Math.sign(v) * (0.7 + 0.24 * Math.tanh((a - 0.7) / 0.24));
};

/** One-pole coefficient for a cutoff of `fc` at `sr`. */
const pole = (fc: number, sr: number): number => 1 - Math.exp((-2 * Math.PI * fc) / sr);

/** What a made tune is rendered to. It used to be the mp3 tracks' own level (RMS about 0.34) so the music
 *  wouldn't drop when the cup moved from a file to a made track -- but matching a mastered recording's RMS
 *  with square waves is matching the wrong number: the same RMS from a mid-heavy pulse is a good deal louder
 *  to the ear, and it left nothing between the loop and the ceiling. 3.3.67 sits about 2 dB under the files
 *  on purpose. */
export const TARGET_RMS = 0.27;
/** 3.3.74: and what it is never allowed past. A circus band has a crest factor around 5 -- a tuba note and a
 *  woodblock tick are not the same size -- so lifting it to an RMS of 0.27 meant pushing 2.4% of the samples
 *  into the knee, which is the "over-compressed, sounds odd" the player heard. Whichever of the two limits
 *  bites first wins; for this band it is the ceiling, costing about 4.5 dB that `MUSIC_VOL` gives back. */
export const PEAK_CEIL = 0.82;
const CHUNK = 4096;

/** Turns a song into samples a bit per `step()`: the notes, then a pass that measures the loudness and the
 *  loudest sample, then one that scales by whichever of `TARGET_RMS` and `PEAK_CEIL` allows less and rounds
 *  off anything still over 0.7. `done` after that. The loop wraps note tails.
 *  3.3.67 made that last pass a knee instead of a `tanh` over everything; 3.3.74 made it a safety net rather
 *  than the plan, because with the ceiling in the gain there is almost nothing left for it to catch. */
export class Renderer {
  readonly out: Float32Array;
  private i = 0;
  private k = 0;
  private sq = 0;
  private pk = 0;
  private gain = 0;
  private noise = rng(7);
  constructor(private readonly song: Song, private readonly sr: number) {
    this.out = new Float32Array(Math.round(song.secs * sr));
  }

  get done(): boolean {
    return this.gain > 0 && this.k >= this.out.length;
  }

  /** Render up to `n` notes, or once they are in, measure or scale `n` chunks of samples. */
  step(n = 48): void {
    const { out, song } = this;
    if (this.i < song.notes.length) {
      const end = Math.min(song.notes.length, this.i + n);
      for (; this.i < end; this.i++) this.note(song.notes[this.i]);
      return;
    }
    const end = Math.min(out.length, this.k + n * CHUNK);
    if (!this.gain) {
      for (; this.k < end; this.k++) {
        const v = out[this.k];
        this.sq += v * v;
        this.pk = Math.max(this.pk, Math.abs(v));
      }
      if (this.k >= out.length) {
        const rms = Math.max(1e-4, Math.sqrt(this.sq / out.length));
        this.gain = Math.min(TARGET_RMS / rms, PEAK_CEIL / Math.max(1e-4, this.pk));
        this.k = 0;
      }
      return;
    }
    for (; this.k < end; this.k++) out[this.k] = knee(out[this.k] * this.gain);
  }

  /** How long a voice sounds past the note it was written: a plucked string rings, a struck thing is over
   *  almost at once, a blown one stops when the player stops. */
  private span(nt: Note): number {
    if (nt.v === 'arp') return Math.max(nt.len, 0.38); // the banjo rings past the note it was written
    // each drum runs until its own decay is 40 dB down; a flat 0.2 s spent a third of the render on a
    // woodblock that had been silent for 120 ms of it
    if (nt.v === 'kick') return 0.2;
    if (nt.v === 'snare') return 0.14;
    if (nt.v === 'hat') return 0.08;
    return nt.len + 0.06;
  }

  private note(nt: Note): void {
    const { sr, out } = this;
    const L = out.length;
    const s0 = Math.round(nt.at * sr);
    const len = Math.round(this.span(nt) * sr);
    const g = GAIN[nt.v] * nt.vel;
    const f = hz(nt.midi);
    let ph = 0;
    let lp1 = 0, hp = 0;
    for (let k = 0; k < len; k++) {
      const t = k / sr;
      let v = 0;
      switch (nt.v) {
        case 'lead': { // piccolo: a bright pipe with a little breath on top and a late vibrato
          const vib = t > 0.09 ? 0.006 * Math.sin(2 * Math.PI * 5.5 * t) : 0;
          v = Math.sin(2 * Math.PI * f * t * (1 + vib)) + 0.18 * Math.sin(4 * Math.PI * f * t) + (this.noise() * 2 - 1) * 0.05;
          v *= Math.min(1, t / 0.02) * (t < nt.len ? 1 : Math.max(0, 1 - (t - nt.len) / 0.05));
          break;
        }
        case 'arp': { // banjo: a plucked string whose filter closes as it dies
          ph += f / sr;
          if (ph >= 1) ph -= 1;
          v = 2 * ph - 1;
          const b = pole(Math.max(600, f * 7) * Math.exp(-t * 3), sr);
          lp1 += b * (v - lp1);
          v = lp1 * 1.4 * Math.exp(-t * 9) * Math.min(1, t / 0.001);
          break;
        }
        case 'kick': {
          ph += (45 + 110 * Math.exp(-t * 28)) / sr;
          v = Math.sin(2 * Math.PI * ph) * Math.exp(-t * 14) * Math.min(1, t / 0.002);
          break;
        }
        case 'snare': { // a marching snare: tighter and drier than the kit one it replaces
          const n0 = this.noise() * 2 - 1;
          hp += 0.65 * (n0 - hp);
          v = ((n0 - hp) + Math.sin(2 * Math.PI * 240 * t) * 0.3) * Math.exp(-t * 30);
          break;
        }
        case 'hat': { // woodblock: the cartoon tick
          v = (Math.sin(2 * Math.PI * 1150 * t) + 0.5 * Math.sin(2 * Math.PI * 2300 * t)) * Math.exp(-t * 75);
          v += (this.noise() * 2 - 1) * Math.exp(-t * 300) * 0.4;
          break;
        }
      }
      out[(s0 + k) % L] += v * g;
    }
  }
}
