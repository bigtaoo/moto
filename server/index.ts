// Our own telemetry collector: one small Node process that appends batches to a file.
//
// It runs on the box blight bloom owns, in its own compose project beside Potion Siege, Holy Kicker
// and fight, and apart from all of them (server/README.md). Ports 80 and 443 on that box belong to
// blight bloom's Caddy, so this publishes none: a cloudflared container dials out and Cloudflare
// serves https://dx.gamestao.com down that connection -- which is also what keeps `cf-connecting-ip`
// and `cf-ipcountry` arriving, the two headers limits.ts reads.
//
// Why a file. The reading we actually do is the low-traffic method (the `data-check` skill): twenty
// players a version, read one player's events in order. That is a day's file and a local script, not
// a database -- so the whole job here is to take a batch, check it, and put it down so a day can be
// read back whole. No schema to migrate, no row limit to outgrow, nothing running between requests.
//
// Endpoints
//   POST /c             a batch from the game (public; the address is in the build, so anyone sees it)
//   GET  /export?day=   that day's batches as NDJSON, exactly as stored (bearer EXPORT_TOKEN)
//   GET  /days          which days hold data (bearer EXPORT_TOKEN)
//   GET  /health        200 while the disk takes writes -- for the container healthcheck
//   GET  /              one line saying what this is
import { appendFileSync, createReadStream, existsSync, mkdirSync, readdirSync, statfsSync, statSync, unlinkSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import { addressOf, Budget, countryOf, readBody } from './limits.ts';
import { LIMITS, parseBatch, type Stored } from './wire.ts';

/** A day's file stops growing past this, so a flood cannot fill a disk three other games are on. */
const MAX_FILE = 512 * 1024 * 1024;
/** Free disk under this and /health says 503, which is what a healthcheck is there to catch. */
const MIN_FREE = 256 * 1024 * 1024;
/**
 * Day files older than this are deleted. Nothing is promised to anyone yet -- the game has no privacy
 * page -- but a portal will ask for one, and a retention we already keep is easier to write down than
 * one we have to start keeping. Checked on the first batch of each UTC day, so no cron is needed.
 */
const KEEP_DAYS = 430;
/** How often the address map is swept. Not the window itself -- that is RATE.window in limits.ts. */
const RATE_SWEEP_MS = 60_000;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const FILE = /^events-(\d{4}-\d{2}-\d{2})\.ndjson$/;

const dayOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

export interface Options {
  /** Where the day files live. Created if it is not there. */
  dir: string;
  /** Secret. Without one, /export and /days answer 404 -- no token, no door. */
  token?: string;
  /** Overridable so a test can reach the cap and the cutoff without half a gigabyte and a year. */
  maxFile?: number;
  keepDays?: number;
}

export function collector({ dir, token = '', maxFile = MAX_FILE, keepDays = KEEP_DAYS }: Options): Server {
  mkdirSync(dir, { recursive: true });
  const budget = new Budget();
  const fileFor = (day: string): string => join(dir, `events-${day}.ndjson`);

  // Nothing here runs between requests except this: a sweep of addresses nobody has used in a minute,
  // so the map cannot grow without end, and one line in the log when anyone was turned away.
  const sweeper = setInterval(() => {
    budget.sweep();
    if (budget.over) {
      console.log(`over budget: ${budget.over} request(s) refused, ${budget.size} address(es) tracked`);
      budget.over = 0;
    }
  }, RATE_SWEEP_MS);
  sweeper.unref();

  let prunedOn = '';
  /** Delete the day files from before the window, once per UTC day. */
  function prune(today: string): void {
    if (today === prunedOn) return;
    prunedOn = today;
    const cutoff = dayOf(Date.parse(`${today}T00:00:00Z`) - keepDays * 86_400_000);
    for (const name of readdirSync(dir)) {
      const m = FILE.exec(name);
      if (!m || m[1] >= cutoff) continue;
      try {
        unlinkSync(join(dir, name));
        console.log(`pruned ${name}`);
      } catch (e) {
        console.error(`could not prune ${name}: ${String(e)}`);
      }
    }
  }

  function sizeOf(file: string): number {
    try {
      return statSync(file).size;
    } catch {
      return 0;
    }
  }

  /** Store one batch, or say why not. Throws only if the disk does, which the caller turns into a 500. */
  function store(body: string, req: IncomingMessage, now: number): { ok: true } | { ok: false; why: string; status: number } {
    const parsed = parseBatch(body);
    if (!parsed.ok) return { ok: false, why: parsed.why, status: 400 };
    const day = dayOf(now);
    prune(day);
    const file = fileFor(day);
    if (sizeOf(file) > maxFile) return { ok: false, why: 'full', status: 507 };
    const stored: Stored = { ...parsed.batch, rt: now };
    const c = countryOf(req);
    if (c) stored.c = c;
    // One line per batch, and a line that cannot hold a newline of its own: JSON.stringify escapes
    // every one it finds, so a day stays readable with `wc -l` and `sed -n` whatever the client sent.
    appendFileSync(file, `${JSON.stringify(stored)}\n`);
    return { ok: true };
  }

  async function collect(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const head = cors(req);
    const addr = addressOf(req);
    const declared = Number(req.headers['content-length']);
    if (!budget.take(addr, Number.isFinite(declared) ? declared : 0)) {
      text(res, 429, 'slow down\n', { ...head, 'retry-after': '60' });
      return;
    }
    const body = await readBody(req, LIMITS.body, (n) => budget.add(addr, n));
    // Over the cap the body was never held: reading it whole first would buffer every byte of a
    // gigabyte post into this process before wire.ts got its say, and one of those is all it takes.
    if (body === null) {
      text(res, 413, 'too big\n', head);
      return;
    }
    let result: ReturnType<typeof store>;
    try {
      result = store(body, req, Date.now());
    } catch (e) {
      // A write that failed is ours, not the client's: 500 so the retry in src/collect.ts is worth
      // making, and a line in the log, because a collector answering 204 while writing nothing is the
      // worst outcome there is here.
      console.error(`store failed: ${String(e)}`);
      text(res, 500, 'sorry\n', head);
      return;
    }
    if (!result.ok) {
      text(res, result.status, `${result.why}\n`, head);
      return;
    }
    // Nothing to say back: the client never reads it, and a body would only cost the beacon time.
    res.writeHead(204, head);
    res.end();
  }

  /** The token is a secret of ours, not a user's: a plain compare, and a miss looks like a 404. */
  function guarded(req: IncomingMessage, res: ServerResponse): boolean {
    if (token && req.headers.authorization === `Bearer ${token}`) return true;
    text(res, 404, 'not found\n');
    return false;
  }

  /**
   * A day, as one NDJSON line per batch -- the same shape the pull script writes to disk and the trace
   * script reads. Streamed off the disk, so a busy day costs this process nothing to hand over.
   */
  function exportDay(res: ServerResponse, day: string): void {
    const file = fileFor(day);
    // A day with no file and a day with nothing in it are the same answer. 200, so a puller walking a
    // week of days does not have to tell a gap from a failure.
    if (!existsSync(file)) {
      text(res, 200, '', { 'content-type': 'application/x-ndjson' });
      return;
    }
    res.writeHead(200, { 'content-type': 'application/x-ndjson' });
    const stream = createReadStream(file);
    stream.on('error', (e) => {
      // The status line is long gone, so the only way to say it is to stop short; the log is where
      // this is actually noticed.
      console.error(`export ${day}: ${String(e)}`);
      res.end();
    });
    stream.pipe(res);
  }

  function days(res: ServerResponse): void {
    const found: string[] = [];
    for (const name of readdirSync(dir)) {
      const m = FILE.exec(name);
      if (m) found.push(m[1]);
    }
    text(res, 200, found.length ? `${found.sort().join('\n')}\n` : '');
  }

  /** Writable, with room left. A full disk is the failure this service has to survive on a shared box. */
  function health(res: ServerResponse): void {
    try {
      const { bavail, bsize } = statfsSync(dir);
      if (bavail * bsize < MIN_FREE) {
        text(res, 503, 'no room\n');
        return;
      }
      text(res, 200, 'ok\n');
    } catch (e) {
      console.error(`health: ${String(e)}`);
      text(res, 503, 'unreadable\n');
    }
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://collector');
    const path = url.pathname;
    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors(req));
      res.end();
      return;
    }
    if (req.method === 'POST' && path === '/c') {
      void collect(req, res);
      return;
    }
    if (req.method === 'GET' && path === '/health') return health(res);
    if (req.method === 'GET' && path === '/export') {
      if (!guarded(req, res)) return;
      const day = url.searchParams.get('day') ?? '';
      if (!DAY.test(day)) return text(res, 400, 'day=YYYY-MM-DD\n');
      return exportDay(res, day);
    }
    if (req.method === 'GET' && path === '/days') {
      if (!guarded(req, res)) return;
      return days(res);
    }
    if (req.method === 'GET' && path === '/') return text(res, 200, 'dummy brawl telemetry collector\n');
    text(res, 404, 'not found\n');
  });
  server.on('close', () => clearInterval(sweeper));
  // A client that opens a socket and says nothing is holding a file descriptor; the body timeout in
  // limits.ts only starts once there is a request to read.
  server.headersTimeout = 15_000;
  server.requestTimeout = 30_000;
  return server;
}

/** The game posts from a portal's page, cross-origin, and never reads the answer. */
function cors(req: IncomingMessage): Record<string, string> {
  const origin = req.headers.origin;
  return {
    // The Origin echoed rather than `*`: `sendBeacon` always sends credentialed, and a credentialed
    // request against `*` fails the browser's own check. The batch still arrives -- the check is on
    // the answer -- but it fails loudly in every console, and the exit flush is the send we most need.
    'access-control-allow-origin': typeof origin === 'string' && origin ? origin : '*',
    'access-control-allow-methods': 'POST,OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
    // Without this a cache that saw one page's answer would hand it to the next page's browser, with
    // the wrong Origin in it.
    vary: 'origin',
  };
}

function text(res: ServerResponse, status: number, body: string, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'content-type': 'text/plain;charset=utf-8', ...headers });
  res.end(body);
}
