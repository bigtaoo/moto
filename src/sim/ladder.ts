// The career ladder: the divisions, the seasons on top of them, and the rides that open along the way.
// Split out of config.ts, which was near the 500-line cap; config.ts re-exports all of it, so the rest
// of the game still reads these through `import * as C from './config'`.

export const UPGRADE_STEP = { top: 1.4, steer: 0.9, hp: 1 };
/**
 * Levels per upgrade. Toughness stops early and stops hard: six levels put the dummy on eleven hit points
 * against rivals who land about nine damage a race, so from the first cup on nothing they did could knock
 * it off (doc 3.3.42 measured 0.05 falls a race). Three levels keep a blow worth dodging all career.
 */
export const UPGRADE_MAX = { top: 10, steer: 8, hp: 3 };
/**
 * Levels open in each season (TIERS index); the rest open with the next one. Without this the cash of
 * the first season maxes everything and the rivals of the later ones never catch up. Toughness is one
 * level a season for the same reason: bought outright it ends the fight for the rest of the career.
 */
export const UPGRADE_CAP: readonly { top: number; steer: number; hp: number }[] = [{ top: 6, steer: 6, hp: 1 }, { top: 8, steer: 7, hp: 2 }, UPGRADE_MAX];

/**
 * The ladder: finish in the top PROMOTE places to move up a division. Each is somewhere else and harder:
 * rivals faster (`top` m/s) and keener and sharper (`mind` on aggression and awareness), more traffic,
 * extra security buggies, more road features, and a bigger purse (`prize` times the prize money).
 */
export interface Division {
  name: string;
  env: 'meadow' | 'desert' | 'autumn' | 'snow' | 'dusk';
  mind: number;
  traffic: number;
  patrol: number;
  prize: number;
  ramps: number;
  works: number;
  cuts: number;
}
export const DIVISIONS: readonly Division[] = [
  { name: 'Rookie Meadow', env: 'meadow', mind: 0, traffic: 1, patrol: 0, prize: 1, ramps: 1, works: 1, cuts: 0 },
  { name: 'Dust Bowl', env: 'desert', mind: 0.05, traffic: 1.1, patrol: 0, prize: 1.5, ramps: 1, works: 1, cuts: 1 },
  { name: 'Maple Run', env: 'autumn', mind: 0.1, traffic: 1.2, patrol: 1, prize: 2.1, ramps: 2, works: 1, cuts: 1 },
  { name: 'Frost Pass', env: 'snow', mind: 0.15, traffic: 1.3, patrol: 1, prize: 2.8, ramps: 2, works: 1, cuts: 1 },
  { name: 'Neon Coast', env: 'dusk', mind: 0.2, traffic: 1.45, patrol: 2, prize: 3.6, ramps: 2, works: 2, cuts: 1 },
];
export const PROMOTE = 3;

/**
 * Seasons: winning the top division's cup moves the career on to the next tier, back at the first
 * division. Everything there is harder on top of the division's own numbers: rivals faster (`top`),
 * keener (`mind`) and tougher (`hp`), more traffic and buggies, longer races (`len`, so the faster
 * riding still takes 2-3 minutes), and a bigger purse.
 */
export interface Tier {
  name: string;
  /**
   * Rivals' extra top speed in each division (m/s). Set from what `careerGear` says the player is
   * riding there, less a lead that shrinks from `LEAD[0]` m/s at the first race to `LEAD[1]` at the
   * last, so the player stays a little faster but the last season is close.
   */
  top: readonly number[];
  mind: number;
  hp: number;
  traffic: number;
  patrol: number;
  prize: number;
  len: number;
}

/** The speed lead the table below leaves the player at the first rung and at the last (3.3.54). */
export const LEAD = [2, 0.6] as const;

export const TIERS: readonly Tier[] = [
  { name: 'Amateur', top: [-1.1, 0.4, 4.2, 5.6, 8.3], mind: 0, hp: 0, traffic: 1, patrol: 0, prize: 1, len: 1 },
  { name: 'Pro', top: [8.4, 11.1, 11.3, 12.7, 14.6], mind: 0.12, hp: 1, traffic: 1.15, patrol: 1, prize: 2, len: 1.12 },
  { name: 'Legend', top: [14.7, 16.2, 18.0, 19.5, 19.6], mind: 0.24, hp: 2, traffic: 1.3, patrol: 1, prize: 3, len: 1.18 },
];

/** A division as raced in a tier. */
export interface Stage extends Division {
  tier: number;
  /** Rivals' extra top speed. */
  top: number;
  /** Extra hit points for every rival. */
  hp: number;
  /** Race length, times RACE_LEN. */
  len: number;
}

