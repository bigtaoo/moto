import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collector, type Options } from './index.ts';
import type { Stored } from './wire.ts';

// A real server on a real port against a real directory. Nothing here is mocked: the whole point of
// moving off the Worker was that the storage is now a file, and a fake file system would only prove
// that the fake behaves. One temp directory per test, thrown away after.

const TOKEN = 'test-token';

let dir: string;
let base: string;
let server: ReturnType<typeof collector>;

async function start(options: Partial<Options> = {}): Promise<void> {
  server = collector({ dir, token: TOKEN, ...options });
  await new Promise<void>((up) => server.listen(0, '127.0.0.1', up));
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
}

/** Close the one `beforeEach` started and put another in its place, with different caps. */
async function restart(options: Partial<Options>): Promise<void> {
  await new Promise((done) => server.close(done));
  await start(options);
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'collect-'));
  await start();
});

afterEach(async () => {
  await new Promise((done) => server.close(done));
  rmSync(dir, { recursive: true, force: true });
});

const today = (): string => new Date().toISOString().slice(0, 10);
const dayFile = (day = today()): string => join(dir, `events-${day}.ndjson`);
const lines = (day = today()): Stored[] =>
  readFileSync(dayFile(day), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as Stored);

const body = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({ sid: 'ab12cd34ef5', v: '0.0.42', n: 0, t: 1, evs: [{ e: 'load', i: 0, s: 1, t: 1 }], ...over });

const post = (text: string, headers: Record<string, string> = {}): Promise<Response> =>
  fetch(`${base}/c`, { method: 'POST', body: text, headers: { 'content-type': 'text/plain', ...headers } });

