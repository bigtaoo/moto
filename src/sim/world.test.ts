import { describe, expect, it } from 'vitest';
import * as C from './config';
import { SIM_VERSION, TICK_HZ } from './config';
import { botInput } from './ai';
import { hashState } from './hash';
import { Recorder, playReplay, type Replay } from './replay';
import { World, type WorldOpts } from './world';
import { knockOff } from './combat';

// The golden hashes pin what a seed plus inputs produce. If one changes, either the change was meant
// to alter the race (bump SIM_VERSION in config.ts and paste the new hashes here) or the sim lost
// its determinism (find out why before touching anything).
const GOLDEN = { version: 22, mid: '3476398f', end: 'e7c7c0a0', endTick: 4883 };

const OPTS: WorldOpts = { seed: 1, upgrades: { top: 2, steer: 2, hp: 2 }, div: 2, nemesis: 3, tier: 1, vehicle: 2 };
const MID = 60 * TICK_HZ;
const CAP = 400 * TICK_HZ;

/** A bot race; returns the hash at MID and at the end, and the replay. */
function race(opts: WorldOpts, remount = false): { mid: string; end: string; tick: number; replay: Replay; world: World } {
  const w = new World(opts);
  const rec = new Recorder(opts);
  let mid = '';
  while (!w.over && w.tick < CAP) {
    botInput(w);
    if (remount && w.player.state === 'down') w.input.remount = true;
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

  it('replays a race with remounts', () => {
    const r = race(OPTS, true);
    expect(r.replay.rows.some((row) => row[4] & 2)).toBe(true);
    expect(playReplay(JSON.parse(JSON.stringify(r.replay)) as Replay).ok).toBe(true);
  });

  it('refuses a replay from another sim version', () => {
    expect(() => playReplay({ ...a.replay, v: SIM_VERSION + 1 })).toThrow(/sim v/);
  });
});

describe('nemesis and remount', () => {
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

  it('puts a downed player straight back on the scooter when asked', () => {
    const w = new World({ seed: 3 });
    for (let i = 0; i < 90; i++) w.step();
    const p = w.player;
    p.hp = 1;
    // knock the player off by hand: the same path a hit takes
    knockOff(w, p, w.riders[1]);
    expect(p.state).toBe('down');
    w.step();
    expect(p.state).toBe('down');
    w.input.remount = true;
    w.step();
    expect(p.state).toBe('ride');
    expect(p.invT).toBeGreaterThan(0);
    expect(w.input.remount).toBe(false);
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
