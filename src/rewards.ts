// Reasons to come back and to push: a daily login streak (paid on the first visit of a UTC day, a rewarded ad
// doubles it) and achievements (each paid once). Pure functions over the save, so they are tested.

import type { Save } from './meta';
import { TIERS, VEHICLES } from './sim/config';

export interface Streak {
  /** UTC day (days since 1970) of the last visit, and days in a row up to it. */
  day: number;
  n: number;
  /** What that day's visit paid, and whether an ad doubled it. */
  pay: number;
  doubled: boolean;
}

/** Pay for the 1st, 2nd.. day in a row (the last holds from then on), times the stage's prize multiplier. */
export const STREAK_PAY = [100, 150, 200, 300, 400, 500, 750];

export const newStreak = (): Streak => ({ day: 0, n: 0, pay: 0, doubled: false });

/**
 * A visit on `day`: the streak goes on (the last visit was yesterday), starts over (a gap) or stands (today was
 * already counted). Returns the cash it pays, 0 when today was already counted or `pays` is off (a new player,
 * whose first visit is the tutorial race).
 */
export function visit(s: Streak, day: number, mult: number, pays: boolean): number {
  if (s.day === day) return 0;
  s.n = s.day === day - 1 ? s.n + 1 : 1;
  s.day = day;
  s.doubled = false;
  s.pay = pays ? Math.round(STREAK_PAY[Math.min(s.n, STREAK_PAY.length) - 1] * mult) : 0;
  return s.pay;
}

/** Lifetime counts the achievements need that the save doesn't keep otherwise. */
export interface Life { kos: number; wins: number; }

/** What a finished race shows the achievements. */
export interface RaceFacts {
  place: number;
  falls: number;
  kos: number;
  near: number;
  /** Best KO chain. */
  chain: number;
}

interface Achievement {
  /** i18n keys `a_<id>` (the name) and `ad_<id>` (what to do). */
  id: string;
  pay: number;
  got: (s: Save, r?: RaceFacts) => boolean;
}

export const ACHIEVEMENTS: readonly Achievement[] = [
  { id: 'win', pay: 300, got: (s) => s.life.wins >= 1 },
  { id: 'promo', pay: 400, got: (s) => s.div >= 1 || s.tier >= 1 },
  { id: 'kos100', pay: 500, got: (s) => s.life.kos >= 100 },
  { id: 'paints', pay: 500, got: (s) => s.paint.owned.length >= 3 },
  { id: 'clean', pay: 500, got: (_, r) => !!r && r.place === 1 && r.falls === 0 },
  { id: 'near6', pay: 600, got: (_, r) => !!r && r.near >= 6 },
  { id: 'chain5', pay: 600, got: (_, r) => !!r && r.chain >= 5 },
  { id: 'kos25', pay: 800, got: (_, r) => !!r && r.kos >= 25 },
  { id: 'nemesis', pay: 800, got: (s) => s.feud.broken >= 1 },
  { id: 'champ', pay: 1500, got: (s) => s.titles >= 1 },
  { id: 'streak7', pay: 1500, got: (s) => s.streak.n >= 7 },
  { id: 'kos1000', pay: 2000, got: (s) => s.life.kos >= 1000 },
  { id: 'legend', pay: 3000, got: (s) => s.tier >= TIERS.length - 1 },
  { id: 'rides', pay: 3000, got: (s) => s.garage.owned.length >= VEHICLES.length },
  { id: 'endless', pay: 5000, got: (s) => s.endless >= 1 },
];
export const ACH_IDS = ACHIEVEMENTS.map((a) => a.id);

export interface Unlocked { id: string; pay: number; }

/** Award (and pay) every achievement the save, and the race if there is one, now meets. */
export function unlock(save: Save, r?: RaceFacts): Unlocked[] {
  const out: Unlocked[] = [];
  for (const a of ACHIEVEMENTS) {
    if (save.ach.includes(a.id) || !a.got(save, r)) continue;
    save.ach.push(a.id);
    save.cash += a.pay;
    out.push({ id: a.id, pay: a.pay });
  }
  return out;
}

/** Count a finished race in the lifetime totals, then award what it earned. */
export function afterRace(save: Save, r: RaceFacts): Unlocked[] {
  save.life.kos += r.kos;
  if (r.place === 1) save.life.wins++;
  return unlock(save, r);
}
