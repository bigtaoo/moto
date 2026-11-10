// The race simulation: fixed 30 Hz steps, no DOM, no Three.js, so the headless bot can run it.
// The road is straight here; the view bends and lifts it (src/view/track.ts).

import { Prng } from './rng';
import * as C from './config';
import { rivalThink, laneClearance, nearestLane } from './ai';
import { Road } from './road';
import { clamp, type Rider, type Car, type Pickup, type Patrol, type SimEvent, type Input, type WorldOpts, type Seen, type Hazard, type Slick } from './types';
import { targetFor, tryAttack, playerAttack, resolveAttack, crash, updatePickups } from './combat';
import { chaseSetup, chaseEnd } from './chase';
import { moveDown, recover } from './down';
import { contacts } from './contacts';
import { land, taunt, crownBoss } from './stunts';
import { placeHazards, updateHazards, grip } from './hazards';
import { MUTATOR, type Mutator } from './fun';
import { spawnCar, updateTraffic } from './traffic';
import { updatePatrol } from './patrol';
import { leaderThreats } from './threats';
import { newFlair, updateFlair } from './flair';

export * from './types';

export class World {
  tick = 0;
  readonly length: number;
  readonly riders: Rider[] = [];
  readonly cars: Car[] = [];
  readonly pickups: Pickup[] = [];
  readonly patrol: Patrol = {
    active: false, mode: 'leave', t: 0, side: 1, units: 0, wait: 0, push: 1, hold: 0, x: 0, z: 0, px: 0, pz: 0, speed: 0,
    from: 'behind', move: 'block', press: 0, blockAhead: 0, pullOutAt: 0, pace: 0,
    react: 10, top: 32, vx: 0, laneX: 0, laneT: 0, slowT: 0, haltT: 0, resume: 'block',
  };
  /** Patrol dice: their own stream, so they don't shift traffic or AI. Busy-ness and first arrival are per race. */
  readonly patrolRng: Prng;
  /** Leaving buggies that had to vanish because traffic wedged them in by the player (should be rare). */
  patrolStuck = 0;
  /** Buggies on duty this race (more when the heat is up). */
  readonly patrolCount: number;
  readonly patrolRate: number;
  readonly patrolFrom: number;
  readonly events: SimEvent[] = [];
  readonly grudges: Set<number>;
  readonly input: Input = { targetX: null, steer: 0, brake: false, attack: false, charge: false, remount: false, taunt: false };
  /** The nemesis' rider id, or -1. */
  readonly nemesis: number;
  /** Times the player knocked the nemesis off this race. */
  revenge = 0;
  countdown = Math.round(C.COUNTDOWN_S * C.TICK_HZ);
  over = false;
  overT = -1;
  finished = 0;
  kos = 0;
  /** Riders the player knocked into traffic or the barrier. */
  shoves = 0;
  grudgeKos = 0;
  /** Near misses with traffic and KO chains (src/sim/flair.ts). */
  readonly flair = newFlair();
  crashes = 0;
  /** Fines paid for pulling over, and the heat (see C.HEAT). */
  fines = 0;
  heat = 0;
  /** Dice for blows (weapons knocked loose): their own stream. */
  readonly combatRng: Prng;
  nextId = 1;
  threatCd = Math.round(C.LEADER.firstDelay * C.TICK_HZ);
  nextThreat: 'hunt' | 'ambush' = 'hunt';
  readonly traffic: Prng;
  readonly aiRng: Prng;
  readonly seed: number;
  readonly divIndex: number;
  readonly div: C.Stage;
  readonly vehicle: number;
  /** Construction zones, trails and ramps this race. */
  readonly road: Road;
  readonly trafficBase: number;
  readonly trafficExtra: number;
  /** A security shift (src/sim/chase.ts): the player hunts the field down; runners knocked off are caught. */
  readonly chase: boolean;
  caught = 0;
  /** Roadside hazards and oil slicks (src/sim/hazards.ts), from their own dice. */
  readonly hazards: Hazard[] = [];
  readonly slicks: Slick[] = [];
  readonly funRng: Prng;
  /** Ticks left to taunt after a takedown; the boss' rider id (-1: none); this race's mutator. */
  tauntT = 0;
  boss = -1;
  readonly mutator: Mutator | null;

