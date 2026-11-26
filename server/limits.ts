// What the collector has to decide before it has read a byte of a body: who is asking, how much they
// have asked for already, and how to read a body without taking more than we agreed to. None of it is
// about telemetry -- it is the part that would be the same for any public POST endpoint -- which is why
// it is here rather than in index.ts, and why it is the part most worth testing on its own.

import type { IncomingMessage } from 'node:http';

/**
 * One address's budget per window. A session sends a batch every five seconds and a batch is about
 * 6 KB, so a whole family on one address is nowhere near this; a page stuck in a loop is.
 */
export const RATE = { reqs: 240, bytes: 1024 * 1024, window: 60_000 } as const;

/** A body not finished in this long is abandoned: a slow drip is how one client holds a socket open. */
export const BODY_MS = 20_000;

/**
 * Who is asking. The only way in is the Cloudflare tunnel, which sets `cf-connecting-ip`, so that
 * header is the address and not a guess -- nothing on the public internet can reach this port to set
 * it themselves. The value is used for the minute's counting and is never written down anywhere.
 */
export function addressOf(req: IncomingMessage): string {
  const cf = req.headers['cf-connecting-ip'];
  if (typeof cf === 'string' && cf) return cf;
  const fwd = req.headers['x-forwarded-for'];
  const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim();
  return first || req.socket.remoteAddress || 'none';
}

/**
 * The country Cloudflare put the request in, which is the one thing worth keeping about where a
 * player is. `XX` (unknown) and `T1` (Tor) are both real answers and neither is a place, so they are
 * dropped rather than stored as if they were.
 */
export function countryOf(req: IncomingMessage): string | undefined {
  const c = req.headers['cf-ipcountry'];
  if (typeof c !== 'string' || !/^[A-Z]{2}$/.test(c) || c === 'XX' || c === 'T1') return undefined;
  return c;
}

/**
 * A minute's budget per address, in requests and in bytes. In memory and nowhere else: it is a filter
 * against one page in a loop, not abuse prevention, and it costs a restart to forget -- which is the
 * right trade for never having an address on disk.
 */
export class Budget {
  private readonly seen = new Map<string, { reqs: number; bytes: number; until: number }>();
  /** How many addresses went over since the last report, for the one log line a minute. */
  over = 0;

  /**
   * `reqs`: the per-window request cap, overridable the way index.ts's `maxFile` and `keepDays` are,
   * so a test can be turned away without sending 245 requests at a 60-second window -- a loop that
   * takes four seconds idle and outruns the window outright on a busy machine, failing for the one
   * reason the test is not about.
   */
  private readonly reqs: number;

  constructor(reqs: number = RATE.reqs) {
    this.reqs = reqs;
  }

  /** True while this address may be served. `bytes` is charged up front from `content-length`. */
  take(addr: string, bytes: number, now = Date.now()): boolean {
    let e = this.seen.get(addr);
    if (!e || e.until <= now) {
      e = { reqs: 0, bytes: 0, until: now + RATE.window };
      this.seen.set(addr, e);
    }
    e.reqs++;
    e.bytes += bytes;
    const ok = e.reqs <= this.reqs && e.bytes <= RATE.bytes;
    if (!ok) this.over++;
    return ok;
  }

  /** Charge what arrived past the declared length. A lying `content-length` is charged either way. */
  add(addr: string, bytes: number, now = Date.now()): void {
    const e = this.seen.get(addr);
    if (e && e.until > now) e.bytes += bytes;
  }

  /** Drop the windows that have run out. Called on a timer: the map is the only thing that grows. */
  sweep(now = Date.now()): void {
    for (const [k, e] of this.seen) if (e.until <= now) this.seen.delete(k);
  }

  get size(): number {
    return this.seen.size;
  }
}

/**
 * The body as text, or null once it is over `max` bytes or takes too long. The declared length is a
 * hint that can be missing or a lie, so it is the running count that decides, and what arrives past
 * the cap is never held: `request.text()`-shaped code buffers every byte of a gigabyte post first,
 * and one of those is all it takes on a 4 GB box.
 */
export function readBody(req: IncomingMessage, max: number, onBytes?: (n: number) => void): Promise<string | null> {
  return new Promise((resolve) => {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > max) {
      resolve(null);
      return;
    }
    const chunks: Buffer[] = [];
    let seen = 0;
    let done = false;
    const finish = (value: string | null): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      req.removeAllListeners('data');
      resolve(value);
    };
    const timer = setTimeout(() => {
      finish(null);
      req.destroy();
    }, BODY_MS);
    req.on('data', (c: Buffer) => {
      seen += c.length;
      onBytes?.(c.length);
      if (seen > max) {
        finish(null);
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => finish(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => finish(null));
    req.on('aborted', () => finish(null));
  });
}
