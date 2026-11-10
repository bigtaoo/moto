// Daily challenges and the first win of the day: three goals a UTC day, the same for everyone that day,
// with progress over the day's races. Pure functions over the save's `daily`, so they are tested.

import { dayOf } from './metrics';

export type Kind = 'kos' | 'shoves' | 'podium' | 'win' | 'races' | 'clean' | 'grudge';
/** Each kind and how much of it a day asks for. */
export const GOALS: Record<Kind, number> = { kos: 6, shoves: 3, podium: 2, win: 2, races: 3, clean: 1, grudge: 2 };
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
  /** Times the player came off in the race. */
  falls: number;
  /** Grudges settled and knockdowns of the nemesis. */
  grudge: number;
}

function amount(k: Kind, r: RaceStats): number {
  switch (k) {
    case 'kos': return r.kos;
    case 'shoves': return r.shoves;
    case 'podium': return r.place <= 3 ? 1 : 0;
    case 'win': return r.place === 1 ? 1 : 0;
    case 'races': return 1;
    case 'clean': return r.falls === 0 ? 1 : 0;
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
