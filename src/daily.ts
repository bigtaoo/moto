// Daily challenges and the first win of the day: three goals a UTC day, the same for everyone that day,
// with progress over the day's races. Pure functions over the save's `daily`, so they are tested.

import { dayOf } from './metrics';

export type Kind = 'kos' | 'shoves' | 'podium' | 'near' | 'races' | 'chain' | 'grudge';
/**
 * Each kind and how much of it a day asks for. Every goal is meant to take two to four races at any rung of
 * the ladder; 3.3.48 measured the old ones and found `kos` and `grudge` ticked themselves inside the first
 * race while `clean` (come home without falling off once) was never ticked at all in 300 races -- this game
 * puts the player on the tarmac four to eight times a race by design.
 */
export const GOALS: Record<Kind, number> = { kos: 24, shoves: 5, podium: 2, near: 7, races: 3, chain: 2, grudge: 4 };
/** How many knockdowns in a row make a chain the `chain` challenge counts. The challenge's text says 3. */
export const CHAIN_LINKS = 3;
const KINDS = Object.keys(GOALS) as Kind[];
export const PER_DAY = 3;
/** Cash for a challenge and for the day's first win, times the division's prize multiplier. */
export const CHALLENGE_PAY = 250;
export const FIRST_WIN_PAY = 400;

export interface Daily {
  /** UTC day (days since 1970) the progress is for. */
  day: number;
  /** Progress per challenge of the day, in the order `challengesFor` gives them. */
  prog: number[];
  /** The day's first win was paid. */
  won: boolean;
}

export const newDaily = (day: number): Daily => ({ day, prog: Array(PER_DAY).fill(0), won: false });
export const today = (): number => dayOf(Date.now());

/** The day's challenges: three different kinds, picked by the day number. */
export function challengesFor(day: number): Kind[] {
  let h = (day * 2654435761) >>> 0;
  const pool = [...KINDS];
  const out: Kind[] = [];
  while (out.length < PER_DAY) {
    h = (Math.imul(h ^ (h >>> 15), 2246822507) + 0x9e3779b9) >>> 0;
    out.push(pool.splice(h % pool.length, 1)[0]);
  }
  return out;
}

/** The save's daily state for `day`: a new day starts afresh. */
export function dailyFor(d: Daily | undefined, day: number): Daily {
  return d && d.day === day ? d : newDaily(day);
}

/** What a race counts towards the challenges. */
export interface RaceStats {
  place: number;
  kos: number;
  shoves: number;
  /** Cars slipped past close without touching one. */
  near: number;
  /** The longest run of knockdowns the player chained this race. */
  chain: number;
  /** Grudges settled and knockdowns of the nemesis. */
  grudge: number;
}

function amount(k: Kind, r: RaceStats): number {
  switch (k) {
    case 'kos': return r.kos;
    case 'shoves': return r.shoves;
    case 'podium': return r.place <= 3 ? 1 : 0;
    case 'near': return r.near;
    case 'races': return 1;
    case 'chain': return r.chain >= CHAIN_LINKS ? 1 : 0;
    case 'grudge': return r.grudge;
  }
}

export interface DailyRow { kind: Kind; goal: number; prog: number; done: boolean; }
export interface DailyOutcome {
  /** Challenges this race completed. */
  done: Kind[];
  /** Cash for them and for the first win. */
  cash: number;
  firstWin: number;
  rows: DailyRow[];
}

/** The day's challenges as they stand. */
export function rows(d: Daily): DailyRow[] {
  return challengesFor(d.day).map((kind, i) => {
    const goal = GOALS[kind];
    const prog = Math.min(goal, d.prog[i] ?? 0);
    return { kind, goal, prog, done: prog >= goal };
  });
}

/** Count a finished race on `d` (changed in place); `mult` the division's prize multiplier. */
export function scoreDaily(d: Daily, r: RaceStats, mult: number): DailyOutcome {
  const done: Kind[] = [];
  challengesFor(d.day).forEach((kind, i) => {
    const goal = GOALS[kind];
    const was = d.prog[i] ?? 0;
    if (was >= goal) return;
    d.prog[i] = Math.min(goal, was + amount(kind, r));
    if (d.prog[i] >= goal) done.push(kind);
  });
  const firstWin = r.place === 1 && !d.won ? Math.round(FIRST_WIN_PAY * mult) : 0;
  if (firstWin) d.won = true;
  return { done, cash: done.length * Math.round(CHALLENGE_PAY * mult), firstWin, rows: rows(d) };
}

/** The daily state from a save's JSON (junk: a fresh day). */
export function readDaily(v: unknown, day: number): Daily {
  const o = v as Partial<Daily> | undefined;
  if (!o || typeof o !== 'object' || o.day !== day || !Array.isArray(o.prog)) return newDaily(day);
  const prog = Array.from({ length: PER_DAY }, (_, i) => Math.max(0, Math.floor(Number(o.prog![i]) || 0)));
  return { day, prog, won: o.won === true };
}
