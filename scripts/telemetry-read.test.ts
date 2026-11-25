import { describe, expect, it } from 'vitest';
import type { Stored, WireEvent } from '../server/wire.ts';
import {
  STEPS, bot, dur, ending, facts, lost, machine, median, own, quantile, secs, sessions, unfocused,
  type Fields,
} from './telemetry-read.ts';

// What the collector's lines mean once they are joined back into sessions. Everything a read of the
// data concludes rests on these: which sessions were nobody, where each one ended, and how far down
// the opening each got. Getting one of them wrong is how twenty players turn into a wrong answer.

/** The fields every event carries once the save has been read (src/telemetry.ts's `begin`). */
const C: Fields = {
  build: 'test', device: 'desktop', form: 'desktop', touch: false, orient: 'land',
  lang: 'en', new_player: true, career: 'new', session_n: 1, days: 0, focus: true, gfx: 2,
};

let seq = 0;
const ev = (e: string, s: number, d: Fields = C): WireEvent => ({ e, i: seq++, s, t: 1764000000000 + s * 1000, d });
/** An event from before the save was read: the boot marks carry no common fields. */
const early = (e: string, s: number, d?: Fields): WireEvent => ({ e, i: seq++, s, ...(d ? { d } : {}) , t: 1764000000000 });
const line = (b: Partial<Stored> & Pick<Stored, 'sid' | 'evs'>): string =>
  JSON.stringify({ v: '0.2.0', n: 0, t: 1764000000000, rt: 1764000000001, ...b } satisfies Stored);
const one = (evs: WireEvent[], b: Partial<Stored> = {}): ReturnType<typeof sessions>[number] =>
  sessions([line({ sid: 'aaaaaaaaaaa', evs, ...b })])[0];

describe('joining the lines back into sessions', () => {
  it('takes the player id and the country from whichever batch carried them', () => {
    seq = 0;
    const [s] = sessions([
      line({ sid: 's1', n: 0, evs: [early('boot', 0.2)], c: 'DE' }),
      line({ sid: 's1', n: 1, evs: [ev('game_loaded', 1.4)], uid: 'zz99yy88xx7', c: 'DE' }),
    ]);
    expect(s.uid).toBe('zz99yy88xx7');
    expect(s.c).toBe('DE');
    expect(s.evs.map((e) => e.e)).toEqual(['boot', 'game_loaded']);
  });

  it('counts a re-sent batch once, and puts the events back in the order they happened', () => {
    seq = 0;
    const a = ev('first_input', 2);
    const b = ev('progression_started', 3);
    const [s] = sessions([
      line({ sid: 's1', n: 1, evs: [b, a] }),
      line({ sid: 's1', n: 1, evs: [a, b] }), // the browser refused the first try; it went again
    ]);
    expect(s.evs.map((e) => e.e)).toEqual(['first_input', 'progression_started']);
  });

  it('sees the hole where a batch never arrived', () => {
    seq = 0;
    const s = sessions([
      line({ sid: 's1', n: 0, evs: [ev('a', 1)] }),
      line({ sid: 's1', n: 2, evs: [ev('c', 3)] }),
    ])[0];
    expect(lost(s)).toBe(1);
    expect(lost(one([ev('a', 1)]))).toBe(0);
  });

  it('keeps sessions apart and measures each by its last event', () => {
    seq = 0;
    const all = sessions([line({ sid: 's1', evs: [ev('a', 9)] }), line({ sid: 's2', evs: [ev('a', 2)] })]);
    expect(all.map((s) => s.sid)).toEqual(['s1', 's2']);
    expect(all.map(dur)).toEqual([9, 2]);
  });
});

