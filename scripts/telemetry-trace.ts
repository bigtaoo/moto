// Read what scripts/telemetry-pull.ts brought down the way the data-check skill says to: one player at
// a time, in order, not as an average. At twenty players a version an average is a number with nothing
// behind it; a trace says where a person stopped. The judgements this rests on -- what counts as a
// crawler, where a session ended, what the funnel's steps are -- are in scripts/telemetry-read.ts.
//
// Usage:
//   npx tsx scripts/telemetry-trace.ts                       every day on disk, one line per session
//   npx tsx scripts/telemetry-trace.ts 2026-11-25            one day
//   npx tsx scripts/telemetry-trace.ts --v 0.2.0+e348781     only that build
//   npx tsx scripts/telemetry-trace.ts --trace               every session's events, in order
//   npx tsx scripts/telemetry-trace.ts --sid ab12cd34ef5     one session's (or one player's) events
//   npx tsx scripts/telemetry-trace.ts --bots --unfocused    keep the sessions left out by default
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  STEPS, bot, dur, ending, facts, lost, machine, median, names, own, quantile, secs, sessions, unfocused,
  type Session,
} from './telemetry-read.ts';

const DIR = 'telemetry-archive/self';

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? undefined : args[i + 1];
};
const has = (name: string): boolean => args.includes(`--${name}`);
const onlyV = flag('v');
const onlySid = flag('sid');
const days = args.filter((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));

function load(): Session[] {
  if (!existsSync(DIR)) {
    console.error(`nothing in ${DIR} -- run scripts/telemetry-pull.ts first`);
    process.exit(2);
  }
  const files = readdirSync(DIR)
    .filter((f) => f.endsWith('.ndjson'))
    .filter((f) => !days.length || days.includes(f.slice(0, 10)))
    .sort();
  return sessions(files.flatMap((f) => readFileSync(join(DIR, f), 'utf8').split('\n')));
}

/** The columns `line` fills, padded the same way, so the two cannot drift out of alignment. */
const HEAD = [
  'sid'.padEnd(12), 'build'.padEnd(10), 'player'.padEnd(12), 'time'.padStart(5),
  'events'.padEnd(7), 'lost'.padEnd(8), 'machine'.padEnd(38), 'ended',
].join('  ');

function line(s: Session): string {
  const gap = lost(s);
  return [
    s.sid.padEnd(12),
    s.v.padEnd(10).slice(0, 10),
    (s.uid ?? '(no save)').padEnd(12),
    secs(dur(s)).padStart(5),
    `${String(s.evs.length).padStart(4)} ev`,
    gap ? `-${gap} batch` : '        ',
    `${machine(s)}${unfocused(s) ? ' unfocused' : ''}`.padEnd(38).slice(0, 38),
    ending(s),
  ].join('  ');
}

function trace(s: Session): void {
  console.log(`
=== ${s.sid}  ${s.v}  ${s.uid ?? '(no save)'}  ${machine(s)}`);
  for (const e of s.evs) {
    // The common fields are on every event and say the same thing every time: show the event's own.
    const d = own(e);
    console.log(`  ${secs(e.s).padStart(6)}  ${e.e}${Object.keys(d).length ? ` ${JSON.stringify(d)}` : ''}`);
  }
}

function funnel(all: Session[]): void {
  if (!all.length) return;
  console.log(`\nfunnel (${all.length} sessions)`);
  let prev = all.length;
  for (const { label, reached } of STEPS) {
    const times = all.map(reached).filter((e) => !!e).map((e) => e.s);
    const pct = Math.round((times.length * 100) / all.length);
    // The drop is against the step above, which is where a change has to be aimed.
    const drop = prev - times.length;
    console.log(
      `  ${label.padEnd(13)} ${String(times.length).padStart(3)}  ${String(pct).padStart(3)}%  ` +
        `${(drop > 0 ? `-${drop}` : '').padStart(4)}  median ${times.length ? secs(median(times)) : '-'}`,
    );
    prev = times.length;
  }
}

const all = load();
if (!all.length) {
  console.log('no sessions in the days on disk');
  process.exit(0);
}

const bots = all.filter(bot);
const dark = all.filter((s) => !bot(s) && unfocused(s));
let shown = all.filter((s) => (has('bots') || !bot(s)) && (has('unfocused') || !unfocused(s)));
if (onlyV) shown = shown.filter((s) => s.v === onlyV);
if (onlySid) shown = shown.filter((s) => s.sid === onlySid || s.uid === onlySid);
shown.sort((a, b) => a.v.localeCompare(b.v) || dur(a) - dur(b));

if (onlySid || has('trace')) {
  for (const s of shown) trace(s);
} else {
  console.log(HEAD);
  for (const s of shown) console.log(line(s));
}

const byV = new Map<string, Session[]>();
for (const s of shown) byV.set(s.v, [...(byV.get(s.v) ?? []), s]);
console.log('');
for (const [v, ss] of [...byV].sort()) {
  const times = ss.map(dur);
  const players = new Set(ss.map((s) => s.uid).filter(Boolean)).size;
  const loaded = ss.filter((s) => names(s).has('game_loaded')).length;
  const tapped = ss.filter((s) => names(s).has('first_input')).length;
  // `new_player` is the save's own count: false means this was not their first session, whenever the
  // first one was. `days` (0..30) is how long ago that first one was, for the ones who came back.
  const back = ss.filter((s) => facts(s).new_player === false);
  const since = back.map((s) => facts(s).days).filter((d) => typeof d === 'number');
  console.log(
    `${v}: ${ss.length} sessions, ${players} players, ${back.length} had played before` +
      `${since.length ? ` (median ${median(since)} days ago)` : ''}, ` +
      `${loaded} reached a first frame, ${ss.length - tapped} never touched it, ` +
      `median ${secs(median(times))}, p75 ${secs(quantile(times, 0.75))}`,
  );
}
const out = [
  bots.length && !has('bots') ? `${bots.length} crawler session(s) (--bots)` : '',
  dark.length && !has('unfocused') ? `${dark.length} background tab(s) that never held the focus (--unfocused)` : '',
].filter(Boolean);
if (out.length) console.log(`(left out: ${out.join(', ')})`);
funnel(shown);
