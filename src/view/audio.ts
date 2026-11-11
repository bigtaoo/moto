// Sound: recorded effects and chiptune music from public/audio (all CC0, see public/audio/CREDITS.txt),
// played through one Web Audio context, plus the round-4 effects made from code (./synth). The files are fetched at boot and decoded once the first tap or
// key has unlocked audio. Anything that should silence the game (the host's pause or mute, the player's
// pause or mute button, a hidden page, an ad) goes through `hold`/`setMuted`, so the rules live here.

import { SYNTHS, type SynthName } from './synth';
import { compose, Renderer } from './tune';

type FileTrack = 'title' | 'race1' | 'race2' | 'race3';
/** A file, or a tune made in code (./tune) from a seed: `gen12`, or a boss race's faster minor one, `boss12`. */
type Track = FileTrack | `gen${number}` | `boss${number}`;
const SFX = ['thunk1', 'thunk2', 'thunk3', 'thunk_big', 'scrape', 'whoosh1', 'whoosh2', 'dodge', 'crash', 'siren',
  'alarm', 'tell', 'pickup', 'count', 'go', 'cash', 'click'] as const;
type Name = (typeof SFX)[number] | Track | SynthName;
const isMade = (t: Track): t is `gen${number}` | `boss${number}` => t.startsWith('gen') || t.startsWith('boss');

const url = (n: Name) => `${import.meta.env.BASE_URL}audio/${n}.mp3`;
const MUSIC_VOL = 0.32;
const SFX_VOL = 0.75;
/** Effects sounding at once. A race fires 300-450 of them and they were piling up 8 deep (doc 3.3.29). */
const MAX_VOICES = 6;
/** The same effect again inside this gap is one event heard twice: +6 dB and no more news. */
const DEDUPE = 0.04;

/** One effect on its way out: the times are the context's, and `stop` cuts it short. */
export interface Voice {
  n: Name;
  start: number;
  end: number;
  vol: number;
  stop?: () => void;
}

/**
 * May this effect start? Refuses a repeat of a sound that began a moment ago, and once MAX_VOICES are
 * sounding refuses the new one unless it is louder than the quietest, which is then cut short to make room
 * -- so a crash is still heard over six whooshes, and six whooshes never become a wall.
 * Mutates `live` (it drops what has finished and appends what it admits); pure otherwise, hence testable.
 */
export function admit(live: Voice[], now: number, v: Voice, dedupe = DEDUPE, max = MAX_VOICES): boolean {
  for (let i = live.length - 1; i >= 0; i--) if (live[i].end <= now) live.splice(i, 1);
  if (live.some((o) => o.n === v.n && Math.abs(v.start - o.start) < dedupe)) return false;
  if (live.length >= max) {
    let worst = 0;
    for (let i = 1; i < live.length; i++) if (live[i].vol < live[worst].vol) worst = i;
    if (live[worst].vol >= v.vol) return false;
    live[worst].stop?.();
    live.splice(worst, 1);
  }
  live.push(v);
  return true;
}

/** The effects sounding right now (see `admit`). */
const live: Voice[] = [];

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let sfxBus: GainNode | null = null;
let musicBus: GainNode | null = null;
const raw = new Map<Name, Promise<ArrayBuffer | null>>();
const buffers = new Map<Name, AudioBuffer>();
const decoding = new Map<Name, Promise<AudioBuffer | null>>();
/** Why the game is silent right now ('host', 'pause', 'hidden', 'ad' ...); playing only when empty. */
const holds = new Set<string>();
const mutes = { host: false, player: false };
/** The player's music and effects switches (the pause menu), apart from the mute button. */
const channels = { music: true, sfx: true };
let wanted: Track | null = null;
let playing: { track: Track; src: AudioBufferSourceNode; gain: GainNode } | null = null;

/** Sound files that failed to load (for the asset_load_error_count in src/telemetry.ts). */
export const loadErrors = { n: 0 };
const failed = () => (loadErrors.n++, null);

function fetchRaw(n: Name): Promise<ArrayBuffer | null> {
  let p = raw.get(n);
  if (!p) {
    p = fetch(url(n)).then((r) => (r.ok ? r.arrayBuffer() : failed())).catch(failed);
    raw.set(n, p);
  }
  return p;
}

