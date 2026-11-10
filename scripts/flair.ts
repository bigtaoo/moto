// A bot's races at one stage: places, flair (near misses, KO chains) and time, to tune C.FLAIR and
// C.ENDLESS. Upgrades are maxed from the Legend season on.
// Usage: npx tsx scripts/flair.ts [races] [skill 0..1] [tier] [div] [endless]

import { World } from '../src/sim/world';
import { botInput } from '../src/sim/ai';
import * as C from '../src/sim/config';

const [races, skill, tier, div, endless] = [12, 0.8, -1, -1, 0].map((d, i) => Number(process.argv[i + 2] ?? d));
const places: number[] = [];
for (let seed = 1; seed <= races; seed++) {
  const opts = { seed, div: div >= 0 ? div : seed % 4, tier: Math.max(0, tier), endless, upgrades: tier >= 2 ? { ...C.UPGRADE_MAX } : undefined, vehicle: tier >= 2 ? C.VEHICLES.length - 1 : 0 };
  const w = new World(opts);
  while (!w.over && w.tick < 30 * 400) {
    botInput(w, skill, true);
    w.step();
  }
  const f = w.flair;
  places.push(w.player.place);
  console.log(`seed ${seed} ${w.div.name}: ${w.player.place}. near ${f.near} ($${f.nearPay}), best chain ${f.best} ($${f.chainPay}), kos ${w.kos}, ${Math.round(w.time)} s`);
}
console.log(`mean place ${(places.reduce((a, b) => a + b, 0) / places.length).toFixed(2)}`);
