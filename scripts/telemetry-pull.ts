// Pull a day (or every day) out of our own collector and keep it on disk as NDJSON, one batch a line --
// exactly the lines the box stores, so a build's data outlives the thirty days of backup on it.
//
// Usage (the token is DX_EXPORT_TOKEN from the box's /home/deploy/dummy-brawl/.env):
//   TELEMETRY_TOKEN=... npx tsx scripts/telemetry-pull.ts            the day being written to
//   ... scripts/telemetry-pull.ts 2026-11-25                         one day
//   ... scripts/telemetry-pull.ts all                                every day the collector has
//   ... scripts/telemetry-pull.ts all --force                        re-pull days already on disk
//   COLLECTOR=http://127.0.0.1:8899 ... scripts/telemetry-pull.ts    a collector run locally
//
// A day already on disk is skipped, except today's: today is still being written to, so it is always
// pulled again. Read what lands here with scripts/telemetry-trace.ts.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = 'telemetry-archive/self';
const DAY = /^\d{4}-\d{2}-\d{2}$/;

// The address is in the build and public either way (server/README.md); the token is the whole door.
const base = (process.env.COLLECTOR ?? 'https://dx.gamestao.com').replace(/\/+$/, '');
const token = process.env.TELEMETRY_TOKEN ?? '';
if (!token) {
  console.error('set TELEMETRY_TOKEN (DX_EXPORT_TOKEN from /home/deploy/dummy-brawl/.env on the box)');
  process.exit(2);
}

const args = process.argv.slice(2);
const force = args.includes('--force');
const asked = args.filter((a) => !a.startsWith('--'));

async function fetchText(path: string): Promise<string> {
  const res = await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${token}` } });
  // A wrong token answers 404 on purpose (server/index.ts), so say both things it can mean.
  if (!res.ok) throw new Error(`${path}: ${res.status} ${res.statusText}${res.status === 404 ? ' (wrong token, or no such day)' : ''}`);
  return res.text();
}

const today = new Date().toISOString().slice(0, 10);

let days: string[];
if (asked.length && asked[0] !== 'all') {
  days = asked;
  for (const d of days) if (!DAY.test(d)) throw new Error(`not a day: ${d}`);
} else {
  days = (await fetchText('/days')).split('\n').map((l) => l.trim()).filter((l) => DAY.test(l));
  if (!asked.length) days = days.slice(-1);
}
if (!days.length) {
  console.log('the collector has nothing yet');
  process.exit(0);
}

mkdirSync(OUT, { recursive: true });
for (const day of days) {
  const file = join(OUT, `${day}.ndjson`);
  if (existsSync(file) && !force && day !== today) {
    console.log(`${day}  already here (--force to re-pull)`);
    continue;
  }
  const body = await fetchText(`/export?day=${day}`);
  const lines = body.split('\n').filter(Boolean);
  // The export streams: it answers 200 before it has read anything, so a failure arrives as a line.
  const broken = lines.filter((l) => l.startsWith('{"error"'));
  writeFileSync(file, lines.length ? `${lines.join('\n')}\n` : '');
  const sessions = new Set(lines.map((l) => (JSON.parse(l) as { sid?: string }).sid).filter(Boolean)).size;
  console.log(`${day}  ${lines.length} batches, ${sessions} sessions -> ${file}${broken.length ? `  ${broken[0]}` : ''}`);
  if (broken.length) process.exitCode = 1;
}

const kept = days.map((d) => join(OUT, `${d}.ndjson`)).filter((f) => existsSync(f));
const bytes = kept.reduce((n, f) => n + readFileSync(f).length, 0);
console.log(`${kept.length} day(s) on disk, ${(bytes / 1024).toFixed(0)} kB`);
