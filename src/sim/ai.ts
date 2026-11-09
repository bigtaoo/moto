// Rival riders, the shoulder thugs and the headless test bot: dodge traffic, pick fights, swing when
// someone is in reach. No AI rider reads anyone's position this very tick: they go by World.seen (where
// the other was a reaction time ago), steer with sideways inertia (World.move) and stick with a plan for a
// while, so they never mirror the player's moves.

import * as C from './config';
import type { Rider, Side, World } from './world';
import { Prng } from './rng';

/** The bot is an input source, not part of the race: its dice must not come from the world's streams. */
const botRngs = new WeakMap<World, Prng>();

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

/** The lane (C.LANE_X index) with the most room ahead, starting from where `r` would like to be. */
function bestLane(w: World, r: Rider, want: number): number {
  let pick = nearestLane(want, false);
  let score = -Infinity;
  for (let i = 0; i < C.LANE_X.length; i++) {
    const x = C.LANE_X[i];
    const t = Math.min(laneClearance(w, r, x), 6);
    const s = t - Math.abs(x - r.x) * 0.12 - (i === C.ONCOMING_LANE ? 1.5 : 0);
    if (s > score) { score = s; pick = i; }
  }
  return pick;
}

/** Lateral position that keeps the headless bot out of traffic (it decides afresh every tick). */
function dodge(w: World, r: Rider, want: number, horizon: number): number {
  if (laneClearance(w, r, want) >= horizon) return want;
  return C.LANE_X[bestLane(w, r, want)];
}

/**
 * An AI rider's way round traffic: once it picks a line to get past a car it keeps to it for a moment
 * (unless that line closes up too), instead of weighing every lane afresh each tick. Just racing, it
 * then stays in the lane it moved into.
 */
function avoid(w: World, r: Rider, want: number): number {
  const look = C.AI.lookBase + C.AI.lookAware * r.aware;
  if (r.escT > 0) {
    r.escT--;
    if (laneClearance(w, r, r.escX) > look * 0.5) return r.escX;
  }
  if (laneClearance(w, r, want) >= look) return want;
  const lane = bestLane(w, r, want);
  r.escX = C.LANE_X[lane];
  r.escT = Math.round(C.AI.escHold * C.TICK_HZ);
  if (r.intent === 'race' && !r.thug && lane !== C.ONCOMING_LANE) r.lane = lane;
  return r.escX;
}

/** Index into C.LANE_X of the lane nearest x (the oncoming lane only if allowed). */
export function nearestLane(x: number, avoidOncoming = true): number {
  let best = 1;
  for (let i = 0; i < C.LANE_X.length; i++) {
    if (avoidOncoming && i === C.ONCOMING_LANE) continue;
    if (Math.abs(C.LANE_X[i] - x) < Math.abs(C.LANE_X[best] - x)) best = i;
  }
  return best;
}

/** No fighting in the first seconds after the start signal, so the grid can spread out. */
function calm(w: World): boolean {
  return w.time < C.AI.calmStart;
}

function roll(w: World, r: readonly [number, number]): number {
  return r[0] + (r[1] - r[0]) * w.aiRng.float();
}

function clampEdge(x: number): number {
  return Math.max(-C.EDGE, Math.min(C.EDGE, x));
}

/** Rivals rubber-band around the player so fights keep happening. */
function rubber(w: World, r: Rider): number {
  const gap = w.player.z - r.z;
  return r.top * (1 + Math.max(-0.22, Math.min(0.2, gap / 100)));
}

/**
 * Go after `f`: pick a side once (the one it is on, unless that's against the barrier) and how far out to
 * ride, and stick with both: it never swaps sides to mirror them.
 */
function harass(w: World, r: Rider, f: Rider, ticks: number): void {
  r.intent = 'harass';
  r.intentT = ticks;
  r.foe = f.id;
  let side: Side = r.x >= f.x ? 1 : -1;
  if (Math.abs(f.x + side * 1.6) > C.EDGE) side = -side as Side;
  r.foeSide = side;
  r.foeOff = roll(w, C.AI.sideOff) + (r.weapon ? C.WEAPON[r.weapon].reach * 0.6 : 0);
  r.wob = 0;
  r.wobTo = (w.aiRng.float() * 2 - 1) * C.AI.wander;
}

function rest(w: World, r: Rider): void {
  r.intent = 'race';
  r.intentT = Math.round(roll(w, C.AI.harassRest) * C.TICK_HZ);
}

/**
 * Riding alongside someone it's after: on its chosen side at its chosen distance (drifting a little so it
 * never sits dead still), level with where it last saw them. Returns the line it wants.
 */
function shadow(w: World, r: Rider, f: Rider, lead = 0, cap = r.top * 1.15): number {
  const s = w.seen(f, r.react);
  r.wob += Math.max(-0.6 * C.DT, Math.min(0.6 * C.DT, r.wobTo - r.wob));
  if (w.aiRng.float() < 0.03) r.wobTo = (w.aiRng.float() * 2 - 1) * C.AI.wander;
  const dz = s.z + lead - r.z;
  r.pace = Math.max(0, Math.min(cap, s.speed + Math.max(-6, Math.min(6, dz * 0.8))));
  return clampEdge(s.x + r.foeSide * (r.foeOff + r.wob));
}

