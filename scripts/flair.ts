// How much flair (near misses, KO chains) a bot earns per race, to tune C.FLAIR.
// Usage: npx tsx scripts/flair.ts [races] [skill 0..1]

import { World } from '../src/sim/world';
import { botInput } from '../src/sim/ai';

const races = Number(process.argv[2] ?? 12);
const skill = Number(process.argv[3] ?? 0.8);
for (let seed = 1; seed <= races; seed++) {
  const w = new World({ seed, div: seed % 4 });
  while (!w.over && w.tick < 30 * 400) {
    botInput(w, skill, true);
    w.step();
  }
  const f = w.flair;
  console.log(`seed ${seed} div ${seed % 4}: near ${f.near} ($${f.nearPay}), best chain ${f.best} ($${f.chainPay}), kos ${w.kos}, ${Math.round(w.time)} s`);
}
