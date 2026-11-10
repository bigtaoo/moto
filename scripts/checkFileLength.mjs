// Fails if a source file is over MAX_LINES. A file that was already over when the rule came in is held
// at its count in BASELINE: it may shrink (lower its number here when it does) but never grow, and it
// leaves the list once it is split down to MAX_LINES or under.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_LINES = 500;
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIRS = ['src', 'scripts'];
const EXTS = ['.ts', '.mts', '.mjs', '.js', '.py', '.css', '.html'];
/** Over the limit as of 2026-11-10, waiting to be split. */
const BASELINE = { 'src/sim/world.ts': 1422 };

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (EXTS.some((e) => name.endsWith(e))) yield p;
  }
}

const errors = [];
for (const d of DIRS) {
  for (const file of walk(join(ROOT, d))) {
    const rel = relative(ROOT, file).split(sep).join('/');
    const text = readFileSync(file, 'utf8');
    const n = text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
    const max = BASELINE[rel] ?? MAX_LINES;
    if (n > max) errors.push(`${rel}: ${n} lines (max ${max})`);
    else if (BASELINE[rel] && n < BASELINE[rel]) console.log(`${rel} is down to ${n}: lower its BASELINE entry`);
  }
}
if (errors.length) {
  console.error(`File length (max ${MAX_LINES} lines):\n  ${errors.join('\n  ')}`);
  process.exit(1);
}
console.log(`file length ok (<= ${MAX_LINES} lines; ${Object.keys(BASELINE).length} older file held at its baseline)`);