  constructor(opts: WorldOpts) {
    this.seed = opts.seed;
    this.chase = opts.chase === true;
    this.mutator = opts.mutator ?? null;
    const mut = this.mutator;
    const bats = mut === 'bats';
    this.divIndex = clamp(Math.floor(opts.div ?? 0), 0, C.DIVISIONS.length - 1);
    this.div = C.stage(this.divIndex, Math.floor(opts.tier ?? 0), opts.endless ?? 0);
    this.length = opts.length ?? Math.round(C.RACE_LEN * this.div.len);
    this.vehicle = clamp(Math.floor(opts.vehicle ?? 0), 0, C.VEHICLES.length - 1);
    this.road = new Road(this.length, this.div, new Prng(opts.seed * 23 + 7));
    const busier = this.div.traffic * (mut === 'traffic' ? MUTATOR.traffic : 1);
    this.trafficBase = Math.round(C.TRAFFIC.base * busier);
    this.trafficExtra = Math.round(C.TRAFFIC.extra * busier);
    this.traffic = new Prng(opts.seed * 7 + 1);
    this.aiRng = new Prng(opts.seed * 13 + 5);
    this.patrolRng = new Prng(opts.seed * 17 + 11);
    this.combatRng = new Prng(opts.seed * 19 + 3);
    this.funRng = new Prng(opts.seed * 29 + 13);
    const [lo, hi] = C.PATROL.count;
    const count = lo + this.patrolRng.int(hi - lo + 1);
    this.patrolRate = C.PATROL.busyGap[0] + (C.PATROL.busyGap[1] - C.PATROL.busyGap[0]) * (count - lo) / (hi - lo);
    const busy = (count - lo) / (hi - lo);
    this.patrolCount = count + this.div.patrol + (mut === 'police' ? MUTATOR.patrol : 0);
    const [s0, s1] = C.PATROL.startAt;
    this.patrolFrom = this.length * clamp(s1 - (s1 - s0) * busy + (this.patrolRng.float() - 0.5) * 0.1, s0, s1);
    this.grudges = new Set(opts.grudges ?? []);
    this.nemesis = opts.nemesis !== undefined && opts.nemesis >= 1 && opts.nemesis <= C.ROSTER.length ? opts.nemesis : -1;
    const up = opts.upgrades ?? { top: 0, steer: 0, hp: 0 };
    const v = C.VEHICLES[this.vehicle];
    const grid = (i: number) => ({ x: C.LANE_X[1 + (i % 3)] + (i >= 3 ? -0.9 : 0.9), z: 14 - Math.floor(i / 3) * 6 });
    // Player starts at the back of the grid so the first fight comes within seconds.
    this.addRider({
      name: 'You', isPlayer: true, x: C.LANE_X[2], z: 2,
      top: C.PLAYER_BASE.top + v.top + up.top * C.UPGRADE_STEP.top,
      steer: C.PLAYER_BASE.steer + v.steer + up.steer * C.UPGRADE_STEP.steer,
      hp: C.PLAYER_BASE.hp + v.hp + up.hp * C.UPGRADE_STEP.hp, accel: C.PLAYER_BASE.accel + v.accel,
      aggr: 0, aware: 1, body: C.PLAYER_BODY, ride: C.PLAYER_RIDE, weapon: opts.weapon ?? (bats ? 'bat' : undefined),
    });
    C.ROSTER.forEach((s, i) => {
      const g = grid(i);
      const d = this.div;
      const nem = i + 1 === this.nemesis;
      this.addRider({
        name: s.name, isPlayer: false, x: g.x, z: g.z, top: s.top + d.top + (nem ? C.NEMESIS.top : 0), steer: 7, hp: C.RIVAL_HP + d.hp + (nem ? C.NEMESIS.hp : 0),
        aggr: Math.min(1, s.aggr + d.mind + (nem ? C.NEMESIS.aggr : 0)), aware: Math.min(1, s.aware + d.mind), body: s.body, ride: s.ride, weapon: bats ? 'bat' : s.weapon,
      });
    });
    // Two thugs, off the road until an ambush calls them.
    for (let i = 0; i < 2; i++) {
      const G = C.GANG;
      this.addRider({ name: G.name, isPlayer: false, x: 0, z: -1000, top: G.top, steer: G.steer, hp: G.hp, aggr: G.aggr, aware: G.aware, body: G.body, ride: G.ride });
      const t = this.riders[this.riders.length - 1];
      t.thug = true;
      t.state = 'away';
      t.accel = G.accel;
    }
    // each AI rider's reflexes: the more aware, the quicker it sees and the slicker it changes line
    for (const r of this.riders) {
      if (r.isPlayer) continue;
      const A = C.AI;
      r.react = Math.round(A.react[1] - (A.react[1] - A.react[0]) * r.aware) + this.aiRng.int(3);
      r.latAcc = A.latAcc[0] + (A.latAcc[1] - A.latAcc[0]) * r.aware;
      r.intentT = this.aiRng.int(C.TICK_HZ);
    }
    if (this.chase) chaseSetup(this);
    if (opts.boss && !this.chase) crownBoss(this);
    for (let z = 70; z < 70 + C.TRAFFIC.ahead; z += 25 + this.traffic.float() * 20) spawnCar(this, z);
    for (const f of C.PICKUP_AT) {
      let x: number = C.LANE_X[1 + this.traffic.int(3)];
      let z = this.length * f;
      // not behind the cones, nor right in front of a ramp
      if (this.road.worksHi(z) < x + 0.5) x = C.LANE_X[2];
      for (const r of this.road.ramps) if (!r.trail && Math.abs(r.x - x) < 1 && Math.abs(r.z - z) < 15) z = r.z - 20;
      const roll = this.traffic.float();
      this.pickups.push({ id: this.nextId++, x, z, kind: bats ? 'bat' : roll < 0.4 ? 'pan' : roll < 0.8 ? 'bat' : 'oil' });
    }
    placeHazards(this);
  }

