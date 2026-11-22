import { describe, expect, it } from 'vitest';
import * as C from './config';
import { SIM_VERSION, TICK_HZ } from './config';
import { botInput } from './ai';
import { hashState } from './hash';
import { Recorder, playReplay, type Replay } from './replay';
import { World, type WorldOpts } from './world';

// 3.3.67/3.3.68: the hashes moved but endTick did not. A bot race steers by targetX and never touches the
// keys, so the press budget changed nothing it does; what the hash picked up is the fields that budget keeps
// on the World, since hashState walks every field there.
// The golden hashes pin what a seed plus inputs produce. If one changes, either the change was meant
// to alter the race (bump SIM_VERSION in config.ts and paste the new hashes here) or the sim lost
// its determinism (find out why before touching anything).
const GOLDEN = { version: 44, mid: '373a7dae', end: '8ed8415f', endTick: 4241 };

const OPTS: WorldOpts = { seed: 1, upgrades: { top: 2, steer: 2, hp: 2 }, div: 2, nemesis: 3, tier: 1, vehicle: 2 };
const MID = 60 * TICK_HZ;
const CAP = 400 * TICK_HZ;

/** A bot race; returns the hash at MID and at the end, and the replay. */
function race(opts: WorldOpts): { mid: string; end: string; tick: number; replay: Replay; world: World } {
  const w = new World(opts);
  const rec = new Recorder(opts);
  let mid = '';
  while (!w.over && w.tick < CAP) {
    botInput(w);
    rec.capture(w);
    w.step();
    w.events.length = 0;
    if (w.tick === MID) mid = hashState(w);
  }
  return { mid, end: hashState(w), tick: w.tick, replay: rec.finish(w), world: w };
}

describe('sim determinism', () => {
  const a = race(OPTS);

  it('matches the golden hash for this SIM_VERSION', () => {
    expect(SIM_VERSION).toBe(GOLDEN.version);
    expect({ mid: a.mid, end: a.end, endTick: a.tick }).toEqual({ mid: GOLDEN.mid, end: GOLDEN.end, endTick: GOLDEN.endTick });
  });

  it('runs the same seed to the same state', () => {
    const b = race(OPTS);
    expect([b.mid, b.end, b.tick]).toEqual([a.mid, a.end, a.tick]);
  });

  it('runs a different seed to a different state', () => {
    expect(race({ ...OPTS, seed: 2 }).mid).not.toBe(a.mid);
  });

  it('sees a last-bit change anywhere in the state', () => {
    const w = new World(OPTS);
    for (let i = 0; i < 300; i++) w.step();
    const h = hashState(w);
    w.riders[3].x += 1e-12;
    expect(hashState(w)).not.toBe(h);
  });

  it('replays a recorded race to the identical state, also through JSON', () => {
    const r = JSON.parse(JSON.stringify(a.replay)) as Replay;
    expect(r.end).toBe(a.tick);
    const out = playReplay(r);
    expect(out.ok).toBe(true);
    expect(out.hash).toBe(a.end);
  });

  it('notices a replay that was tampered with', () => {
    const r = structuredClone(a.replay);
    r.rows.splice(r.rows.findIndex((row) => row[4] & 1), 1);
    expect(playReplay(r).ok).toBe(false);
  });

  it('refuses a replay from another sim version', () => {
    expect(() => playReplay({ ...a.replay, v: SIM_VERSION + 1 })).toThrow(/sim v/);
  });
});

describe('steering keys (3.3.67)', () => {
  /** Roll out of the countdown on an empty road, then hold left for `ms` and let go. */
  function press(ms: number, again = 0): number {
    const w = new World({ seed: 7 });
    for (let i = 0; i < TICK_HZ * 3; i++) w.step();
    for (const r of w.riders) if (!r.isPlayer) r.z = w.player.z - 500; // nobody to rub along the way
    const x0 = w.player.x;
    const run = (steer: number, secs: number) => {
      for (let i = 0; i < Math.round(secs * TICK_HZ); i++) {
        w.cars.length = 0; // and no traffic to be shoved by: this is about the keys alone
        w.input.steer = steer;
        w.step();
        w.events.length = 0;
      }
    };
    run(-1, ms / 1000);
    run(0, 0.2);
    if (again) { run(-1, again / 1000); run(0, 0.2); }
    return x0 - w.player.x;
  }

  it('spends a lane at most, however long the key is held', () => {
    // a firm press used to run on for as long as the finger did: 900 ms of it crossed two lanes
    expect(press(700)).toBeCloseTo(C.KEY_STEP, 2);
    expect(press(900)).toBeCloseTo(C.KEY_STEP, 2);
    expect(press(2000)).toBeCloseTo(C.KEY_STEP, 2);
  });

  it('reads press length as distance, so less than a lane is something a hand can aim (3.3.68)', () => {
    // the whole point: a third of a second is about half a lane -- from the left of a lane to the middle --
    // and the step from one press length to the next is small enough to be worth aiming at
    for (const ms of [100, 200, 300, 500]) expect(press(ms)).toBeCloseTo((C.KEY_RATE * ms) / 1000, 1);
    expect(press(350)).toBeGreaterThan(C.KEY_STEP * 0.4);
    expect(press(350)).toBeLessThan(C.KEY_STEP * 0.6);
  });

  it('lets a second press buy the next lane', () => {
    expect(press(700, 700)).toBeGreaterThan(C.KEY_STEP * 1.8);
  });
});

