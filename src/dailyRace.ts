// The daily challenge: one race a day, and the same race for everybody who rides it that day. The UTC day
// picks the seed, the stage and the twist (and picks them so that no two days running are alike); everyone rides the gear the ladder is balanced around at that
// stage (L.careerGear), so the day is the same fight whether the player's own garage is empty or full;
// and the run comes out as one number, so two days' worth of riding can be compared. Nothing in the career
// moves -- no cup points, no promotion, no races count, no dailies, no achievements, no feud -- the rule
// src/free.ts set in 3.3.69. Today's challenges (three goals tracked across the cup's races) are the other
// file, src/daily.ts; this is a race.

import * as C from './sim/config';
import * as L from './sim/ladder';
import { MUTATORS, type Mutator } from './sim/fun';
import { dayMult } from './rewards';
import type { World } from './sim/world';
import type { WorldOpts } from './sim/types';
import type { Save } from './meta';

/** What the daily challenge keeps on the save: the day it is for, the best score set on it, and the runs. */
export interface DailyRace {
  day: number;
  best: number;
  runs: number;
}

export const newDailyRace = (day: number): DailyRace => ({ day, best: 0, runs: 0 });

/** The challenge opens where the shift and the free race do: with the first cup behind the player. Before
 *  that a new player has one road in front of them, and it is the cup's (3.3.71, 3.3.72). */
export const dailyRaceOpen = (save: Save): boolean => save.races >= C.CHASE.unlock;

/** The state for `day`: a day that has turned starts the challenge afresh. */
export const dailyRaceFor = (d: DailyRace, day: number): DailyRace => (d.day === day ? d : newDailyRace(day));

/** The daily state out of a save's JSON (junk, or yesterday's: a fresh day). */
export function readDailyRace(v: unknown, day: number): DailyRace {
  const o = v as Partial<DailyRace> | undefined;
  if (!o || typeof o !== 'object' || o.day !== day) return newDailyRace(day);
  const n = (x: unknown) => Math.max(0, Math.floor(Number(x) || 0));
  return { day, best: n(o.best), runs: n(o.runs) };
}

/** The day's number, stirred, so that two days running are neither the same race nor neighbouring stages. */
function spin(day: number, salt: number): number {
  let h = (Math.imul(day, 2654435761) + Math.imul(salt, 40503)) >>> 0;
  h = (Math.imul(h ^ (h >>> 15), 2246822507) + 0x9e3779b9) >>> 0;
  return (h ^ (h >>> 13)) >>> 0;
}

/** Which stage a day is run at, and the twist it is run under. The same for every player on that day. */
/**
 * Which rung of the ladder today is run on. Not the hash: a walk of `STEP` rungs a day, which is coprime
 * with the fifteen of them, so every rung comes up once a fortnight and no two days running share one.
 * A hash looked fairer and wasn't -- one day in fifteen it handed back yesterday's stage, and a player
 * who opens the game to the track they rode yesterday has no reason to believe the day picked anything.
 */
const STEP = 7;
const RUNGS = L.DIVISIONS.length * L.TIERS.length;
export const dailyStage = (day: number): { div: number; tier: number } => {
  const rung = (((day * STEP) % RUNGS) + RUNGS) % RUNGS;
  return { div: rung % L.DIVISIONS.length, tier: Math.floor(rung / L.DIVISIONS.length) };
};

export const dailyMutator = (day: number): Mutator => MUTATORS[spin(day, 3) % MUTATORS.length];

/**
 * The day's race, built from the day alone -- nothing of the save goes into it. The gear is what
 * `careerGear` says the career is riding by the time it reaches that stage, which is the gear the whole
 * ladder's difficulty was set against (3.3.54), so a Legend day is a Legend fight rather than a base
 * scooter being lapped, and an Amateur day is not a victory lap for a maxed-out garage.
 */
export function dailyOpts(day: number): WorldOpts {
  const { div, tier } = dailyStage(day);
  const gear = L.careerGear(div, tier);
  return {
    seed: (spin(day, 4) % 99991) + 1,
    upgrades: gear.up, vehicle: gear.vehicle, div, tier, endless: 0,
    grudges: [], rookie: -1, mutator: dailyMutator(day),
  };
}

