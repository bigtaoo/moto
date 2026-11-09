// Every tuning number for the race lives here. Units: metres, seconds, m/s.

/**
 * Bump on any change to the race rules that alters what a seed plus inputs produce, and record the new
 * golden hash in world.test.ts. Replays and (later) online rooms only mix the same version.
 */
export const SIM_VERSION = 10;

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
  slow: 0.86, // the target's speed is cut to this
  /** Swinging costs the swinger speed too, hit or miss: a landed blow still gains ground, a wild one loses it. */
  selfSlow: 0.9,
};
export const WEAPON = {
  pan: { dmg: 2, reach: 0.2 },
  bat: { dmg: 2, reach: 0.6 },
} as const;
export type WeaponKind = keyof typeof WEAPON;

/**
 * Knocked off: the body tumbles to a stop while the scooter slides on further (the faster the crash, the
 * further), then the rider gets up and runs back to it.
 */
export const DOWN = {
  lie: { ko: 30, car: 40 }, // ticks on the ground at least before getting up
  body: 20, // m/s² the body slows at ...
  bike: 11, // ... and the scooter
  bikeSide: 0.6, // share of the sideways shove the scooter takes
  run: 8, // m/s running back to it ...
  runUp: 0.25, // ... reached after this many seconds
  reach: 1.0, // metres from the scooter at which they're back on it
  maxRun: 4, // seconds of running before they're put back on regardless
};
export const INVULN_TICKS = 45;
export const RECOVER_SPEED = 0.35;

export const CAR = { halfW: 0.95, halfL: 2.2, riderHalfW: 0.4, minSpeed: 9, maxSpeed: 16, oncoming: -14 };
export const TRAFFIC = { ahead: 260, behind: 50, spawnFrom: 170, base: 9, extra: 6, gap: 14 };

/**
 * The test-site security buggies want the player to pull over. None ever rams anyone, and none sticks
 * around: each one makes a single go at the player, then pulls off and leaves the race. One that catches
 * up from behind draws level and shoves them onto the shoulder, grinding their speed off; one waiting
 * ahead either does the same or cuts in front, slows down and shadows their line. The way out is the
 * traffic: a buggy won't shove anyone into a car (it backs off and leaves a gap), and it can't follow
 * through a gap it doesn't fit. How many come, when, from where and with which move
 * is random per race and per buggy (ranges are [min, max]). They are solid, so riders bump off them like they do
 * off each other. Brake, steer round them or outlast them.
 */
