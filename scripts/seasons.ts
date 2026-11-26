// Is the ladder actually getting harder? Every rung of the career, raced on exactly the gear
// `careerGear` says a career owns there, so the only things that move between rungs are the division,
// the season and the player's own cap.
//
//   npx tsx scripts/seasons.ts [seeds per rung] [skill 0..1]
//
//   npm run seasons -- 120 1
//
// Prints a row per rung and a line per season, then what put each field on the tarmac and how much of that
// was a shove. Average place is the headline -- it should get worse, or at least not better, the higher the
// ladder goes. Doc 3.3.55 left it at 2.15 / 1.98 / 1.58 and 3.3.85 made it monotone (1.89 / 2.31 / 2.39).
// Thirty seeds a rung is a glance; the swing between two runs of 120 is about 0.12 of a place, so do not
// read anything smaller than that out of it.

import { World } from '../src/sim/world';
import * as C from '../src/sim/config';
import { botInput } from '../src/sim/ai';

const seeds = Number(process.argv[2] ?? 30);
const skill = Number(process.argv[3] ?? 1);

const CAUSES = ['ko', 'car', 'wall', 'cones', 'oil', 'cow'] as const;
interface Row { place: number; top3: number; kos: number; downs: number; falls: number; hits: number; taken: number; aiFalls: number; aiKos: number; edge: number; time: number;
  ko: number; car: number; wall: number; cones: number; oil: number; cow: number; pKo: number; pCar: number; pWall: number; pCones: number; pOil: number; pCow: number;
  shoveByAi: number; shoveByP: number }
const zero = (): Row => ({ place: 0, top3: 0, kos: 0, downs: 0, falls: 0, hits: 0, taken: 0, aiFalls: 0, aiKos: 0, edge: 0, time: 0,
  ko: 0, car: 0, wall: 0, cones: 0, oil: 0, cow: 0, pKo: 0, pCar: 0, pWall: 0, pCones: 0, pOil: 0, pCow: 0, shoveByAi: 0, shoveByP: 0 });
const add = (a: Row, b: Row) => { for (const k of Object.keys(a) as (keyof Row)[]) a[k] += b[k]; return a; };
const div_ = (a: Row, n: number) => { const o = zero(); for (const k of Object.keys(a) as (keyof Row)[]) o[k] = a[k] / n; return o; };

const seasons: Row[] = C.TIERS.map(zero);
const seasonN: number[] = C.TIERS.map(() => 0);

console.log(`${seeds} seeds a rung, skill ${skill}\n`);
console.log('rung                      place  top3   KOs  downs falls  swung  taken  AIfall AIko  edge  time');
for (let tier = 0; tier < C.TIERS.length; tier++) {
  for (let div = 0; div < C.DIVISIONS.length; div++) {
    const gear = C.careerGear(div, tier);
    const sum = zero();
    for (let seed = 1; seed <= seeds; seed++) {
      const w = new World({ seed, div, tier, upgrades: gear.up, vehicle: gear.vehicle });
      const r = zero();
      while (!w.over && w.tick < 400 * C.TICK_HZ) {
        botInput(w, skill, true);
        w.step();
        for (const e of w.events) {
          if (e.type === 'hit' && e.to === 0) { r.taken++; if (e.ko) r.downs++; }
          if (e.type === 'hit' && e.from === 0) r.hits++;
          if (e.type === 'crash' && e.rider === 0) { r.falls++; r[`p${e.cause[0].toUpperCase()}${e.cause.slice(1)}` as keyof Row]++; }
          if (e.type === 'crash' && e.rider !== 0) { r.aiFalls++; r[e.cause as keyof Row]++; }
          if (e.type === 'hit' && e.ko && e.to !== 0 && e.from !== 0) r.aiKos++;
          if (e.type === 'shove' && e.to !== 0) { if (e.from === 0) r.shoveByP++; else r.shoveByAi++; }
        }
        w.events.length = 0;
      }
      r.place = w.player.place;
      r.top3 = w.player.place <= 3 ? 1 : 0;
      r.kos = w.kos;
      r.edge = w.player.top - (C.PLAYER_BASE.top + w.div.top);
      r.time = w.time;
      add(sum, r);
    }
    const a = div_(sum, seeds);
    const s = C.stage(div, tier);
    console.log(`${s.name.padEnd(22)} ${a.place.toFixed(2).padStart(7)} ${(a.top3 * 100).toFixed(0).padStart(4)}% ${a.kos.toFixed(1).padStart(5)} ${a.downs.toFixed(2).padStart(6)} ${a.falls.toFixed(2).padStart(5)} ${a.hits.toFixed(1).padStart(6)} ${a.taken.toFixed(1).padStart(6)} ${a.aiFalls.toFixed(1).padStart(6)} ${a.aiKos.toFixed(1).padStart(5)} ${a.edge.toFixed(1).padStart(5)} ${a.time.toFixed(0).padStart(5)}s`);
    add(seasons[tier], sum);
    seasonN[tier] += seeds;
  }
  console.log('');
}
console.log('season                    place  top3   KOs  downs falls  swung  taken  AIfall AIko  edge  time');
for (let tier = 0; tier < C.TIERS.length; tier++) {
  const a = div_(seasons[tier], seasonN[tier]);
  console.log(`${C.TIERS[tier].name.padEnd(22)} ${a.place.toFixed(2).padStart(7)} ${(a.top3 * 100).toFixed(0).padStart(4)}% ${a.kos.toFixed(1).padStart(5)} ${a.downs.toFixed(2).padStart(6)} ${a.falls.toFixed(2).padStart(5)} ${a.hits.toFixed(1).padStart(6)} ${a.taken.toFixed(1).padStart(6)} ${a.aiFalls.toFixed(1).padStart(6)} ${a.aiKos.toFixed(1).padStart(5)} ${a.edge.toFixed(1).padStart(5)} ${a.time.toFixed(0).padStart(5)}s`);
}

console.log('');
console.log('What puts them on the tarmac, per race (AI riders, then the player)');
console.log(`season                 ${CAUSES.map((c) => c.padStart(6)).join('')}   |${CAUSES.map((c) => c.padStart(6)).join('')}`);
for (let tier = 0; tier < C.TIERS.length; tier++) {
  const a = div_(seasons[tier], seasonN[tier]);
  const ai = CAUSES.map((c) => (a[c] as number).toFixed(1).padStart(6)).join('');
  const pl = CAUSES.map((c) => (a[`p${c[0].toUpperCase()}${c.slice(1)}` as keyof Row] as number).toFixed(2).padStart(6)).join('');
  console.log(`${C.TIERS[tier].name.padEnd(22)} ${ai}   |${pl}`);
}

console.log('');
console.log('Of those AI crashes, how many were a shove into something (rival did it / player did it)');
console.log('season                   byAI   byP');
for (let tier = 0; tier < C.TIERS.length; tier++) {
  const a = div_(seasons[tier], seasonN[tier]);
  console.log(`${C.TIERS[tier].name.padEnd(22)} ${a.shoveByAi.toFixed(1).padStart(6)} ${a.shoveByP.toFixed(1).padStart(5)}`);
}
