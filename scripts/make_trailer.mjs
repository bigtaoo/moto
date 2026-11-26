// The store trailer, both shapes, from the built package:
//
//   npm run build:crazygames && node scripts/make_trailer.mjs
//
// CrazyGames asks for 15-20 seconds, no sound, no fast-forwarding, opening on the static cover, at
// most 50 MB, in 16:9 and in 2:3. So: one second of the cover, then three shots of the bot riding --
// the first race at the first division, then a season on with a better ride, then the last division
// after dark -- cut together at 30 fps. Every frame is stepped by hand (scripts/capture_trailer.mjs),
// so the pace is the game's own and nothing is sped up.
//
// Needs Chrome and ffmpeg. About four minutes for both shapes.

import { spawn } from 'node:child_process';
import { copyFileSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const DIR = resolve(process.argv[2] ?? 'dist-cg');
const OUT = resolve('store/video');
const WORK = resolve('.trailer-frames');
const FPS = 30;
const COVER_SECONDS = 1;

/** A rider worth watching at each stop: the save src/meta.ts reads before the bot takes over. */
// src/sim/ladder.ts UPGRADE_MAX: anything past it is refunded at a price that grows by the level, which
// is how a made-up save ends up with a HUD full of noughts.
// The rivals' speed is set from what src/sim/ladder.ts says a career is riding at that rung, so a shot
// where the player is over-equipped is a shot of an empty road. These are that table's own caps.
const CAP = [{ top: 6, steer: 6, hp: 1 }, { top: 8, steer: 7, hp: 2 }, { top: 10, steer: 8, hp: 3 }];
const gear = (div, tier, vehicle, hat) => JSON.stringify({
  div, tier, races: 10 + div * 3 + tier * 15, cash: 12000,
  up: CAP[tier],
  garage: { cur: vehicle, owned: [0, 1, 2, 3, 4, 5] },
  hat: { cur: hat, owned: [0, 1, 2, 3, 4, 5, 6] },
});

const SHOTS = [
  // the first race of all, from the countdown: the whole field still on its scooters
  { seconds: 5.5, skip: 0, near: 0, save: '' },
  // a season on, mid-race in the dust: a better ride, traffic to thread, rivals within reach
  { seconds: 5.5, skip: 20, near: 3, save: gear(1, 1, 3, 5) },
  // the last division of the last season, after dark, on the fastest ride in the garage
  { seconds: 6, skip: 25, near: 3, save: gear(4, 2, 5, 2) },
];

const SHAPES = [
  { w: 1920, h: 1080, cover: 'store/covers/cover_landscape_1920x1080.png', crop: '', name: 'trailer_1920x1080.mp4' },
  // the 9:16 cover cut down from the top, where the title is, rather than a 800x1200 one blown up
  { w: 1080, h: 1620, cover: 'store/covers/cover_portrait_1080x1920.png', crop: 'crop=1080:1620:0:0', name: 'trailer_1080x1620.mp4' },
];

const run = (cmd, args) => new Promise((res, rej) => {
  const p = spawn(cmd, args, { stdio: ['ignore', 'inherit', 'inherit'], shell: false });
  p.on('exit', (c) => (c === 0 ? res() : rej(new Error(`${cmd} exited ${c}`))));
});

mkdirSync(OUT, { recursive: true });

for (const s of SHAPES) {
  console.log(`\n== ${s.w}x${s.h} ==`);
  const frames = join(WORK, `${s.w}x${s.h}`);
  rmSync(frames, { recursive: true, force: true });
  mkdirSync(frames, { recursive: true });

  const nth = (i) => join(frames, `${String(i).padStart(5, '0')}.jpg`);
  const coverFrames = FPS * COVER_SECONDS;
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', resolve(s.cover),
    '-vf', [s.crop, `scale=${s.w}:${s.h}`].filter(Boolean).join(','), '-q:v', '2', nth(1)]);
  for (let i = 2; i <= coverFrames; i++) copyFileSync(nth(1), nth(i));

  let start = coverFrames + 1;
  for (const shot of SHOTS) {
    await run(process.execPath, ['scripts/capture_trailer.mjs', DIR, '--frames', frames, '--start', String(start),
      '--w', String(s.w), '--h', String(s.h), '--fps', String(FPS),
      '--seconds', String(shot.seconds), '--skip', String(shot.skip), '--near', String(shot.near),
      ...(shot.save ? ['--save', shot.save] : [])]);
    start += Math.round(FPS * shot.seconds);
  }

  const out = join(OUT, s.name);
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', join(frames, '%05d.jpg'),
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '21', '-pix_fmt', 'yuv420p', '-profile:v', 'high',
    '-an', '-movflags', '+faststart', out]);
  console.log(`${out}  ${((start - 1) / FPS).toFixed(1)}s  ${(statSync(out).size / 1e6).toFixed(1)} MB`);
}

rmSync(WORK, { recursive: true, force: true });
