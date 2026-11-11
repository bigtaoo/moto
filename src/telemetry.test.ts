import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as C from './sim/config';
import { CUP_RACES, settleRace, type Settlement } from './career';
import { parseSave, type Save } from './meta';
import { World } from './sim/world';

/**
 * Just enough page for the module to wire itself to. Everything telemetry reports is shaped in node --
 * the fields, the dedupe, the milestones -- but it reads a handful of page globals on the way, and
 * vitest runs in the node environment (doc 3.3.32). These are the whole list.
 */
Object.assign(globalThis, {
  // `documentElement` is i18n's, not telemetry's: vitest's workers share one global object, so a stub
  // thin enough for this file alone breaks whatever runs next in the same worker.
  document: { hidden: false, hasFocus: () => true, addEventListener: () => {}, documentElement: { lang: 'en' } },
  innerWidth: 1280,
  innerHeight: 720,
  devicePixelRatio: 2,
});

const host = vi.hoisted(() => ({
  sent: [] as { name: string; data: Record<string, unknown> }[],
  common: null as null | (() => Record<string, unknown>),
}));
vi.mock('./platform', () => ({
  track: (name: string, data?: Record<string, unknown>) => { host.sent.push({ name, data: data ?? {} }); },
  setCommonFields: (f: () => Record<string, unknown>) => { host.common = f; },
  flushEarly: () => {},
  deviceType: () => 'desktop',
}));
vi.mock('./view/audio', () => ({ loadErrors: { n: 0 }, sfx: {} }));

const tele = await import('./telemetry');

const canvas = { width: 1280, height: 720, addEventListener: () => {} } as unknown as HTMLCanvasElement;
const named = (name: string) => host.sent.filter((e) => e.name === name);
const one = (name: string) => {
  const es = named(name);
  expect(es.length, name).toBe(1);
  return es[0].data;
};

/** A race run to the finish by nobody: the fields are what is under test, not the riding. */
function raced(seed = 5): World {
  const w = new World({ seed });
  while (!w.over && w.tick < 400 * C.TICK_HZ) { w.step(); w.events.length = 0; }
  return w;
}

/** The settlement a finished race hands telemetry. */
function settled(save: Save, w: World): Settlement {
  const of = (f: (r: (typeof w.riders)[number]) => number) => w.riders.map((r) => (r.thug ? 0 : f(r)));
  return settleRace(save, {
    place: w.standing, kos: w.kos, grudgeKos: w.grudgeKos, shoves: w.shoves,
    nearPay: w.flair.nearPay, chainPay: w.flair.chainPay, fines: w.fines, grudges: [...w.grudges],
    places: of((r) => r.place), koPlayer: of((r) => r.koPlayer), koByPlayer: of((r) => r.koByPlayer),
  });
}

let save: Save;
beforeEach(() => {
  host.sent.length = 0;
  save = parseSave(null);
  tele.begin(save, canvas, () => 2);
  host.sent.length = 0;
});

describe('the session the analytics see', () => {
  it('counts the session into the save and sets the fields every event carries', () => {
    const s = parseSave(null);
    tele.begin(s, canvas, () => 1);
    expect(s.sessions).toBe(1);
    expect(s.firstDay).toBeGreaterThan(0);

    const f = host.common!();
    expect(f).toMatchObject({ build: tele.BUILD, new_player: true, session_n: 1, days: 0, gfx: 1, orient: 'land', focus: true });
    expect(f.rung).toBe(C.rung(s.div, s.tier));

    s.sessions = 40; // the field is capped, so the bucket stays a bucket
    expect(host.common!()).toMatchObject({ new_player: false, session_n: 20 });
  });

  it('reports an error kind three times and then stops', () => {
    for (let i = 0; i < 5; i++) tele.noWebgl();
    const es = named('error_report');
    expect(es.length).toBe(3);
    expect(es.map((e) => e.data.n)).toEqual([1, 2, 3]);
    expect(es[0].data).toMatchObject({ kind: 'no_webgl' });
  });
});

