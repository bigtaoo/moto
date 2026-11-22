// Headless beginner (follows the road, reads no traffic) in race 1: place at 15/30 s and at the line. Usage: npx tsx scripts/first-race-band.ts [races] [dropBack] [per] [rivalTop0]
import { World } from '../src/sim/world';
import * as C from '../src/sim/config';
const N = Number(process.argv[2] ?? 200);
const drop = process.argv[3] !== undefined ? Number(process.argv[3]) : C.AI.band.dropBack;
const per = process.argv[4] !== undefined ? Number(process.argv[4]) : C.AI.band.per;
const rival = process.argv[5] !== undefined ? Number(process.argv[5]) : null;
C.AI.firstRaceBand.dropBack = drop; C.AI.firstRaceBand.per = per;
if (rival !== null) C.ROOKIE.rivalTop[0] = rival;
let s=0x9e3779b9; const rnd=()=>{s^=s<<13;s>>>=0;s^=s>>>17;s^=s<<5;s>>>=0;return s/4294967296;};
const st30: number[] = [], st15: number[] = [], fin: number[] = [], time: number[] = [];
for (let seed = 1; seed <= N; seed++) {
  const w = new World({ seed, rookie: 0 });
  let want = 0, next = 0;
  let a15 = 0, a30 = 0;
  while (!w.over && w.tick < 200 * C.TICK_HZ) {
    const p = w.player;
    if (w.tick >= next) { want = (rnd() * 2 - 1) * C.EDGE; next = w.tick + (1.5 + rnd() * 2.5) * C.TICK_HZ; }
    w.input.targetX = w.road.clampWant(want, p.z, 30);
    w.step(); w.events.length = 0;
    const t = w.tick / C.TICK_HZ;
    if (!a15 && t >= 15) a15 = w.standing; if (!a30 && t >= 30) a30 = w.standing;
  }
  st15.push(a15); st30.push(a30); fin.push(w.standing); time.push(w.time);
}
const pct=(a:number[],f:(x:number)=>boolean)=>Math.round(a.filter(f).length/a.length*100);
console.log(`drop ${drop} per ${per} rival0 ${C.ROOKIE.rivalTop[0]} | place<=3 @15s ${pct(st15,x=>x<=3)}% @30s ${pct(st30,x=>x<=3)}% | place>=6 @15s ${pct(st15,x=>x>=6)}% @30s ${pct(st30,x=>x>=6)}% | finish top3 ${pct(fin,x=>x<=3)}% win ${pct(fin,x=>x==1)}% last3 ${pct(fin,x=>x>=6)}%`);
