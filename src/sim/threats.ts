// Threats for the leader: a rival hunting them down, or thugs waiting on the shoulder.

import * as C from './config';
import { clamp, type Rider, type Side } from './types';
import type { World } from './world';
import { nearestLane } from './ai';

export function leaderThreats(w: World): void {
  const p = w.player;
  const prog = clamp(p.z / w.length, 0, 1);
  // thugs left far behind drop out
  for (const r of w.riders) {
    if (r.thug && r.state === 'ride' && (r.z < p.z - C.GANG.goneAt || p.finished)) r.state = 'away';
  }
  const leading = p.state === 'ride' && !p.finished && prog > C.LEADER.startAt && w.standing === 1;
  if (!leading) {
    w.threatCd = Math.max(w.threatCd, Math.round(C.LEADER.firstDelay * C.TICK_HZ));
    return;
  }
  // one threat at a time; the calm is counted from when the last one ends
  if (w.riders.some((r) => r.huntT > 0 || (r.thug && r.state !== 'away'))) return;
  if (--w.threatCd > 0) return;
  const first = w.nextThreat;
  const second = first === 'hunt' ? 'ambush' : 'hunt';
  const start = (k: 'hunt' | 'ambush') => (k === 'hunt' ? startHunt(w) : startAmbush(w, prog));
  const done = start(first) ? first : start(second) ? second : null;
  if (!done) {
    w.threatCd = C.TICK_HZ; // nobody available; look again in a second
    return;
  }
  w.nextThreat = done === 'hunt' ? 'ambush' : 'hunt';
  const gap = C.LEADER.gapEarly + (C.LEADER.gapLate - C.LEADER.gapEarly) * prog;
  w.threatCd = Math.round(gap * (0.8 + 0.4 * w.aiRng.float()) * C.TICK_HZ);
}

/** The keenest rival not too far behind (grudges first) comes for the leader at full tilt. */
export function startHunt(w: World): boolean {
  const p = w.player;
  let best: Rider | null = null;
  let bestS = -Infinity;
  for (const r of w.riders) {
    if (r.isPlayer || r.thug || r.state !== 'ride' || r.finished) continue;
    const gap = p.z - r.z;
    if (gap < 8 || gap > C.HUNT.range) continue;
    const s = (w.hates(r.id) ? 2 : 0) + r.aggr + w.aiRng.float() * 0.6;
    if (s > bestS) { bestS = s; best = r; }
  }
  if (!best) return false;
  best.huntT = Math.round((C.HUNT.chase + C.HUNT.attack) * C.TICK_HZ);
  w.events.push({ type: 'hunt', rider: best.id });
  return true;
}

/** Thugs wait on the shoulder ahead and pull out as the leader arrives. */
export function startAmbush(w: World, prog: number): boolean {
  const p = w.player;
  const G = C.GANG;
  if (p.z + G.spawnAhead > w.length - 60) return false;
  const free = w.riders.filter((r) => r.thug && r.state === 'away');
  const n = Math.min(free.length, prog >= G.pairFrom ? 2 : 1);
  if (n === 0) return false;
  const first: Side = w.aiRng.float() < 0.5 ? 1 : -1;
  // a pair works together: from both sides at once, or the far one cuts in front while the near one strikes
  const pincer = n === 1 || w.aiRng.float() < G.pincerChance;
  const ids: number[] = [];
  for (let k = 0; k < n; k++) {
    const r = free[k];
    const side: Side = k === 0 ? first : (-first as Side);
    r.state = 'ride';
    r.z = r.pz = p.z + G.spawnAhead + k * 7;
    r.x = r.px = r.wantX = side > 0 ? w.road.worksHi(r.z) : -C.EDGE;
    r.airT = 0;
    r.cutId = -1;
    r.vx = r.latV = 0;
    r.speed = r.pace = p.speed * G.lurk;
    r.hp = r.maxHp;
    r.invT = r.atkT = r.atkCd = r.hitT = r.downT = r.runT = r.rubT = r.gangT = r.intentT = r.escT = 0;
    r.gang = 'lurk';
    r.role = n === 1 ? 'strike' : pincer ? 'pincer' : k === 0 ? 'strike' : 'block';
    r.weapon = k === 0 && prog >= G.batFrom ? 'bat' : 'pan';
    r.foe = p.id;
    r.foeSide = side;
    r.foeOff = C.AI.sideOff[0] + (C.AI.sideOff[1] - C.AI.sideOff[0]) * w.aiRng.float() + C.WEAPON[r.weapon].reach * 0.6;
    r.wob = r.wobTo = 0;
    r.lane = nearestLane(r.x);
    r.hitBy = -1;
    w.resetMemory(r);
    ids.push(r.id);
  }
  w.events.push({ type: 'ambush', riders: ids });
  return true;
}