const read = (path: string, token: string | null = TOKEN): Promise<Response> =>
  fetch(`${base}${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });

describe('taking a batch', () => {
  it('writes one line per batch and says nothing back', async () => {
    const r = await post(body());
    expect(r.status).toBe(204);
    expect(await r.text()).toBe('');
    await post(body({ n: 1 }));
    const all = lines();
    expect(all).toHaveLength(2);
    expect(all[0].sid).toBe('ab12cd34ef5');
    expect(all[0].evs[0].e).toBe('load');
    // The server's own clock, which is what a day is grouped by: the client's `t` is not trusted for it.
    expect(all[0].rt).toBeGreaterThan(1_700_000_000_000);
    expect(all[1].n).toBe(1);
  });

  it('keeps the country the edge put on it, and nothing else about where it came from', async () => {
    await post(body(), { 'cf-ipcountry': 'DE', 'cf-connecting-ip': '203.0.113.9' });
    const [one] = lines();
    expect(one.c).toBe('DE');
    // The address is used for the minute's counting and is never written down.
    expect(JSON.stringify(one)).not.toContain('203.0.113');
  });

  it('leaves the country off when the edge did not say', async () => {
    await post(body(), { 'cf-ipcountry': 'XX' });
    expect(lines()[0].c).toBeUndefined();
  });

  it('refuses what wire.ts will not have, without storing it', async () => {
    const r = await post(JSON.stringify({ sid: 'nope!', v: '1', n: 0, t: 1, evs: [] }));
    expect(r.status).toBe(400);
    expect(readdirSync(dir)).toHaveLength(0);
  });

  it('refuses a body over the cap before reading it', async () => {
    const r = await post(body({ pad: 'x'.repeat(100_000) }));
    expect(r.status).toBe(413);
    expect(readdirSync(dir)).toHaveLength(0);
  });

  it('stops taking batches once the day is as big as we are willing to keep', async () => {
    await restart({ maxFile: 200 });
    // The first is always taken: the cap is on what is already down, so a day is never refused empty.
    expect((await post(body())).status).toBe(204);
    expect((await post(body({ n: 1 }))).status).toBe(204);
    const r = await post(body({ n: 2 }));
    expect(r.status).toBe(507);
    expect(lines()).toHaveLength(2);
  });

  it('turns one address away once it has had its minute', async () => {
    // Ten, not the real 240. This used to send RATE.reqs + 5 = 245 requests one after another at a
    // window only 60 seconds wide: four seconds on an idle machine, and on a busy one it outruns the
    // window outright, which hands the address a fresh budget and fails the test over its own running
    // time. The real number is already tested where it can be tested instantly -- limits.test.ts
    // walks Budget to RATE.reqs with an injected clock. What is left for a real socket to prove is
    // that the server wires that refusal to a 429 with a retry-after, and ten is plenty for that.
    const cap = 10;
    await restart({ maxReqs: cap });
    let refused = 0;
    for (let i = 0; i < cap + 5; i++) {
      const r = await post(body({ n: i }), { 'cf-connecting-ip': '198.51.100.7' });
      if (r.status === 429) {
        refused++;
        expect(r.headers.get('retry-after')).toBe('60');
      }
    }
    expect(refused).toBe(5);
    // ...and only that address: the next one starts with its own budget.
    expect((await post(body(), { 'cf-connecting-ip': '198.51.100.8' })).status).toBe(204);
  });
});

describe('answering the browser', () => {
  it('echoes the Origin rather than a star, so a credentialed beacon passes the check', async () => {
    const r = await post(body(), { origin: 'https://playgama.com' });
    expect(r.headers.get('access-control-allow-origin')).toBe('https://playgama.com');
    expect(r.headers.get('vary')).toBe('origin');
  });

  it('answers a preflight without one', async () => {
    const r = await fetch(`${base}/c`, { method: 'OPTIONS', headers: { origin: 'https://crazygames.com' } });
    expect(r.status).toBe(204);
    expect(r.headers.get('access-control-allow-origin')).toBe('https://crazygames.com');
    expect(r.headers.get('access-control-allow-headers')).toContain('content-type');
  });
});

describe('reading it back', () => {
  it('hands a day back exactly as it was stored', async () => {
    await post(body());
    await post(body({ n: 1 }));
    const r = await read(`/export?day=${today()}`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('ndjson');
    const got = (await r.text()).trim().split('\n');
    expect(got).toHaveLength(2);
    expect(got.map((l) => (JSON.parse(l) as Stored).n)).toEqual([0, 1]);
  });

  it('reads an empty day the same as a missing one', async () => {
    const r = await read('/export?day=2020-01-01');
    expect(r.status).toBe(200);
    expect(await r.text()).toBe('');
  });

  it('wants a day that is a day', async () => {
    expect((await read('/export')).status).toBe(400);
    expect((await read('/export?day=yesterday')).status).toBe(400);
  });

  it('lists the days that hold something', async () => {
    writeFileSync(dayFile('2026-01-02'), '{}\n');
    writeFileSync(join(dir, 'notes.txt'), 'not a day');
    await post(body());
    const got = (await read('/days')).text();
    expect((await got).trim().split('\n')).toEqual(['2026-01-02', today()].sort());
  });

  it('is a 404 to anyone without the token, so it does not advertise itself', async () => {
    for (const path of ['/days', `/export?day=${today()}`]) {
      expect((await read(path, null)).status).toBe(404);
      expect((await read(path, 'wrong')).status).toBe(404);
    }
    // And with no token configured at all, the door is not there for us either.
    await restart({ token: '' });
    expect((await read('/days')).status).toBe(404);
  });
});

describe('the rest of it', () => {
  it('says what it is, and nothing about anything else', async () => {
    const root = await fetch(base);
    expect(root.status).toBe(200);
    expect(await root.text()).toContain('dummy brawl');
    expect((await fetch(`${base}/wp-admin`)).status).toBe(404);
    expect((await fetch(`${base}/c`)).status).toBe(404);
  });

  it('answers the healthcheck while the disk takes writes', async () => {
    const r = await fetch(`${base}/health`);
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('ok');
  });

  it('drops the days that are past the window, on the first batch of a day', async () => {
    await restart({ keepDays: 30 });
    const old = new Date(Date.now() - 40 * 86_400_000).toISOString().slice(0, 10);
    const recent = new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10);
    writeFileSync(dayFile(old), '{}\n');
    writeFileSync(dayFile(recent), '{}\n');
    await post(body());
    const left = readdirSync(dir).sort();
    expect(left).toEqual([`events-${recent}.ndjson`, `events-${today()}.ndjson`].sort());
  });
});