/** A tune made in code, in slices of about 4 ms between frames so the countdown doesn't hitch. */
function made(t: `gen${number}` | `boss${number}`): Promise<AudioBuffer | null> {
  return new Promise((done) => {
    if (!ctx) return done(null);
    const boss = t.startsWith('boss');
    const r = new Renderer(compose({ seed: Number(t.slice(boss ? 4 : 3)), boss }), ctx.sampleRate);
    const slice = () => {
      if (!ctx) return done(null);
      const t0 = performance.now();
      do r.step(4); while (!r.done && performance.now() - t0 < 4);
      if (!r.done) return void setTimeout(slice, 0);
      const b = ctx.createBuffer(1, r.out.length, ctx.sampleRate);
      b.getChannelData(0).set(r.out);
      buffers.set(t, b);
      done(b);
    };
    slice();
  });
}

function decode(n: Name): Promise<AudioBuffer | null> {
  let p = decoding.get(n);
  if (!p && isMade(n as Track)) {
    p = made(n as `gen${number}`);
    decoding.set(n, p);
  }
  if (!p) {
    p = fetchRaw(n).then(async (data) => {
      if (!data || !ctx) return null;
      try {
        const b = await ctx.decodeAudioData(data.slice(0));
        buffers.set(n, b);
        return b;
      } catch {
        return null;
      }
    });
    decoding.set(n, p);
  }
  return p;
}

/** Start downloading the effects (small) so they are there by the first race. */
export function preloadAudio(): void {
  for (const n of SFX) void fetchRaw(n);
}

/** Create or resume the audio context; needs a user gesture the first time. */
export function unlockAudio(): void {
  if (ctx) { apply(); return; }
  if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return; // no gesture yet: try on the next one
  try {
    ctx = new AudioContext();
    master = ctx.createGain();
    // Nothing else stops a pile-up reaching the speakers: six effects and a music track summed past full
    // scale and the output hard-clipped (peak 1.33, doc 3.3.29). The threshold sits above a race's 90th
    // percentile, so ordinary moments pass through untouched and only the pile-ups are held down.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.15;
    limiter.connect(ctx.destination);
    master.connect(limiter);
    sfxBus = ctx.createGain();
    sfxBus.connect(master);
    musicBus = ctx.createGain();
    musicBus.connect(master);
    for (const n of SFX) void decode(n);
    // made a few frames apart (~50 ms of maths in all), so the tap that unlocks audio doesn't stall
    (Object.entries(SYNTHS) as [SynthName, (sr: number) => Float32Array][]).forEach(([n, gen], k) => setTimeout(() => {
      if (!ctx) return;
      const data = gen(ctx.sampleRate);
      const b = ctx.createBuffer(1, data.length, ctx.sampleRate);
      b.getChannelData(0).set(data);
      buffers.set(n, b);
    }, 40 * (k + 1)));
    apply();
    if (wanted) music(wanted);
  } catch {
    ctx = null;
  }
}

/** Mute from the host platform or from the player's button; either one silences everything. */
export function setMuted(who: 'host' | 'player', on: boolean): void {
  mutes[who] = on;
  apply();
}

/** The player's music or effects switch. */
export function setChannel(which: 'music' | 'sfx', on: boolean): void {
  channels[which] = on;
  apply();
}

/** Hold (or release) all sound for a reason; the context runs only with no holds left. */
export function hold(reason: string, on: boolean): void {
  if (on) holds.add(reason);
  else holds.delete(reason);
  apply();
}

function apply(): void {
  if (!ctx || !master) return;
  master.gain.value = mutes.host || mutes.player ? 0 : 1;
  if (sfxBus) sfxBus.gain.value = channels.sfx ? SFX_VOL : 0;
  if (musicBus) musicBus.gain.value = channels.music ? MUSIC_VOL : 0;
  if (holds.size) { if (ctx.state === 'running') void ctx.suspend(); }
  // 'suspended', or iOS Safari's 'interrupted' after a call or another app's sound: back on with the next tap
  else if (ctx.state !== 'running' && ctx.state !== 'closed') void ctx.resume().catch(() => {});
}

/** Switch the music to a track (null: none). Starts once audio is unlocked and the track is loaded. */
export function music(track: Track | null): void {
  wanted = track;
  if (playing?.track === track) return;
  if (playing) {
    const old = playing;
    playing = null;
    if (ctx) {
      old.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.15);
      old.src.stop(ctx.currentTime + 0.8);
    }
    // a decoded track is ~13 MB of samples: only the one playing stays decoded (its mp3 stays, to decode again)
    buffers.delete(old.track);
    decoding.delete(old.track);
  }
  if (!track || !ctx) return;
  void decode(track).then((b) => {
    if (!b || !ctx || !musicBus || wanted !== track || playing) return;
    const src = ctx.createBufferSource();
    src.buffer = b;
    src.loop = true;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.setTargetAtTime(1, ctx.currentTime, 0.3);
    src.connect(gain).connect(musicBus);
    src.start();
    playing = { track, src, gain };
  });
}