  get player(): Rider {
    return this.riders[0];
  }

  /** A rival out to get the player: one holding a grudge, or the nemesis. */
  hates(id: number): boolean {
    return id === this.nemesis || this.grudges.has(id);
  }

  private addRider(o: { name: string; isPlayer: boolean; x: number; z: number; top: number; steer: number; hp: number; accel?: number; aggr: number; aware: number; body: number; ride: number; weapon?: C.WeaponKind }): void {
    this.riders.push({
      id: this.riders.length, name: o.name, isPlayer: o.isPlayer, x: o.x, z: o.z, px: o.x, pz: o.z, vx: 0, speed: 0,
      top: o.top, accel: o.accel ?? C.PLAYER_BASE.accel, steer: o.steer, hp: o.hp, maxHp: o.hp, wantX: o.x, braking: false,
      state: 'ride', downT: 0, runT: 0, bikeX: o.x, bikeZ: o.z, bikePX: o.x, bikePZ: o.z, bikeV: 0, bikeVx: 0, invT: 0, atkT: 0, atkSide: 1, atkCd: 0, charge: 0, power: 0, hitT: 0, weapon: o.weapon ?? null,
      finished: false, place: 0, aggr: o.aggr, aware: o.aware, body: o.body, ride: o.ride, koPlayer: 0, koByPlayer: 0, rubT: 0, rubSide: 1,
      thug: false, huntT: 0, gang: 'lurk', gangT: 0, role: 'strike', pace: 0,
      react: 10, latV: 0, latAcc: 16, intent: 'race', intentT: 0, lane: nearestLane(o.x), escX: o.x, escT: 0,
      foe: -1, foeSide: 1, foeOff: 1.6, wob: 0, wobTo: 0, hitBy: -1, hx: [], hz: [], hv: [],
      stagT: 0, shoveT: 0, openT: 0, aim: -1, aimX: 0, aimZ: 0, aimVx: 0, aimV: 0,
      lo: -C.EDGE, hi: C.EDGE, airT: 0, airMax: 0, cutId: -1, cutTake: false, boss: false, slide: 0, bowled: 0,
    });
    this.resetMemory(this.riders[this.riders.length - 1]);
  }

  /** Forget where a rider was: it has always been where it is now (a thug pulling onto the road). */
  resetMemory(r: Rider): void {
    for (let i = 0; i < C.AI.memory; i++) { r.hx[i] = r.x; r.hz[i] = r.z; r.hv[i] = r.speed; }
  }

  /** Note where everyone ended this tick, for the others' late view of them. */
  private remember(): void {
    const i = this.tick % C.AI.memory;
    for (const r of this.riders) { r.hx[i] = r.x; r.hz[i] = r.z; r.hv[i] = r.speed; }
  }

