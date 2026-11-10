// Sound: recorded effects and chiptune music from public/audio (all CC0, see public/audio/CREDITS.txt),
// played through one Web Audio context. The files are fetched at boot and decoded once the first tap or
// key has unlocked audio. Anything that should silence the game (the host's pause or mute, the player's
// pause or mute button, a hidden page, an ad) goes through `hold`/`setMuted`, so the rules live here.

type Track = 'title' | 'race1' | 'race2' | 'race3';
const SFX = ['thunk1', 'thunk2', 'thunk3', 'thunk_big', 'scrape', 'whoosh1', 'whoosh2', 'dodge', 'crash', 'siren',
  'alarm', 'tell', 'pickup', 'count', 'go', 'coin', 'cash', 'click'] as const;
type Name = (typeof SFX)[number] | Track;

const url = (n: Name) => `${import.meta.env.BASE_URL}audio/${n}.mp3`;
const MUSIC_VOL = 0.32;
const SFX_VOL = 0.75;

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
let wanted: Track | null = null;
let playing: { track: Track; src: AudioBufferSourceNode; gain: GainNode } | null = null;

function fetchRaw(n: Name): Promise<ArrayBuffer | null> {
  let p = raw.get(n);
  if (!p) {
    p = fetch(url(n)).then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null);
    raw.set(n, p);
  }
  return p;
}

function decode(n: Name): Promise<AudioBuffer | null> {
  let p = decoding.get(n);
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
    master.connect(ctx.destination);
    sfxBus = ctx.createGain();
    sfxBus.gain.value = SFX_VOL;
    sfxBus.connect(master);
    musicBus = ctx.createGain();
    musicBus.gain.value = MUSIC_VOL;
    musicBus.connect(master);
    for (const n of SFX) void decode(n);
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

/** Hold (or release) all sound for a reason; the context runs only with no holds left. */
export function hold(reason: string, on: boolean): void {
  if (on) holds.add(reason);
  else holds.delete(reason);
  apply();
}

function apply(): void {
  if (!ctx || !master) return;
  master.gain.value = mutes.host || mutes.player ? 0 : 1;
  if (holds.size) { if (ctx.state === 'running') void ctx.suspend(); }
  else if (ctx.state === 'suspended') void ctx.resume();
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

/** The race track for a division, so the music changes as the player moves up. */
export const raceTrack = (div: number): Track => (['race1', 'race2', 'race3'] as const)[div % 3];

function play(n: Name, vol = 1, rate = 1, delay = 0): void {
  const b = buffers.get(n);
  if (!b || !ctx || !sfxBus || holds.size) return;
  const src = ctx.createBufferSource();
  src.buffer = b;
  src.playbackRate.value = rate * (0.94 + Math.random() * 0.12);
  const g = ctx.createGain();
  g.gain.value = vol;
  src.connect(g).connect(sfxBus);
  src.start(ctx.currentTime + delay);
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
};
