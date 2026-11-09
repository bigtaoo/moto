// The race simulation: fixed 30 Hz steps, no DOM, no Three.js, so the headless bot can run it.
// The road is straight here; the view bends and lifts it (src/view/track.ts).

import { Prng } from './rng';
import * as C from './config';
import { rivalThink, laneClearance } from './ai';

export type Side = -1 | 1;
export type CrashCause = 'ko' | 'car' | 'patrol';

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
  downT: number;
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

export interface Patrol {
  active: boolean;
  mode: 'chase' | 'warn' | 'dash' | 'fall' | 'off';
  t: number;
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
  | { type: 'caught' }
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
  readonly patrol: Patrol = { active: false, mode: 'off', t: 0, x: 0, z: 0, px: 0, pz: 0, speed: 0 };
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
  fines = 0;
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
      this.addRider({ name: G.name, isPlayer: false, x: 0, z: -1000, top: G.top, steer: G.steer, hp: G.hp, aggr: 1, aware: G.aware, body: G.body, ride: G.ride });
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
      state: 'ride', downT: 0, invT: 0, atkT: 0, atkSide: 1, atkCd: 0, hitT: 0, weapon: o.weapon ?? null,
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
    for (const r of this.riders) { r.px = r.x; r.pz = r.z; }
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
      r.speed = Math.max(0, r.speed - 20 * C.DT);
      r.z += r.speed * C.DT;
      r.vx *= 0.85;
      r.x = clamp(r.x + r.vx * C.DT, -C.EDGE, C.EDGE);
      if (--r.downT <= 0) this.recover(r);
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
    r.downT = C.DOWN_TICKS[c];
    r.vx = vx;
    r.atkT = 0;
    r.huntT = 0;
    if (r.isPlayer) this.crashes++;
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
    if (!pt.active) {
      if (!p.finished && p.z > this.length * C.PATROL.startAt) {
        Object.assign(pt, { active: true, mode: 'chase', t: 0, x: p.x, z: p.z - C.PATROL.spawnBack, speed: p.speed });
        pt.px = pt.x;
        pt.pz = pt.z;
      }
      return;
    }
    if (p.finished && pt.mode !== 'fall' && pt.mode !== 'off') { pt.mode = 'fall'; pt.t = 9999; }
    pt.t++;
    const gap = p.z - pt.z;
    switch (pt.mode) {
      case 'chase': {
        pt.speed = p.speed + C.PATROL.chaseGain + Math.max(0, gap - 30) * 0.15;
        if (gap < C.PATROL.warnAt && p.state === 'ride') { pt.mode = 'warn'; pt.t = 0; this.events.push({ type: 'patrolWarn' }); }
        if (p.state === 'down') { pt.mode = 'fall'; pt.t = 0; }
        break;
      }
      case 'warn':
        pt.speed = p.speed + 1;
        if (pt.t >= C.PATROL.warnTicks) { pt.mode = 'dash'; pt.t = 0; }
        break;
      case 'dash':
        pt.speed = p.speed + C.PATROL.dash;
        if (p.state === 'ride' && p.invT <= 0 && Math.abs(p.x - pt.x) < 1.25 && Math.abs(gap) < 2.6) {
          this.fines += C.FINE;
          this.events.push({ type: 'caught' });
          this.crash(p, 'patrol', (p.x >= pt.x ? 1 : -1) * 5);
          pt.mode = 'fall';
          pt.t = 0;
        } else if (pt.t >= C.PATROL.dashTicks || gap < -8) {
          pt.mode = 'fall';
          pt.t = 0;
        }
        break;
      case 'fall':
        pt.speed = Math.max(4, p.speed - 9);
        if (gap > C.PATROL.fallBack && pt.t > C.PATROL.fallTicks) {
          if (p.finished) pt.mode = 'off';
          else { pt.mode = 'chase'; pt.t = 0; }
        }
        break;
      case 'off':
        pt.speed = 0;
        break;
    }
    this.patrolTraffic(pt.mode === 'chase' ? p.x : pt.x);
    pt.z += pt.speed * C.DT;
    // The buggy bowls over any rival in its path.
    if (pt.mode === 'dash') {
      for (const r of this.riders) {
        if (!r.isPlayer && r.state === 'ride' && Math.abs(r.x - pt.x) < 1.25 && Math.abs(r.z - pt.z) < 2.4) this.crash(r, 'patrol', (r.x >= pt.x ? 1 : -1) * 5);
      }
    }
  }

  /**
   * Keeps the buggy out of traffic: it steers toward `want` but changes lane when a car is in the
   * way, never slides sideways into a car beside it, and slows behind a car it cannot get round.
   */
  private patrolTraffic(want: number): void {
    const pt = this.patrol;
    const P = C.PATROL;
    const wide = C.CAR.halfW + P.halfW + 0.15;
    const long = C.CAR.halfL + P.halfL + 0.3;
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
    const step = P.steer * (target === want ? 1 : 1.6) * C.DT;
    const nx = clamp(pt.x + clamp(target - pt.x, -step, step), -C.EDGE, C.EDGE);
    if (!this.cars.some((c) => Math.abs(c.x - nx) < wide && Math.abs(c.z - pt.z) < long)) pt.x = nx;
    // still boxed in: hang back behind the car ahead (an oncoming one is dodged above)
    for (const c of this.cars) {
      if (Math.abs(c.x - pt.x) >= wide || c.speed <= 0) continue;
      const dist = c.z - pt.z - long;
      if (dist < -long) continue;
      pt.speed = Math.min(pt.speed, c.speed + Math.max(0, dist) * 1.5);
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
      r.invT = r.atkT = r.atkCd = r.hitT = r.downT = r.rubT = r.stalkT = r.gangT = 0;
      r.gang = 'lurk';
      r.weapon = k === 0 && prog >= G.batFrom ? 'bat' : null;
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