  /**
   * Rider `o` as someone who reacts `lag` ticks late sees them: where they were then, carried forward
   * by their speed and part of their sideways speed (C.AI.predict). A sudden swerve or a hard brake only
   * shows up a reaction time later, and a feint draws them the wrong way.
   */
  seen(o: Rider, lag: number, predict: number = C.AI.predict): Seen {
    const M = C.AI.memory;
    const l = clamp(lag, 1, M - 4);
    const at = (k: number) => (((this.tick - k) % M) + M) % M;
    const i = at(l);
    const x = o.hx[i];
    const z = o.hz[i];
    const speed = o.hv[i];
    const vx = (x - o.hx[at(l + 3)]) * (C.TICK_HZ / 3);
    const t = l * C.DT;
    return { x: clamp(x + vx * t * predict, -C.CUT.outer, C.CUT.outer), z: z + speed * t, speed, vx };
  }

  /** Progress in seconds since the start signal. */
  get time(): number {
    return Math.max(0, this.tick - Math.round(C.COUNTDOWN_S * C.TICK_HZ)) / C.TICK_HZ;
  }

  /** Riders in the race (the thugs aren't). */
  get racers(): number {
    let n = 0;
    for (const r of this.riders) if (!r.thug) n++;
    return n;
  }

  /** Current standing of the player, 1-based. */
  get standing(): number {
    const p = this.player;
    if (p.finished || this.over) return p.place; // at the time cap the ones still riding are placed, not finished
    let ahead = this.finished;
    for (const r of this.riders) if (!r.isPlayer && !r.thug && !r.finished && r.z > p.z) ahead++;
    return ahead + 1;
  }

  step(): void {
    this.tick++;
    for (const r of this.riders) { r.px = r.x; r.pz = r.z; r.bikePX = r.bikeX; r.bikePZ = r.bikeZ; }
    for (const c of this.cars) c.pz = c.z;
    this.patrol.px = this.patrol.x;
    this.patrol.pz = this.patrol.z;
    if (this.countdown > 0) {
      if (--this.countdown === 0) this.events.push({ type: 'go' });
      this.remember();
      return;
    }
    this.controlPlayer();
    for (const r of this.riders) if (!r.isPlayer) rivalThink(this, r);
    for (const r of this.riders) this.move(r);
    contacts(this);
    updateTraffic(this);
    updateFlair(this);
    for (const r of this.riders) resolveAttack(this, r);
    updatePickups(this);
    updateHazards(this);
    // on a security shift the player is the security: no buggies, hunters or thugs
    if (!this.chase) { updatePatrol(this); leaderThreats(this); }
    this.checkFinish();
    this.remember();
  }

  private controlPlayer(): void {
    const p = this.player;
    const inp = this.input;
    // the barrier and a trail's sides hold the player in; the cones don't (ride into them and you're off)
    const [lo, hiB] = this.road.bounds(p.x, p.z);
    const hi = hiB === this.road.worksHi(p.z) ? C.EDGE : hiB;
    if (inp.targetX !== null) p.wantX = clamp(inp.targetX, lo, hi);
    else p.wantX = clamp(p.x + inp.steer * 3, lo, hi);
    p.braking = inp.brake || (this.chase && this.time < C.CHASE.hold);
    playerAttack(this, p);
    taunt(this, p);
    if (inp.remount && p.state === 'down') {
      // straight back onto the scooter, with a moment's grace
      p.bikeX = this.road.clampX(p.bikeX, p.bikeZ);
      recover(this, p);
    }
    inp.remount = false;
  }

