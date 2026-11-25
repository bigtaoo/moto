import { describe, expect, it } from 'vitest';
import type { IncomingMessage } from 'node:http';
import { addressOf, Budget, countryOf, RATE } from './limits.ts';

// Budget and the two header readers, on their own: index.test.ts walks a real socket through them, but
// the window rolling over and the byte budget are the parts a test would otherwise have to wait out.

const req = (headers: Record<string, string>, remote = '10.0.0.1'): IncomingMessage =>
  ({ headers, socket: { remoteAddress: remote } }) as unknown as IncomingMessage;

describe('who is asking', () => {
  it('believes the tunnel, because nothing else can reach the port', () => {
    expect(addressOf(req({ 'cf-connecting-ip': '203.0.113.5', 'x-forwarded-for': '1.2.3.4' }))).toBe('203.0.113.5');
  });

  it('falls back to the first hop, then to the socket', () => {
    expect(addressOf(req({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8' }))).toBe('1.2.3.4');
    expect(addressOf(req({}))).toBe('10.0.0.1');
    expect(addressOf(req({}, ''))).toBe('none');
  });
});

describe('where it came from', () => {
  it('keeps a country and drops everything that is not one', () => {
    expect(countryOf(req({ 'cf-ipcountry': 'DE' }))).toBe('DE');
    // Unknown and Tor are both real answers and neither is a place.
    for (const c of ['XX', 'T1', 'de', 'DEU', '', 'D1']) expect(countryOf(req({ 'cf-ipcountry': c }))).toBeUndefined();
    expect(countryOf(req({}))).toBeUndefined();
  });
});

describe('a minute of budget', () => {
  it('serves an address up to its count and then stops', () => {
    const b = new Budget();
    const now = 1_000_000;
    for (let i = 0; i < RATE.reqs; i++) expect(b.take('a', 0, now)).toBe(true);
    expect(b.take('a', 0, now)).toBe(false);
    expect(b.over).toBe(1);
    // Another address has its own, which is the whole point of keying it.
    expect(b.take('b', 0, now)).toBe(true);
  });

  it('counts bytes as well, for the client that sends few but enormous batches', () => {
    const b = new Budget();
    const now = 1_000_000;
    expect(b.take('a', RATE.bytes, now)).toBe(true);
    expect(b.take('a', 1, now)).toBe(false);
  });

  it('charges what arrives past a content-length that lied', () => {
    const b = new Budget();
    const now = 1_000_000;
    expect(b.take('a', 10, now)).toBe(true);
    b.add('a', RATE.bytes, now);
    expect(b.take('a', 0, now)).toBe(false);
  });

  it('charges nothing to a window that has already gone', () => {
    const b = new Budget();
    b.take('a', 10, 1_000_000);
    b.add('a', RATE.bytes, 1_000_000 + RATE.window + 1);
    expect(b.take('a', 0, 1_000_000 + RATE.window + 1)).toBe(true);
  });

  it('gives the address its budget back when the window rolls over', () => {
    const b = new Budget();
    const now = 1_000_000;
    for (let i = 0; i <= RATE.reqs; i++) b.take('a', 0, now);
    expect(b.take('a', 0, now)).toBe(false);
    expect(b.take('a', 0, now + RATE.window)).toBe(true);
  });

  it('forgets the addresses whose minute is up, so the map cannot grow for ever', () => {
    const b = new Budget();
    b.take('a', 0, 1_000_000);
    b.take('b', 0, 1_000_000 + RATE.window);
    expect(b.size).toBe(2);
    b.sweep(1_000_000 + RATE.window + 1);
    expect(b.size).toBe(1);
    b.sweep(1_000_000 + 2 * RATE.window + 1);
    expect(b.size).toBe(0);
  });
});