describe('a race, start to finish', () => {
  it('opens with the step it is on and the player as they stand', () => {
    const w = raced();
    tele.raceStart(w);
    const d = one('progression_started');
    expect(d).toMatchObject({ tier: 0, div: 0, cup_race: 1, ride: 0, career_race: 1, cash: save.cash, up_total: 0, mutator: 'none' });
    expect(typeof d.step_id).toBe('string');
    expect(d.step_index).toBeGreaterThanOrEqual(0);
  });

  it('closes with how the race went, and a performance sample with it', () => {
    const w = raced();
    tele.raceStart(w);
    host.sent.length = 0;
    tele.crashed('car');
    tele.crashed('ko');
    tele.paused();
    for (let i = 0; i < 400; i++) tele.frame(16, true, true); // 6.4 s: past the sampler's 5 s floor

    const s = settled(save, w);
    tele.raceEnd(s);

    const name = w.standing <= C.PROMOTE ? 'progression_completed' : 'progression_failed';
    const d = one(name);
    expect(d).toMatchObject({
      place: w.standing, racers: w.racers, kos: w.kos, shoves: w.shoves,
      falls_car: 1, falls_ko: 1, pauses: 1, time_s: Math.round(w.time),
      input: 'none', earned: s.earned, cash: save.cash,
    });
    const p = one('performance_sample');
    expect(p).toMatchObject({ js_error_count: 0, webgl_context_loss_count: 0, dpr: 2, mpix: 0.9, frame_count: 400 });
    expect(p.fps_avg).toBeCloseTo(62.5, 1);
  });

  it('a restart is a failure with its own reason, and ends the race', () => {
    const w = raced();
    tele.raceStart(w);
    host.sent.length = 0;
    tele.raceRestart();
    expect(one('progression_failed')).toMatchObject({ reason: 'restart', started: true });

    host.sent.length = 0;
    tele.raceRestart(); // no race left to fail
    expect(host.sent).toEqual([]);
  });

  it('offers the remount ad once a race', () => {
    const w = raced();
    tele.raceStart(w);
    host.sent.length = 0;
    tele.remountOffer();
    tele.remountOffer();
    expect(one('ad_offer')).toMatchObject({ placement: 'remount' });
  });

  it('counts the purchases between races onto the next one', () => {
    const w = raced();
    tele.raceStart(w);
    tele.raceEnd(settled(save, w));
    tele.bought();
    tele.bought();
    host.sent.length = 0;
    tele.raceStart(raced(6));
    expect(one('progression_started').buys).toBe(2);
  });
});

describe('the career milestones', () => {
  it('a won cup reports the cup, the promotion and the rides it opened', () => {
    const w = raced();
    save.cup.race = CUP_RACES - 1; // the last race of the cup, so its end is reported
    tele.raceStart(w);
    host.sent.length = 0;

    const s = settled(save, w);
    tele.raceEnd(s);
    if (!s.end) { expect(named('cup_completed')).toEqual([]); return; } // the bot did not finish the cup: nothing to report
    expect(one('cup_completed')).toMatchObject({ rank: s.end.rank, promoted: s.end.promoted, champion: s.end.champion });
    expect(named('division_reached').length).toBe(s.end.promoted ? 1 : 0);
    expect(named('season_reached').length).toBe(s.end.nextTier ? 1 : 0);
    for (const e of named('ride_unlocked')) expect(typeof e.data.affordable).toBe('boolean');
  });

  it('a nemesis made and a nemesis beaten each say so once', () => {
    const w = raced();
    tele.raceStart(w);
    host.sent.length = 0;
    const s = settled(save, w);
    tele.raceEnd(s);
    const want = (s.feud.fresh !== null ? 1 : 0) + (s.feud.beaten ? 1 : 0);
    expect(named('nemesis').length).toBe(want);
    for (const e of named('nemesis')) expect(['new', 'beaten', 'broken']).toContain(e.data.result);
  });
});