/** Swing at whoever is in reach: keener at the one it's after when they're level and just swung (open). */
function maybeSwing(w: World, r: Rider, keen: number): void {
  const t = w.targetFor(r);
  if (!t || r.atkCd > 0 || r.atkT > 0) return;
  let chance = r.aggr * (t.isPlayer ? C.AI.swingAtPlayer : C.AI.swingAtRival) * keen;
  if (t.id === r.foe && r.intent !== 'back') {
    const level = Math.abs(t.z - r.z) < 1.2;
    chance *= level && t.atkCd > 0 ? C.AI.swingOpen : level ? 1 : 0.5;
  }
  if (r.intent === 'back') chance *= 0.3;
  if (w.aiRng.float() < chance) w.tryAttack(r);
}

/** Someone close by worth going after, if it fancies it this time (the player, or whoever hit it last, first). */
function pickFoe(w: World, r: Rider): Rider | null {
  let best: Rider | null = null;
  let bestD = Infinity;
  for (const o of w.riders) {
    if (o === r || o.state !== 'ride' || o.finished) continue;
    const d = Math.abs(o.z - r.z) + Math.abs(o.x - r.x) * 0.5;
    if (Math.abs(o.z - r.z) > (o.isPlayer ? 14 : 10) || d >= bestD) continue;
    best = o;
    bestD = d;
  }
  if (!best) return null;
  let chance = r.aggr * (best.isPlayer ? C.AI.harassPlayer : C.AI.harassRival);
  if (r.hitBy === best.id || (best.isPlayer && w.grudges.has(r.id))) chance *= C.AI.grudge;
  return w.aiRng.float() < chance ? best : null;
}

export function rivalThink(w: World, r: Rider): void {
  if (r.state !== 'ride') return;
  if (r.thug) return thugThink(w, r);
  const p = w.player;
  const gap = p.z - r.z;
  if (r.intentT > 0) r.intentT--;
  let keen = 1;
  if (r.huntT > 0) {
    // Hunting the leader: up to HUNT.chase s to close in, then HUNT.attack s on their shoulder.
    r.huntT--;
    keen = C.HUNT.swing;
    if (p.state !== 'ride' || p.finished) r.huntT = 0;
    else if (Math.abs(gap) < 14) {
      r.huntT = Math.min(r.huntT, Math.round(C.HUNT.attack * C.TICK_HZ));
      if (r.intent !== 'harass' || r.foe !== p.id) harass(w, r, p, r.huntT);
    }
  }
  r.pace = rubber(w, r);
  let want: number = C.LANE_X[r.lane];
  if (r.finished || calm(w)) {
    r.intent = 'race';
  } else if (r.huntT > 0 && gap >= 14) {
    // closing in at full tilt, toward the lane they were in
    const s = w.seen(p, r.react);
    r.pace = s.speed + Math.max(C.HUNT.boostMin, Math.min(C.HUNT.boostMax, C.HUNT.boostMin + gap * C.HUNT.boostPerM));
    want = C.LANE_X[nearestLane(s.x)];
  } else if (r.intent === 'harass') {
    const f = w.riders[r.foe];
    if (f.state !== 'ride' || f.finished || r.intentT === 0 || Math.abs(f.z - r.z) > 25) rest(w, r);
    else if (r.hp <= 1 && r.hitT > 0 && r.huntT === 0) {
      // one more blow and it's off: drop back and out of their reach for a moment
      r.intent = 'back';
      r.intentT = Math.round(C.AI.backTime * C.TICK_HZ);
    } else want = shadow(w, r, f, 0, r.huntT > 0 ? Infinity : undefined); // a hunter keeps up whatever it takes
  }
  if (r.intent === 'back') {
    const f = w.riders[r.foe];
    const s = w.seen(f, r.react);
    want = clampEdge(s.x + r.foeSide * 3.5);
    r.pace = Math.max(0, s.speed - 3);
    if (r.intentT === 0 || f.state !== 'ride') rest(w, r);
  } else if (r.intent === 'race' && r.intentT === 0 && !r.finished && !calm(w) && r.huntT === 0) {
    // time to rethink: go after someone near, get round a slower rider, or now and then change lane
    r.intentT = Math.round(roll(w, C.AI.think) * C.TICK_HZ);
    const f = pickFoe(w, r);
    if (f) {
      harass(w, r, f, Math.round(roll(w, C.AI.harassTime) * (0.6 + r.aggr) * C.TICK_HZ));
      want = shadow(w, r, f);
    } else {
      const slow = w.riders.some((o) => o !== r && o.state === 'ride' && o.z > r.z && o.z - r.z < 12 &&
        Math.abs(o.x - C.LANE_X[r.lane]) < 1.2 && o.speed < r.speed - 0.5);
      if (slow || w.aiRng.float() < 0.08) {
        const l = r.lane === 1 ? 2 : r.lane === 3 ? 2 : w.aiRng.float() < 0.5 ? 1 : 3;
        if (laneClearance(w, r, C.LANE_X[l]) > 2) r.lane = l;
      }
    }
  }
  r.wantX = avoid(w, r, want);
  if (!calm(w)) maybeSwing(w, r, keen);
}

