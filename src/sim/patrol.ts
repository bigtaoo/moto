// The test-site security buggy: when one is sent, how it chases, blocks, squeezes or waves the player
// on, and how it keeps out of traffic and pushes riders aside.

import * as C from './config';
import { clamp, type Side, type Car, type Patrol } from './types';
import type { World } from './world';
import { nearestLane } from './ai';
import { addHeat } from './combat';

export function updatePatrol(w: World): void {
  const pt = w.patrol;
  const p = w.player;
  const P = C.PATROL;
  const riding = p.state === 'ride';
  w.heat = Math.max(0, w.heat - C.HEAT.decay * C.DT);
  const units = w.patrolCount + Math.floor(w.heat) * C.HEAT.units;
  if (!pt.active) {
    if (pt.wait > 0) pt.wait--;
    else if (riding && !p.finished && pt.units < units && p.z > w.patrolFrom && p.z < w.length - P.stopBefore) sendPatrol(w);
    return;
  }
  pt.t++;
  const gap = p.z - pt.z;
  // the driver goes by what it saw a moment ago, not by where the player is this very tick
  const s = w.seen(p, pt.react);
  const sGap = s.z - pt.z;
  // a lane's width to one side of the player, on a side with room
  const roadHi = w.road.worksHi(pt.z) - (P.halfW - P.riderHalfW);
  const beside = (side: Side): number => {
    const off = P.halfW + P.riderHalfW + 1.2;
    const x = s.x + side * off;
    return x <= roadHi && x >= -C.EDGE ? x : clamp(s.x - side * off, -C.EDGE, roadHi);
  };
  const leave = () => {
    // it had them and they never pulled over: word gets round
    if ((pt.mode === 'squeeze' || pt.mode === 'block') && pt.hold > C.TICK_HZ / 2 && riding && !p.finished) addHeat(w, C.HEAT.flee);
    pt.mode = 'leave';
    pt.t = 0;
  };
  const toBlock = () => {
    pt.mode = 'block';
    pt.laneX = C.LANE_X[nearestLane(s.x, false)];
    pt.laneT = P.laneHold;
  };
  if (p.finished && pt.mode !== 'leave') leave();
  // off down a trail: it can't follow
  if (pt.mode !== 'leave' && w.road.trailAt(p.x, p.z) !== 0) leave();
  // pulling over works: once the player (as far as it can tell) has slowed right down, it lets them off
  if ((pt.mode === 'squeeze' || pt.mode === 'block') && riding) {
    pt.slowT = s.speed < P.haltSpeed ? pt.slowT + 1 : 0;
    if (pt.slowT > P.haltSec * C.TICK_HZ) {
      pt.resume = pt.mode;
      pt.mode = 'halt';
    }
  }
  let want = pt.x;
  let speed = pt.speed;
  let steer = P.steer;
  switch (pt.mode) {
    case 'chase':
      // while the player is down it hangs back and waits for them to get going again
      speed = riding ? s.speed + P.chaseGain + Math.max(0, sGap - 30) * 0.25 : s.speed + clamp(sGap - 30, -8, 8);
      // come up a lane over, never into the player's back: on their left to shove them right onto the
      // shoulder, unless they're out in the oncoming lane
      pt.side = s.x < -3.5 ? 1 : -1;
      want = beside(pt.side);
      if (gap > P.outrun) return patrolGone(w); // too quick for it: it never catches up
      if (pt.t > P.giveUp * C.TICK_HZ || p.finished) leave();
      else if (riding && gap < P.warnAt) {
        pt.mode = 'squeeze';
        pt.t = pt.hold = 0;
        w.events.push({ type: 'patrolWarn' });
      }
      break;
    case 'lurk':
      // cruise in its lane until the player comes up behind, then pull across in front of them, or wait
      // until they're level and lean in
      // a set pace, not the player's: if it matched them it could drag along someone stuck behind it
      speed = p.top * pt.pace;
      const inLane = Math.abs(p.x - pt.x) < P.halfW + P.riderHalfW + 0.5;
      // a squeezer speeds up as the player closes so they draw level slowly instead of running into its back
      if (pt.move === 'squeeze' && -sGap < 25 && riding) speed = Math.max(4, s.speed - clamp(-sGap * 0.3, 1.5, 6));
      if (riding && (pt.move === 'block' ? -gap < pt.pullOutAt : gap > -1 || (inLane && -gap < 8))) {
        if (pt.move === 'block') toBlock();
        else pt.mode = 'squeeze';
        pt.t = pt.hold = 0;
        w.events.push({ type: 'patrolWarn' });
      } else if (gap > P.halfL + 2) leave(); // got past it while down
      else if (pt.t > P.giveUp * C.TICK_HZ) {
        if (-gap > 60) return patrolGone(w); // never came: it turns off far up the road
        leave();
      }
      break;
    case 'block': {
      // sit in front of the player and slow down. It follows their lane, not their every twitch: only
      // a lane change it is sure of (they are well over the line), and not straight back again, so a
      // feint pulls it the wrong way and a real one leaves it a beat behind
      const lead = pt.z - s.z;
      if (lead < 12) pt.hold++; // the clock runs once it's actually in their way
      const k = clamp(pt.hold / pt.press, 0, 1);
      const pace = P.blockPace[0] + (P.blockPace[1] - P.blockPace[0]) * k;
      speed = clamp(s.speed + (pt.blockAhead - lead) * 1.5, s.speed * 0.5, p.top * pace);
      pt.laneT++;
      // it switches lane on what it saw them actually do, not on a guess where they're heading
      const at = w.seen(p, pt.react, 0).x;
      if (Math.abs(at - pt.laneX) > 1.75 + P.laneCommit && pt.laneT >= P.laneHold) {
        pt.laneX = C.LANE_X[nearestLane(at, false)];
        pt.laneT = 0;
      }
      want = pt.laneX + clamp(s.x - pt.laneX, -P.laneShade, P.laneShade);
      steer = P.blockSteer;
      if (!riding || pt.hold > pt.press || pt.t > pt.press + P.pressMax * C.TICK_HZ || gap > 2) leave();
      break;
    }
    case 'squeeze': {
      // pull the player over: draw level on one side, then lean in and shove them toward the other
      const wide = P.halfW + P.riderHalfW;
      // right up against them it feels them through the bodywork and keeps level as they slow
      const touching = Math.abs(gap) < P.halfL + 1 && Math.abs(pt.x - p.x) < wide + 0.4;
      const f = touching ? w.seen(p, P.feel) : s;
      const fGap = f.z - pt.z;
      speed = f.speed + clamp(fGap * 2, -6, 8);
      if (fGap < -(P.halfL + 3)) {
        // they braked harder than it could tell and it shot past: cut in front if it has time left
        if (pt.hold < pt.press) toBlock();
        else leave();
        break;
      }
      if (Math.abs(fGap) >= P.halfL || Math.abs(pt.x - f.x) > wide + 1.5) {
        // still getting there: a lane over (leaning in from behind would just run into their back), on
        // their left to shove them right onto the shoulder unless they're out in the oncoming lane
        pt.side = s.x < -3.5 ? 1 : -1;
        want = beside(pt.side);
      } else {
        pt.hold++;
        pt.side = pt.x >= p.x ? 1 : -1;
        pt.push = -pt.side as Side;
        // never into a car: with one on the shoulder side coming up, it eases off and leaves them a gap
        // (unless the heat is up: then it's their own lookout)
        want = w.heat < C.HEAT.rough && carOnShoulder(w, pt.push)
          ? f.x + pt.side * (wide + 1)
          : f.x + pt.side * (wide - P.squeezeIn);
        steer = P.pushSteer;
      }
      if (!riding || pt.hold > pt.press || pt.t > pt.press + P.pressMax * C.TICK_HZ) leave();
      else if (gap > 25 && pt.speed > pt.top - 0.5) leave(); // they're getting away and it's flat out
      break;
    }
    case 'halt':
      // they've pulled over: it draws up a lane over, just ahead of them, warns them and waves them on
      pt.haltT++;
      want = beside(pt.side);
      speed = clamp(s.speed + (s.z + P.halfL + 3 - pt.z) * 1.2, 0, pt.top);
      if (!riding) leave();
      else if (pt.haltT > P.letHold * C.TICK_HZ) {
        const fine = P.fine + Math.floor(w.heat) * P.fineStar;
        w.fines += fine;
        addHeat(w, -C.HEAT.comply);
        w.events.push({ type: 'patrolLetGo', fine });
        leave();
      } else if (s.speed > P.haltSpeed + 5) {
        // took off again before the warning: back at it
        pt.mode = pt.resume;
        pt.slowT = 0;
        if (pt.mode === 'block') toBlock();
      }
      break;
    case 'leave':
      // pull off the player's line first, then drop out of the race for good: well ahead, it speeds off;
      // otherwise it brakes and falls behind. It keeps out of the oncoming lane doing that: with its
      // weight it can't dart back out of a car's way there
      want = beside(pt.side);
      if (want < C.LANE_X[1] && s.x > -3.5) want = beside(-pt.side as Side);
      speed = gap < -3 ? p.top + 10 : gap < 0.5 && Math.abs(pt.x - p.x) < P.halfW + P.riderHalfW + 0.3 ? p.speed + 3 : riding ? Math.max(4, p.speed - 15) : 16; // player down: just drive off
      if (gap > P.goneAt || -gap > P.goneAhead) return patrolGone(w);
      // wedged in traffic right by the player for a while: it pulls off the road rather than hold them up
      if (pt.t > P.stuckSec * C.TICK_HZ && Math.abs(gap) < 8 && riding && pt.speed > p.speed - 3 && Math.abs(pt.x - p.x) < P.halfW + P.riderHalfW + 0.3) { w.patrolStuck++; return patrolGone(w); }
      break;
  }
  speed = Math.max(0, pt.mode === 'leave' ? speed : Math.min(speed, pt.top));
  pt.speed = speed > pt.speed ? Math.min(speed, pt.speed + P.accel * C.DT) : Math.max(speed, pt.speed - P.brake * C.DT);
  patrolTraffic(w, want, steer);
  pt.z += pt.speed * C.DT;
  patrolContacts(w);
}

