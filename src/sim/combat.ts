// Blows: who can be hit, swings and what they do, knock-offs and crashes, and who gets the credit.

import * as C from './config';
import { clamp, type Rider, type Pickup, type CrashCause } from './types';
import type { World } from './world';
import { chainKo } from './flair';
import { onCredit } from './chase';

/** The rider `r` could hit right now on either side, nearest first. */
export function targetFor(w: World, r: Rider, tol = 0): Rider | null {
  const reach = C.ATTACK.reachX + (r.weapon ? C.WEAPON[r.weapon].reach : 0) + tol;
  let best: Rider | null = null;
  let bestD = Infinity;
  for (const o of w.riders) {
    if (o === r || o.state !== 'ride' || o.airT > 0) continue;
    const dx = Math.abs(o.x - r.x);
    const dz = Math.abs(o.z - r.z);
    if (dz > C.ATTACK.reachZ + tol || dx > reach || dx < C.ATTACK.minX) continue;
    if (w.road.apart(r.x, r.z, o.x, o.z)) continue;
    const d = dx + dz;
    if (d < bestD) { bestD = d; best = o; }
  }
  return best;
}

/** The player's blows from this tick's input: a tap slaps; holding winds up, and letting go throws a haymaker. */
export function playerAttack(w: World, p: Rider): void {
  const inp = w.input;
  if (inp.attack) tryAttack(w, p);
  inp.attack = false;
  const K = C.CHARGE;
  if (inp.charge && p.state === 'ride' && !p.finished) {
    if (p.charge < K.full) p.charge++;
    if (p.charge >= K.min) p.speed *= K.drag;
    return;
  }
  if (p.charge >= K.min) tryAttack(w, p, p.charge / K.full);
  p.charge = 0;
}

/** Start a swing; `power` (0..1) makes it a haymaker (C.CHARGE). */
export function tryAttack(w: World, r: Rider, power = 0): boolean {
  if (r.state !== 'ride' || r.airT > 0 || r.atkT > 0 || r.atkCd > 0) return false;
  r.power = power;
  const t = targetFor(w, r, 0.3);
  r.atkSide = t ? (t.x >= r.x ? 1 : -1) : r.atkSide === 1 ? -1 : 1;
  r.atkT = r.isPlayer ? C.ATTACK.windup : C.ATTACK.windupAI;
  r.atkCd = C.ATTACK.cooldown + r.atkT - C.ATTACK.windup;
  // the player's blow is out at once; an AI rider holds its pace through the wind-up and loses it on the blow
  if (r.isPlayer) r.speed *= C.ATTACK.selfSlow;
  r.aim = t ? t.id : -1;
  if (t) {
    r.aimX = t.x;
    r.aimZ = t.z;
    r.aimVx = (t.x - t.px) * C.TICK_HZ;
    r.aimV = t.speed;
  }
  w.events.push({ type: 'swing', rider: r.id, side: r.atkSide, aim: r.aim, windup: r.atkT, power });
  return true;
}

export function resolveAttack(w: World, r: Rider): void {
  if (r.atkT <= 0) return;
  if (--r.atkT > 0 || r.state !== 'ride' || r.airT > 0) return;
  const A = C.ATTACK;
  if (!r.isPlayer) r.speed *= A.selfSlow;
  const reach = A.reachX + (r.weapon ? C.WEAPON[r.weapon].reach : 0) + 0.4 + r.power * C.CHARGE.reach;
  // an AI rider swings at where its target was heading when it wound up: off that line by now, it misses them
  let dodged: Rider | null = null;
  if (!r.isPlayer && r.aim >= 0) {
    const t = w.riders[r.aim];
    const k = A.windupAI * C.DT;
    if (Math.abs(t.x - (r.aimX + r.aimVx * k)) > A.dodgeX || Math.abs(t.z - (r.aimZ + r.aimV * k)) > A.dodgeZ) dodged = t;
  }
  let victim: Rider | null = null;
  let bestD = Infinity;
  for (const o of w.riders) {
    if (o === r || o === dodged || o.state !== 'ride' || o.invT > 0 || o.airT > 0) continue;
    if (w.road.apart(r.x, r.z, o.x, o.z)) continue;
    const dx = (o.x - r.x) * r.atkSide;
    const dz = Math.abs(o.z - r.z);
    if (dx < A.minX - 0.2 || dx > reach || dz > A.reachZ + 0.4) continue;
    if (dx + dz < bestD) { bestD = dx + dz; victim = o; }
  }
  if (!victim) {
    // swung at the player and missed: overbalanced and wide open for a moment
    if (!r.isPlayer && r.aim === w.player.id) {
      r.openT = A.open;
      r.speed *= 0.94;
      w.events.push({ type: 'whiff', rider: r.id, dodged: dodged !== null });
    }
    return;
  }
  const counter = r.isPlayer && victim.openT > 0;
  const dmg = (r.weapon ? C.WEAPON[r.weapon].dmg : 1) + (counter ? A.counterDmg : 0) + (r.power >= 1 ? C.CHARGE.dmg : 0);
  victim.hp -= dmg;
  victim.vx += r.atkSide * (A.push + (r.weapon ? C.WEAPON[r.weapon].push : 0) + r.power * C.CHARGE.push);
  victim.latV = 0;
  victim.stagT = victim.isPlayer ? A.stagger.player : A.stagger.ai;
  victim.shoveT = C.SHOVE.ticks;
  victim.openT = 0;
  victim.speed *= A.slow;
  victim.hitT = 6;
  victim.hitBy = r.id;
  const ko = victim.hp <= 0;
  w.events.push({ type: 'hit', from: r.id, to: victim.id, side: r.atkSide, dmg, ko, counter, power: r.power });
  if (r.isPlayer && patrolSees(w)) addHeat(w, ko ? C.HEAT.hit + C.HEAT.down : C.HEAT.hit);
  if (ko) return knockOff(w, victim, r);
  // the blow can knock their weapon loose: an empty hand takes it, an armed one knocks it to the road
  if (victim.weapon && w.combatRng.float() < (counter ? 1 : r.isPlayer ? C.STEAL.player : C.STEAL.ai)) {
    const kind = victim.weapon;
    victim.weapon = null;
    const took = r.weapon === null && !r.thug;
    if (took) r.weapon = kind;
    else w.pickups.push({ id: w.nextId++, x: w.road.clampX(victim.x + r.atkSide * 1.2, victim.z + 6), z: victim.z + 6, kind });
    w.events.push({ type: 'steal', from: r.id, to: victim.id, kind, took });
  }
}

