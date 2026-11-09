import { describe, expect, it } from 'vitest';
import { SIM_VERSION, TICK_HZ } from './config';
import { botInput } from './ai';
import { hashState } from './hash';
import { Recorder, playReplay, type Replay } from './replay';
import { World, type WorldOpts } from './world';

// The golden hashes pin what a seed plus inputs produce. If one changes, either the change was meant
// to alter the race (bump SIM_VERSION in config.ts and paste the new hashes here) or the sim lost
// its determinism (find out why before touching anything).
const GOLDEN = { version: 11, mid: '0ce0f211', end: 'a25e2333', endTick: 4906 };

const OPTS: WorldOpts = { seed: 1, upgrades: { top: 2, steer: 2, hp: 2 } };
const MID = 60 * TICK_HZ;
const CAP = 400 * TICK_HZ;

/** A bot race; returns the hash at MID and at the end, and the replay. */
function race(opts: WorldOpts): { mid: string; end: string; tick: number; replay: Replay } {
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
  return { mid, end: hashState(w), tick: w.tick, replay: rec.finish(w) };
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
    r.rows.splice(r.rows.findIndex((row) => row[4] === 1), 1);
    expect(playReplay(r).ok).toBe(false);
  });

  it('refuses a replay from another sim version', () => {
    expect(() => playReplay({ ...a.replay, v: SIM_VERSION + 1 })).toThrow(/sim v/);
  });
});