/**
 * Is there a car the player would be shoved into: on their `push` side (alongside or within
 * C.PATROL.carWarn seconds ahead, oncoming ones included)?
 */
export function carOnShoulder(w: World, push: Side): boolean {
  const p = w.player;
  for (const c of w.cars) {
    const off = (c.x - p.x) * push;
    if (off < 0.3 || off > 3.5 + C.CAR.halfW) continue;
    const dist = c.z - p.z;
    if (Math.abs(dist) < C.CAR.halfL + 1.5) return true;
    const closing = p.speed - c.speed;
    if (dist > 0 && closing > 0.1 && (dist - C.CAR.halfL - 1.5) / closing < C.PATROL.carWarn) return true;
  }
  return false;
}

/** This buggy is out of the race; roll when the next one comes. */
export function patrolGone(w: World): void {
  const P = C.PATROL;
  w.patrol.active = false;
  const prog = clamp(w.player.z / w.length, 0, 1);
  const sec = w.patrolRng.float() < P.pairChance
    ? roll(w, P.pairGap)
    : (P.gapEarly + (P.gapLate - P.gapEarly) * prog) * w.patrolRate * roll(w, P.gapJitter);
  w.patrol.wait = Math.round(sec / (1 + C.HEAT.gap * w.heat) * C.TICK_HZ);
}

