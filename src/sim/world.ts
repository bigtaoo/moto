// The race simulation: fixed 30 Hz steps, no DOM, no Three.js, so the headless bot can run it.
// The road is straight here; the view bends and lifts it (src/view/track.ts).

import { Prng } from './rng';
import * as C from './config';
import { rivalThink, laneClearance, nearestLane } from './ai';
import { Road } from './road';

export type Side = -1 | 1;
export type CrashCause = 'ko' | 'car' | 'wall' | 'cones';

export interface Rider {
  id: number;
  name: string;
  isPlayer: boolean;
  x: number;
  z: number;
  px: number;
  pz: number;
  vx: number;
  speed: number;
  top: number;
  accel: number;
  steer: number;
  hp: number;
  maxHp: number;
  wantX: number;
  braking: boolean;
  /** 'away': a thug not on the road right now. */
  state: 'ride' | 'down' | 'away';
  /** Down: ticks left lying on the road; then runT counts ticks spent running back to the scooter. */
  downT: number;
  runT: number;
  /** Down: where the scooter is (it slides on without the rider), last tick's spot, and its speed. */
  bikeX: number;
  bikeZ: number;
  bikePX: number;
  bikePZ: number;
  bikeV: number;
  bikeVx: number;
  invT: number;
  atkT: number;
  atkSide: Side;
  atkCd: number;
  hitT: number;
  weapon: C.WeaponKind | null;
  finished: boolean;
  place: number;
  aggr: number;
  aware: number;
  body: number;
  ride: number;
  /** Times this rival knocked the player off, and the player them. */
  koPlayer: number;
  koByPlayer: number;
  /** Ticks left of shoulder-to-shoulder pressing, and which side the other rider is on. */
  rubT: number;
  rubSide: Side;
  /** Not in the race: one of the shoulder thugs. */
  thug: boolean;
  /** Ticks left of hunting the leader (rivals). */
  huntT: number;
  /** Thug plan and ticks spent in it; its part when two come together. */
  gang: 'lurk' | 'attack' | 'back' | 'leave';
  gangT: number;
  role: 'strike' | 'block' | 'pincer';
  /** Target speed the AI sets while riding with someone (thugs always, rivals while harassing). */
  pace: number;
  // --- how an AI rider sees and moves (unused for the player) ---
  /** Ticks late it sees the others: everyone reacts to where you were, not where you are. */
  react: number;
  /** Sideways speed and how fast it can change: an AI rider has to start and stop a lane change. */
  latV: number;
  latAcc: number;
  /** What it is up to, for how many more ticks before it thinks again, and the lane (C.LANE_X index) it rides in. */
  intent: 'race' | 'harass' | 'back';
  intentT: number;
  lane: number;
  /** Line picked to get round traffic, held this many more ticks so it doesn't flip-flop. */
  escX: number;
  escT: number;
  /** Harassing: whom, from which side, how far out, and a slow drift so it never sits dead still. */
  foe: number;
  foeSide: Side;
  foeOff: number;
  wob: number;
  wobTo: number;
  /** Who landed the last blow on this rider (-1: nobody yet). */
  hitBy: number;
  /** Ticks left of being carried by a blow (no steering), and of a crash still counting for whoever struck. */
  stagT: number;
  shoveT: number;
  /** Ticks left wide open after swinging at the player and missing. */
  openT: number;
  /** The swing under way: whom it is aimed at (-1: nobody) and where they were and how they were moving then. */
  aim: number;
  aimX: number;
  aimZ: number;
  aimVx: number;
  aimV: number;
  /** Where it was over the last C.AI.memory ticks (ring buffer, indexed by tick), for the others' late view of it. */
  hx: number[];
  hz: number[];
  hv: number[];
  /** Where it can ride this tick (the barrier, the cones, a trail's sides): set by World.move. */
  lo: number;
  hi: number;
  /** Ticks left in the air off a ramp, out of how many. */
  airT: number;
  airMax: number;
  /** The trail (World.road.cuts index) it has made up its mind about, and whether it takes it. */
  cutId: number;
  cutTake: boolean;
}

/** What an AI makes of another rider: where they were a reaction time ago, carried forward. */
export interface Seen {
  x: number;
  z: number;
  speed: number;
  vx: number;
}

export interface Car {
  id: number;
  x: number;
  z: number;
  pz: number;
  speed: number;
  /** The speed it drives at when nothing holds it up. */
  cruise: number;
  lane: number;
  color: number;
}

export interface Pickup {
  id: number;
  x: number;
  z: number;
  kind: C.WeaponKind;
}

/**
 * The security buggy on the road right now, if any. Each one makes a single go at the player and then
 * leaves the race; the next one is a different buggy, from behind or waiting ahead.
 */
export interface Patrol {
  active: boolean;
  /**
   * chase: ride up from behind. lurk: cruise slowly in a side lane ahead, waiting. block: sit in front of
   * the player, slowing and shadowing their line. squeeze: draw level and shove them toward the shoulder.
   * halt: the player did pull over; it draws up beside them, warns them and lets them go.
   * leave: pull off the player's line and drop out.
   */
  mode: 'chase' | 'lurk' | 'block' | 'squeeze' | 'halt' | 'leave';
  t: number;
  /** Which side of the player it works from. */
  side: Side;
  /** Buggies sent so far this race. */
  units: number;
  /** This buggy's plan, rolled when it is sent: where it comes from and which move it makes. */
  from: 'behind' | 'ahead';
  move: 'block' | 'squeeze';
  /** Its rolled numbers: ticks it presses for, metres ahead it blocks at, where it pulls out, lurking pace. */
  press: number;
  blockAhead: number;
  pullOutAt: number;
  pace: number;
  /** Ticks until the next buggy, once this one has gone. */
  wait: number;
  /** Squeezing: which way it shoves the player (away from its own side). */
  push: Side;
  /** Ticks it has actually been at it (level with them, or in front of them); its press time counts these. */
  hold: number;
  /** The driver: ticks late it sees the player, top speed, sideways speed. */
  react: number;
  top: number;
  vx: number;
  /** Blocking: the lane it holds and ticks since it last switched. */
  laneX: number;
  laneT: number;
  /** Ticks the player has looked stopped; ticks spent pulled up beside them; what it goes back to if they take off. */
  slowT: number;
  haltT: number;
  resume: 'block' | 'squeeze';
  x: number;
  z: number;
  px: number;
  pz: number;
  speed: number;
}

