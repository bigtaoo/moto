// Race music made in code: a 16-bar chiptune loop per seed (a lead, a bass, an arpeggio and drums), so a
// three-hour career doesn't run on three tracks and nothing more is downloaded. Built from safe parts: a
// known chord loop, a lead that lands on chord tones on the beat and steps through the scale between, a
// motif that comes back, and a second half that climbs. `compose` is the score; `Renderer` turns it into
// samples a slice at a time, so the race's countdown doesn't stall while it is made.

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

type Voice = 'lead' | 'bass' | 'arp' | 'kick' | 'snare' | 'hat';
export interface Note { v: Voice; at: number; len: number; midi: number; vel: number }
export interface Song { bpm: number; secs: number; notes: Note[]; duty: number }

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
/** Drum bars in sixteenths: k kick, s snare, h hat, x snare and hat. */
const BEATS = [
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
  const bpm = Math.round((boss ? 164 : 138) + r() * 18);
  const loop = pick(LOOPS[mode]);
  const beat = pick(BEATS);
  const beatB = pick(BEATS);
  const duty = pick([0.125, 0.25, 0.5]);
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
      notes.push({ v: 'lead', at: t0 + i * eighth, len: (end ? 8 - i : j - i) * eighth * (end ? 0.9 : 0.82), midi: prev, vel: end ? 0.9 : i % 4 === 0 ? 1 : 0.8 });
      if (end) break;
    }
    // bass: root on eighths, the octave on the off-beats, a fifth to walk into the next chord
    const low = ch > 4 ? ch - 7 : ch; // the chord's root within the bass's octave
    for (let i = 0; i < 8; i++) {
      const walk = i === 7 && bi % 2 === 1;
      notes.push({ v: 'bass', at: t0 + i * eighth, len: eighth * 0.75, midi: deg(walk ? low + 4 : low, root - 12) + (i % 2 && !walk ? 12 : 0), vel: i % 2 ? 0.7 : 1 });
    }
    // arpeggio in the second half: chord tones up in sixteenths
    if (bi >= 8) for (let i = 0; i < 16; i++) {
      const d = ch + [0, 2, 4, 7][i % 4];
      notes.push({ v: 'arp', at: t0 + (i * eighth) / 2, len: eighth * 0.4, midi: deg(d, root + 12), vel: 0.6 });
    }
    // drums: the second half's pattern from bar 8, a fill on each half's last bar
    const pat = bi >= 8 ? beatB : beat;
    for (let i = 0; i < 16; i++) {
      const at = t0 + (i * eighth) / 2;
      const ch2 = bi % 8 === 7 && i >= 12 ? 's' : pat[i];
      if (ch2 === 'k') notes.push({ v: 'kick', at, len: 0.18, midi: 0, vel: 1 });
      if (ch2 === 's' || ch2 === 'x') notes.push({ v: 'snare', at, len: 0.14, midi: 0, vel: bi % 8 === 7 && i >= 12 ? 0.6 + 0.1 * (i - 12) : 1 });
      if (ch2 === 'h' || ch2 === 'x') notes.push({ v: 'hat', at, len: 0.04, midi: 0, vel: 0.7 });
    }
  }
  notes.sort((x, y) => x.at - y.at);
  return { bpm, secs: bar * 16, notes, duty };
}

const hz = (m: number) => 440 * 2 ** ((m - 69) / 12);

/** PolyBLEP: rounds a waveform's jump so the square doesn't alias into a hiss. */
function blep(t: number, dt: number): number {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}

const GAIN: Record<Voice, number> = { lead: 0.2, bass: 0.34, arp: 0.08, kick: 0.6, snare: 0.22, hat: 0.07 };

/** The loudness the race's mp3 tracks sit at (RMS about 0.34): a made tune is brought up to it, so the music
 *  doesn't drop 5 dB when the cup moves from a file to a made track. */
export const TARGET_RMS = 0.33;
const CHUNK = 4096;

/** Turns a song into samples a bit per `step()`: the notes, then a pass that measures the loudness, then one
 *  that scales to `TARGET_RMS` through a soft clip (tanh) so the kick's peaks stay under 1. `done` after that.
 *  The loop wraps note tails. */
export class Renderer {
  readonly out: Float32Array;
  private i = 0;
  private k = 0;
  private sq = 0;
  private gain = 0;
  private noise = rng(7);
  private hp = 0;
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
      for (; this.k < end; this.k++) this.sq += out[this.k] * out[this.k];
      if (this.k >= out.length) {
        this.gain = TARGET_RMS / Math.max(1e-4, Math.sqrt(this.sq / out.length)) * 1.08; // tanh takes a little back
        this.k = 0;
      }
      return;
    }
    for (; this.k < end; this.k++) out[this.k] = Math.tanh(out[this.k] * this.gain);
  }

  private note(nt: Note): void {
    const { sr, out } = this;
    const L = out.length;
    const s0 = Math.round(nt.at * sr);
    const tail = nt.v === 'kick' || nt.v === 'snare' || nt.v === 'hat' ? 0 : 0.03;
    const len = Math.round((nt.len + tail) * sr);
    const g = GAIN[nt.v] * nt.vel;
    const f = hz(nt.midi);
    let ph = 0;
    for (let k = 0; k < len; k++) {
      const t = k / sr;
      let v = 0;
      switch (nt.v) {
        case 'lead': case 'arp': {
          const dt = (f * (1 + (nt.v === 'lead' && t > 0.12 ? 0.004 * Math.sin(2 * Math.PI * 6 * t) : 0))) / sr;
          ph += dt;
          if (ph >= 1) ph -= 1;
          const duty = nt.v === 'arp' ? 0.25 : this.song.duty;
          v = (ph < duty ? 1 : -1) + blep(ph, dt) - blep((ph - duty + 1) % 1, dt);
          v *= Math.min(1, t / 0.004) * (t < nt.len ? 1 - 0.25 * (t / nt.len) : Math.max(0, 1 - (t - nt.len) / tail) * 0.75);
          break;
        }
        case 'bass': {
          ph += f / sr;
          if (ph >= 1) ph -= 1;
          v = 1 - 4 * Math.abs(ph - 0.5); // triangle
          v *= Math.min(1, t / 0.003) * (t < nt.len ? 1 : Math.max(0, 1 - (t - nt.len) / tail));
          break;
        }
        case 'kick': {
          ph += (45 + 110 * Math.exp(-t * 28)) / sr;
          v = Math.sin(2 * Math.PI * ph) * Math.exp(-t * 14) * Math.min(1, t / 0.002);
          break;
        }
        case 'snare': {
          const n0 = this.noise() * 2 - 1;
          this.hp += 0.5 * (n0 - this.hp);
          v = ((n0 - this.hp) * 0.8 + Math.sin(2 * Math.PI * 190 * t) * 0.35) * Math.exp(-t * 22);
          break;
        }
        case 'hat': {
          const n0 = this.noise() * 2 - 1;
          this.hp += 0.8 * (n0 - this.hp);
          v = (n0 - this.hp) * Math.exp(-t * 90);
          break;
        }
      }
      out[(s0 + k) % L] += v * g;
    }
  }
}