export function roll(w: World, r: readonly [number, number]): number {
  return r[0] + (r[1] - r[0]) * w.patrolRng.float();
}

/** A fresh buggy with its own dice: from behind or waiting ahead, blocking or squeezing, never the same plan twice running. */
export function sendPatrol(w: World): void {
  const pt = w.patrol;
  const p = w.player;
  const P = C.PATROL;
  const plans = (['behind squeeze', 'ahead block', 'ahead squeeze'] as const)
    .filter((k) => pt.units === 0 || k !== `${pt.from} ${pt.move}`);
  const [from, move] = w.patrolRng.pick(plans).split(' ') as [Patrol['from'], Patrol['move']];
  let side: Side = w.patrolRng.float() < 0.5 ? -1 : 1;
  // never turns up in the oncoming lane: it comes from behind in the player's direction of travel
  let x = Math.max(p.x, C.LANE_X[1]);
  let z = p.z - roll(w, P.spawnBack);
  // no car near the spot it turns up on
  const clear = (cx: number, cz: number) =>
    w.cars.every((c) => Math.abs(c.x - cx) > C.CAR.halfW + P.halfW || Math.abs(c.z - cz) > C.CAR.halfL + P.halfL + 6);
  if (from === 'behind') {
    const cx = [x, C.LANE_X[1], C.LANE_X[2], C.LANE_X[3]].find((cx) => clear(cx, z));
    if (cx === undefined) { pt.wait = C.TICK_HZ; return; }
    x = cx;
  } else {
    // a same-direction side lane (lane 0 is oncoming)
    const z0 = p.z + roll(w, P.spawnAhead);
    let spot: { x: number; z: number; side: Side } | null = null;
    for (let dz = 0; dz <= 60 && !spot; dz += 15) {
      for (const s of move === 'squeeze' ? [-1, 1] as Side[] : [side, -side as Side]) {
        const cx = s > 0 ? C.LANE_X[3] : C.LANE_X[1];
        if (clear(cx, z0 + dz)) { spot = { x: cx, z: z0 + dz, side: s }; break; }
      }
    }
    if (!spot) { pt.wait = C.TICK_HZ; return; } // road's busy up there; try again in a second
    ({ x, z, side } = spot);
  }
  pt.units++;
  const pace = roll(w, P.lurkPace);
  Object.assign(pt, {
    active: true, mode: from === 'ahead' ? 'lurk' : 'chase', t: 0, side, push: -side as Side, hold: 0, x, z,
    speed: from === 'ahead' ? p.top * pace : p.speed,
    from, move, pace, press: Math.round(roll(w, P.pressSec) * (1 + C.HEAT.press * w.heat) * C.TICK_HZ),
    blockAhead: roll(w, P.blockAhead), pullOutAt: roll(w, P.pullOutAt),
    react: Math.max(3, Math.round(roll(w, P.react) - Math.floor(w.heat) * C.HEAT.react)), top: roll(w, P.top) + w.div.top,
    vx: 0, laneX: x, laneT: 0, slowT: 0, haltT: 0, resume: move,
  });
  pt.px = pt.x;
  pt.pz = pt.z;
  patrolContacts(w); // don't appear inside someone
}

