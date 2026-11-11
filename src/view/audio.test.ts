import { describe, it, expect } from 'vitest';
import { admit, type Voice } from './audio';

/** A voice of length `len` starting at `start`; `n` is cast because the test names needn't be real samples. */
const v = (n: string, start: number, vol = 1, len = 0.5): Voice =>
  ({ n: n as Voice['n'], start, end: start + len, vol });

describe('how many effects may sound at once', () => {
  it('lets ordinary traffic through', () => {
    const live: Voice[] = [];
    expect(admit(live, 0, v('crash', 0))).toBe(true);
    expect(admit(live, 0.1, v('whoosh1', 0.1))).toBe(true);
    expect(admit(live, 0.2, v('thunk1', 0.2))).toBe(true);
    expect(live.length).toBe(3);
  });

  it('refuses the same sample twice inside the dedupe gap, and allows it after', () => {
    const live: Voice[] = [];
    expect(admit(live, 0, v('thunk1', 0))).toBe(true);
    expect(admit(live, 0.02, v('thunk1', 0.02))).toBe(false);
    expect(admit(live, 0.05, v('thunk1', 0.05))).toBe(true);
    expect(admit(live, 0.05, v('thunk2', 0.05))).toBe(true); // another sample is another event
  });

  it('forgets voices that have finished', () => {
    const live: Voice[] = [];
    for (let i = 0; i < 6; i++) admit(live, i * 0.1, v('whoosh1', i * 0.1, 1, 0.05));
    expect(live.length).toBe(1);
  });

  it('caps the pile at six and keeps the loudest', () => {
    const live: Voice[] = [];
    for (let i = 0; i < 6; i++) expect(admit(live, 0, v(`q${i}`, i * 0.001, 0.2))).toBe(true);
    expect(admit(live, 0.01, v('quiet', 0.01, 0.1))).toBe(false); // quieter than the quietest: no room
    expect(live.length).toBe(6);
    expect(admit(live, 0.01, v('crash', 0.01, 0.9))).toBe(true); // louder: the quietest gives way
    expect(live.length).toBe(6);
    expect(live.some((o) => o.n === 'crash')).toBe(true);
  });

  it('cuts the voice it evicts short, and only that one', () => {
    const live: Voice[] = [];
    const stopped: string[] = [];
    for (let i = 0; i < 6; i++) live.push({ ...v(`q${i}`, 0, 0.2 + i * 0.01), stop: () => stopped.push(`q${i}`) });
    admit(live, 0.01, v('crash', 0.01, 0.9));
    expect(stopped).toEqual(['q0']);
  });
});
