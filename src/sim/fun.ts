// Tuning for the fourth round of play (SIM_VERSION 20): bowling with the tumbling body, the oil can, each
// division's own roadside hazard, the taunt, the cup's last-race boss and the weekly mutator.

/**
 * Down and still tumbling, the player can lean the body sideways (`slide` m/s at full steer) while it moves
 * at `minSpeed` or more; a rider still on their scooter hit by it (within x/z metres) is knocked off, a
 * KO that pays `pay` on top. At most `max` a fall.
 */
export const BOWL = { slide: 3.2, minSpeed: 4, x: 1.05, z: 1.5, pay: 40, max: 3 };

/**
 * The oil can: a weapon that swings at nobody. Used, it pours a slick on the road `back` metres behind the
 * rider; whoever rides over it (inside halfW/halfZ) goes down, and it counts for the one who poured it.
 * The pourer is safe from their own slick for `grace` ticks; a slick lasts `life` ticks.
 */
export const OIL = { back: 2.5, halfW: 1.0, halfZ: 0.9, grace: 60, life: 900, kick: 4 };

/** Right after the player puts someone down they have `ticks` ticks to taunt: it pays, and costs pace. */
export const TAUNT = { ticks: 30, pay: 30, slow: 0.86, show: 24 };

/**
 * The boss of the cup's last race: one rival, bigger and armoured. Every blow on it does one damage (a full
 * haymaker two), blows push it `push` as far, it has `hp` more and is faster and meaner. Putting it down the
 * first time pays `pay` (times the stage's prize).
 */
export const BOSS = { hp: 2, top: 1.2, aggr: 0.25, push: 0.5, pay: 300 };

/**
 * Each division's hazard, `count` of them a race, spread over [from, to] of the road:
 * - cow (meadow): ambles across the road and back; riding into one is a crash (aware riders steer round).
 * - weed (desert): tumbleweeds bowling across; one hit shoves the rider aside and bursts (back after `regrow` ticks).
 * - leaves (autumn), ice (snow): a slippery patch `len` m long; steering grip drops to `grip`, and a sideways
 *   shove carries on much further (`carry` kept per tick).
 * - hydrant (dusk): a burst hydrant by the barrier, spraying `reach` m across the road for `on` of every
 *   `cycle` ticks; the spray pushes riders away from it.
 */
export const HAZARD = {
  from: 0.18, to: 0.88,
  cow: { count: 3, halfW: 0.9, halfL: 1.1, roam: 4.2, speed: 0.9 },
  weed: { count: 3, n: 3, r: 0.6, speed: 5.5, push: 7, regrow: 90 },
  leaves: { count: 3, len: 26, grip: 0.45, carry: 0.93 },
  ice: { count: 3, len: 32, grip: 0.3, carry: 0.96 },
  hydrant: { count: 4, reach: 6.5, on: 45, cycle: 105, push: 16, slow: 0.994, halfZ: 1.6 },
} as const;

/** The weekly mutator, on the second race of every cup (UTC weeks from Monday). */
export const MUTATORS = ['lowgrav', 'bats', 'bigheads', 'traffic', 'police'] as const;
export type Mutator = (typeof MUTATORS)[number];
export const MUTATOR = { race: 1, prize: 1.25, air: 2, traffic: 1.6, patrol: 2 };

/** This UTC week's mutator (weeks start on Monday; the epoch was a Thursday). */
export function weeklyMutator(now: number): Mutator {
  const week = Math.floor((now / 86_400_000 + 3) / 7);
  return MUTATORS[((week % MUTATORS.length) + MUTATORS.length) % MUTATORS.length];
}
