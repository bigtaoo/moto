// Our own telemetry collector: one Cloudflare Worker in front of one R2 bucket.
// Deploy: npx wrangler deploy -c wrangler/collect.jsonc   (config, bindings and secrets are documented there)
//
// Why this shape. The reading we actually do is the low-traffic method (the `data-check` skill):
// twenty players a version, read one player's events in order. That is a `list` with a day's prefix and a
// local script, not a database — so the server's whole job is to take a batch, check it, and put it down
// where a day can be pulled back whole. No schema to migrate, no row limit to outgrow, nothing to keep
// running between requests.
//
// Endpoints
//   POST /c             a batch from the game (public; this address is in the build, so anyone can see it)
//   GET  /export?day=   a day's batches as NDJSON (bearer EXPORT_TOKEN); &after= carries on past a cut
//   GET  /days          which days hold data (bearer EXPORT_TOKEN)
//   GET  /              one line saying what this is
import { key, LIMITS, parseBatch, type Stored } from './wire';

export interface Env {
  /** The bucket every batch lands in. */
  RAW: R2Bucket;
  /** Optional rate limit, keyed per address, so one page cannot fill the bucket. */
  LIMIT?: RateLimit;
  /** Secret. Without it set, /export and /days answer 404 — no token, no door. */
  EXPORT_TOKEN?: string;
  /** Optional comma-separated host allowlist for POSTs (`crazygames.com,playgama.ai`). Empty: any. */
  ORIGINS?: string;
}

/** The game sends from a portal's page, cross-origin, and never reads the answer. */
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST,OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '86400',
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function text(body: string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/plain;charset=utf-8', ...headers } });
}

/**
 * `https://sub.crazygames.com` matches `crazygames.com`; nothing else does. The list is a filter against
 * junk rather than a lock: the address is in the build, so anyone who opens the game can post to it with
 * whatever Origin they like, and what actually keeps the bucket clean is wire.ts.
 */
function allowed(origin: string | null, list: string): boolean {
  if (!list.trim()) return true;
  // No Origin at all -- a beacon from a page that is already gone -- and the literal "null" a sandboxed
  // iframe sends, which is most portals: both mean the browser would not say, not that it said something
  // else. Turning those away would throw out every batch from a `sandbox`ed embed.
  if (!origin || origin === 'null') return true;
  let host: string;
  try {
    host = new URL(origin).hostname;
  } catch {
    return false;
  }
  return list
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
    .some((h) => host === h || host.endsWith(`.${h}`));
}

function guarded(request: Request, env: Env): Response | null {
  if (!env.EXPORT_TOKEN) return text('not found\n', 404);
  const given = request.headers.get('authorization') ?? '';
  // The token is a secret of ours, not a user's: a plain compare is enough, and a miss looks like a 404
  // so the endpoint does not advertise itself.
  return given === `Bearer ${env.EXPORT_TOKEN}` ? null : text('not found\n', 404);
}

/**
 * The body as text, or null once it is over `max` bytes. The declared length is only a hint -- it can be
 * missing or a lie -- so it is the running count that decides, and the rest of the upload is cancelled
 * rather than drained. Bytes, not characters: `max` is what the stored JSON is measured in.
 */
async function readCapped(request: Request, max: number): Promise<string | null> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) return null;
  const body = request.body;
  if (!body) return '';
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let out = '';
  let seen = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    seen += value.byteLength;
    if (seen > max) {
      await reader.cancel();
      return null;
    }
    out += decoder.decode(value, { stream: true });
  }
  return out + decoder.decode();
}

async function collect(request: Request, env: Env): Promise<Response> {
  if (!allowed(request.headers.get('origin'), env.ORIGINS ?? '')) return text('no\n', 403, CORS);
  if (env.LIMIT) {
    // Per address, and only as a loose filter: the binding counts per edge location, so a real flood
    // from many places still gets through. It is here to stop one page in a loop.
    const ip = request.headers.get('cf-connecting-ip') ?? 'none';
    const { success } = await env.LIMIT.limit({ key: ip });
    if (!success) return text('slow down\n', 429, CORS);
  }
  const body = await readCapped(request, LIMITS.body);
  // Over the cap the body was never held: `request.text()` would have buffered every byte of a gigabyte
  // post into the isolate's 128 MB before wire.ts got its say, and one of those is all it takes.
  if (body === null) return text('too big\n', 413, CORS);
  const parsed = parseBatch(body);
  if (!parsed.ok) return text(`${parsed.why}\n`, 400, CORS);
  const rt = Date.now();
  const stored: Stored = { ...parsed.batch, rt };
  const country = (request as { cf?: IncomingCf }).cf?.country;
  if (country) stored.c = country;
  await env.RAW.put(key(parsed.batch, rt), JSON.stringify(stored));
  // Nothing to say back: the client never reads it, and a body would only cost the beacon time.
  return new Response(null, { status: 204, headers: CORS });
}