export type SimEvent =
  | { type: 'swing'; rider: number; side: Side; aim: number; windup: number }
  | { type: 'hit'; from: number; to: number; side: Side; dmg: number; ko: boolean; counter: boolean }
  | { type: 'whiff'; rider: number; dodged: boolean }
  | { type: 'shove'; from: number; to: number; into: 'car' | 'wall' | 'cones' }
  | { type: 'steal'; from: number; to: number; kind: C.WeaponKind; took: boolean }
  | { type: 'crash'; rider: number; cause: CrashCause; vx: number; speed: number }
  | { type: 'recover'; rider: number }
  | { type: 'pickup'; rider: number; kind: C.WeaponKind }
  | { type: 'drop'; pickup: number }
  | { type: 'patrolWarn' }
  | { type: 'patrolLetGo'; fine: number }
  | { type: 'finish'; rider: number; place: number }
  | { type: 'grudge'; rider: number }
  | { type: 'rub'; x: number; z: number; side: Side; player: boolean }
  | { type: 'hunt'; rider: number }
  | { type: 'ambush'; riders: number[] }
  | { type: 'jump'; rider: number }
  | { type: 'land'; rider: number; stomp: number }
  | { type: 'go' }
  | { type: 'over' };

export interface Upgrades {
  top: number;
  steer: number;
  hp: number;
}

export interface Input {
  /** Lateral target in metres (drag steering); null while keys steer. */
  targetX: number | null;
  steer: number;
  brake: boolean;
  attack: boolean;
  /** Down: back on the scooter right now (paid for with a rewarded ad, once a race). */
  remount: boolean;
}

export interface WorldOpts {
  seed: number;
  upgrades?: Upgrades;
  /** Rival ids that hold a grudge from earlier races. */
  grudges?: number[];
  /** The player's nemesis (a rival id), if they have one. */
  nemesis?: number;
  length?: number;
  /** Division (C.DIVISIONS index): where the race is and how hard. */
  div?: number;
  /** Season (C.TIERS index): harder again on top of the division. */
  tier?: number;
  /** The player's ride (C.VEHICLES index). */
  vehicle?: number;
}