describe('the sweep', () => {
  it('calls the race a few seconds after the last rival is home, not at the time cap', () => {
    // a player who never touches the controls: they fall behind, everyone else finishes
    const w = new World({ seed: 7, div: 1, tier: 2 });
    let lastRival = 0;
    let swept = 0;
    while (!w.over && w.tick < 400 * TICK_HZ) {
      w.input.steer = 0;
      w.input.brake = false;
      w.input.attack = false;
      w.step();
      for (const e of w.events) {
        if (e.type === 'finish' && e.rider !== 0) lastRival = w.time;
        if (e.type === 'sweep') swept = w.time;
      }
      w.events.length = 0;
    }
    expect(w.player.finished).toBe(false);
    expect(w.time).toBeLessThan(C.TIME_CAP_S - 10);
    expect(swept).toBeCloseTo(lastRival, 1);
    expect(w.time - swept).toBeCloseTo(C.SWEEP_S, 0);
    // and everyone still has a place
    expect(new Set(w.riders.filter((r) => !r.thug).map((r) => r.place)).size).toBe(w.riders.filter((r) => !r.thug).length);
  });

  it('leaves a normal race alone: the player finishing still ends it', () => {
    const w = race(OPTS).world;
    expect(w.player.finished).toBe(true);
    expect(w.time).toBeLessThan(C.TIME_CAP_S);
  });
});

describe('nemesis', () => {
  it('makes the nemesis faster and keener, and nobody else', () => {
    const plain = new World({ seed: 5, div: 1 });
    const nem = new World({ seed: 5, div: 1, nemesis: 4 });
    expect(nem.nemesis).toBe(4);
    expect(plain.nemesis).toBe(-1);
    for (const r of nem.riders.slice(1)) {
      const p = plain.riders[r.id];
      if (r.id === 4) {
        expect(r.top).toBeGreaterThan(p.top);
        expect(r.aggr).toBeGreaterThanOrEqual(p.aggr);
      } else {
        expect([r.top, r.aggr]).toEqual([p.top, p.aggr]);
      }
    }
    expect(nem.hates(4)).toBe(true);
    expect(nem.hates(5)).toBe(false);
    expect(new World({ seed: 5, nemesis: 99 }).nemesis).toBe(-1);
  });

  it('counts the player KOs on each rival, and revenge on the nemesis', () => {
    let got = false;
    for (let seed = 1; seed <= 12 && !got; seed++) {
      const w = race({ seed, upgrades: { top: 3, steer: 3, hp: 3 }, nemesis: 2 }).world;
      const total = w.riders.reduce((s, r) => s + r.koByPlayer, 0);
      expect(w.riders[2].koByPlayer).toBe(w.revenge);
      expect(total).toBeLessThanOrEqual(w.kos + w.shoves + 1);
      got = w.revenge > 0;
    }
    expect(got).toBe(true);
  });

  it('lets a player just back on the scooter steer off the cones before they count', () => {
    let seed = 1;
    while (new World({ seed }).road.works.length === 0) seed++;
    /** The player riding right up against the cones mid-zone, steering into them; the cone falls in 20 ticks. */
    const cones = (grace: number): number => {
      const w = new World({ seed });
      w.countdown = 0;
      const p = w.player;
      const z = (w.road.works[0].z0 + w.road.works[0].z1) / 2;
      p.z = p.pz = z;
      p.x = p.px = w.road.worksHi(z);
      p.speed = p.top;
      p.invT = grace;
      w.input.targetX = C.EDGE;
      let n = 0;
      for (let i = 0; i < 20; i++) {
        w.step();
        n += w.events.filter((e) => e.type === 'crash' && e.rider === 0 && e.cause === 'cones').length;
        w.events.length = 0;
      }
      return n;
    };
    expect(cones(C.INVULN_TICKS)).toBe(0);
    expect(cones(0)).toBe(1);
  });
});

describe('seasons and rides', () => {
  it('puts the ride on top of the base and the upgrades', () => {
    const up = { top: 2, steer: 1, hp: 3 };
    const base = new World({ seed: 4, upgrades: up });
    const v = 4;
    const rode = new World({ seed: 4, upgrades: up, vehicle: v });
    const V = C.VEHICLES[v];
    expect(rode.vehicle).toBe(v);
    expect(rode.player.top).toBeCloseTo(base.player.top + V.top, 6);
    expect(rode.player.steer).toBeCloseTo(base.player.steer + V.steer, 6);
    expect(rode.player.hp).toBe(base.player.hp + V.hp);
    expect(rode.player.accel).toBeCloseTo(base.player.accel + V.accel, 6);
    expect(new World({ seed: 4, vehicle: 99 }).vehicle).toBe(C.VEHICLES.length - 1);
  });

  it('makes a later season faster, tougher and longer than the same division before it', () => {
    const am = new World({ seed: 6, div: 1 });
    const pro = new World({ seed: 6, div: 1, tier: 1 });
    expect(pro.div.name).toBe(`${C.TIERS[1].name} ${C.DIVISIONS[1].name}`);
    expect(pro.length).toBe(Math.round(C.RACE_LEN * C.TIERS[1].len));
    expect(pro.length).toBeGreaterThan(am.length);
    for (let i = 1; i <= C.ROSTER.length; i++) {
      expect(pro.riders[i].top - am.riders[i].top).toBeCloseTo(C.TIERS[1].top[1] - C.TIERS[0].top[1], 6);
      expect(pro.riders[i].hp).toBe(am.riders[i].hp + C.TIERS[1].hp);
    }
  });
});
