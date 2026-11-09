// Rival riders and the headless test bot: dodge traffic, pick fights, swing when someone is in reach.

import * as C from './config';
import type { Rider, World } from './world';

/** Seconds until `r` would run into a car if it rode along lateral position x (Infinity when clear). */
export function laneClearance(w: World, r: Rider, x: number): number {
  let best = Infinity;
  for (const c of w.cars) {
    if (Math.abs(c.x - x) > C.CAR.halfW + 0.9) continue;
    const dist = c.z - r.z - C.CAR.halfL - 0.6;
    if (dist < -2 * C.CAR.halfL) continue;
    const closing = r.speed - c.speed;
    const t = dist <= 0 ? 0 : closing <= 0.1 ? Infinity : dist / closing;
    if (t < best) best = t;
  }
  return best;
}

/** Lateral position that keeps `r` out of traffic, starting from where it would like to be. */
function dodge(w: World, r: Rider, want: number, horizon: number): number {
  if (laneClearance(w, r, want) >= horizon) return want;
  let pick = want;
  let score = -Infinity;
  for (let i = 0; i < C.LANE_X.length; i++) {
    const x = C.LANE_X[i];
    const t = Math.min(laneClearance(w, r, x), 6);
    const s = t - Math.abs(x - r.x) * 0.12 - (i === C.ONCOMING_LANE ? 1.5 : 0);
    if (s > score) { score = s; pick = x; }
  }
  return pick;
}

function nearestLane(x: number, avoidOncoming: boolean): number {
  let best: number = C.LANE_X[1];
  for (let i = 0; i < C.LANE_X.length; i++) {
    if (avoidOncoming && i === C.ONCOMING_LANE) continue;
    if (Math.abs(C.LANE_X[i] - x) < Math.abs(best - x)) best = C.LANE_X[i];
  }
  return best;
}

/** No fighting in the first seconds after the start signal, so the grid can spread out. */
function calm(w: World): boolean {
  return w.time < C.AI.calmStart;
}

export function rivalThink(w: World, r: Rider): void {
  if (r.state !== 'ride') return;
  const p = w.player;
  const gap = p.z - r.z;
  const rng = w.aiRng;
  if (r.stalkT > 0) {
    if (--r.stalkT === 0) r.stalkT = -Math.round(C.AI.stalkRest * C.TICK_HZ);
  } else if (r.stalkT < 0) r.stalkT++;
  else if (calm(w)) return void (r.wantX = dodge(w, r, nearestLane(r.x, true), C.AI.lookBase + C.AI.lookAware * r.aware));
  else if (!r.finished && p.state === 'ride' && Math.abs(gap) < 14 && rng.float() < r.aggr * C.AI.stalkChance) r.stalkT = Math.round(C.AI.stalkTime * C.TICK_HZ);

  let want = nearestLane(r.x, true);
  if (r.stalkT > 0 && p.state === 'ride') {
    const side = r.x >= p.x ? 1 : -1;
    want = clampEdge(p.x + side * 1.7);
  }
  r.wantX = dodge(w, r, want, C.AI.lookBase + C.AI.lookAware * r.aware);

  const t = w.targetFor(r);
  if (t && r.atkCd <= 0 && r.atkT <= 0) {
    const chance = r.aggr * (t.isPlayer ? C.AI.swingAtPlayer : C.AI.swingAtRival);
    if (rng.float() < chance) w.tryAttack(r);
  }
}

/** Headless player: sit beside the nearest rival ahead, swing whenever someone is in reach, dodge cars. */
export function botInput(w: World, skill = 1): void {
  const p = w.player;
  w.input.steer = 0;
  w.input.brake = false;
  if (p.state !== 'ride') return;
  let prey: Rider | null = null;
  for (const r of w.riders) {
    if (r.isPlayer || r.state !== 'ride') continue;
    const gap = r.z - p.z;
    if (gap > -3 && gap < 18 && (!prey || gap < prey.z - p.z)) prey = r;
  }
  let want = prey ? clampEdge(prey.x + (p.x >= prey.x ? 1.7 : -1.7)) : nearestLane(p.x, true);
  want = dodge(w, p, want, 0.8 + 1.6 * skill);
  // Ease toward the pick like a finger would, instead of jumping each tick when the choice flips.
  const prev = w.input.targetX ?? p.x;
  w.input.targetX = prev + (want - prev) * 0.25;
  if (w.targetFor(p) && w.aiRng.float() < 0.25 * skill) w.input.attack = true;
}

function clampEdge(x: number): number {
  return Math.max(-C.EDGE, Math.min(C.EDGE, x));
}
