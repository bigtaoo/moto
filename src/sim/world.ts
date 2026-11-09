// The race simulation: fixed 30 Hz steps, no DOM, no Three.js, so the headless bot can run it.
// The road is straight here; the view bends and lifts it (src/view/track.ts).

import { Prng } from './rng';
import * as C from './config';
import { rivalThink, laneClearance } from './ai';

export type Side = -1 | 1;
export type CrashCause = 'ko' | 'car';

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
  stalkT: number;
  body: number;
  ride: number;
  /** Times this rival knocked the player off. */
  koPlayer: number;
  /** Ticks left of shoulder-to-shoulder pressing, and which side the other rider is on. */
  rubT: number;
  rubSide: Side;
  /** Not in the race: one of the shoulder thugs. */
  thug: boolean;
  /** Ticks left of hunting the leader (rivals). */
  huntT: number;
  /** Thug plan and ticks spent in it. */
  gang: 'lurk' | 'attack' | 'leave';
  gangT: number;
  /** Thugs' target speed, set by their AI. */
  pace: number;
}

export interface Car {
  id: number;
  x: number;
  z: number;
  pz: number;
  speed: number;
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
   * leave: pull off the player's line and drop out.
   */
  mode: 'chase' | 'lurk' | 'block' | 'squeeze' | 'leave';
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
  x: number;
  z: number;
  px: number;
  pz: number;
  speed: number;
}

export type SimEvent =
  | { type: 'swing'; rider: number; side: Side }
  | { type: 'hit'; from: number; to: number; side: Side; dmg: number; ko: boolean }
  | { type: 'crash'; rider: number; cause: CrashCause; vx: number; speed: number }
  | { type: 'recover'; rider: number }
  | { type: 'pickup'; rider: number; kind: C.WeaponKind }
  | { type: 'drop'; pickup: number }
  | { type: 'patrolWarn' }
  | { type: 'finish'; rider: number; place: number }
  | { type: 'grudge'; rider: number }
  | { type: 'rub'; x: number; z: number; side: Side; player: boolean }
  | { type: 'hunt'; rider: number }
  | { type: 'ambush'; riders: number[] }
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
}

