// After `vite build`: fails if the shipped JavaScript (gzipped) or the whole build grows past its budget,
// so a heavy dependency or an asset dump doesn't slip into the upload unnoticed.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const DIST = process.argv[2] ?? 'dist';
const JS_GZ_KB = 260;
const TOTAL_MB = 6;

// A chunk named after a two-letter language code (src/i18n/more.ts) is one language's words. A player
// downloads exactly one of them, so only the heaviest counts against the budget, not all fifteen.
const LANG = /^[a-z]{2}-[A-Za-z0-9_-]+\.js$/;

let js = 0;
let lang = 0;
let total = 0;
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { walk(p); continue; }
    const buf = readFileSync(p);
    total += buf.length;
    if (!name.endsWith('.js')) continue;
    const gz = gzipSync(buf).length;
    if (LANG.test(name)) lang = Math.max(lang, gz);
    else js += gz;
  }
}
walk(DIST);
const jsKb = (js + lang) / 1024;
const totalMb = total / 2 ** 20;
console.log(`bundle: ${jsKb.toFixed(0)} kB js (gzip, budget ${JS_GZ_KB}; ${(lang / 1024).toFixed(0)} kB of it the heaviest language), ${totalMb.toFixed(2)} MB total (budget ${TOTAL_MB})`);
if (jsKb > JS_GZ_KB || totalMb > TOTAL_MB) {
  console.error('bundle over budget');
  process.exit(1);
}