/**
 * The music for a race: the cup's first race keeps the division's file (and in the first season its third
 * too), the others get a tune made for that division and season, and the boss race a faster minor one. So a
 * career hears 3 files and some 40 tunes, not the same 3 files for three hours.
 */
export function raceTrack(div: number, tier = 0, race = 0, boss = false): Track {
  const id = div * 3 + tier;
  if (boss) return `boss${id}`;
  if (race === 0 || (race === 2 && tier === 0)) return (['race1', 'race2', 'race3'] as const)[div % 3];
  return `gen${id * 2 + (race === 2 ? 1 : 0)}`;
}

/** A security shift's music: a tune of its own per shift. */
export const shiftTrack = (n: number): Track => `gen${900 + (n % 8)}`;

function play(n: Name, vol = 1, rate = 1, delay = 0): void {
  const b = buffers.get(n);
  if (!b || !ctx || !sfxBus || holds.size) return;
  const at = ctx.currentTime + delay;
  const pitch = rate * (0.94 + Math.random() * 0.12);
  const src = ctx.createBufferSource();
  src.buffer = b;
  src.playbackRate.value = pitch;
  const g = ctx.createGain();
  g.gain.value = vol;
  const voice: Voice = { n, start: at, end: at + b.duration / pitch, vol, stop: () => { try { src.stop(); } catch { /* already over */ } } };
  if (!admit(live, ctx.currentTime, voice)) return;
  src.onended = () => {
    const i = live.indexOf(voice);
    if (i >= 0) live.splice(i, 1);
  };
  src.connect(g).connect(sfxBus);
  src.start(at);
}

const pick = <T>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)];

export const sfx = {
  /** The dummy's hollow plastic body taking a slap. */
  thunk(big: boolean): void {
    if (big) play('thunk_big', 1);
    else play(pick(['thunk1', 'thunk2', 'thunk3'] as const), 0.8);
  },
  /** Plastic decks grinding together. */
  scrape(loud: boolean): void {
    play('scrape', loud ? 0.6 : 0.25, 0.8);
  },
  whoosh(): void {
    play(pick(['whoosh1', 'whoosh2'] as const), 0.55);
  },
  crash(): void {
    play('crash', 0.9);
    play('thunk_big', 0.6, 0.8, 0.04);
  },
  siren(): void {
    play('siren', 0.5);
  },
  /** Rising alarm: someone is coming for the leader. */
  alarm(): void {
    play('alarm', 0.6);
  },
  /** Someone is winding up a swing at the player. */
  tell(): void {
    play('tell', 0.6);
  },
  /** Out of the way of a swing / a counter landing. */
  dodge(): void {
    play('dodge', 0.6, 1.3);
  },
  pickup(): void {
    play('pickup', 0.7);
  },
  beep(go: boolean): void {
    play(go ? 'go' : 'count', go ? 0.8 : 0.6);
  },
  coin(): void {
    play('cash', 0.8);
  },
  click(): void {
    play('click', 0.5);
  },
  /** A cow by the road, `near` 0..1 by how close. */
  moo(near: number): void {
    play('moo', 0.15 + 0.35 * near);
  },
  /** A burst hydrant coming on, `near` 0..1. */
  spray(near: number): void {
    play('spray', 0.15 + 0.4 * near);
  },
  /** Oil poured from the can. */
  glug(): void {
    play('glug', 0.7);
  },
  /** A rider's wheels gone on an oil slick. */
  slip(): void {
    play('slip', 0.5);
  },
  /** Riding into a tumbleweed. */
  rustle(): void {
    play('rustle', 0.7);
  },
  /** The taunt paying out. */
  boing(): void {
    play('boing', 0.6);
    play('cash', 0.4, 1.15, 0.12);
  },
  /** The cup's boss is down. */
  fanfare(): void {
    play('fanfare', 0.55);
    play('cash', 0.6, 1, 0.3);
  },
  /** The tumbling body bowling a rider over. */
  pins(): void {
    play('pins', 0.8);
  },
  /** A launch prop smashed: crates crack, barrels clang, cars crunch. */
  smash(kind: 'crate' | 'barrel' | 'car'): void {
    if (kind === 'crate') { play('crack', 0.9); play('thunk2', 0.4); }
    else if (kind === 'barrel') { play('clang', 0.7); play('thunk_big', 0.4); }
    else { play('crash', 0.9); play('clang', 0.3, 0.6, 0.03); }
  },
};