/**
 * The buggy is solid but never rams: a rider beside it is pushed aside (pinned on the barrier if
 * there's no room) and grinds speed off; one behind it is held on its bumper; one in front makes it
 * brake. Which face they meet on comes from last tick's positions, so it can't flip mid-contact.
 */
export function patrolContacts(w: World): void {
  const pt = w.patrol;
  if (!pt.active) return;
  const P = C.PATROL;
  const wide = P.halfW + P.riderHalfW;
  const long = P.halfL + 0.6;
  const carW = C.CAR.halfW + P.halfW;
  const carL = C.CAR.halfL + P.halfL;
  const hitsCar = (x: number) => w.cars.some((c) => Math.abs(c.x - x) < carW && Math.abs(c.z - pt.z) < carL);
  // two passes, so a push from one rider can't leave the buggy inside another
  for (let pass = 0; pass < 2; pass++) {
    for (const r of w.riders) {
      if (r.state !== 'ride' || r.airT > 0) continue;
      if (Math.abs(r.x - pt.x) >= wide - 1e-6 || Math.abs(r.z - pt.z) >= long - 1e-6) continue;
      const odx = r.px - pt.px;
      const odz = r.pz - pt.pz;
      if (Math.abs(odx) / wide >= Math.abs(odz) / long) {
        const s: Side = odx >= 0 ? 1 : -1;
        let nx = pt.x + s * wide;
        const lim = s > 0 ? r.hi : r.lo;
        if (nx * s > lim * s) {
          nx = lim;
          const bx = nx - s * wide;
          if (hitsCar(bx)) {
            // nowhere for either to go: the rider drops in behind the buggy
            r.z = pt.z - long;
            r.speed = Math.min(r.speed, pt.speed);
            continue;
          }
          pt.x = bx;
          r.speed *= P.pinned;
        }
        r.x = nx;
        if (pass === 0) {
          r.speed *= P.rub;
          r.rubT = C.CONTACT.rubTicks;
          r.rubSide = -s as Side;
          if ((w.tick + r.id) % C.CONTACT.rubEvery === 0) {
            w.events.push({ type: 'rub', x: r.x - s * P.riderHalfW, z: r.z, side: -s as Side, player: r.isPlayer });
          }
        }
      } else if (odz >= 0) {
        pt.z = r.z - long;
        pt.speed = Math.min(pt.speed, r.speed);
      } else {
        r.z = pt.z - long;
        r.speed = Math.min(r.speed, pt.speed);
      }
    }
  }
}

