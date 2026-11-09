// Every tuning number for the race lives here. Units: metres, seconds, m/s.

/**
 * Bump on any change to the race rules that alters what a seed plus inputs produce, and record the new
 * golden hash in world.test.ts. Replays and (later) online rooms only mix the same version.
 */
export const SIM_VERSION = 1;

export const TICK_HZ = 30;
export const DT = 1 / TICK_HZ;

/** Road: 4 lanes of 3.5 m. Lane 0 (leftmost) carries oncoming traffic. */
export const ROAD_HALF = 7;
export const LANE_X = [-5.25, -1.75, 1.75, 5.25] as const;
export const ONCOMING_LANE = 0;
export const EDGE = ROAD_HALF - 0.55;

/** About 2.5 minutes at top speed with a few crashes. */
export const RACE_LEN = 3800;
export const TIME_CAP_S = 240;
/** Weapon pickups, as fractions of the race. */
export const PICKUP_AT = [0.08, 0.22, 0.36, 0.5, 0.64, 0.78, 0.9];
export const COUNTDOWN_S = 2;

export const PLAYER_BASE = { top: 26.5, accel: 7, steer: 8.5, hp: 3 };
export const UPGRADE_STEP = { top: 1.3, steer: 0.9, hp: 1 };
export const UPGRADE_MAX = 6;
export const upgradeCost = (level: number) => Math.round(150 * 1.55 ** level);

/** Rider-to-rider contact (see World.press). */
export const CONTACT = {
  width: 0.95, // closest two riders sit side by side
  full: 1.1, // along-road distance within which they need the full width
  clear: 2.4, // along-road distance beyond which they don't touch at all
  friction: 0.9985, // speed kept per tick while pressing
  rubTicks: 4,
  rubEvery: 6, // ticks between spark/scrape events per rider
};

export const BRAKE = 15;
export const COAST = 4;

export const ATTACK = {
  reachX: 2.5,
  reachZ: 1.9,
  minX: 0.45,
  windup: 4, // ticks before the blow lands
  cooldown: 13, // ticks between swings
  push: 4.5, // sideways m/s given to the target
  slow: 0.93,
};
export const WEAPON = {
  pan: { dmg: 2, reach: 0.2 },
  bat: { dmg: 2, reach: 0.6 },
} as const;
export type WeaponKind = keyof typeof WEAPON;

export const DOWN_TICKS = { ko: 60, car: 72, patrol: 66 };
export const INVULN_TICKS = 45;
export const RECOVER_SPEED = 0.35;

export const CAR = { halfW: 0.95, halfL: 2.2, riderHalfW: 0.4, minSpeed: 9, maxSpeed: 16, oncoming: -14 };
export const TRAFFIC = { ahead: 260, behind: 50, spawnFrom: 170, base: 9, extra: 6, gap: 14 };

export const PATROL = {
  startAt: 0.3, // fraction of the race
  spawnBack: 75,
  chaseGain: 4,
  steer: 5,
  warnAt: 13,
  warnTicks: 20,
  dash: 13,
  dashTicks: 40,
  fallBack: 75,
  fallTicks: 150,
};

/**
 * Whoever leads gets company: after a short breather, either a rival hunts them down from behind or
 * thugs waiting on the shoulder ahead pull out to box them in. One threat at a time, alternating.
 */
export const LEADER = {
  startAt: 0.06, // fraction of the race before any of this starts
  firstDelay: 4, // seconds in the lead before the first threat
  gapEarly: 11, // seconds of calm between threats, early in the race ...
  gapLate: 5, // ... and near the end
};
export const HUNT = {
  chase: 20, // seconds to catch up before giving up ...
  attack: 8, // ... then seconds on the leader's shoulder
  range: 260, // only rivals this close behind are picked
  boostMin: 5, // m/s faster than the leader, plus boostPerM for each metre behind
  boostPerM: 0.1,
  boostMax: 15,
  swing: 2.5, // swing keenness multiplier while hunting
};
export const GANG = {
  name: 'Thug',
  hp: 2,
  top: 34,
  accel: 12,
  steer: 7.5,
  aware: 0.7,
  body: 0x45454e,
  ride: 0x141418,
  spawnAhead: 100, // metres ahead of the leader they wait
  lurk: 0.42, // their speed while waiting, as a fraction of the leader's
  engageAt: 30, // pull out when the leader is this close behind
  attackTime: 8, // seconds alongside before they give up
  swing: 0.09, // per tick while the leader is in reach
  pairFrom: 0.4, // two of them from this far into the race
  batFrom: 0.6, // and one carries a bat
  goneAt: 45, // metres behind the leader where they drop out of the race
};

export const PRIZE = [600, 420, 300, 220, 160, 120, 90, 70];
export const KO_BONUS = 60;
export const GRUDGE_BONUS = 150;
export const FINE = 120;
/** Knock the player off this many times and a rival becomes a grudge. */
export const GRUDGE_AT = 2;

export interface RivalSpec {
  name: string;
  top: number;
  aggr: number; // 0..1 how keen they are to fight
  aware: number; // 0..1 how early they see traffic
  body: number; // dummy colour
  ride: number; // scooter colour
  weapon?: WeaponKind;
}

export const ROSTER: RivalSpec[] = [
  { name: 'Bumper', top: 27.2, aggr: 0.9, aware: 0.8, body: 0xe8e4da, ride: 0xd23c3c, weapon: 'bat' },
  { name: 'Wobbles', top: 25.6, aggr: 0.4, aware: 0.45, body: 0x7fb6e8, ride: 0x2f5fb0 },
  { name: 'Dent', top: 26.6, aggr: 0.75, aware: 0.75, body: 0xf09a4a, ride: 0x2b2b30 },
  { name: 'Sticker', top: 26.0, aggr: 0.55, aware: 0.6, body: 0x9ad07a, ride: 0x6b3fa0, weapon: 'pan' },
  { name: 'Nugget', top: 25.2, aggr: 0.3, aware: 0.55, body: 0xd9a6e0, ride: 0x18a39a },
  { name: 'Torque', top: 27.6, aggr: 0.6, aware: 0.9, body: 0xb0b4bc, ride: 0xe0b020 },
  { name: 'Crumple', top: 26.2, aggr: 0.85, aware: 0.5, body: 0xe86a8a, ride: 0x3a7d3a },
];

export const RIVAL_HP = 3;
export const AI = {
  calmStart: 3, // seconds after the start with no stalking
  stalkChance: 0.012, // per tick, times aggression
  stalkTime: 4,
  stalkRest: 6,
  swingAtPlayer: 0.05, // per tick while in reach, times aggression
  swingAtRival: 0.02,
  lookBase: 1.4, // seconds of traffic look-ahead
  lookAware: 2,
};

export const PLAYER_BODY = 0xf2c230;
export const PLAYER_RIDE = 0x2a6fdb;