describe('who was behind it', () => {
  it('calls a page left during the boot a crawler, and one that reached a first frame a person', () => {
    seq = 0;
    expect(bot(one([early('boot_left', 0.6, { stage: 'script', ms: 600 })]))).toBe(true);
    seq = 0;
    expect(bot(one([ev('game_loaded', 1.2), ev('boot_left', 2, { stage: 'ready', ms: 2000 })]))).toBe(false);
    seq = 0;
    expect(bot(one([ev('game_loaded', 1.2), ev('session_end', 40)]))).toBe(false);
  });

  it('waits out a slow boot rather than calling it a crawler', () => {
    seq = 0;
    expect(bot(one([early('boot_left', 7.5, { stage: 'script', ms: 7500 })]))).toBe(false);
  });

  it('marks a tab that never held the focus, and only once it could have', () => {
    seq = 0;
    const dark = one([ev('game_loaded', 1, { ...C, focus: false }), ev('idle', 40, { ...C, focus: false })]);
    expect(unfocused(dark)).toBe(true);
    seq = 0;
    const watched = one([ev('game_loaded', 1, { ...C, focus: false }), ev('first_input', 9)]);
    expect(unfocused(watched)).toBe(false);
    seq = 0;
    // Nothing but boot marks: no common fields yet, so there is nothing to judge.
    expect(unfocused(one([early('boot_left', 0.6, { stage: 'script', ms: 600 })]))).toBe(false);
  });

  it('reads the common fields past the events that were sent before the save was', () => {
    seq = 0;
    const s = one([early('boot', 0.2), ev('game_loaded', 1.4, { ...C, device: 'android', form: 'mobile', touch: true, orient: 'port' })], { c: 'FI' });
    expect(facts(s).device).toBe('android');
    expect(machine(s)).toBe('FI android form:mobile port touch en gfx2');
  });

  it('says nothing about the form where the host said nothing', () => {
    seq = 0;
    // No bridge, as on CrazyGames: `form` is 'unknown', which is an absence and not a disagreement.
    const s = one([ev('game_loaded', 1.4, { ...C, device: 'desktop', form: 'unknown' })], { c: 'DE' });
    expect(machine(s)).toBe('DE desktop land en gfx2');
  });
});

describe('what an event says of its own', () => {
  it('keeps what the event itself said and drops the thirteen it merely carries', () => {
    seq = 0;
    expect(own(ev('game_loaded', 1.4, { ...C, ms: 1400, save_ms: 12 }))).toEqual({ ms: 1400, save_ms: 12 });
    expect(own(ev('idle', 40))).toEqual({});
    expect(own(early('boot', 0.2))).toEqual({});
  });
});

describe('where the session ended', () => {
  it('takes the last word, because one is sent on every hide', () => {
    seq = 0;
    const s = one([
      ev('session_end', 30, { ...C, reason: 'race', races: 1, played: 25 }),
      ev('session_end', 90, { ...C, reason: 'garage', races: 3, played: 70 }),
    ]);
    expect(ending(s)).toBe('session_end (garage, 3 races, 70s racing)');
  });

  it('falls back to the boot, and then says it does not know', () => {
    seq = 0;
    expect(ending(one([early('boot_left', 0.6, { stage: 'bridge', ms: 600 })]))).toBe('boot_left (bridge at 600ms)');
    seq = 0;
    expect(ending(one([ev('game_loaded', 1)]))).toContain('no word');
  });
});

describe('the opening funnel', () => {
  it('is monotone over a session that got as far as a second race', () => {
    seq = 0;
    const s = one([
      ev('game_loaded', 1.4), ev('first_input', 3), ev('progression_started', 5),
      ev('tutorial_step', 6, { ...C, step: 'steer' }), ev('tutorial_step', 9, { ...C, step: 'slap' }),
      ev('progression_completed', 70), ev('play_30s', 40), ev('progression_started', 80),
    ]);
    const reached = STEPS.map(({ label, reached: r }) => [label, !!r(s)] as const);
    expect(reached).toEqual([
      ['first frame', true], ['first input', true], ['race 1 start', true], ['steered', true],
      ['slapped', true], ['landed a hit', false], ['30s racing', true], ['race 1 done', true],
      ['race 2 start', true], ['60s racing', false], ['3min racing', false], ['10min racing', false],
    ]);
  });

  it('does not take the first race start for the second', () => {
    seq = 0;
    const s = one([ev('game_loaded', 1), ev('progression_started', 5)]);
    expect(STEPS.find((x) => x.label === 'race 2 start')?.reached(s)).toBeUndefined();
  });
});

describe('the numbers under the summary', () => {
  it('takes the middle of an even list, and 0 of nothing', () => {
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([5])).toBe(5);
    expect(median([])).toBe(0);
    expect(quantile([1, 2, 3, 4], 0.75)).toBe(4);
    expect(quantile([], 0.5)).toBe(0);
  });

  it('writes a time the way a person reads one', () => {
    expect(secs(4.25)).toBe('4.3s');
    expect(secs(42.4)).toBe('42s');
    expect(secs(95)).toBe('1m35');
  });
});
