import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The sim must give the same result on every machine from the same seed and inputs (replays now,
// online races later). Scans src/sim for calls whose result can differ between JS engines or runs,
// and for anything from the render side. Comments and strings are blanked first, so prose quoting a
// rule does not trip it. Every allowlist entry carries its reason and must stay in use.

const BANNED: readonly { pattern: RegExp; why: string }[] = [
  { pattern: /\bMath\.random\s*\(/, why: 'use a Prng stream' },
  { pattern: /\bMath\.(?:sqrt|cbrt|hypot)\s*\(/, why: 'keep to + - * /: compare squared distances' },
  { pattern: /\bMath\.(?:sin|cos|tan|asin|acos|atan2?|sinh|cosh|tanh)\s*\(/, why: 'trig is not bit-identical across engines' },
  { pattern: /\bMath\.(?:log2?|log10|log1p|exp|expm1|pow)\s*\(/, why: 'transcendental: not bit-identical across engines' },
  { pattern: /\*\*/, why: 'exponentiation goes through pow: multiply instead' },
  { pattern: /\bDate\b|\bperformance\b|\bsetTimeout\b|\bsetInterval\b|\brequestAnimationFrame\b/, why: 'clocks: the sim advances on ticks' },
  { pattern: /\bwindow\b|\bdocument\b|\bnavigator\b|\blocalStorage\b/, why: 'browser: the sim knows nothing of the host' },
  { pattern: /\bfor\s*\(\s*(?:const|let|var)\s+[\w$]+\s+in\b/, why: 'for…in walks keys in insertion order: loop over an array' },
  { pattern: /\bObject\.(?:keys|values|entries)\s*\(/, why: 'key order is insertion order: loop over an array' },
  { pattern: /\.sort\s*\(/, why: 'a sort needs a comparator with a total order (a last tiebreak): allowlist it with the reason' },
];

const ALLOWED: readonly { file: string; pattern: RegExp; why: string }[] = [
  { file: 'config.ts', pattern: /upgradeCost = .*1\.6 \*\* level/, why: 'a shop price between races, never race state' },
  { file: 'hash.ts', pattern: /Object\.keys\(v as object\)/, why: 'the state hash walks fields in creation order, which the code that builds them fixes' },
  { file: 'world.ts', pattern: /\.sort\(\(a, b\) => b\.z - a\.z \|\| a\.id - b\.id\)/, why: 'ties broken by rider id' },
];

/** Blanks comments and string literals, keeping line breaks so line numbers stay true. */
export function strip(src: string): string {
  let out = '';
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const n = src[i + 1];
    if (c === '/' && n === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && n === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) out += src[i++] === '\n' ? '\n' : ' ';
      i++;
    } else if (c === "'" || c === '"' || c === '`') {
      out += c;
      for (i++; i < src.length && src[i] !== c; i++) {
        if (src[i] === '\\') i++;
        out += src[i] === '\n' ? '\n' : ' ';
      }
      out += c;
    } else out += c;
  }
  return out;
}

const files = readdirSync(__dirname)
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
  .map((f) => {
    const text = readFileSync(join(__dirname, f), 'utf8');
    return { rel: f, text, code: strip(text) };
  });

describe('determinism lint', () => {
  it('scans the sim sources', () => {
    expect(files.map((f) => f.rel)).toEqual(expect.arrayContaining(['world.ts', 'ai.ts', 'config.ts', 'rng.ts', 'hash.ts', 'replay.ts']));
  });

  it('finds no banned call outside the allowlist', () => {
    const found: string[] = [];
    for (const f of files) {
      f.code.split('\n').forEach((line, i) => {
        for (const b of BANNED) {
          if (!b.pattern.test(line)) continue;
          if (ALLOWED.some((a) => a.file === f.rel && a.pattern.test(line))) continue;
          found.push(`${f.rel}:${i + 1} ${line.trim()}  (${b.why})`);
        }
      });
    }
    expect(found).toEqual([]);
  });

  it('imports only from the sim itself (no three, no view, no DOM code)', () => {
    const outside = files.flatMap((f) =>
      [...f.text.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map((m) => m[1]).filter((m) => !m.startsWith('./')).map((m) => `${f.rel}: ${m}`));
    expect(outside).toEqual([]);
  });

  it('keeps every allowlist entry in use', () => {
    for (const a of ALLOWED) expect(files.find((f) => f.rel === a.file)?.text).toMatch(a.pattern);
  });

  it('strips comments and strings but keeps code', () => {
    expect(strip("a(); // Math.random()\nb('Math.sqrt(')")).toBe("a(); \nb('          ')");
  });
});