/**
 * How many batches one /export hands back. Every R2 read is a subrequest, and a Worker gets 1000 of them
 * per request on the Paid plan and 50 on Free — a day with more objects than that cannot come back in one
 * answer whatever we do here, so it comes back in pieces instead: the last line of a cut-short export is
 * `{"more":"<key>"}` and the puller asks again with `&after=<that key>`. The number is held well under the
 * Paid budget to leave room for the `list` calls that go with it.
 */
const EXPORT_MAX = 900;

/**
 * A day, as one NDJSON line per batch — the same shape the pull script writes to disk and the trace
 * script reads. Streamed, because a busy day is tens of thousands of objects and a Worker holds no
 * more than its memory. `after` is a key from an earlier `{"more":...}` line: carry on past it.
 */
function exportDay(env: Env, day: string, after: string): Response {
  const stream = new TransformStream<Uint8Array, Uint8Array>();
  const writer = stream.writable.getWriter();
  const encoder = new TextEncoder();
  void (async () => {
    // The last key actually written out, which is what a follow-up asks to carry on from. It is tracked
    // outside the try because a read that breaks halfway has to say where it got to as well.
    let last = '';
    try {
      const prefix = `v1/${day}/`;
      const all: string[] = [];
      let cursor: string | undefined;
      let from = after;
      do {
        const page = await env.RAW.list({ prefix, cursor, limit: 1000, ...(from ? { startAfter: from } : {}) });
        for (const o of page.objects) all.push(o.key);
        from = ''; // startAfter is where the walk begins, the cursor carries it on from there
        cursor = page.truncated ? page.cursor : undefined;
      } while (cursor && all.length < EXPORT_MAX);
      all.sort();
      let more = !!cursor;
      if (all.length > EXPORT_MAX) {
        all.length = EXPORT_MAX;
        more = true;
      }
      // A few at a time: R2 is fast but one round trip per object would make a big day crawl, and
      // unbounded concurrency is how a Worker runs out of its subrequest budget.
      for (let i = 0; i < all.length; i += 20) {
        const slice = all.slice(i, i + 20);
        const chunk = await Promise.all(slice.map((k) => env.RAW.get(k).then((o) => o?.text())));
        const lines = chunk.filter((t): t is string => !!t).map((t) => `${t.replace(/\n/g, ' ')}\n`);
        if (lines.length) await writer.write(encoder.encode(lines.join('')));
        last = slice[slice.length - 1] ?? last;
      }
      // A day of exactly EXPORT_MAX costs one extra, empty follow-up. Cheaper than a short day read as
      // a whole one.
      if (more) await writer.write(encoder.encode(`${JSON.stringify({ more: last })}\n`));
    } catch (e) {
      // The status line is long gone; say it in the body so a truncated pull is not read as a short day,
      // and say where it stopped so the puller can pick it up rather than start over.
      await writer.write(encoder.encode(`${JSON.stringify({ error: String(e), more: last })}\n`));
    } finally {
      // A reader that has already gone away makes this throw, and there is nobody left to tell.
      try {
        await writer.close();
      } catch {
        /* nothing to do about it */
      }
    }
  })();
  return new Response(stream.readable, { headers: { 'content-type': 'application/x-ndjson' } });
}

/**
 * Which days have anything. One `list` per 1000 days rather than per 1000 objects: the delimiter makes
 * R2 fold every key under `v1/<day>/` into the one prefix, so a year of data is a single round trip
 * instead of a walk over every batch ever stored.
 */
async function days(env: Env): Promise<Response> {
  const seen = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await env.RAW.list({ prefix: 'v1/', delimiter: '/', cursor, limit: 1000 });
    for (const p of page.delimitedPrefixes ?? []) seen.add(p.slice(3).replace(/\/$/, ''));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return text(`${[...seen].sort().join('\n')}\n`);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (request.method === 'POST' && url.pathname === '/c') return collect(request, env);
    if (request.method === 'GET' && url.pathname === '/export') {
      const no = guarded(request, env);
      if (no) return no;
      const day = url.searchParams.get('day') ?? '';
      if (!DAY.test(day)) return text('day=YYYY-MM-DD\n', 400);
      return exportDay(env, day, url.searchParams.get('after') ?? '');
    }
    if (request.method === 'GET' && url.pathname === '/days') return guarded(request, env) ?? days(env);
    if (request.method === 'GET' && url.pathname === '/') return text('dummy brawl telemetry collector\n');
    return text('not found\n', 404);
  },
};
