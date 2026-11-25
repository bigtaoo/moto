// The wire in front of our own collector: what it sends, when, and what it does when it cannot.
// The server's half of the same contract is checked in server/wire.test.ts.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { collect, flush, identify, post, resetCollector, setTelemetryUrl, waiting, MAX_BATCH, MAX_QUEUE, MAX_SEND, RETRY_MS, SID } from './collect';
import { parseBatch } from '../server/wire';

const URL_ = 'https://dx.example.test/c';

/** Every body handed to fetch, parsed by the server's own reader: the two ends must agree. */
function sent(fetchMock: ReturnType<typeof vi.fn>): ReturnType<typeof parseBatch>[] {
  return fetchMock.mock.calls.map((c) => parseBatch(String((c[1] as { body: string }).body)));
}

describe('our own collector', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let beacon: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock = vi.fn(() => Promise.resolve({ status: 204 }));
    beacon = vi.fn(() => true);
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('navigator', { sendBeacon: beacon });
    vi.stubGlobal('document', { visibilityState: 'visible', addEventListener: vi.fn(), removeEventListener: vi.fn() });
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
    resetCollector();
    setTelemetryUrl(URL_);
  });

  afterEach(() => {
    resetCollector();
    setTelemetryUrl(null);
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('sends nothing at all when no collector is configured', () => {
    setTelemetryUrl('');
    for (let i = 0; i < MAX_BATCH + 5; i++) collect('game_loaded');
    flush(true);
    expect(waiting()).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(beacon).not.toHaveBeenCalled();
  });

  it('waits, then sends a full batch in one request', () => {
    for (let i = 0; i < MAX_BATCH - 1; i++) collect('first_input', { ms: i });
    expect(fetchMock).not.toHaveBeenCalled();
    collect('first_input', { ms: 99 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [batch] = sent(fetchMock);
    expect(batch.ok && batch.batch.evs).toHaveLength(MAX_BATCH);
  });

  it('sends a part-full batch once the oldest has waited', () => {
    collect('tutorial_step', { step: 'start' });
    expect(fetchMock).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('writes an envelope the server accepts, with the session and the player on it', () => {
    identify('abc123');
    collect('progression_started', { career_race: 2, boss: false, mutator: 'none' });
    flush();
    const [batch] = sent(fetchMock);
    expect(batch.ok).toBe(true);
    if (!batch.ok) return;
    expect(batch.batch.sid).toBe(SID);
    expect(batch.batch.uid).toBe('abc123');
    expect(batch.batch.n).toBe(0);
    expect(batch.batch.v.length).toBeGreaterThan(0);
    expect(batch.batch.evs[0]).toMatchObject({ e: 'progression_started', i: 0, d: { career_race: 2, boss: false, mutator: 'none' } });
  });

  it('numbers batches in order so a lost one can be seen', () => {
    collect('a_one'); flush();
    collect('a_two'); flush();
    expect(sent(fetchMock).map((b) => (b.ok ? b.batch.n : -1))).toEqual([0, 1]);
  });

  it('uses the beacon only when the page is going away', () => {
    collect('session_end', { reason: 'race' });
    flush(true);
    expect(beacon).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back to fetch when the browser refuses the beacon', () => {
    beacon.mockReturnValue(false);
    collect('session_end');
    flush(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps the events when nothing could be handed over', () => {
    fetchMock.mockImplementation(() => { throw new Error('offline'); });
    beacon.mockReturnValue(false);
    collect('game_loaded');
    flush();
    expect(waiting()).toBe(1);
  });

  it('caps the queue, keeps the opening, and says how many it dropped', () => {
    fetchMock.mockImplementation(() => { throw new Error('offline'); });
    beacon.mockReturnValue(false);
    for (let i = 0; i < MAX_QUEUE + 10; i++) collect('idle', { n: i });
    expect(waiting()).toBe(MAX_QUEUE);
    // The failed sends on the way up are not what this is about.
    fetchMock.mockClear();
    fetchMock.mockImplementation(() => Promise.resolve({ status: 204 }));
    // A failed send holds everything back for RETRY_MS, and books the next try for the end of it.
    vi.advanceTimersByTime(RETRY_MS);
    expect(waiting()).toBe(0);
    const batches = sent(fetchMock);
    // Several POSTs, none longer than the server will read: one 400-event body would be cut at 200.
    expect(batches.length).toBe(Math.ceil((MAX_QUEUE + 1) / MAX_SEND));
    expect(batches.every((b) => b.ok && b.batch.evs.length <= MAX_SEND)).toBe(true);
    const first = batches[0];
    const last = batches[batches.length - 1];
    // The oldest are still at the front: the opening is what no later event can tell us about.
    expect(first.ok && first.batch.evs[0].d).toEqual({ n: 0 });
    const tail = last.ok ? last.batch.evs[last.batch.evs.length - 1] : null;
    expect(tail).toMatchObject({ e: 'telemetry_dropped', d: { n: 10 } });
  });

  it('takes a batch back when the send fails after the browser took it', async () => {
    fetchMock.mockImplementation(() => Promise.resolve({ status: 503 }));
    collect('game_loaded');
    flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Handed over is not arrived: the browser took it and the collector was down behind it.
    await vi.advanceTimersByTimeAsync(0);
    expect(waiting()).toBe(1);
    // ...and nothing is tried again until the cooldown is up, however many events arrive meanwhile.
    for (let i = 0; i < MAX_BATCH + 5; i++) collect('idle', { n: i });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockImplementation(() => Promise.resolve({ status: 204 }));
    await vi.advanceTimersByTimeAsync(RETRY_MS);
    expect(waiting()).toBe(0);
  });

  it('never loses the count of what it dropped, not even with the batch carrying it', async () => {
    fetchMock.mockImplementation(() => { throw new Error('offline'); });
    beacon.mockReturnValue(false);
    for (let i = 0; i < MAX_QUEUE + 10; i++) collect('idle', { n: i });
    expect(waiting()).toBe(MAX_QUEUE);
    // The collector answers again but refuses this batch: all of it comes back, the marker with it, and
    // the marker is the newest event there is -- the first thing the cap throws away a second time.
    fetchMock.mockImplementation(() => Promise.resolve({ status: 503 }));
    await vi.advanceTimersByTimeAsync(RETRY_MS);
    expect(waiting()).toBe(MAX_QUEUE);
    fetchMock.mockClear();
    fetchMock.mockImplementation(() => Promise.resolve({ status: 204 }));
    await vi.advanceTimersByTimeAsync(RETRY_MS);
    expect(waiting()).toBe(0);
    const evs = sent(fetchMock).flatMap((b) => (b.ok ? b.batch.evs : []));
    const marks = evs.filter((e) => e.e === 'telemetry_dropped');
    expect(marks).toHaveLength(1);
    expect(marks[0].d).toEqual({ n: 10 });
  });

  it('post() says no when there is nothing to send', () => {
    expect(post([])).toBe(false);
  });
});
