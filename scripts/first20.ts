// The design's own promise (1.2): a new player's first 20 seconds already land a hit and a crash.
// Headless, division 0, no upgrades, a middling bot: when does each first happen?
import { World } from '../src/sim/world';
import { TICK_HZ } from '../src/sim/config';
import { botInput } from '../src/sim/ai';
const n = Number(process.argv[2] ?? 40), skill = Number(process.argv[3] ?? 0.5);
const first = { swing: [] as number[], hit: [] as number[], took: [] as number[], crash: [] as number[], ko: [] as number[] };
for (let seed = 1; seed <= n; seed++) {
  const w = new World({ seed });
  const f: Record<string, number> = {};
  while (!w.over && w.tick < 40 * TICK_HZ) {
    botInput(w, skill); w.step();
    const t = w.tick / TICK_HZ;
    for (const e of w.events) {
      if (e.type === 'hit' && e.from === 0 && f.hit === undefined) f.hit = t;
      if (e.type === 'hit' && e.to === 0 && f.took === undefined) f.took = t;
      if (e.type === 'crash' && e.rider === 0 && f.crash === undefined) f.crash = t;
      if (e.type === 'crash' && e.rider !== 0 && e.cause === 'ko' && f.ko === undefined) f.ko = t;
    }
    w.events.length = 0;
  }
  for (const k of ['hit', 'took', 'crash', 'ko'] as const) first[k].push(f[k] ?? Infinity);
}
const pct = (a: number[], s: number) => Math.round((a.filter((x) => x <= s).length / a.length) * 100);
const med = (a: number[]) => { const b = a.filter(Number.isFinite).sort((x, y) => x - y); return b.length ? b[b.length >> 1].toFixed(1) : '-'; };
for (const k of ['hit', 'took', 'ko', 'crash'] as const)
  console.log(k.padEnd(6), 'median', med(first[k]).padStart(5), 's   by 10s', String(pct(first[k], 10)).padStart(3) + '%', '  by 20s', String(pct(first[k], 20)).padStart(3) + '%', '  by 40s', String(pct(first[k], 40)).padStart(3) + '%');
