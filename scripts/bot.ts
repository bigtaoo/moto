// Headless races: how long a race takes, where the bot finishes, how often it fights and crashes,
// and how much pressure it is under while leading.
// Usage: npm run bot -- [races] [skill 0..1] [fight|race] [upgrade level 0..6 for all three] [stop: pull over for the buggies]

import { World } from '../src/sim/world';
import { TICK_HZ } from '../src/sim/config';
import { botInput } from '../src/sim/ai';

const races = Number(process.argv[2] ?? 20);
const skill = Number(process.argv[3] ?? 1);
const fight = process.argv[4] !== 'race';
const up = Number(process.argv[5] ?? 0);
const comply = process.argv[6] === "stop"; // pulls over for the buggies
interface Row { place: number; time: number; kos: number; crashes: number; hits: number; lead: number; leadHits: number; leadCrashes: number; quiet: number; hunts: number; ambushes: number;
  aiSwings: number; hitP: number; shoves: number; aiShoves: number; took: number; lost: number; whiffs: number; counters: number; fines: number; heat: number; letGo: number }
const rows: Row[] = [];
for (let seed = 1; seed <= races; seed++) {
  const w = new World({ seed, upgrades: { top: up, steer: up, hp: up } });
  let hits = 0;
  let lead = 0;
  let leadHits = 0;
  let leadCrashes = 0;
  // longest stretch (s) leading with nothing hitting, swinging at or crashing the player
  let calm = 0;
  let quiet = 0;
  let hunts = 0;
  let ambushes = 0;
  let aiSwings = 0, hitP = 0, aiShoves = 0, took = 0, lost = 0, whiffs = 0, counters = 0, heat = 0, letGo = 0;
  while (!w.over && w.tick < 400 * TICK_HZ) {
    botInput(w, skill, fight, comply);
    w.step();
    const leading = w.time > 3 && !w.player.finished && w.standing === 1;
    let pressure = false;
    for (const e of w.events) {
      if (e.type === 'hit' && (e.from === 0 || e.to === 0)) hits++;
      if (e.type === 'hit' && e.to === 0) { pressure = true; if (leading) leadHits++; }
      if (e.type === 'swing' && e.rider !== 0 && w.targetFor(w.riders[e.rider], 0.3) === w.player) pressure = true;
      if (e.type === 'crash' && e.rider === 0) { pressure = true; if (leading) leadCrashes++; }
      if (e.type === 'patrolWarn') pressure = true;
      if (e.type === 'hunt') hunts++;
      if (e.type === 'ambush') ambushes++;
      if (e.type === 'hit' && e.to === 0) hitP++;
      if (e.type === 'hit' && e.counter) counters++;
      if (e.type === 'shove' && e.from !== 0) aiShoves++;
      if (e.type === 'steal' && e.from === 0) took++;
      if (e.type === 'steal' && e.to === 0) lost++;
      if (e.type === 'whiff') whiffs++;
      if (e.type === 'swing' && e.aim === 0) aiSwings++;
      if (e.type === 'patrolLetGo') letGo++;
    }
    w.events.length = 0;
    heat = Math.max(heat, w.heat);
    if (leading) {
      lead++;
      calm = pressure ? 0 : calm + 1;
      quiet = Math.max(quiet, calm);
    } else calm = 0;
  }
  const row: Row = { place: w.player.place, time: w.time, kos: w.kos, crashes: w.crashes, hits, lead: lead / TICK_HZ, leadHits, leadCrashes, quiet: quiet / TICK_HZ, hunts, ambushes,
    aiSwings, hitP, shoves: w.shoves, aiShoves, took, lost, whiffs, counters, fines: w.fines, heat, letGo };
  rows.push(row);
  console.log(`seed ${seed}: place ${row.place}, ${row.time.toFixed(0)} s, KOs ${row.kos}, crashes ${row.crashes} (${leadCrashes} while 1st), fights ${hits}, 1st for ${row.lead.toFixed(0)} s, hit ${leadHits}x while 1st, longest calm lead ${row.quiet.toFixed(0)} s, hunts ${hunts}, ambushes ${ambushes}`);
}
const avg = (k: keyof Row) => rows.reduce((s, r) => s + r[k], 0) / rows.length;
console.log(`avg: place ${avg('place').toFixed(1)}, ${avg('time').toFixed(0)} s, KOs ${avg('kos').toFixed(1)}, crashes ${avg('crashes').toFixed(1)}, fights ${avg('hits').toFixed(1)}, 1st for ${avg('lead').toFixed(0)} s, hit ${avg('leadHits').toFixed(1)}x / crashed ${avg('leadCrashes').toFixed(1)}x while 1st, longest calm lead ${avg('quiet').toFixed(0)} s, hunts ${avg('hunts').toFixed(1)}, ambushes ${avg('ambushes').toFixed(1)}`);
console.log(`     AI swings at player ${avg('aiSwings').toFixed(1)}, player hit ${avg('hitP').toFixed(1)}, shoves ${avg('shoves').toFixed(1)} (AI ${avg('aiShoves').toFixed(1)}), weapons taken ${avg('took').toFixed(1)} / lost ${avg('lost').toFixed(1)}, AI whiffs at player ${avg('whiffs').toFixed(1)}, counters ${avg('counters').toFixed(1)}, max heat ${avg('heat').toFixed(2)}, let go ${avg('letGo').toFixed(1)}, fines $${avg('fines').toFixed(0)}`);