const CAR_COLORS = [0xd8d8d8, 0x3f6fb5, 0xb53f3f, 0x2e8b57, 0xe0c040, 0x444a55, 0xf08a30, 0x8a5cc0];

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
  private readonly patrolRng: Prng;
  /** Leaving buggies that had to vanish because traffic wedged them in by the player (should be rare). */
  patrolStuck = 0;
  /** Buggies on duty this race (more when the heat is up). */
  readonly patrolCount: number;
  private readonly patrolRate: number;
  private readonly patrolFrom: number;
  readonly events: SimEvent[] = [];
  readonly grudges: Set<number>;
  readonly input: Input = { targetX: null, steer: 0, brake: false, attack: false, remount: false };
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
  crashes = 0;
  /** Fines paid for pulling over, and the heat (see C.HEAT). */
  fines = 0;
  heat = 0;
  /** Dice for blows (weapons knocked loose): their own stream. */
  private readonly combatRng: Prng;
  private nextId = 1;
  private threatCd = Math.round(C.LEADER.firstDelay * C.TICK_HZ);
  private nextThreat: 'hunt' | 'ambush' = 'hunt';
  private readonly traffic: Prng;
  readonly aiRng: Prng;
  readonly seed: number;
  readonly divIndex: number;
  readonly div: C.Stage;
  readonly vehicle: number;
  /** Construction zones, trails and ramps this race. */
  readonly road: Road;
  private readonly trafficBase: number;
  private readonly trafficExtra: number;

  constructor(opts: WorldOpts) {
    this.seed = opts.seed;
    this.divIndex = clamp(Math.floor(opts.div ?? 0), 0, C.DIVISIONS.length - 1);
    this.div = C.stage(this.divIndex, Math.floor(opts.tier ?? 0));
    this.length = opts.length ?? Math.round(C.RACE_LEN * this.div.len);
    this.vehicle = clamp(Math.floor(opts.vehicle ?? 0), 0, C.VEHICLES.length - 1);
    this.road = new Road(this.length, this.div, new Prng(opts.seed * 23 + 7));
    this.trafficBase = Math.round(C.TRAFFIC.base * this.div.traffic);
    this.trafficExtra = Math.round(C.TRAFFIC.extra * this.div.traffic);
    this.traffic = new Prng(opts.seed * 7 + 1);
    this.aiRng = new Prng(opts.seed * 13 + 5);
    this.patrolRng = new Prng(opts.seed * 17 + 11);
    this.combatRng = new Prng(opts.seed * 19 + 3);
    const [lo, hi] = C.PATROL.count;
    const count = lo + this.patrolRng.int(hi - lo + 1);
    this.patrolRate = C.PATROL.busyGap[0] + (C.PATROL.busyGap[1] - C.PATROL.busyGap[0]) * (count - lo) / (hi - lo);
    const busy = (count - lo) / (hi - lo);
    this.patrolCount = count + this.div.patrol;
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
      aggr: 0, aware: 1, body: C.PLAYER_BODY, ride: C.PLAYER_RIDE,
    });
    C.ROSTER.forEach((s, i) => {
      const g = grid(i);
      const d = this.div;
      const nem = i + 1 === this.nemesis;
      this.addRider({
        name: s.name, isPlayer: false, x: g.x, z: g.z, top: s.top + d.top + (nem ? C.NEMESIS.top : 0), steer: 7, hp: C.RIVAL_HP + d.hp + (nem ? C.NEMESIS.hp : 0),
        aggr: Math.min(1, s.aggr + d.mind + (nem ? C.NEMESIS.aggr : 0)), aware: Math.min(1, s.aware + d.mind), body: s.body, ride: s.ride, weapon: s.weapon,
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
    for (let z = 70; z < 70 + C.TRAFFIC.ahead; z += 25 + this.traffic.float() * 20) this.spawnCar(z);
    for (const f of C.PICKUP_AT) {
      let x: number = C.LANE_X[1 + this.traffic.int(3)];
      let z = this.length * f;
      // not behind the cones, nor right in front of a ramp
      if (this.road.worksHi(z) < x + 0.5) x = C.LANE_X[2];
      for (const r of this.road.ramps) if (!r.trail && Math.abs(r.x - x) < 1 && Math.abs(r.z - z) < 15) z = r.z - 20;
      this.pickups.push({ id: this.nextId++, x, z, kind: this.traffic.float() < 0.5 ? 'pan' : 'bat' });
    }
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
      state: 'ride', downT: 0, runT: 0, bikeX: o.x, bikeZ: o.z, bikePX: o.x, bikePZ: o.z, bikeV: 0, bikeVx: 0, invT: 0, atkT: 0, atkSide: 1, atkCd: 0, hitT: 0, weapon: o.weapon ?? null,
      finished: false, place: 0, aggr: o.aggr, aware: o.aware, body: o.body, ride: o.ride, koPlayer: 0, koByPlayer: 0, rubT: 0, rubSide: 1,
      thug: false, huntT: 0, gang: 'lurk', gangT: 0, role: 'strike', pace: 0,
      react: 10, latV: 0, latAcc: 16, intent: 'race', intentT: 0, lane: nearestLane(o.x), escX: o.x, escT: 0,
      foe: -1, foeSide: 1, foeOff: 1.6, wob: 0, wobTo: 0, hitBy: -1, hx: [], hz: [], hv: [],
      stagT: 0, shoveT: 0, openT: 0, aim: -1, aimX: 0, aimZ: 0, aimVx: 0, aimV: 0,
      lo: -C.EDGE, hi: C.EDGE, airT: 0, airMax: 0, cutId: -1, cutTake: false,
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
    this.contacts();
    this.updateTraffic();
    for (const r of this.riders) this.resolveAttack(r);
    this.updatePickups();
    this.updatePatrol();
    this.leaderThreats();
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
    p.braking = inp.brake;
    if (inp.attack) this.tryAttack(p);
    inp.attack = false;
    if (inp.remount && p.state === 'down') {
      // straight back onto the scooter, with a moment's grace
      p.bikeX = this.road.clampX(p.bikeX, p.bikeZ);
      this.recover(p);
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
    if (r.state === 'down') {
      const D = C.DOWN;
      // the scooter slides on by itself
      r.bikeV = Math.max(0, r.bikeV - D.bike * C.DT);
      r.bikeZ += r.bikeV * C.DT;
      r.bikeVx *= 0.88;
      r.bikeX = this.road.clampX(r.bikeX + r.bikeVx * C.DT, r.bikeZ);
      if (r.runT === 0) {
        // tumbling to a stop, then a moment on the ground
        r.speed = Math.max(0, r.speed - D.body * C.DT);
        r.z += r.speed * C.DT;
        r.vx *= 0.85;
        r.x = this.road.clampX(r.x + r.vx * C.DT, r.z);
        if (r.downT > 0) r.downT--;
        if (r.downT === 0 && r.speed < 2) {
          if (r.thug) return this.recover(r); // thugs limp off instead
          r.runT = 1;
          r.speed = 0;
        }
        return;
      }
      // up and running back to the scooter
      const dx = r.bikeX - r.x;
      const dz = r.bikeZ - r.z;
      if (dx * dx + dz * dz < D.reach * D.reach || r.runT > D.maxRun * C.TICK_HZ) return this.recover(r);
      // along the road at running pace, across at a bit less (no square roots in the sim)
      const s = D.run * Math.min(1, r.runT / (D.runUp * C.TICK_HZ)) * C.DT;
      const sz = clamp(dz, -s, s);
      r.z += sz;
      r.x += clamp(dx, -s * 0.7, s * 0.7);
      r.speed = Math.max(0, sz / C.DT);
      r.runT++;
      return;
    }
    const R = this.road;
    if (r.airT > 0 && --r.airT === 0) this.land(r);
    const air = r.airT > 0;
    // out on a trail: a bumpier ride, but it cuts the corner
    const trail = R.trailAt(r.x, r.z) !== 0;
    if (!air) {
      const target = r.braking || (r.finished && r.isPlayer) ? 0 : this.topNow(r) * (trail ? C.CUT.top : 1);
      if (r.speed < target) r.speed = Math.min(target, r.speed + r.accel * C.DT);
      else r.speed = Math.max(target, r.speed - (r.braking ? C.BRAKE : C.COAST) * C.DT);
      // a blow carries the rider sideways for a moment before they can steer against it
      if (r.isPlayer) {
        const step = r.steer * C.DT;
        if (r.stagT === 0) r.x += clamp(r.wantX - r.x, -step, step);
      } else {
        // an AI rider has to build up and kill its sideways speed instead of snapping onto its line
        const v = clamp((r.wantX - r.x) * 2.6, -r.steer, r.steer);
        const dv = r.latAcc * C.DT;
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
    r.vx *= r.stagT > 0 ? C.SHOVE.carry : 0.82;
    r.z += r.speed * C.DT * (trail ? C.CUT.gain : 1);
    if (cones) return this.crash(r, 'cones', -3);
    if (slam) return this.crash(r, 'wall', r.x > 0 ? -3 : 3);
    if (air) return;
    // the end post of a trail's opening, for one caught halfway across
    if (r.speed > C.WORKS.crashSpeed && R.postHit(r.x, r.pz, r.z)) return this.crash(r, 'wall', r.x > 0 ? -3 : 3);
    const ramp = R.rampHit(r.x, r.pz, r.z);
    if (ramp && r.speed > C.RAMP.minSpeed) {
      r.airT = r.airMax = Math.max(2, Math.round(r.speed * C.RAMP.air * C.TICK_HZ));
      r.atkT = 0;
      this.events.push({ type: 'jump', rider: r.id });
    }
  }

  /** Down off a ramp: a little faster, and anyone landed on is knocked off. */
  private land(r: Rider): void {
    r.speed = Math.min(r.speed * C.RAMP.boost, r.top * 1.15);
    let stomp = -1;
    for (const o of this.riders) {
      if (o === r || o.state !== 'ride' || o.airT > 0 || o.invT > 0) continue;
      if (Math.abs(o.x - r.x) < C.RAMP.stompX && Math.abs(o.z - r.z) < C.RAMP.stompZ) {
        stomp = o.id;
        r.atkSide = o.x >= r.x ? 1 : -1;
        o.hitBy = r.id;
        this.knockOff(o, r);
        break;
      }
    }
    this.events.push({ type: 'land', rider: r.id, stomp });
  }

  /** The player rides flat out; an AI rider goes at the pace its AI picked this tick (src/sim/ai.ts). */
  private topNow(r: Rider): number {
    return r.isPlayer ? r.top : r.pace;
  }

  private recover(r: Rider): void {
    if (r.thug) {
      // Knocked-off thugs limp away instead of rejoining.
      r.state = 'away';
      r.weapon = null;
      this.events.push({ type: 'recover', rider: r.id });
      return;
    }
    // back on the scooter, where it came to rest
    r.x = r.px = r.bikeX;
    r.z = r.pz = r.bikeZ;
    r.runT = 0;
    r.state = 'ride';
    r.hp = r.maxHp;
    r.invT = C.INVULN_TICKS;
    r.speed = Math.max(r.speed, r.top * C.RECOVER_SPEED);
    r.wantX = r.x;
    r.latV = 0;
    this.events.push({ type: 'recover', rider: r.id });
  }

  /**
   * Riders are solid side to side. After everyone has moved, each pair alongside is set back to the
   * side gap they need, the correction split evenly (a barrier hands its share to the other rider).
   * Two riders pressing equally hold still; one pressing alone shoves both over at half its steering
   * rate. The needed gap fades smoothly with the distance along the road (riders are rounded, not
   * boxes), so riding up from behind eases you aside instead of toggling a hard wall on and off.
   * Nothing is ever kicked back, so nothing jitters.
   */
  private contacts(): void {
    const rs = this.riders;
    const { width, full, clear } = C.CONTACT;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < rs.length; i++) {
        const a = rs[i];
        if (a.state !== 'ride' || a.airT > 0) continue;
        for (let j = i + 1; j < rs.length; j++) {
          const b = rs[j];
          const dz = Math.abs(b.z - a.z);
          if (b.state !== 'ride' || b.airT > 0 || dz >= clear) continue;
          const t = dz <= full ? 0 : (dz - full) / (clear - full);
          const need = width * (1 - t * t * (3 - 2 * t));
          // Which side b is on comes from where they were before this tick, so it can't flip mid-press.
          const oldDx = b.px - a.px;
          const s: Side = oldDx > 0 || (oldDx === 0 && b.x >= a.x) ? 1 : -1;
          const pen = need - (b.x - a.x) * s;
          if (pen <= 1e-4) continue;
          const na = clamp(a.x - s * pen * 0.5, a.lo, a.hi);
          const movedA = (a.x - na) * s;
          const nb = clamp(b.x + s * (pen - movedA), b.lo, b.hi);
          const movedB = (nb - b.x) * s;
          a.x = clamp(na - s * (pen - movedA - movedB), a.lo, a.hi);
          b.x = nb;
          if (pass > 0 || dz > full) continue;
          // squeeze feedback: lean in, grind, lose a little speed; pinned on the barrier loses more
          a.rubT = b.rubT = C.CONTACT.rubTicks;
          a.rubSide = s;
          b.rubSide = -s as Side;
          a.speed *= C.CONTACT.friction;
          b.speed *= C.CONTACT.friction;
          if (movedA < pen * 0.5 - 1e-4) a.speed *= 0.99;
          if (movedB < pen * 0.5 - 1e-4) b.speed *= 0.99;
          if ((this.tick + i + j) % C.CONTACT.rubEvery === 0) {
            this.events.push({ type: 'rub', x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, side: s, player: a.isPlayer || b.isPlayer });
          }
        }
      }
    }
  }

  // --- combat ---

  /** The rider `r` could hit right now on either side, nearest first. */
  targetFor(r: Rider, tol = 0): Rider | null {
    const reach = C.ATTACK.reachX + (r.weapon ? C.WEAPON[r.weapon].reach : 0) + tol;
    let best: Rider | null = null;
    let bestD = Infinity;
    for (const o of this.riders) {
      if (o === r || o.state !== 'ride' || o.airT > 0) continue;
      const dx = Math.abs(o.x - r.x);
      const dz = Math.abs(o.z - r.z);
      if (dz > C.ATTACK.reachZ + tol || dx > reach || dx < C.ATTACK.minX) continue;
      if (this.road.apart(r.x, r.z, o.x, o.z)) continue;
      const d = dx + dz;
      if (d < bestD) { bestD = d; best = o; }
    }
    return best;
  }

  tryAttack(r: Rider): boolean {
    if (r.state !== 'ride' || r.airT > 0 || r.atkT > 0 || r.atkCd > 0) return false;
    const t = this.targetFor(r, 0.3);
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
    this.events.push({ type: 'swing', rider: r.id, side: r.atkSide, aim: r.aim, windup: r.atkT });
    return true;
  }

  private resolveAttack(r: Rider): void {
    if (r.atkT <= 0) return;
    if (--r.atkT > 0 || r.state !== 'ride' || r.airT > 0) return;
    const A = C.ATTACK;
    if (!r.isPlayer) r.speed *= A.selfSlow;
    const reach = A.reachX + (r.weapon ? C.WEAPON[r.weapon].reach : 0) + 0.4;
    // an AI rider swings at where its target was heading when it wound up: off that line by now, it misses them
    let dodged: Rider | null = null;
    if (!r.isPlayer && r.aim >= 0) {
      const t = this.riders[r.aim];
      const k = A.windupAI * C.DT;
      if (Math.abs(t.x - (r.aimX + r.aimVx * k)) > A.dodgeX || Math.abs(t.z - (r.aimZ + r.aimV * k)) > A.dodgeZ) dodged = t;
    }
    let victim: Rider | null = null;
    let bestD = Infinity;
    for (const o of this.riders) {
      if (o === r || o === dodged || o.state !== 'ride' || o.invT > 0 || o.airT > 0) continue;
      if (this.road.apart(r.x, r.z, o.x, o.z)) continue;
      const dx = (o.x - r.x) * r.atkSide;
      const dz = Math.abs(o.z - r.z);
      if (dx < A.minX - 0.2 || dx > reach || dz > A.reachZ + 0.4) continue;
      if (dx + dz < bestD) { bestD = dx + dz; victim = o; }
    }
    if (!victim) {
      // swung at the player and missed: overbalanced and wide open for a moment
      if (!r.isPlayer && r.aim === this.player.id) {
        r.openT = A.open;
        r.speed *= 0.94;
        this.events.push({ type: 'whiff', rider: r.id, dodged: dodged !== null });
      }
      return;
    }
    const counter = r.isPlayer && victim.openT > 0;
    const dmg = (r.weapon ? C.WEAPON[r.weapon].dmg : 1) + (counter ? A.counterDmg : 0);
    victim.hp -= dmg;
    victim.vx += r.atkSide * (A.push + (r.weapon ? C.WEAPON[r.weapon].push : 0));
    victim.latV = 0;
    victim.stagT = victim.isPlayer ? A.stagger.player : A.stagger.ai;
    victim.shoveT = C.SHOVE.ticks;
    victim.openT = 0;
    victim.speed *= A.slow;
    victim.hitT = 6;
    victim.hitBy = r.id;
    const ko = victim.hp <= 0;
    this.events.push({ type: 'hit', from: r.id, to: victim.id, side: r.atkSide, dmg, ko, counter });
    if (r.isPlayer && this.patrolSees()) this.addHeat(ko ? C.HEAT.hit + C.HEAT.down : C.HEAT.hit);
    if (ko) return this.knockOff(victim, r);
    // the blow can knock their weapon loose: an empty hand takes it, an armed one knocks it to the road
    if (victim.weapon && this.combatRng.float() < (counter ? 1 : r.isPlayer ? C.STEAL.player : C.STEAL.ai)) {
      const kind = victim.weapon;
      victim.weapon = null;
      const took = r.weapon === null && !r.thug;
      if (took) r.weapon = kind;
      else this.pickups.push({ id: this.nextId++, x: this.road.clampX(victim.x + r.atkSide * 1.2, victim.z + 6), z: victim.z + 6, kind });
      this.events.push({ type: 'steal', from: r.id, to: victim.id, kind, took });
    }
  }

  /** A security buggy is close enough to see what the player is up to. */
  private patrolSees(): boolean {
    return this.patrol.active && Math.abs(this.patrol.z - this.player.z) < C.HEAT.near;
  }

  private addHeat(v: number): void {
    this.heat = clamp(this.heat + v, 0, C.HEAT.max);
  }

  /** Whoever put `v` down gets the credit: the player's settle grudges, a rival's on the player starts one. */
  private credit(v: Rider, by: Rider): void {
    if (by.isPlayer && this.grudges.has(v.id)) { this.grudgeKos++; this.grudges.delete(v.id); }
    if (by.isPlayer) {
      v.koByPlayer++;
      if (v.id === this.nemesis) this.revenge++;
    }
    if (v.isPlayer && !by.isPlayer && !by.thug) {
      by.koPlayer++;
      if (by.koPlayer >= C.GRUDGE_AT && !this.grudges.has(by.id) && by.id !== this.nemesis) {
        this.grudges.add(by.id);
        this.events.push({ type: 'grudge', rider: by.id });
      }
    }
  }

  private knockOff(v: Rider, by: Rider): void {
    if (by.isPlayer) this.kos++;
    this.credit(v, by);
    this.crash(v, 'ko', by.atkSide * 6);
  }

  crash(r: Rider, c: CrashCause, vx: number): void {
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
      this.crashes++;
      this.threatCd = Math.max(this.threatCd, Math.round(C.LEADER.mercy * C.TICK_HZ));
    }
    this.events.push({ type: 'crash', rider: r.id, cause: c, vx, speed: r.speed });
    // knocked into a car or the barrier just after a blow: that one counts for whoever struck
    if (c !== 'ko' && r.shoveT > 0 && r.hitBy >= 0) {
      const by = this.riders[r.hitBy];
      if (by.isPlayer) {
        this.shoves++;
        if (this.patrolSees()) this.addHeat(C.HEAT.down);
      }
      this.credit(r, by);
      this.events.push({ type: 'shove', from: by.id, to: r.id, into: c });
    }
    r.shoveT = r.stagT = r.openT = 0;
    if (r.weapon) {
      const p: Pickup = { id: this.nextId++, x: this.road.clampX(r.x + Math.sign(vx || 1) * 1.2, r.z + 6), z: r.z + 6, kind: r.weapon };
      this.pickups.push(p);
      r.weapon = null;
    }
  }

  // --- traffic ---

  private spawnCar(z: number): void {
    const lane = this.traffic.int(4);
    const x = C.LANE_X[lane];
    for (const c of this.cars) if (c.lane === lane && Math.abs(c.z - z) < C.TRAFFIC.gap) return;
    // not in a coned-off lane or on a ramp
    if (this.road.blockAhead(lane, z - C.CAR.halfL - 3, 2 * C.CAR.halfL + 6) < Infinity) return;
    // nor on top of (or right on the tail of) the security buggy
    const pt = this.patrol;
    if (pt.active && Math.abs(pt.x - x) < C.CAR.halfW + C.PATROL.halfW + 0.5 && Math.abs(pt.z - z) < C.TRAFFIC.gap) return;
    const oncoming = lane === C.ONCOMING_LANE;
    const speed = oncoming ? C.CAR.oncoming : C.CAR.minSpeed + this.traffic.float() * (C.CAR.maxSpeed - C.CAR.minSpeed);
    this.cars.push({ id: this.nextId++, x, z, pz: z, speed, cruise: speed, lane, color: this.traffic.pick(CAR_COLORS) });
  }

  private updateTraffic(): void {
    const p = this.player;
    const progress = clamp(p.z / this.length, 0, 1);
    const want = this.trafficBase + Math.round(progress * this.trafficExtra);
    const R = this.road;
    for (const c of this.cars) {
      if (c.speed > 0 || c.cruise > 0) {
        let cap = c.cruise;
        // the lane closes ahead (cones, a ramp): merge over when there's room, else stop short of it
        const block = R.blockAhead(c.lane, c.z, C.WORKS.carMerge);
        if (block < Infinity) {
          const opts = c.lane === 3 ? [2] : c.lane === 2 ? [1, 3] : [2];
          const to = opts.find((l) => R.blockAhead(l, c.z - 10, C.WORKS.carMerge + 20) === Infinity &&
            this.cars.every((o) => o === c || o.lane !== l || Math.abs(o.z - c.z) > C.TRAFFIC.gap));
          if (to !== undefined) c.lane = to;
          else cap = Math.min(cap, Math.max(0, (block - 8 - c.z) * 0.8));
        }
        // Same-direction cars brake behind slower cars in their lane instead of driving through them.
        for (const o of this.cars) {
          if (o !== c && o.lane === c.lane && o.z > c.z && o.z - c.z < 9 && o.speed < cap) cap = Math.max(0, o.speed);
        }
        // ...and behind the security buggy when it is in their lane
        const pt = this.patrol;
        if (pt.active && Math.abs(pt.x - c.x) < C.CAR.halfW + C.PATROL.halfW + 0.15 &&
          pt.z > c.z && pt.z - c.z < 10 && pt.speed < cap) cap = pt.speed;
        c.speed = c.speed < cap ? Math.min(cap, c.speed + 3 * C.DT) : cap;
        c.x += clamp(C.LANE_X[c.lane] - c.x, -3 * C.DT, 3 * C.DT);
      }
      c.z += c.speed * C.DT;
    }
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const c = this.cars[i];
      if (c.z < p.z - C.TRAFFIC.behind || c.z > p.z + C.TRAFFIC.ahead + 120) this.cars.splice(i, 1);
    }
    if (this.cars.length < want && this.tick % 4 === 0 && p.z < this.length - 60) {
      this.spawnCar(p.z + C.TRAFFIC.spawnFrom + this.traffic.float() * 90);
    }
    for (const r of this.riders) {
      if (r.state !== 'ride' || r.invT > 0 || r.airT > 0) continue;
      for (const c of this.cars) {
        if (Math.abs(r.x - c.x) < C.CAR.halfW + C.CAR.riderHalfW && Math.abs(r.z - c.z) < C.CAR.halfL + 0.4) {
          const side = r.x >= c.x ? 1 : -1;
          r.speed = Math.max(0, Math.min(r.speed, Math.abs(r.speed - c.speed) * 0.6 + 4));
          this.crash(r, 'car', side * 4);
          break;
        }
      }
    }
  }

  /** Free distance ahead of `r` along lateral position x. */
  clearance(r: Rider, x: number): number {
    return laneClearance(this, r, x);
  }

  // --- pickups ---

  private updatePickups(): void {
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const k = this.pickups[i];
      for (const r of this.riders) {
        if (r.state !== 'ride' || r.finished || r.thug) continue;
        if (Math.abs(r.x - k.x) < 1.2 && Math.abs(r.z - k.z) < 1.6) {
          r.weapon = k.kind;
          this.pickups.splice(i, 1);
          this.events.push({ type: 'pickup', rider: r.id, kind: k.kind });
          this.events.push({ type: 'drop', pickup: k.id });
          break;
        }
      }
    }
  }

  // --- the test-site security buggy ---

  private updatePatrol(): void {
    const pt = this.patrol;
    const p = this.player;
    const P = C.PATROL;
    const riding = p.state === 'ride';
    this.heat = Math.max(0, this.heat - C.HEAT.decay * C.DT);
    const units = this.patrolCount + Math.floor(this.heat) * C.HEAT.units;
    if (!pt.active) {
      if (pt.wait > 0) pt.wait--;
      else if (riding && !p.finished && pt.units < units && p.z > this.patrolFrom && p.z < this.length - P.stopBefore) this.sendPatrol();
      return;
    }
    pt.t++;
    const gap = p.z - pt.z;
    // the driver goes by what it saw a moment ago, not by where the player is this very tick
    const s = this.seen(p, pt.react);
    const sGap = s.z - pt.z;
    // a lane's width to one side of the player, on a side with room
    const roadHi = this.road.worksHi(pt.z) - (P.halfW - P.riderHalfW);
    const beside = (side: Side): number => {
      const off = P.halfW + P.riderHalfW + 1.2;
      const x = s.x + side * off;
      return x <= roadHi && x >= -C.EDGE ? x : clamp(s.x - side * off, -C.EDGE, roadHi);
    };
    const leave = () => {
      // it had them and they never pulled over: word gets round
      if ((pt.mode === 'squeeze' || pt.mode === 'block') && pt.hold > C.TICK_HZ / 2 && riding && !p.finished) this.addHeat(C.HEAT.flee);
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
    if (pt.mode !== 'leave' && this.road.trailAt(p.x, p.z) !== 0) leave();
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
        if (gap > P.outrun) return this.patrolGone(); // too quick for it: it never catches up
        if (pt.t > P.giveUp * C.TICK_HZ || p.finished) leave();
        else if (riding && gap < P.warnAt) {
          pt.mode = 'squeeze';
          pt.t = pt.hold = 0;
          this.events.push({ type: 'patrolWarn' });
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
          this.events.push({ type: 'patrolWarn' });
        } else if (gap > P.halfL + 2) leave(); // got past it while down
        else if (pt.t > P.giveUp * C.TICK_HZ) {
          if (-gap > 60) return this.patrolGone(); // never came: it turns off far up the road
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
        const at = this.seen(p, pt.react, 0).x;
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
        const f = touching ? this.seen(p, P.feel) : s;
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
          want = this.heat < C.HEAT.rough && this.carOnShoulder(pt.push)
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
          const fine = P.fine + Math.floor(this.heat) * P.fineStar;
          this.fines += fine;
          this.addHeat(-C.HEAT.comply);
          this.events.push({ type: 'patrolLetGo', fine });
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
        if (gap > P.goneAt || -gap > P.goneAhead) return this.patrolGone();
        // wedged in traffic right by the player for a while: it pulls off the road rather than hold them up
        if (pt.t > P.stuckSec * C.TICK_HZ && Math.abs(gap) < 8 && riding && pt.speed > p.speed - 3 && Math.abs(pt.x - p.x) < P.halfW + P.riderHalfW + 0.3) { this.patrolStuck++; return this.patrolGone(); }
        break;
    }
    speed = Math.max(0, pt.mode === 'leave' ? speed : Math.min(speed, pt.top));
    pt.speed = speed > pt.speed ? Math.min(speed, pt.speed + P.accel * C.DT) : Math.max(speed, pt.speed - P.brake * C.DT);
    this.patrolTraffic(want, steer);
    pt.z += pt.speed * C.DT;
    this.patrolContacts();
  }

  /**
   * Is there a car the player would be shoved into: on their `push` side (alongside or within
   * C.PATROL.carWarn seconds ahead, oncoming ones included)?
   */
  private carOnShoulder(push: Side): boolean {
    const p = this.player;
    for (const c of this.cars) {
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
  private patrolGone(): void {
    const P = C.PATROL;
    this.patrol.active = false;
    const prog = clamp(this.player.z / this.length, 0, 1);
    const sec = this.patrolRng.float() < P.pairChance
      ? this.roll(P.pairGap)
      : (P.gapEarly + (P.gapLate - P.gapEarly) * prog) * this.patrolRate * this.roll(P.gapJitter);
    this.patrol.wait = Math.round(sec / (1 + C.HEAT.gap * this.heat) * C.TICK_HZ);
  }

  private roll(r: readonly [number, number]): number {
    return r[0] + (r[1] - r[0]) * this.patrolRng.float();
  }

  /** A fresh buggy with its own dice: from behind or waiting ahead, blocking or squeezing, never the same plan twice running. */
  private sendPatrol(): void {
    const pt = this.patrol;
    const p = this.player;
    const P = C.PATROL;
    const plans = (['behind squeeze', 'ahead block', 'ahead squeeze'] as const)
      .filter((k) => pt.units === 0 || k !== `${pt.from} ${pt.move}`);
    const [from, move] = this.patrolRng.pick(plans).split(' ') as [Patrol['from'], Patrol['move']];
    let side: Side = this.patrolRng.float() < 0.5 ? -1 : 1;
    // never turns up in the oncoming lane: it comes from behind in the player's direction of travel
    let x = Math.max(p.x, C.LANE_X[1]);
    let z = p.z - this.roll(P.spawnBack);
    // no car near the spot it turns up on
    const clear = (cx: number, cz: number) =>
      this.cars.every((c) => Math.abs(c.x - cx) > C.CAR.halfW + P.halfW || Math.abs(c.z - cz) > C.CAR.halfL + P.halfL + 6);
    if (from === 'behind') {
      const cx = [x, C.LANE_X[1], C.LANE_X[2], C.LANE_X[3]].find((cx) => clear(cx, z));
      if (cx === undefined) { pt.wait = C.TICK_HZ; return; }
      x = cx;
    } else {
      // a same-direction side lane (lane 0 is oncoming)
      const z0 = p.z + this.roll(P.spawnAhead);
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
    const pace = this.roll(P.lurkPace);
    Object.assign(pt, {
      active: true, mode: from === 'ahead' ? 'lurk' : 'chase', t: 0, side, push: -side as Side, hold: 0, x, z,
      speed: from === 'ahead' ? p.top * pace : p.speed,
      from, move, pace, press: Math.round(this.roll(P.pressSec) * (1 + C.HEAT.press * this.heat) * C.TICK_HZ),
      blockAhead: this.roll(P.blockAhead), pullOutAt: this.roll(P.pullOutAt),
      react: Math.max(3, Math.round(this.roll(P.react) - Math.floor(this.heat) * C.HEAT.react)), top: this.roll(P.top) + this.div.top,
      vx: 0, laneX: x, laneT: 0, slowT: 0, haltT: 0, resume: move,
    });
    pt.px = pt.x;
    pt.pz = pt.z;
    this.patrolContacts(); // don't appear inside someone
  }

  /**
   * The buggy is solid but never rams: a rider beside it is pushed aside (pinned on the barrier if
   * there's no room) and grinds speed off; one behind it is held on its bumper; one in front makes it
   * brake. Which face they meet on comes from last tick's positions, so it can't flip mid-contact.
   */
  private patrolContacts(): void {
    const pt = this.patrol;
    if (!pt.active) return;
    const P = C.PATROL;
    const wide = P.halfW + P.riderHalfW;
    const long = P.halfL + 0.6;
    const carW = C.CAR.halfW + P.halfW;
    const carL = C.CAR.halfL + P.halfL;
    const hitsCar = (x: number) => this.cars.some((c) => Math.abs(c.x - x) < carW && Math.abs(c.z - pt.z) < carL);
    // two passes, so a push from one rider can't leave the buggy inside another
    for (let pass = 0; pass < 2; pass++) {
      for (const r of this.riders) {
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
            if ((this.tick + r.id) % C.CONTACT.rubEvery === 0) {
              this.events.push({ type: 'rub', x: r.x - s * P.riderHalfW, z: r.z, side: -s as Side, player: r.isPlayer });
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
  private patrolTraffic(want: number, steerRate: number): void {
    const pt = this.patrol;
    const P = C.PATROL;
    const wide = C.CAR.halfW + P.halfW + 0.15;
    const long = C.CAR.halfL + P.halfL + 0.8; // margin covers the buggy's own move after traffic has moved this tick
    // seconds until the buggy reaches a car along lateral position x (0: one is already beside it)
    const clear = (x: number): number => {
      let best = Infinity;
      for (const c of this.cars) {
        if (Math.abs(c.x - x) > wide) continue;
        const dist = c.z - pt.z - long;
        if (dist < -2 * long) continue;
        const closing = pt.speed - c.speed;
        const t = dist <= 0 ? 0 : closing <= 0.1 ? Infinity : dist / closing;
        if (t < best) best = t;
      }
      const cones = this.road.conesAhead(x, P.halfW, pt.z + P.halfL);
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
    const nx = clamp(pt.x + pt.vx * C.DT, -C.EDGE, this.road.worksHi(pt.z) - (P.halfW - P.riderHalfW));
    // judged where the buggy will be after this tick's move, so it can't slip in beside a slower car's tail
    // (moving away from a car it is already alongside is always allowed)
    const blocked = (c: Car) => Math.abs(c.x - nx) < wide && Math.abs(c.x - nx) <= Math.abs(c.x - pt.x) &&
      (Math.abs(c.z - pt.z) < long || Math.abs(c.z - pt.z - Math.max(0, pt.speed - c.speed) * C.DT) < long);
    if (!this.cars.some(blocked)) pt.x = nx;
    else pt.vx = 0;
    // still boxed in: hang back behind the car ahead (an oncoming one is dodged above)
    let cap = Infinity;
    for (const c of this.cars) {
      if (Math.abs(c.x - pt.x) >= wide || c.speed <= 0) continue;
      const dist = c.z - pt.z - long;
      if (dist < -long) continue;
      cap = Math.min(cap, Math.max(0, c.speed + dist * 1.5)); // too close already: drop back
    }
    pt.speed = Math.min(pt.speed, cap);
    // and keep ahead of a car coming up right behind it, unless that would run it into the one in front
    // (the car behind brakes for the buggy then)
    for (const c of this.cars) {
      if (Math.abs(c.x - pt.x) >= wide || c.speed <= 0) continue;
      const dist = pt.z - c.z - long;
      if (dist < 0.5 && dist > -long) pt.speed = Math.max(pt.speed, Math.min(cap, c.speed + 0.5));
    }
  }

  // --- threats for the leader ---

  private leaderThreats(): void {
    const p = this.player;
    const prog = clamp(p.z / this.length, 0, 1);
    // thugs left far behind drop out
    for (const r of this.riders) {
      if (r.thug && r.state === 'ride' && (r.z < p.z - C.GANG.goneAt || p.finished)) r.state = 'away';
    }
    const leading = p.state === 'ride' && !p.finished && prog > C.LEADER.startAt && this.standing === 1;
    if (!leading) {
      this.threatCd = Math.max(this.threatCd, Math.round(C.LEADER.firstDelay * C.TICK_HZ));
      return;
    }
    // one threat at a time; the calm is counted from when the last one ends
    if (this.riders.some((r) => r.huntT > 0 || (r.thug && r.state !== 'away'))) return;
    if (--this.threatCd > 0) return;
    const first = this.nextThreat;
    const second = first === 'hunt' ? 'ambush' : 'hunt';
    const start = (k: 'hunt' | 'ambush') => (k === 'hunt' ? this.startHunt() : this.startAmbush(prog));
    const done = start(first) ? first : start(second) ? second : null;
    if (!done) {
      this.threatCd = C.TICK_HZ; // nobody available; look again in a second
      return;
    }
    this.nextThreat = done === 'hunt' ? 'ambush' : 'hunt';
    const gap = C.LEADER.gapEarly + (C.LEADER.gapLate - C.LEADER.gapEarly) * prog;
    this.threatCd = Math.round(gap * (0.8 + 0.4 * this.aiRng.float()) * C.TICK_HZ);
  }

  /** The keenest rival not too far behind (grudges first) comes for the leader at full tilt. */
  private startHunt(): boolean {
    const p = this.player;
    let best: Rider | null = null;
    let bestS = -Infinity;
    for (const r of this.riders) {
      if (r.isPlayer || r.thug || r.state !== 'ride' || r.finished) continue;
      const gap = p.z - r.z;
      if (gap < 8 || gap > C.HUNT.range) continue;
      const s = (this.hates(r.id) ? 2 : 0) + r.aggr + this.aiRng.float() * 0.6;
      if (s > bestS) { bestS = s; best = r; }
    }
    if (!best) return false;
    best.huntT = Math.round((C.HUNT.chase + C.HUNT.attack) * C.TICK_HZ);
    this.events.push({ type: 'hunt', rider: best.id });
    return true;
  }

  /** Thugs wait on the shoulder ahead and pull out as the leader arrives. */
  private startAmbush(prog: number): boolean {
    const p = this.player;
    const G = C.GANG;
    if (p.z + G.spawnAhead > this.length - 60) return false;
    const free = this.riders.filter((r) => r.thug && r.state === 'away');
    const n = Math.min(free.length, prog >= G.pairFrom ? 2 : 1);
    if (n === 0) return false;
    const first: Side = this.aiRng.float() < 0.5 ? 1 : -1;
    // a pair works together: from both sides at once, or the far one cuts in front while the near one strikes
    const pincer = n === 1 || this.aiRng.float() < G.pincerChance;
    const ids: number[] = [];
    for (let k = 0; k < n; k++) {
      const r = free[k];
      const side: Side = k === 0 ? first : (-first as Side);
      r.state = 'ride';
      r.z = r.pz = p.z + G.spawnAhead + k * 7;
      r.x = r.px = r.wantX = side > 0 ? this.road.worksHi(r.z) : -C.EDGE;
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
      r.foeOff = C.AI.sideOff[0] + (C.AI.sideOff[1] - C.AI.sideOff[0]) * this.aiRng.float() + C.WEAPON[r.weapon].reach * 0.6;
      r.wob = r.wobTo = 0;
      r.lane = nearestLane(r.x);
      r.hitBy = -1;
      this.resetMemory(r);
      ids.push(r.id);
    }
    this.events.push({ type: 'ambush', riders: ids });
    return true;
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

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