  private move(r: Rider): void {
    if (r.invT > 0) r.invT--;
    if (r.hitT > 0) r.hitT--;
    if (r.atkCd > 0) r.atkCd--;
    if (r.rubT > 0) r.rubT--;
    if (r.stagT > 0) r.stagT--;
    if (r.shoveT > 0) r.shoveT--;
    if (r.openT > 0) r.openT--;
    if (r.state === 'away') return;
    if (r.state === 'down') return moveDown(this, r);
    const R = this.road;
    if (r.airT > 0 && --r.airT === 0) land(this, r);
    const air = r.airT > 0;
    // out on a trail: a bumpier ride, but it cuts the corner
    const trail = R.trailAt(r.x, r.z) !== 0;
    // leaves and ice: less grip to steer with, and a shove carries further
    const slip = air ? null : grip(this, r);
    const g = slip ? slip.grip : 1;
    if (!air) {
      const target = r.braking || (r.finished && r.isPlayer) ? 0 : this.topNow(r) * (trail ? C.CUT.top : 1);
      if (r.speed < target) r.speed = Math.min(target, r.speed + r.accel * C.DT);
      else r.speed = Math.max(target, r.speed - (r.braking ? C.BRAKE : C.COAST) * C.DT);
      // a blow carries the rider sideways for a moment before they can steer against it
      if (r.isPlayer) {
        const step = r.steer * g * C.DT;
        if (r.stagT === 0) r.x += clamp(r.wantX - r.x, -step, step);
      } else {
        // an AI rider has to build up and kill its sideways speed instead of snapping onto its line
        const v = clamp((r.wantX - r.x) * 2.6, -r.steer, r.steer);
        const dv = r.latAcc * g * C.DT;
        if (r.stagT === 0) r.latV += clamp(v - r.latV, -dv, dv);
        r.x += r.latV * C.DT;
      }
    }
    r.x += r.vx * C.DT;
    const [lo, hi] = R.bounds(r.px, r.z);
    r.lo = lo;
    r.hi = hi;
    // riding into the cones of a construction zone at speed throws them off (not just after getting back on)
    const cones = !air && r.invT === 0 && r.speed > C.WORKS.crashSpeed && r.x > hi + 0.05 && hi < C.EDGE - 1e-6 && R.worksHi(r.z) <= hi + 1e-6;
    let slam = false;
    if (r.x > hi || r.x < lo) {
      // knocked into the barrier hard enough, it throws them off; otherwise they scrape along it
      const out = r.x > hi ? 1 : -1;
      slam = r.shoveT > 0 && r.vx * out > C.SHOVE.wallVx;
      r.x = out > 0 ? hi : lo;
      r.vx = r.latV = 0;
      if (!air) r.speed *= 0.985;
    }
    r.vx *= slip ? slip.carry : r.stagT > 0 ? C.SHOVE.carry : 0.82;
    r.z += r.speed * C.DT * (trail ? C.CUT.gain : 1);
    if (cones) return crash(this, r, 'cones', -3);
    if (slam) return crash(this, r, 'wall', r.x > 0 ? -3 : 3);
    if (air) return;
    // the end post of a trail's opening, for one caught halfway across
    if (r.speed > C.WORKS.crashSpeed && R.postHit(r.x, r.pz, r.z)) return crash(this, r, 'wall', r.x > 0 ? -3 : 3);
    const ramp = R.rampHit(r.x, r.pz, r.z);
    if (ramp && r.speed > C.RAMP.minSpeed) {
      r.airT = r.airMax = Math.max(2, Math.round(r.speed * C.RAMP.air * C.TICK_HZ * (this.mutator === 'lowgrav' ? MUTATOR.air : 1)));
      r.atkT = 0;
      this.events.push({ type: 'jump', rider: r.id });
    }
  }

  /** The player rides flat out; an AI rider goes at the pace its AI picked this tick (src/sim/ai.ts). */
  private topNow(r: Rider): number {
    return r.isPlayer ? r.top : r.pace;
  }

  /** The rider `r` could hit right now on either side, nearest first. */
  targetFor(r: Rider, tol = 0): Rider | null {
    return targetFor(this, r, tol);
  }

  tryAttack(r: Rider): boolean {
    return tryAttack(this, r);
  }

  /** Free distance ahead of `r` along lateral position x. */
  clearance(r: Rider, x: number): number {
    return laneClearance(this, r, x);
  }

  // --- finish ---

  private checkFinish(): void {
    for (const r of this.riders) {
      if (r.finished || r.thug || r.z < this.length) continue;
      r.finished = true;
      r.place = ++this.finished;
      this.events.push({ type: 'finish', rider: r.id, place: r.place });
      if (r.isPlayer) this.overT = this.tick + Math.round(1.6 * C.TICK_HZ);
    }
    if (this.chase) chaseEnd(this);
    const timeUp = this.time >= C.TIME_CAP_S;
    if (!this.over && ((this.overT > 0 && this.tick >= this.overT) || timeUp)) {
      // Riders still on the road get places by distance.
      const rest = this.riders.filter((r) => !r.finished && !r.thug).sort((a, b) => b.z - a.z || a.id - b.id);
      for (const r of rest) r.place = ++this.finished;
      this.over = true;
      this.events.push({ type: 'over' });
    }
  }
}