/** A security buggy is close enough to see what the player is up to. */
export function patrolSees(w: World): boolean {
  return w.patrol.active && Math.abs(w.patrol.z - w.player.z) < C.HEAT.near;
}

export function addHeat(w: World, v: number): void {
  w.heat = clamp(w.heat + v, 0, C.HEAT.max);
}

/** Whoever put `v` down gets the credit: the player's settle grudges, a rival's on the player starts one. */
export function credit(w: World, v: Rider, by: Rider): void {
  if (by.isPlayer && w.grudges.has(v.id)) { w.grudgeKos++; w.grudges.delete(v.id); }
  if (by.isPlayer) {
    chainKo(w);
    v.koByPlayer++;
    if (v.id === w.nemesis) w.revenge++;
    if (w.chase) onCredit(w, v);
  }
  if (v.isPlayer && !by.isPlayer && !by.thug) {
    by.koPlayer++;
    if (by.koPlayer >= C.GRUDGE_AT && !w.grudges.has(by.id) && by.id !== w.nemesis) {
      w.grudges.add(by.id);
      w.events.push({ type: 'grudge', rider: by.id });
    }
  }
}

export function knockOff(w: World, v: Rider, by: Rider): void {
  if (by.isPlayer) w.kos++;
  credit(w, v, by);
  crash(w, v, 'ko', by.atkSide * 6);
}

export function crash(w: World, r: Rider, c: CrashCause, vx: number): void {
  if (r.state !== 'ride') return;
  r.state = 'down';
  r.downT = C.DOWN.lie[c];
  r.runT = 0;
  r.vx = vx;
  r.bikeX = r.bikePX = r.x;
  r.bikeZ = r.bikePZ = r.z;
  r.bikeV = r.speed;
  r.bikeVx = vx * C.DOWN.bikeSide;
  r.atkT = 0;
  r.huntT = 0;
  r.latV = 0;
  r.airT = 0;
  if (!r.thug) { r.intent = 'race'; r.intentT = 0; }
  if (r.isPlayer) {
    w.crashes++;
    w.threatCd = Math.max(w.threatCd, Math.round(C.LEADER.mercy * C.TICK_HZ));
  }
  w.events.push({ type: 'crash', rider: r.id, cause: c, vx, speed: r.speed });
  // knocked into a car or the barrier just after a blow: that one counts for whoever struck
  if (c !== 'ko' && r.shoveT > 0 && r.hitBy >= 0) {
    const by = w.riders[r.hitBy];
    if (by.isPlayer) {
      w.shoves++;
      if (patrolSees(w)) addHeat(w, C.HEAT.down);
    }
    credit(w, r, by);
    w.events.push({ type: 'shove', from: by.id, to: r.id, into: c });
  }
  r.shoveT = r.stagT = r.openT = 0;
  if (r.weapon) {
    const p: Pickup = { id: w.nextId++, x: w.road.clampX(r.x + Math.sign(vx || 1) * 1.2, r.z + 6), z: r.z + 6, kind: r.weapon };
    w.pickups.push(p);
    r.weapon = null;
  }
}

/** A rider in the race running over a weapon on the road picks it up. */
export function updatePickups(w: World): void {
  for (let i = w.pickups.length - 1; i >= 0; i--) {
    const k = w.pickups[i];
    for (const r of w.riders) {
      if (r.state !== 'ride' || r.finished || r.thug) continue;
      if (Math.abs(r.x - k.x) < 1.2 && Math.abs(r.z - k.z) < 1.6) {
        r.weapon = k.kind;
        w.pickups.splice(i, 1);
        w.events.push({ type: 'pickup', rider: r.id, kind: k.kind });
        w.events.push({ type: 'drop', pickup: k.id });
        break;
      }
    }
  }
}