/**
 * After the career: every title won in the last season's top division adds a level of "+N" on top of it.
 * Per level the rivals are `top` m/s faster and `mind` keener (up to `mindMax`), one more hit point every
 * `hpEvery` levels, the traffic `traffic` busier (up to `trafficMax` levels' worth) and the prizes `prize` richer.
 */
export const ENDLESS = { top: 0.45, mind: 0.02, mindMax: 0.16, hpEvery: 3, traffic: 0.03, trafficMax: 6, prize: 0.15 };

export function stage(div: number, tier: number, plus = 0): Stage {
  const d = DIVISIONS[Math.max(0, Math.min(DIVISIONS.length - 1, div))];
  const ti = Math.max(0, Math.min(TIERS.length - 1, tier));
  const t = TIERS[ti];
  const n = ti === TIERS.length - 1 ? Math.max(0, Math.floor(plus)) : 0;
  const E = ENDLESS;
  return {
    ...d, name: (ti ? `${t.name} ${d.name}` : d.name) + (n ? ` +${n}` : ''), tier: ti, top: t.top[DIVISIONS.indexOf(d)] + n * E.top,
    mind: d.mind + t.mind + Math.min(E.mindMax, n * E.mind), hp: t.hp + Math.floor(n / E.hpEvery),
    traffic: d.traffic * t.traffic * (1 + Math.min(n, E.trafficMax) * E.traffic), patrol: d.patrol + t.patrol, prize: d.prize * t.prize * (1 + n * E.prize), len: t.len,
  };
}

/** Where a division of a tier sits on the whole ladder, 0 the first race of the career. */
export const rung = (div: number, tier: number) => tier * DIVISIONS.length + div;

/**
 * The player's rides. Each is a package on top of PLAYER_BASE and the upgrades (which belong to the
 * dummy and carry over): faster, but with its own character. Bought with cash once the career reaches
 * `rung` (see `rung`).
 */
export interface Vehicle {
  name: string;
  price: number;
  rung: number;
  top: number;
  steer: number;
  hp: number;
  accel: number;
  /** One line for the garage. */
  blurb: string;
}

export const VEHICLES: readonly Vehicle[] = [
  { name: 'Test Scooter', price: 0, rung: 0, top: 0, steer: 0, hp: 0, accel: 0, blurb: 'Standard issue. Kick to start.' },
  { name: 'Shopping Cart', price: 3500, rung: 2, top: 0.85, steer: -0.6, hp: 2, accel: 0, blurb: 'Heavy, rattly, hard to knock over.' },
  { name: 'Office Chair', price: 9000, rung: 4, top: 1.95, steer: 2, hp: 0, accel: 1.5, blurb: 'Spins on a dime. Swivel to win.' },
  { name: 'Mobility Scooter', price: 20000, rung: 6, top: 3.25, steer: 0.5, hp: 2, accel: 0.5, blurb: 'Top speed of a sports car. Probably illegal.' },
  { name: 'Toilet Rocket', price: 45000, rung: 9, top: 5, steer: 0, hp: 1, accel: 2.5, blurb: 'Do not ask how it works.' },
  { name: 'Jet Bathtub', price: 200000, rung: 12, top: 6.7, steer: 1, hp: 2, accel: 3, blurb: 'Bubbles not included. Top of the line.' },
];

/**
 * What the career is riding by the time it reaches a rung: the newest ride open to it, and upgrades
 * walked from the last season's cap up to this one's across the five divisions. The rivals' `top` table
 * is set from this (3.3.54), and a test checks the lead it actually leaves.
 */
export function careerGear(div: number, tier: number): { vehicle: number; up: { top: number; steer: number; hp: number } } {
  const rg = rung(div, tier);
  let vehicle = 0;
  for (let i = 0; i < VEHICLES.length; i++) if (VEHICLES[i].rung <= rg) vehicle = i;
  const cap = UPGRADE_CAP[Math.min(tier, UPGRADE_CAP.length - 1)];
  const prev = tier > 0 ? UPGRADE_CAP[Math.min(tier - 1, UPGRADE_CAP.length - 1)] : { top: 0, steer: 0, hp: 0 };
  const f = (div + 1) / DIVISIONS.length;
  const walk = (a: number, b: number) => Math.round(a + (b - a) * f);
  return {
    vehicle,
    up: { top: walk(prev.top, cap.top), steer: walk(prev.steer, cap.steer), hp: Math.max(1, walk(prev.hp, cap.hp)) },
  };
}