/**
 * Shoulder thugs: wait, pull out as the leader arrives and work them over. A pair works together: from
 * both sides at once (pincer), or the far one gets in front of the leader and slows them while the
 * other strikes from the side. One that's nearly knocked off drops back for a moment, then comes again.
 */
function thugThink(w: World, r: Rider): void {
  const p = w.player;
  const G = C.GANG;
  const ahead = r.z - p.z;
  if (r.intentT > 0) r.intentT--;
  let want = r.x;
  if (r.gang === 'lurk') {
    r.pace = w.seen(p, r.react).speed * G.lurk;
    if (ahead < G.engageAt) { r.gang = 'attack'; r.gangT = 0; }
  } else r.gangT++;
  const over = r.gangT > G.attackTime * C.TICK_HZ || p.state !== 'ride' || p.finished || ahead < -12;
  if ((r.gang === 'attack' || r.gang === 'back') && over) r.gang = 'leave';
  if (r.gang === 'attack' && r.hp <= 1 && r.hitT > 0) {
    r.gang = 'back';
    r.intentT = Math.round(C.AI.backTime * C.TICK_HZ);
  }
  if (r.gang === 'attack') {
    if (r.role === 'block') {
      // ride just in front of them in their lane (the lane, not their every twitch), a bit slower, so
      // they ride up into the fight; once they draw level it fights from that side like the other one
      const s = w.seen(p, r.react);
      if (r.intentT === 0 && Math.abs(s.x - C.LANE_X[r.lane]) > 1.75 + C.PATROL.laneCommit) {
        r.lane = nearestLane(s.x, false);
        r.intentT = C.PATROL.laneHold;
      }
      want = C.LANE_X[r.lane] + Math.max(-0.6, Math.min(0.6, s.x - C.LANE_X[r.lane]));
      const dz = s.z + G.blockAhead - r.z;
      r.pace = Math.max(0, Math.min(r.top, s.speed * G.blockPace + Math.max(-4, Math.min(4, dz * 1.2))));
      if (ahead < 1.5 || r.gangT > G.attackTime * C.TICK_HZ * 0.5) {
        r.role = 'strike';
        r.foeSide = r.x >= p.x ? 1 : -1;
      }
    } else want = shadow(w, r, p);
    maybeSwing(w, r, 1);
  } else if (r.gang === 'back') {
    const s = w.seen(p, r.react);
    want = clampEdge(s.x + r.foeSide * 3.8);
    r.pace = Math.max(0, s.speed - 4);
    if (r.intentT === 0) r.gang = 'attack';
    maybeSwing(w, r, 0.3);
  } else if (r.gang === 'leave') {
    r.pace = Math.max(0, p.speed - 9);
    want = r.foeSide * C.EDGE;
  }
  r.wantX = avoid(w, r, want);
}

/**
 * Headless player: sit beside the nearest rival ahead, swing whenever someone is in reach, dodge cars.
 * With `fight` off it just races (holds its lane, dodges, swings only at whoever comes into reach).
 * With `comply` it does what a security buggy wants and pulls over (brakes to a stop) while one presses it.
 */
export function botInput(w: World, skill = 1, fight = true, comply = false): void {
  const p = w.player;
  w.input.steer = 0;
  w.input.brake = false;
  if (p.state !== 'ride') return;
  const pt = w.patrol;
  if (comply && pt.active && (pt.mode === 'squeeze' || pt.mode === 'block' || pt.mode === 'halt') && Math.abs(pt.z - p.z) < 15) {
    w.input.brake = true;
    return;
  }
  let prey: Rider | null = null;
  for (const r of w.riders) {
    if (!fight || r.isPlayer || r.state !== 'ride') continue;
    const gap = r.z - p.z;
    if (gap > -3 && gap < 18 && (!prey || gap < prey.z - p.z)) prey = r;
  }
  let want: number = prey ? clampEdge(prey.x + (p.x >= prey.x ? 1.7 : -1.7)) : C.LANE_X[nearestLane(p.x)];
  want = dodge(w, p, want, 0.8 + 1.6 * skill);
  // Ease toward the pick like a finger would, instead of jumping each tick when the choice flips.
  const prev = w.input.targetX ?? p.x;
  w.input.targetX = prev + (want - prev) * 0.25;
  let rng = botRngs.get(w);
  if (!rng) botRngs.set(w, (rng = new Prng(w.seed * 31 + 11)));
  if (w.targetFor(p) && rng.float() < 0.25 * skill) w.input.attack = true;
}
