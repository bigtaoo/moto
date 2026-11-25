import { describe, expect, it } from 'vitest';
import { key, LIMITS, parseBatch } from './wire';

const good = {
  sid: 'ab12cd34ef5',
  v: '0.0.42',
  uid: 'zz99yy88xx7',
  n: 3,
  t: 1_764_000_000_000,
  evs: [{ e: 'funnel_first_cast', i: 7, s: 12.345, t: 1_764_000_000_000, d: { wave: 2, stuck: 'done', ok: true } }],
};

const send = (b: unknown) => parseBatch(JSON.stringify(b));

describe('parseBatch', () => {
  it('takes a batch the game actually sends', () => {
    const r = send(good);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.batch.sid).toBe('ab12cd34ef5');
    expect(r.batch.uid).toBe('zz99yy88xx7');
    // `s` keeps two decimals: enough to order events inside one frame, not enough to be a clock.
    expect(r.batch.evs[0]).toEqual({ e: 'funnel_first_cast', i: 7, s: 12.35, t: good.t, d: { wave: 2, stuck: 'done', ok: true } });
  });

  it('refuses junk without throwing', () => {
    for (const [body, why] of [
      ['', 'not json'],
      ['nonsense', 'not json'],
      ['[1,2]', 'not an object'],
      ['"a string"', 'not an object'],
    ] as const) {
      const r = parseBatch(body);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.why).toBe(why);
    }
  });

  it('wants a whole envelope', () => {
    expect(send({ ...good, sid: undefined }).ok).toBe(false);
    expect(send({ ...good, sid: 'has-a-dash' }).ok).toBe(false);
    expect(send({ ...good, v: '' }).ok).toBe(false);
    expect(send({ ...good, n: -1 }).ok).toBe(false);
    expect(send({ ...good, t: 'now' }).ok).toBe(false);
    expect(send({ ...good, evs: [] }).ok).toBe(false);
  });

  it('drops a bad event but keeps the batch', () => {
    const r = send({ ...good, evs: [{ e: 'Caps Are Not Ours', i: 1, t: 1 }, ...good.evs] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.batch.evs).toHaveLength(1);
  });

  it('refuses a batch whose every event is bad', () => {
    const r = send({ ...good, evs: [{ e: 'ok_name' }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.why).toBe('no usable event');
  });

  it('drops a uid it does not recognise instead of the batch', () => {
    const r = send({ ...good, uid: 'not a uid' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.batch.uid).toBeUndefined();
  });

  it('keeps free text out: long strings, nesting and odd keys go', () => {
    const r = send({
      ...good,
      evs: [{ e: 'boot_error', i: 0, s: 1, t: 1, d: { msg: 'x'.repeat(LIMITS.value + 1), inner: { a: 1 }, list: [1], 'not a key': 1, gpu: 'Mali-G52' } }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.batch.evs[0].d).toEqual({ gpu: 'Mali-G52' });
  });

  it('caps the fields, the events and the body', () => {
    const many = Object.fromEntries(Array.from({ length: LIMITS.fields + 10 }, (_, i) => [`f${i}`, i]));
    const r = send({ ...good, evs: [{ e: 'performance_sample', i: 0, s: 1, t: 1, d: many }] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(Object.keys(r.batch.evs[0].d ?? {})).toHaveLength(LIMITS.fields);

    const flood = send({ ...good, evs: Array.from({ length: LIMITS.events + 50 }, (_, i) => ({ ...good.evs[0], i })) });
    expect(flood.ok).toBe(true);
    if (flood.ok) expect(flood.batch.evs).toHaveLength(LIMITS.events);

    const big = parseBatch(JSON.stringify(good) + ' '.repeat(LIMITS.body));
    expect(big.ok).toBe(false);
    if (!big.ok) expect(big.why).toBe('too big');
  });

  it('drops a field that is not a number, and keeps one that is zero or false', () => {
    const r = send({ ...good, evs: [{ e: 'quit_done', i: 0, s: 0, t: 1, d: { fence: 0, won: false, fps: NaN } }] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.batch.evs[0].d).toEqual({ fence: 0, won: false });
  });
});

describe('key', () => {
  it('files a batch under the day it arrived, in order within its session', () => {
    const rt = Date.UTC(2026, 10, 24, 9, 30);
    expect(key({ ...good, n: 7 }, rt)).toBe(`v1/2026-11-24/ab12cd34ef5/0007-${rt}.json`);
  });

  it('sorts a session batch by batch, past ten', () => {
    const rt = Date.UTC(2026, 10, 24);
    const ten = key({ ...good, n: 10 }, rt);
    const nine = key({ ...good, n: 9 }, rt);
    expect([ten, nine].sort()).toEqual([nine, ten]);
  });

  it('never lets a resend overwrite the first attempt', () => {
    expect(key(good, 1)).not.toBe(key(good, 2));
  });
});
