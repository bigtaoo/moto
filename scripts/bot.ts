// Headless races: how long a race takes, where the bot finishes, how often it fights and crashes.
// Usage: npm run bot -- [races] [skill 0..1]

import { World } from '../src/sim/world';
import { TICK_HZ } from '../src/sim/config';
import { botInput } from '../src/sim/ai';

const races = Number(process.argv[2] ?? 20);
const skill = Number(process.argv[3] ?? 1);
const rows: { place: number; time: number; kos: number; crashes: number; fines: number; hits: number; firstHit: number; firstCrash: number }[] = [];
for (let seed = 1; seed <= races; seed++) {
  const w = new World({ seed });
  let hits = 0;
  let firstHit = -1;
  let firstCrash = -1;
  while (!w.over && w.tick < 400 * TICK_HZ) {
    botInput(w, skill);
    w.step();
    for (const e of w.events) {
      if (e.type === 'hit' && (e.from === 0 || e.to === 0)) {
        hits++;
        if (firstHit < 0) firstHit = w.time;
      }
      if (e.type === 'crash' && e.rider === 0 && firstCrash < 0) firstCrash = w.time;
    }
    w.events.length = 0;
  }
  const row = { place: w.player.place, time: w.time, kos: w.kos, crashes: w.crashes, fines: w.fines, hits, firstHit, firstCrash };
  rows.push(row);
  console.log(`seed ${seed}: place ${row.place}, ${row.time.toFixed(0)} s, KOs ${row.kos}, crashes ${row.crashes}, fines ${row.fines}, fights ${hits}, first hit ${firstHit.toFixed(1)} s, first crash ${firstCrash.toFixed(1)} s`);
}
const avg = (k: keyof (typeof rows)[number]) => rows.reduce((s, r) => s + r[k], 0) / rows.length;
console.log(`avg: place ${avg('place').toFixed(1)}, ${avg('time').toFixed(0)} s, KOs ${avg('kos').toFixed(1)}, crashes ${avg('crashes').toFixed(1)}, fights ${avg('hits').toFixed(1)}, first hit ${avg('firstHit').toFixed(1)} s`);