export const PATROL = {
  startAt: [0.12, 0.4] as const, // fraction of the race before the first one (busy races start early)
  stopBefore: 300, // metres from the finish after which no new one comes
  gapEarly: 12, // seconds between one leaving and the next arriving, early in the race ...
  gapLate: 7, // ... and near the end ...
  gapJitter: [0.3, 1.8] as const, // ... times this for each gap ...
  count: [2, 6] as const, // buggies this race, rolled per race; a busy race gets shorter gaps:
  busyGap: [1.7, 0.35] as const, // ... gap scale for the fewest and for the most
  pairChance: 0.2, // sometimes the next one is right behind the last ...
  pairGap: [1.5, 4] as const, // ... this many seconds later
  spawnBack: [45, 70] as const, // one from behind starts this far back (off camera) ...
  chaseGain: 8, // ... and closes in this much faster than the player
  spawnAhead: [120, 190] as const, // a waiting one starts this far ahead ...
  lurkPace: [0.35, 0.55] as const, // ... cruising at this fraction of the player's speed ...
  pullOutAt: [25, 45] as const, // ... and cuts in front when the player is this close behind (or squeezes when level)
  pressMax: 6, // seconds past its press time before it gives up on a player it can't get to
  giveUp: 20, // seconds before a buggy that never reaches the player leaves anyway
  steer: 5, // sideways m/s getting about (slower than any rider) ...
  pushSteer: 6, // ... shoving a rider toward the shoulder ...
  blockSteer: 8.5, // ... and shadowing the line of the rider behind it: an upgraded steer just gets round it
  accel: 9,
  brake: 12,
  warnAt: 13, // siren and its move when it gets this close behind
  pressSec: [2.5, 5] as const, // how long it blocks or squeezes
  blockAhead: [5, 8] as const, // metres ahead of the player it settles while blocking ...
  blockPace: [0.8, 0.55] as const, // ... driving at this fraction of the player's top speed, slowing to the second over its press time
  squeezeIn: 0.5, // metres it keeps leaning in past touching while squeezing
  /** Squeezing: it eases off when a car is in the way on the shoulder side within this many seconds. */
  carWarn: 1.4,
  rub: 0.99, // speed a rider keeps per tick while grinding against it: being pulled over slows you hard
  pinned: 0.99, // ... and this on top while pinned on the barrier
  goneAt: 30, // leaving: gone once this far behind the player (off camera) ...
  goneAhead: 45, // ... or this far ahead ...
  stuckSec: 5, // ... or after this long still right by the player (wedged in traffic)
  /** Buggy footprint, for keeping it out of traffic and riders off it. */
  halfW: 1.0,
  halfL: 1.7,
  riderHalfW: 0.45,
  /** Change lane when a car is closer than this many seconds along the wanted line. */
  dodgeT: 2,
  /** A driver at the wheel: it sees the player this many ticks late (rolled per buggy) ... */
  react: [8, 14] as const,
  /** ... can't go faster than this (rolled; a fully upgraded scooter outruns the slow ones) ... */
  top: [33, 38] as const,
  /** ... and has to build up and kill its sideways speed (m/s²) */
  latAcc: 11,
  /** Rubbing against the player it feels them: then it reacts within this many ticks. */
  feel: 3,
  /** Gave up the chase: the player got this far ahead of it. */
  outrun: 80,
  /**
   * Pulling the player over works: once they are down to haltSpeed for haltSec it draws ahead a lane
   * over, holds there letHold seconds (the warning), then waves them on and leaves.
   */
  haltSpeed: 9,
  haltSec: 0.4,
  letHold: 1.0,
  /** Blocking: it only follows a lane change it is sure of, the player this far past the lane line, ... */
  laneCommit: 0.3,
  /** ... sticks with a lane at least this long, ... */
  laneHold: 12,
  /** ... and inside its lane it shades toward the player's side by up to this much. */
  laneShade: 0.6,
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
  /** After the player goes down for any reason, no new threat for at least this long. */
  mercy: 10,
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
/** Thugs fight like any rival (same swing odds, same hp) but always come armed. Knock one off and its weapon is yours. */
export const GANG = {
  name: 'Thug',
  hp: 3,
  aggr: 0.9,
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
  /** A pair either comes from both sides at once, or one gets in front and slows while the other strikes. */
  pincerChance: 0.5,
  blockAhead: 3.5, // metres in front of the leader the blocker rides ...
  blockPace: 0.92, // ... at this share of their speed, so they ride up into the fight
  pairFrom: 0.4, // two of them from this far into the race
  batFrom: 0.5, // frying pans before this, then the first one carries a bat
  goneAt: 45, // metres behind the leader where they drop out of the race
};

export const PRIZE = [600, 420, 300, 220, 160, 120, 90, 70];
export const KO_BONUS = 60;
export const GRUDGE_BONUS = 150;
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
/**
 * How rivals and thugs ride. None of them sees the others as they are now: each one reacts to where they
 * were a reaction time ago (carried forward a little), has to build up and kill its sideways speed, and
 * sticks with what it decided for a while. So nobody copies the player's moves the same tick, and a
 * feint or a hard brake can fool them.
 */
export const AI = {
  calmStart: 3, // seconds after the start with no picking fights
  /** Ticks of the others' past positions each rider remembers (longest reaction it can have). */
  memory: 24,
  /** Reaction in ticks, sharpest to slowest (by awareness, plus 0..2 ticks rolled per race). */
  react: [6, 15] as const,
  /** Share of the others' sideways speed they carry forward over their reaction time. */
  predict: 0.5,
  /** Sideways acceleration m/s², clumsiest to slickest (by awareness). */
  latAcc: [13, 22] as const,
  /** Seconds between rethinking what to do while just racing. */
  think: [0.8, 1.8] as const,
  /** Each rethink near someone: chance to go after them, times aggression (the player, a rival). */
  harassPlayer: 1.1,
  harassRival: 0.12,
  /** ... doubled for someone who hit them last. */
  grudge: 2,
  /** Seconds they stick with someone, times 0.6 + aggression ... */
  harassTime: [4, 7] as const,
  /** ... and leave them alone afterwards. */
  harassRest: [2, 4] as const,
  /** How far out to the side they ride while harassing (plus some of their weapon's reach), and the drift on top. */
  sideOff: [1.2, 1.65] as const,
  wander: 0.35,
  /** Back off this long after a blow leaves them on their last hit point. */
  backTime: 2,
  swingAtPlayer: 0.065, // per tick while in reach, times aggression
  swingAtRival: 0.02,
  /** Swing keenness when the other is level and just swung (open), or still lining up. */
  swingOpen: 1.8,
  lookBase: 1.4, // seconds of traffic look-ahead
  lookAware: 2,
  /** Seconds a line picked to get round traffic is kept. */
  escHold: 0.7,
};

export const PLAYER_BODY = 0xf2c230;
export const PLAYER_RIDE = 0x2a6fdb;
