// Tiny synthesized sounds: hollow plastic thunks, whooshes, a siren chirp, coins. No files.

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
export let muted = false;

export function unlockAudio(): void {
  if (ctx) { if (ctx.state === 'suspended') void ctx.resume(); return; }
  try {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  } catch {
    ctx = null;
  }
}

export function setMuted(m: boolean): void {
  muted = m;
  if (master) master.gain.value = m ? 0 : 0.5;
}

export function suspendAudio(on: boolean): void {
  if (!ctx) return;
  if (on) void ctx.suspend();
  else void ctx.resume();
}

function env(g: GainNode, t: number, peak: number, dur: number): void {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
}

function tone(type: OscillatorType, f0: number, f1: number, dur: number, peak: number, delay = 0): void {
  if (!ctx || !master) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  env(g, t, peak, dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(freq: number, q: number, dur: number, peak: number, sweepTo?: number): void {
  if (!ctx || !master || !noiseBuf) return;
  const t = ctx.currentTime;
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.setValueAtTime(freq, t);
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
  f.Q.value = q;
  const g = ctx.createGain();
  env(g, t, peak, dur);
  s.connect(f).connect(g).connect(master);
  s.start(t);
  s.stop(t + dur + 0.02);
}

export const sfx = {
  /** The dummy's hollow plastic body taking a slap. */
  thunk(big: boolean): void {
    tone('sine', big ? 190 : 240, 70, big ? 0.22 : 0.14, big ? 0.9 : 0.6);
    tone('triangle', 520, 300, 0.05, 0.25);
    noise(1400, 1.2, 0.06, 0.35);
  },
  /** Plastic decks grinding together. */
  scrape(loud: boolean): void {
    noise(2600, 3, 0.11, loud ? 0.22 : 0.08, 1700);
  },
  whoosh(): void {
    noise(600, 0.8, 0.16, 0.18, 2400);
  },
  crash(): void {
    noise(300, 0.6, 0.45, 0.6, 90);
    tone('sine', 120, 45, 0.35, 0.7);
    tone('square', 900, 400, 0.06, 0.08, 0.05);
  },
  siren(): void {
    tone('square', 880, 880, 0.12, 0.12);
    tone('square', 660, 660, 0.12, 0.12, 0.14);
  },
  /** Rising two-note alarm: someone is coming for the leader. */
  alarm(): void {
    tone('sawtooth', 330, 520, 0.16, 0.14);
    tone('sawtooth', 330, 620, 0.2, 0.16, 0.18);
  },
  pickup(): void {
    tone('triangle', 520, 1040, 0.12, 0.3);
  },
  beep(go: boolean): void {
    tone('sine', go ? 880 : 440, go ? 880 : 440, go ? 0.35 : 0.15, 0.35);
  },
  coin(): void {
    tone('square', 990, 990, 0.05, 0.12);
    tone('square', 1320, 1320, 0.12, 0.12, 0.06);
  },
};