/**
 * What the run is worth. A place alone would make the daily a second cup race, and takedowns alone would
 * pay a player who stopped racing to brawl, so the score is both at once with the clock against them:
 * finish high, put people down, and do it quickly.
 */
export const SCORE = {
  /** What a finishing place is worth, 1st first. */
  place: [900, 640, 460, 330, 230, 150, 90, 40],
  ko: 200,
  shove: 120,
  near: 25,
  /** Per link past the first of the race's longest knockdown chain. */
  chain: 150,
  /** Off the bike: the one thing on the card that costs points. */
  fall: 120,
  /** Off the score for every second the race took. */
  sec: 5,
};

export interface DailyScore {
  place: number;
  placePts: number;
  kos: number;
  koPts: number;
  shoves: number;
  shovePts: number;
  near: number;
  nearPts: number;
  /** Links past the first of the longest chain, and what they were worth. */
  chain: number;
  chainPts: number;
  falls: number;
  fallPts: number;
  time: number;
  timePts: number;
  /** Never below zero: a run that went badly scores nothing, it does not score backwards. */
  total: number;
}

/** `falls`: times the player came off this race (main.ts counts them). */
export function dailyScore(w: World, falls: number): DailyScore {
  const chain = Math.max(0, w.flair.best - 1);
  const s = {
    place: w.player.place, placePts: SCORE.place[w.player.place - 1] ?? 0,
    kos: w.kos, koPts: w.kos * SCORE.ko,
    shoves: w.shoves, shovePts: w.shoves * SCORE.shove,
    near: w.flair.near, nearPts: w.flair.near * SCORE.near,
    chain, chainPts: chain * SCORE.chain,
    falls, fallPts: -falls * SCORE.fall,
    time: w.time, timePts: -Math.round(w.time) * SCORE.sec,
  };
  const sum = s.placePts + s.koPts + s.shovePts + s.nearPts + s.chainPts + s.fallPts + s.timePts;
  return { ...s, total: Math.max(0, sum) };
}

/** What the day's first finished run pays, at the stage the player's own career is on. It is paid once a
 *  day however the run went: the reason to come back is the day's race, not the money. */
export const DAILY_PAY = 400;

export interface DailyRaceResult {
  score: DailyScore;
  /** The best on today's race before this run, and whether this run beat it. */
  was: number;
  best: boolean;
  runs: number;
  /** Cash this run paid: the day's first run only. */
  paid: number;
  /** The stage the day is run at, and its twist. */
  name: string;
  mutator: Mutator | null;
  /** Daily points after this run: the sum of every day's best, which is what the board ranks. */
  pts: number;
}

/**
 * What the public board holds. A Playgama board is one list that keeps the highest number a player ever
 * sent it -- it has no notion of a day -- so sending today's score would rank a Legend Tuesday against
 * somebody's Amateur Friday and call it a ranking. The sum of every day's best is the one number a
 * standing board can carry honestly: it only ever climbs, and it says what it looks like it says, which
 * is who rides the day, and rides it well, most often (3.3.77).
 */
export const dailyPoints = (save: Save): number => save.dpts;

/** Score a finished daily run into the save. */
export function settleDailyRace(save: Save, w: World, falls: number, day: number): DailyRaceResult {
  const d = dailyRaceFor(save.drace, day);
  save.drace = d;
  const score = dailyScore(w, falls);
  const was = d.best;
  const paid = d.runs === 0 ? Math.round(DAILY_PAY * dayMult(L.stage(save.div, save.tier, save.endless).prize)) : 0;
  d.runs++;
  d.best = Math.max(d.best, score.total);
  // only what this run added to today's best, so a second run cannot bank the same day twice
  save.dpts += Math.max(0, score.total - was);
  save.cash += paid;
  return { score, was, best: score.total > was, runs: d.runs, paid, name: w.div.name, mutator: w.mutator, pts: save.dpts };
}