/**
 * Keeps the buggy out of traffic: it steers toward `want` but changes lane when a car is in the
 * way, never slides sideways into a car beside it, and slows behind a car it cannot get round.
 */
export function patrolTraffic(w: World, want: number, steerRate: number): void {
  const pt = w.patrol;
  const P = C.PATROL;
  const wide = C.CAR.halfW + P.halfW + 0.15;
  const long = C.CAR.halfL + P.halfL + 0.8; // margin covers the buggy's own move after traffic has moved this tick
  // seconds until the buggy reaches a car along lateral position x (0: one is already beside it)
  const clear = (x: number): number => {
    let best = Infinity;
    for (const c of w.cars) {
      if (Math.abs(c.x - x) > wide) continue;
      const dist = c.z - pt.z - long;
      if (dist < -2 * long) continue;
      const closing = pt.speed - c.speed;
      const t = dist <= 0 ? 0 : closing <= 0.1 ? Infinity : dist / closing;
      if (t < best) best = t;
    }
    const cones = w.road.conesAhead(x, P.halfW, pt.z + P.halfL);
    if (cones < Infinity) best = Math.min(best, pt.speed > 0.1 ? cones / pt.speed : cones > 0 ? Infinity : 0);
    return best;
  };
  let target = want;
  if (clear(want) < P.dodgeT) {
    let score = -Infinity;
    for (let i = 0; i < C.LANE_X.length; i++) {
      const x = C.LANE_X[i];
      const s = Math.min(clear(x), 4) - Math.abs(x - want) * 0.1 - (i === C.ONCOMING_LANE ? 1 : 0);
      if (s > score) { score = s; target = x; }
    }
  }
  // a buggy has weight: it builds up its sideways speed and has to kill it again
  const dodging = target !== want;
  const rate = dodging ? P.steer * 1.6 : steerRate;
  const v = clamp((target - pt.x) * 2.5, -rate, rate);
  // swerving out of a car's way it yanks the wheel harder than it steers to hunt the player
  const dv = P.latAcc * (dodging ? 1.8 : 1) * C.DT;
  pt.vx += clamp(v - pt.vx, -dv, dv);
  const nx = clamp(pt.x + pt.vx * C.DT, -C.EDGE, w.road.worksHi(pt.z) - (P.halfW - P.riderHalfW));
  // judged where the buggy will be after this tick's move, so it can't slip in beside a slower car's tail
  // (moving away from a car it is already alongside is always allowed)
  const blocked = (c: Car) => Math.abs(c.x - nx) < wide && Math.abs(c.x - nx) <= Math.abs(c.x - pt.x) &&
    (Math.abs(c.z - pt.z) < long || Math.abs(c.z - pt.z - Math.max(0, pt.speed - c.speed) * C.DT) < long);
  if (!w.cars.some(blocked)) pt.x = nx;
  else pt.vx = 0;
  // still boxed in: hang back behind the car ahead (an oncoming one is dodged above)
  let cap = Infinity;
  for (const c of w.cars) {
    if (Math.abs(c.x - pt.x) >= wide || c.speed <= 0) continue;
    const dist = c.z - pt.z - long;
    if (dist < -long) continue;
    cap = Math.min(cap, Math.max(0, c.speed + dist * 1.5)); // too close already: drop back
  }
  pt.speed = Math.min(pt.speed, cap);
  // and keep ahead of a car coming up right behind it, unless that would run it into the one in front
  // (the car behind brakes for the buggy then)
  for (const c of w.cars) {
    if (Math.abs(c.x - pt.x) >= wide || c.speed <= 0) continue;
    const dist = pt.z - c.z - long;
    if (dist < 0.5 && dist > -long) pt.speed = Math.max(pt.speed, Math.min(cap, c.speed + 0.5));
  }
}
