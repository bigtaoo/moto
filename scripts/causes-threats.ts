// What happens to each leader threat: does it reach the player, swing, land, get knocked off?
import { World } from '../src/sim/world';
import { TICK_HZ } from '../src/sim/config';
import { botInput } from '../src/sim/ai';

const T: Record<string, number[]> = { hunt: [0, 0, 0, 0, 0, 0], ambush: [0, 0, 0, 0, 0, 0] };
for (let seed = 1; seed <= 20; seed++) {
  const w = new World({ seed, upgrades: { top: 4, steer: 4, hp: 4 } });
  const live = new Map<number, { kind: string; reach: boolean; swings: number; hits: number; ko: boolean; t0: number }>();
  let wait: number[] = [];
  while (!w.over && w.tick < 400 * TICK_HZ) {
    botInput(w, 1, false);
    w.step();
    for (const e of w.events) {
      if (e.type === 'hunt') live.set(e.rider, { kind: 'hunt', reach: false, swings: 0, hits: 0, ko: false, t0: w.tick });
      if (e.type === 'ambush') for (const id of e.riders) live.set(id, { kind: 'ambush', reach: false, swings: 0, hits: 0, ko: false, t0: w.tick });
      if (e.type === 'swing' && live.has(e.rider)) live.get(e.rider)!.swings++;
      if (e.type === 'hit' && live.has(e.from) && e.to === 0) live.get(e.from)!.hits++;
      if (e.type === 'hit' && e.ko && live.has(e.to)) live.get(e.to)!.ko = true;
    }
    w.events.length = 0;
    for (const [id, s] of live) {
      const r = w.riders[id];
      if (r.state === 'ride' && Math.abs(r.z - w.player.z) < 2 && Math.abs(r.x - w.player.x) < 3) {
        if (!s.reach) wait.push((w.tick - s.t0) / TICK_HZ);
        s.reach = true;
      }
      const over = s.kind === 'hunt' ? r.huntT <= 0 : r.state === 'away';
      if (over) {
        const a = T[s.kind];
        a[0]++; if (s.reach) a[1]++; a[2] += s.swings; a[3] += s.hits; if (s.ko) a[4]++;
        live.delete(id);
      }
    }
  }
}
for (const k of ['hunt', 'ambush']) {
  const [n, reach, sw, hits, ko] = T[k];
  console.log(`${k}: ${n} riders, reached the player ${reach}, swings ${sw}, hits ${hits}, knocked off ${ko}`);
}