export interface WorldOpts {
  seed: number;
  upgrades?: Upgrades;
  /** Rival ids that hold a grudge from earlier races. */
  grudges?: number[];
  length?: number;
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
  };
  /** Patrol dice: their own stream, so they don't shift traffic or AI. Busy-ness and first arrival are per race. */
  private readonly patrolRng: Prng;
  /** Leaving buggies that had to vanish because traffic wedged them in by the player (should be rare). */
  patrolStuck = 0;
  private readonly patrolCount: number;
  private readonly patrolRate: number;
  private readonly patrolFrom: number;
  readonly events: SimEvent[] = [];
  readonly grudges: Set<number>;
  readonly input: Input = { targetX: null, steer: 0, brake: false, attack: false };
  countdown = Math.round(C.COUNTDOWN_S * C.TICK_HZ);
  over = false;
  overT = -1;
  finished = 0;
  kos = 0;
  grudgeKos = 0;
  crashes = 0;
  private nextId = 1;
  private threatCd = Math.round(C.LEADER.firstDelay * C.TICK_HZ);
  private nextThreat: 'hunt' | 'ambush' = 'hunt';
  private readonly traffic: Prng;
  readonly aiRng: Prng;
  readonly seed: number;

  constructor(opts: WorldOpts) {
    this.seed = opts.seed;
    this.length = opts.length ?? C.RACE_LEN;
    this.traffic = new Prng(opts.seed * 7 + 1);
    this.aiRng = new Prng(opts.seed * 13 + 5);
    this.patrolRng = new Prng(opts.seed * 17 + 11);
    const [lo, hi] = C.PATROL.count;
    this.patrolCount = lo + this.patrolRng.int(hi - lo + 1);
    this.patrolRate = C.PATROL.busyGap[0] + (C.PATROL.busyGap[1] - C.PATROL.busyGap[0]) * (this.patrolCount - lo) / (hi - lo);
    const busy = (this.patrolCount - lo) / (hi - lo);
    const [s0, s1] = C.PATROL.startAt;
    this.patrolFrom = this.length * clamp(s1 - (s1 - s0) * busy + (this.patrolRng.float() - 0.5) * 0.1, s0, s1);
    this.grudges = new Set(opts.grudges ?? []);
    const up = opts.upgrades ?? { top: 0, steer: 0, hp: 0 };
    const grid = (i: number) => ({ x: C.LANE_X[1 + (i % 3)] + (i >= 3 ? -0.9 : 0.9), z: 14 - Math.floor(i / 3) * 6 });
    // Player starts at the back of the grid so the first fight comes within seconds.
    this.addRider({
      name: 'You', isPlayer: true, x: C.LANE_X[2], z: 2,
      top: C.PLAYER_BASE.top + up.top * C.UPGRADE_STEP.top,
      steer: C.PLAYER_BASE.steer + up.steer * C.UPGRADE_STEP.steer,
      hp: C.PLAYER_BASE.hp + up.hp * C.UPGRADE_STEP.hp,
      aggr: 0, aware: 1, body: C.PLAYER_BODY, ride: C.PLAYER_RIDE,
    });
    C.ROSTER.forEach((s, i) => {
      const g = grid(i);
      this.addRider({ name: s.name, isPlayer: false, x: g.x, z: g.z, top: s.top, steer: 7, hp: C.RIVAL_HP, aggr: s.aggr, aware: s.aware, body: s.body, ride: s.ride, weapon: s.weapon });
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
    for (let z = 70; z < 70 + C.TRAFFIC.ahead; z += 25 + this.traffic.float() * 20) this.spawnCar(z);
    for (const f of C.PICKUP_AT) {
      this.pickups.push({ id: this.nextId++, x: C.LANE_X[1 + this.traffic.int(3)], z: this.length * f, kind: this.traffic.float() < 0.5 ? 'pan' : 'bat' });
    }
  }

  get player(): Rider {
    return this.riders[0];
  }

  private addRider(o: { name: string; isPlayer: boolean; x: number; z: number; top: number; steer: number; hp: number; aggr: number; aware: number; body: number; ride: number; weapon?: C.WeaponKind }): void {
    this.riders.push({
      id: this.riders.length, name: o.name, isPlayer: o.isPlayer, x: o.x, z: o.z, px: o.x, pz: o.z, vx: 0, speed: 0,
      top: o.top, accel: C.PLAYER_BASE.accel, steer: o.steer, hp: o.hp, maxHp: o.hp, wantX: o.x, braking: false,
      state: 'ride', downT: 0, runT: 0, bikeX: o.x, bikeZ: o.z, bikePX: o.x, bikePZ: o.z, bikeV: 0, bikeVx: 0, invT: 0, atkT: 0, atkSide: 1, atkCd: 0, hitT: 0, weapon: o.weapon ?? null,
      finished: false, place: 0, aggr: o.aggr, aware: o.aware, stalkT: 0, body: o.body, ride: o.ride, koPlayer: 0, rubT: 0, rubSide: 1,
      thug: false, huntT: 0, gang: 'lurk', gangT: 0, pace: 0,
    });
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
    if (p.finished) return p.place;
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
  }

  private controlPlayer(): void {
    const p = this.player;
    const inp = this.input;
    if (inp.targetX !== null) p.wantX = clamp(inp.targetX, -C.EDGE, C.EDGE);
    else p.wantX = clamp(p.x + inp.steer * 3, -C.EDGE, C.EDGE);
    p.braking = inp.brake;
    if (inp.attack) this.tryAttack(p);
    inp.attack = false;
  }

  private move(r: Rider): void {
    if (r.invT > 0) r.invT--;
    if (r.hitT > 0) r.hitT--;
    if (r.atkCd > 0) r.atkCd--;
    if (r.rubT > 0) r.rubT--;
    if (r.state === 'away') return;
    if (r.state === 'down') {
      const D = C.DOWN;
      // the scooter slides on by itself
      r.bikeV = Math.max(0, r.bikeV - D.bike * C.DT);
      r.bikeZ += r.bikeV * C.DT;
      r.bikeVx *= 0.88;
      r.bikeX = clamp(r.bikeX + r.bikeVx * C.DT, -C.EDGE, C.EDGE);
      if (r.runT === 0) {
        // tumbling to a stop, then a moment on the ground
        r.speed = Math.max(0, r.speed - D.body * C.DT);
        r.z += r.speed * C.DT;
        r.vx *= 0.85;
        r.x = clamp(r.x + r.vx * C.DT, -C.EDGE, C.EDGE);
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
    const target = r.braking || (r.finished && r.isPlayer) ? 0 : this.topNow(r);
    if (r.speed < target) r.speed = Math.min(target, r.speed + r.accel * C.DT);
    else r.speed = Math.max(target, r.speed - (r.braking ? C.BRAKE : C.COAST) * C.DT);
    const step = r.steer * C.DT;
    r.x += clamp(r.wantX - r.x, -step, step) + r.vx * C.DT;
    r.vx *= 0.82;
    if (Math.abs(r.x) > C.EDGE) {
      r.x = Math.sign(r.x) * C.EDGE;
      r.vx = 0;
      r.speed *= 0.985; // scraping the barrier
    }
    r.z += r.speed * C.DT;
  }

  /** Rivals rubber-band around the player so fights keep happening; stalkers match the player's pace. */
  private topNow(r: Rider): number {
    if (r.isPlayer) return r.top;
    if (r.thug) return r.pace;
    const p = this.player;
    const gap = p.z - r.z;
    if (r.huntT > 0 && gap > 6 && p.state === 'ride') {
      return p.speed + clamp(C.HUNT.boostMin + gap * C.HUNT.boostPerM, C.HUNT.boostMin, C.HUNT.boostMax);
    }
    if (r.stalkT > 0 && Math.abs(gap) < 7 && p.state === 'ride') return clamp(p.speed + gap * 0.9, 0, r.top * 1.15);
    return r.top * (1 + clamp(gap / 120, -0.22, 0.16));
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
        if (a.state !== 'ride') continue;
        for (let j = i + 1; j < rs.length; j++) {
          const b = rs[j];
          const dz = Math.abs(b.z - a.z);
          if (b.state !== 'ride' || dz >= clear) continue;
          const t = dz <= full ? 0 : (dz - full) / (clear - full);
          const need = width * (1 - t * t * (3 - 2 * t));
          // Which side b is on comes from where they were before this tick, so it can't flip mid-press.
          const oldDx = b.px - a.px;
          const s: Side = oldDx > 0 || (oldDx === 0 && b.x >= a.x) ? 1 : -1;
          const pen = need - (b.x - a.x) * s;
          if (pen <= 1e-4) continue;
          const na = clamp(a.x - s * pen * 0.5, -C.EDGE, C.EDGE);
          const movedA = (a.x - na) * s;
          const nb = clamp(b.x + s * (pen - movedA), -C.EDGE, C.EDGE);
          const movedB = (nb - b.x) * s;
          a.x = clamp(na - s * (pen - movedA - movedB), -C.EDGE, C.EDGE);
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
      if (o === r || o.state !== 'ride') continue;
      const dx = Math.abs(o.x - r.x);
      const dz = Math.abs(o.z - r.z);
      if (dz > C.ATTACK.reachZ + tol || dx > reach || dx < C.ATTACK.minX) continue;
      const d = dx + dz;
      if (d < bestD) { bestD = d; best = o; }
    }
    return best;
  }

  tryAttack(r: Rider): boolean {
    if (r.state !== 'ride' || r.atkT > 0 || r.atkCd > 0) return false;
    const t = this.targetFor(r, 0.3);
    r.atkSide = t ? (t.x >= r.x ? 1 : -1) : r.atkSide === 1 ? -1 : 1;
    r.atkT = C.ATTACK.windup;
    r.atkCd = C.ATTACK.cooldown;
    r.speed *= C.ATTACK.selfSlow;
    this.events.push({ type: 'swing', rider: r.id, side: r.atkSide });
    return true;
  }

  private resolveAttack(r: Rider): void {
    if (r.atkT <= 0) return;
    if (--r.atkT > 0 || r.state !== 'ride') return;
    const reach = C.ATTACK.reachX + (r.weapon ? C.WEAPON[r.weapon].reach : 0) + 0.4;
    let victim: Rider | null = null;
    let bestD = Infinity;
    for (const o of this.riders) {
      if (o === r || o.state !== 'ride' || o.invT > 0) continue;
      const dx = (o.x - r.x) * r.atkSide;
      const dz = Math.abs(o.z - r.z);
      if (dx < C.ATTACK.minX - 0.2 || dx > reach || dz > C.ATTACK.reachZ + 0.4) continue;
      if (dx + dz < bestD) { bestD = dx + dz; victim = o; }
    }
    if (!victim) return;
    const dmg = r.weapon ? C.WEAPON[r.weapon].dmg : 1;
    victim.hp -= dmg;
    victim.vx += r.atkSide * C.ATTACK.push;
    victim.speed *= C.ATTACK.slow;
    victim.hitT = 6;
    const ko = victim.hp <= 0;
    this.events.push({ type: 'hit', from: r.id, to: victim.id, side: r.atkSide, dmg, ko });
    if (ko) this.knockOff(victim, r);
  }

  private knockOff(v: Rider, by: Rider): void {
    if (by.isPlayer) {
      this.kos++;
      if (this.grudges.has(v.id)) { this.grudgeKos++; this.grudges.delete(v.id); }
    }
    if (v.isPlayer && !by.isPlayer && !by.thug) {
      by.koPlayer++;
      if (by.koPlayer >= C.GRUDGE_AT && !this.grudges.has(by.id)) {
        this.grudges.add(by.id);
        this.events.push({ type: 'grudge', rider: by.id });
      }
    }
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
    if (r.isPlayer) {
      this.crashes++;
      this.threatCd = Math.max(this.threatCd, Math.round(C.LEADER.mercy * C.TICK_HZ));
    }
    this.events.push({ type: 'crash', rider: r.id, cause: c, vx, speed: r.speed });
    if (r.weapon) {
      const p: Pickup = { id: this.nextId++, x: clamp(r.x + Math.sign(vx || 1) * 1.2, -C.EDGE, C.EDGE), z: r.z + 6, kind: r.weapon };
      this.pickups.push(p);
      r.weapon = null;
    }
  }

  // --- traffic ---

  private spawnCar(z: number): void {
    const lane = this.traffic.int(4);
    const x = C.LANE_X[lane];
    for (const c of this.cars) if (c.lane === lane && Math.abs(c.z - z) < C.TRAFFIC.gap) return;
    const oncoming = lane === C.ONCOMING_LANE;
    const speed = oncoming ? C.CAR.oncoming : C.CAR.minSpeed + this.traffic.float() * (C.CAR.maxSpeed - C.CAR.minSpeed);
    this.cars.push({ id: this.nextId++, x, z, pz: z, speed, lane, color: this.traffic.pick(CAR_COLORS) });
  }

  private updateTraffic(): void {
    const p = this.player;
    const progress = clamp(p.z / this.length, 0, 1);
    const want = C.TRAFFIC.base + Math.round(progress * C.TRAFFIC.extra);
    for (const c of this.cars) {
      // Same-direction cars brake behind slower cars in their lane instead of driving through them.
      if (c.speed > 0) {
        for (const o of this.cars) {
          if (o !== c && o.lane === c.lane && o.z > c.z && o.z - c.z < 9 && o.speed < c.speed) c.speed = o.speed;
        }
        // ...and behind the security buggy when it is in their lane
        const pt = this.patrol;
        if (pt.active && Math.abs(pt.x - c.x) < C.CAR.halfW + C.PATROL.halfW + 0.15 &&
          pt.z > c.z && pt.z - c.z < 10 && pt.speed < c.speed) c.speed = pt.speed;
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
      if (r.state !== 'ride' || r.invT > 0) continue;
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
    if (!pt.active) {
      if (pt.wait > 0) pt.wait--;
      else if (riding && !p.finished && pt.units < this.patrolCount && p.z > this.patrolFrom && p.z < this.length - P.stopBefore) this.sendPatrol();
      return;
    }
    pt.t++;
    const gap = p.z - pt.z;
    // a lane's width to one side of the player, on a side with room
    const beside = (side: Side): number => {
      const off = P.halfW + P.riderHalfW + 1.2;
      return Math.abs(p.x + side * off) <= C.EDGE ? p.x + side * off : p.x - side * off;
    };
    const leave = () => { pt.mode = 'leave'; pt.t = 0; };
    if (p.finished && pt.mode !== 'leave') leave();
    let want = pt.x;
    let speed = pt.speed;
    let steer = P.steer;
    switch (pt.mode) {
      case 'chase':
        // while the player is down it hangs back and waits for them to get going again
        speed = riding ? p.speed + P.chaseGain + Math.max(0, gap - 30) * 0.25 : p.speed + clamp(gap - 30, -8, 8);
        // come up a lane over, never into the player's back: on their left to shove them right onto the
        // shoulder, unless they're out in the oncoming lane
        pt.side = p.x < -3.5 ? 1 : -1;
        want = beside(pt.side);
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
        if (pt.move === 'squeeze' && -gap < 25 && riding) speed = Math.max(4, p.speed - clamp(-gap * 0.3, 1.5, 6));
        if (riding && (pt.move === 'block' ? -gap < pt.pullOutAt : gap > -1 || (inLane && -gap < 8))) {
          pt.mode = pt.move;
          pt.t = pt.hold = 0;
          this.events.push({ type: 'patrolWarn' });
        } else if (gap > P.halfL + 2) leave(); // got past it while down
        else if (pt.t > P.giveUp * C.TICK_HZ) {
          if (-gap > 60) return this.patrolGone(); // never came: it turns off far up the road
          leave();
        }
        break;
      case 'block': {
        // sit in front of the player and slow down, shadowing their line: get round it where it can't follow
        const lead = pt.z - p.z;
        if (lead < 12) pt.hold++; // the clock runs once it's actually in their way
        const k = clamp(pt.hold / pt.press, 0, 1);
        const pace = P.blockPace[0] + (P.blockPace[1] - P.blockPace[0]) * k;
        speed = clamp(p.speed + (pt.blockAhead - lead) * 1.5, p.speed * 0.5, p.top * pace);
        want = p.x;
        steer = P.blockSteer;
        if (!riding || pt.hold > pt.press || pt.t > pt.press + P.pressMax * C.TICK_HZ || lead < -2) leave();
        break;
      }
      case 'squeeze': {
        // pull the player over: draw level on one side, then lean in and shove them toward the other
        const wide = P.halfW + P.riderHalfW;
        const level = Math.abs(gap) < P.halfL;
        speed = p.speed + clamp(gap * 2, -6, 8);
        if (!level || Math.abs(pt.x - p.x) > wide + 1.5) {
          // still getting there: a lane over (leaning in from behind would just run into their back), on
          // their left to shove them right onto the shoulder unless they're out in the oncoming lane
          pt.side = p.x < -3.5 ? 1 : -1;
          want = beside(pt.side);
        } else {
          pt.hold++;
          pt.side = pt.x >= p.x ? 1 : -1;
          pt.push = -pt.side as Side;
          // never into a car: with one on the shoulder side coming up, it eases off and leaves them a gap
          want = this.carOnShoulder(pt.push)
            ? p.x + pt.side * (wide + 1)
            : p.x + pt.side * (wide - P.squeezeIn);
          steer = P.pushSteer;
        }
        if (!riding || pt.hold > pt.press || pt.t > pt.press + P.pressMax * C.TICK_HZ) leave();
        break;
      }
      case 'leave':
        // pull off the player's line first, then drop out of the race for good: well ahead, it speeds off;
        // otherwise it brakes and falls behind
        want = beside(pt.side);
        speed = gap < -3 ? p.top + 10 : gap < 0.5 && Math.abs(pt.x - p.x) < P.halfW + P.riderHalfW + 0.3 ? p.speed + 3 : riding ? Math.max(4, p.speed - 15) : 16; // player down: just drive off
        if (gap > P.goneAt || -gap > P.goneAhead) return this.patrolGone();
        // wedged in traffic right by the player for a while: it pulls off the road rather than hold them up
        if (pt.t > P.stuckSec * C.TICK_HZ && Math.abs(gap) < 8 && riding && pt.speed > p.speed - 3 && Math.abs(pt.x - p.x) < P.halfW + P.riderHalfW + 0.3) { this.patrolStuck++; return this.patrolGone(); }
        break;
    }
    speed = Math.max(0, speed);
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
    this.patrol.wait = Math.round(sec * C.TICK_HZ);
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
    let x = p.x;
    let z = p.z - this.roll(P.spawnBack);
    if (from === 'ahead') {
      // a same-direction side lane with no car near the spot (lane 0 is oncoming)
      const clear = (cx: number, cz: number) =>
        this.cars.every((c) => Math.abs(c.x - cx) > C.CAR.halfW + P.halfW || Math.abs(c.z - cz) > C.CAR.halfL + P.halfL + 6);
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
      from, move, pace, press: Math.round(this.roll(P.pressSec) * C.TICK_HZ),
      blockAhead: this.roll(P.blockAhead), pullOutAt: this.roll(P.pullOutAt),
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
        if (r.state !== 'ride') continue;
        if (Math.abs(r.x - pt.x) >= wide - 1e-6 || Math.abs(r.z - pt.z) >= long - 1e-6) continue;
        const odx = r.px - pt.px;
        const odz = r.pz - pt.pz;
        if (Math.abs(odx) / wide >= Math.abs(odz) / long) {
          const s: Side = odx >= 0 ? 1 : -1;
          let nx = pt.x + s * wide;
          if (Math.abs(nx) > C.EDGE) {
            nx = s * C.EDGE;
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
    const step = (target === want ? steerRate : P.steer * 1.6) * C.DT;
    const nx = clamp(pt.x + clamp(target - pt.x, -step, step), -C.EDGE, C.EDGE);
    // judged where the buggy will be after this tick's move, so it can't slip in beside a slower car's tail
    const blocked = (c: Car) => Math.abs(c.x - nx) < wide &&
      (Math.abs(c.z - pt.z) < long || Math.abs(c.z - pt.z - Math.max(0, pt.speed - c.speed) * C.DT) < long);
    if (!this.cars.some(blocked)) pt.x = nx;
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
      const s = (this.grudges.has(r.id) ? 2 : 0) + r.aggr + this.aiRng.float() * 0.6;
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
    const ids: number[] = [];
    for (let k = 0; k < n; k++) {
      const r = free[k];
      const side = k === 0 ? first : -first;
      r.state = 'ride';
      r.x = r.px = r.wantX = side * C.EDGE;
      r.z = r.pz = p.z + G.spawnAhead + k * 7;
      r.vx = 0;
      r.speed = r.pace = p.speed * G.lurk;
      r.hp = r.maxHp;
      r.invT = r.atkT = r.atkCd = r.hitT = r.downT = r.runT = r.rubT = r.stalkT = r.gangT = 0;
      r.gang = 'lurk';
      r.weapon = k === 0 && prog >= G.batFrom ? 'bat' : 'pan';
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
