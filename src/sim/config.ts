// Every tuning number for the race lives here. Units: metres, seconds, m/s.

/**
 * Bump on any change to the race rules that alters what a seed plus inputs produce, and record the new
 * golden hash in world.test.ts. Replays and (later) online rooms only mix the same version.
 */
export const SIM_VERSION = 49;

export const TICK_HZ = 30;
export const DT = 1 / TICK_HZ;

/** Road: 4 lanes of 3.5 m. Lane 0 (leftmost) carries oncoming traffic. */
export const ROAD_HALF = 7;
export const LANE_X = [-5.25, -1.75, 1.75, 5.25] as const;
export const ONCOMING_LANE = 0;
export const EDGE = ROAD_HALF - 0.55;

/** Two and a half minutes of racing, measured: see docs 3.3.21, held there through 3.3.31's faster bikes. */
export const RACE_LEN = 3400;
export const TIME_CAP_S = 240;
/** Once every rival is home, the stragglers get this long at the flag before the race is called. */
export const SWEEP_S = 12;
/** Weapon pickups, as fractions of the race. */
export const PICKUP_AT = [0.08, 0.22, 0.36, 0.5, 0.64, 0.78, 0.9];
export const COUNTDOWN_S = 2;

export const PLAYER_BASE = { top: 28.6, accel: 7, steer: 8.5, hp: 3 };
/**
 * How fast the spot a held key steers for travels, as a fraction of the bike's own `steer` speed. Press
 * length reads as distance, stopped only by the road's edges: 0.1 s half a metre, 0.7 s a lane, 2.5 s all of it.
 *
 * 3.3.67 found a new player's crashes are overshot dodges, not missed ones: at the full 8.5 m/s a 300 ms
 * press slid 2.55 m and half a second crossed a lane into oncoming traffic. 3.3.68 fixed it twice over --
 * 5 m/s, and a `KEY_STEP` cap of one lane -- and 3.3.73 found only the rate was doing the work: the cap
 * made a held key go dead after a lane, so the player kept pressing and the bike kept still. The cap is gone.
 *
 * A fraction, not a speed: the old flat 5 m/s meant a keyboard player felt nothing of the steer upgrades or
 * a nimbler ride. 0.6 leaves the base bike at the 5.1 m/s 3.3.68 measured, and an upgraded one steers faster.
 */
export const KEY_RATE = 0.6;
/** How far ahead of the bike the steered-for spot may get. Shoved off line or held against the barrier, a
 *  press cannot run up a debt of metres that snaps back the moment the bike is free. */
export const KEY_LEASH = 2.5;
/** 3.3.82: how far across the player may slide before GO. The grid is the one moment of a race with nothing
 *  else in it, so a press there answers on its own -- but another rider sits 4.4 m away, and arriving at GO
 *  on top of them would open a new player's first race with a shove. */
export const GRID_SLIDE = 2;
/**
 * How the engine's pull falls off near the bike's own top speed. Below `knee` of it the full `accel` is
 * there, so getting back up after a fall is as quick as it ever was; over the knee the pull slides down to
 * `tail` of it at the top, so the last fifth has to be earned on a clean stretch of road. Without this the
 * push was flat and the speed trace was a square wave -- half a race pinned at exactly the top, the other
 * half on the ground (doc 3.3.31).
 */
export const PULL = { knee: 0.55, tail: 0.07 };
export const upgradeCost = (level: number) => Math.round(250 * 1.6 ** level);

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
  windup: 4, // ticks before the player's blow lands
  /**
   * An AI rider's arm goes up first (the tell): its blow lands this many ticks after the swing starts. It
   * aims at where the target was heading when it wound up, so a target that swerves (dodgeX) or brakes
   * (dodgeZ) off that line in the meantime makes it miss, and a rider that swung at the player and missed
   * is left wide open for `open` ticks: a blow then is a counter (counterDmg extra, and it loses its weapon).
   */
  windupAI: 10,
  dodgeX: 1,
  dodgeZ: 0.8,
  open: 24,
  counterDmg: 1,
  cooldown: 13, // ticks between swings
  push: 5.5, // sideways m/s given to the target (plus the weapon's push)
  /** Ticks a struck rider is carried by the blow before steering again: an AI rider longer than the player. */
  stagger: { ai: 6, player: 3 },
  slow: 0.86, // the target's speed is cut to this
  /** Swinging costs the swinger speed too, hit or miss: a landed blow still gains ground, a wild one loses it. */
  selfSlow: 0.9,
};
/**
 * Holding the slap winds up a haymaker (the player only): held `min` ticks or more, letting go swings with
 * power held/full (up to 1) for more reach and push, and at full one more damage. The wind-up drags the pace.
 * `min` is past the cooldown of the slap that pressing the key throws first.
 */
export const CHARGE = { min: 15, full: 27, reach: 0.5, push: 5, dmg: 1, drag: 0.997 };
export const WEAPON = {
  pan: { dmg: 2, reach: 0.2, push: 1 },
  bat: { dmg: 2, reach: 0.6, push: 2 },
  // not swung: poured out behind (src/sim/fun.ts OIL)
  oil: { dmg: 0, reach: 0, push: 0 },
} as const;

/**
 * Knocked into something: a rider who hits a car or slams the barrier (still moving sideways at wallVx or
 * more) within `ticks` ticks of a blow goes down, and it counts for whoever struck them. A bat or pan carries a rider in the outer lane into it; a fist only one already riding the barrier.
 */
export const SHOVE = { ticks: 24, wallVx: 1, carry: 0.88 /* sideways speed kept per tick while staggered (0.82 otherwise) */ };

/** A blow on an armed rider can knock the weapon loose: an empty-handed striker takes it, an armed one knocks it to the road. */
export const STEAL = { player: 0.35, ai: 0.15 };
export type WeaponKind = keyof typeof WEAPON;

/**
 * Knocked off: the body tumbles to a stop while the scooter slides on further (the faster the crash, the
 * further), then the rider gets up (slowly, and with some clowning about) and runs back to it.
 */
export const DOWN = {
  lie: { ko: 30, car: 40, wall: 36, cones: 36, oil: 36, cow: 40 }, // ticks on the ground at least before getting up
  stand: 1.7, // seconds getting up and on their feet before the run (the view: a slow climb up, then a gag)
  body: 20, // m/s² the body slows at ...
  /**
   * ... and the scooter. 3.7.2: the sandbox had a losing player on the ground 33 s of a 120 s race, and
   * the climb up is deliberately slow (it is the joke), so the time came off the *run back* instead: the
   * scooter stops sooner and they scurry faster, about 2.5 s a fall. The fall still hurts; it stops being
   * the whole race.
   */
  bike: 15,
  bikeSide: 0.6, // share of the sideways shove the scooter takes
  run: 7, // m/s running back to it (a panicky scurry; the view makes the legs go faster) ...
  runUp: 0.4, // ... reached after this many seconds
  reach: 1.0, // metres from the scooter at which they're back on it
  maxRun: 4.5, // seconds of running before they're put back on regardless
};
/**
 * The opening of a career, eased. Measured on the sandbox (docs 3.7.2): the first race took 145-185 s
 * while half the sessions ended inside 152 s, so nobody saw a result; of the falls that ate that time,
 * 71% were traffic. So the first races are shorter and emptier and the rivals a little slower.
 * 3.3.58: two eased races was a ramp with one step in it - the third race arrived at twice the length
 * and twice the traffic at once, and that is exactly where the sandbox's losing races sit (the median
 * `progression_failed` is the player's third career race, 6.9 falls and 30 s of a 126 s race spent on
 * the ground, finishing 7th of 8). Four eased races spread the same climb over steps of about a tenth
 * each. Indexed by races finished (`save.races`); past the lists, nothing is eased.
 */
export const ROOKIE = {
  len: [0.5, 0.65, 0.8, 0.9], // times the stage's race length
  traffic: [0.5, 0.65, 0.8, 0.9], // times the division's density
  /**
   * m/s off every rival's top speed, so the first races can actually be won. Longer than the other two
   * lists on purpose: the length and traffic easing stop after four races, and the rivals keep tapering
   * past that so race 5 is not a cliff. 3.3.65: measured on a beginner who steers along the road but
   * never reads traffic and never swings, the old ramp let them place top-3 in 23% of first races and 2%
   * of third races - they spent a quarter of the race on the ground and nothing could be done about it
   * from the saddle. This ramp puts the first race at 63%, which is the floor; anyone who fights back
   * does better.
   */
  rivalTop: [-5.0, -4.4, -3.8, -3.2, -2.0, -1.0],
};
/** `ROOKIE[key]` for a player with `races` races behind them: 1 (or 0 m/s) once they are past the opening. */
export const rookieEase = (races: number, key: 'len' | 'traffic'): number =>
  races >= 0 && races < ROOKIE[key].length ? ROOKIE[key][races] : 1;
export const rookieTop = (races: number): number =>
  races >= 0 && races < ROOKIE.rivalTop.length ? ROOKIE.rivalTop[races] : 0;
/** Still inside the eased opening races. */
export const inRookie = (races: number): boolean => races >= 0 && races < ROOKIE.len.length;
/**
 * The rookie races forgive a graze. 3.3.65: a beginner who steers along the road but does not yet read
 * traffic took 4 car falls in the first race, and every fall costs about 3.5 s on the ground - 30% of the
 * race lying down, against 19% for the players who finish. Thinning the traffic does not help (dropping
 * race 1 from 0.50 to 0.15 of the division's density moved the ground share only 29% -> 27%): it is the
 * falls that cost, not the cars. So in the opening races the player's shoulder along a car's flank, at a
 * speed near the car's own, is a scrape - shoved aside and slowed - and only a square-on or fast hit floors
 * them. Rivals still fall, and so does the player against an oncoming car: only a car
 * travelling the player's way can be scraped along.
 */
export const SCRAPE = {
  x: 0.8, // metres of lateral gap from the car's middle at or past which the contact is a graze
  keep: 6, // m/s left on top of the closing-speed term
  push: 7, // m/s of sideways shove away from the car
  invT: 8, // ticks before traffic can bite again
};

export const INVULN_TICKS = 45;
export const RECOVER_SPEED = 0.35;

export const CAR = { halfW: 0.95, halfL: 2.2, riderHalfW: 0.4, minSpeed: 9, maxSpeed: 16, oncoming: -14 };
/**
 * Traffic. `sway` is how far a car wanders either side of its lane and `swayS` how many seconds one wander
 * takes, each car out of step with the next: a car's half-width plus a rider's leaves 0.4 m of air on a lane
 * boundary, so without the wander the painted lines would be rails no car could ever touch you on. Half a
 * metre of it closes that gap now and then, which makes riding the line a gamble rather than a free ride.
 */
export const TRAFFIC = { ahead: 260, behind: 50, spawnFrom: 170, base: 9, extra: 6, gap: 14, wall: 34, sway: 0.5, swayS: 7 };

export * from './law';

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
/** Knocking someone into traffic or the barrier pays more than a plain knockout. */
export const SHOVE_BONUS = 100;
export const GRUDGE_BONUS = 150;
/**
 * Flair (src/sim/flair.ts). A near miss: passing a car at `nearSpeed` m/s or more with at most `nearGap` m
 * of air between rider and car. A KO chain: each KO within `chainS` s of the last one pays `chainPay` per
 * link after the first, up to `chainMax` links' worth.
 */
export const FLAIR = { nearGap: 1, nearSpeed: 10, nearPay: 25, chainS: 3, chainPay: 20, chainMax: 3 };
/** Knock the player off this many times and a rival becomes a grudge. */
/**
 * Security shift (src/sim/chase.ts): the runners ride at the player's own top speed times `slow` (3.3.47: it
 * used to be their own, so a capped scooter left the whole field behind and the shift ended with most of them
 * never caught), the player held for `hold` seconds, cash per runner caught and for catching them all. The pay
 * follows `prize ** curve`, not the purse itself -- what a race pays the player barely doubles across the
 * ladder while the purse multiplies elevenfold (3.3.45). Offered after `unlock` races.
 */
export const CHASE = { slow: 0.93, hold: 4, bounty: 170, sweep: 470, unlock: 3, curve: 0.45 };
export const GRUDGE_AT = 2;

/**
 * The nemesis (picked by the career, src/career.ts): one rival who comes for the player every race, a
 * little faster (`top` m/s), keener (`aggr`) and tougher (`hp` more hits) than usual, and hunts them like a
 * grudge does.
 */
export const NEMESIS = { top: 0.6, aggr: 0.2, hp: 2 };

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
  { name: 'Bumper', top: 28.7, aggr: 0.9, aware: 0.8, body: 0xe8e4da, ride: 0xd23c3c, weapon: 'bat' },
  { name: 'Wobbles', top: 27.0, aggr: 0.4, aware: 0.45, body: 0x7fb6e8, ride: 0x2f5fb0 },
  { name: 'Dent', top: 28.1, aggr: 0.75, aware: 0.75, body: 0xf09a4a, ride: 0x2b2b30 },
  { name: 'Sticker', top: 27.4, aggr: 0.55, aware: 0.6, body: 0x9ad07a, ride: 0x6b3fa0, weapon: 'pan' },
  { name: 'Nugget', top: 26.6, aggr: 0.3, aware: 0.55, body: 0xd9a6e0, ride: 0x18a39a },
  { name: 'Torque', top: 29.1, aggr: 0.6, aware: 0.9, body: 0xb0b4bc, ride: 0xe0b020 },
  { name: 'Crumple', top: 27.6, aggr: 0.85, aware: 0.5, body: 0xe86a8a, ride: 0x3a7d3a },
];

export const RIVAL_HP = 3;
/**
 * How rivals and thugs ride. None of them sees the others as they are now: each one reacts to where they
 * were a reaction time ago (carried forward a little), has to build up and kill its sideways speed, and
 * sticks with what it decided for a while. So nobody copies the player's moves the same tick, and a
 * feint or a hard brake can fool them.
 */
export const AI = {
  /**
   * Rivals rubber-band around the player so fights keep happening: one behind rides up to `catchUp` over its
   * top speed, one ahead up to `dropBack` under it, reaching full strength `per` metres away.
   * 3.3.50: the band also paid back every knockdown. A rival the player put on the tarmac lost 65 m and had
   * half of it back in 10 s and all of it in 30-45 s, so on a 160 s race the brawling bought no places at
   * all -- a bot that fought finished no better than the same bot that only drove. A rider who comes off now
   * rides `downSecs` with no catch-up: the ground they lost is theirs to make up.
   */
  band: { catchUp: 0.2, dropBack: 0.22, per: 100, downSecs: 20 },
  /**
   * 3.3.71: a new player's first race rubber-bands harder on the way down only: a rival ahead of them
   * eases off up to `dropBack` over `per` metres (live data: 30 of the 46 who quit race 1 mid-race were in
   * 6th-8th, median 29 s in). Headless beginner (follows the road, reads no traffic), 300 races: 6th or
   * worse at 15 s 44% -> 14%, top three at the line 56% -> 81%. The catch-up side is untouched.
   */
  firstRaceBand: { dropBack: 0.5, per: 40 },
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
  swingAtPlayer: 0.1, // per tick while in reach, times aggression
  swingAtRival: 0.02,
  /** Swing keenness when the other is level and just swung (open), or still lining up. */
  swingOpen: 1.8,
  lookBase: 1.4, // seconds of traffic look-ahead
  lookAware: 2,
  /** Seconds a line picked to get round traffic is kept. */
  escHold: 0.7,
};

/**
 * Road features, placed per race (their own dice) in evenly spaced slots over this stretch of the race,
 * each moved up to `jitter` of a slot either way.
 */
export const FEATURES = { from: 0.14, to: 0.9, jitter: 0.25 };

/**
 * Construction zone: cones close the right lane (lane 3) for `len` metres. They funnel in over `taper`
 * metres before it and out over `out` after; riders keep left of `edge`. A rider who hits the cones
 * faster than crashSpeed goes down; cars merge out of the lane within carMerge metres of the cones.
 */
export const WORKS = { len: [90, 150] as const, taper: 26, out: 14, edge: 3.1, crashSpeed: 10, carMerge: 40 };

/**
 * Shortcut trail: a dirt track just outside the barrier on one side. The barrier opens for `gap` metres
 * at its start (get across before it closes again, or hit its end post) and for `merge` metres at its
 * end, where the trail runs back onto the road. Riders on it keep between inner and outer, ride at `top`
 * of their speed, but every metre there counts `gain` metres of the road: it cuts a corner. Past `split`
 * a rider is off the road (riders on it and on the road can't touch or hit each other). Rivals decide
 * once per trail whether to take it: take[0] + take[1] * awareness.
 */
export const CUT = {
  len: [150, 210] as const, gap: 24, merge: 22, split: 8.2, inner: 9.9, outer: 13.3, mid: 11.6,
  gain: 1.3, top: 0.9, take: [0.3, 0.55] as const, look: 90, lineUp: 60,
};

/**
 * Ramps: one in a lane (cars keep out of that lane from before..after it), one mid-trail. Over it faster
 * than minSpeed sends a rider flying for `air` seconds per m/s: no blows either way, no traffic, and the
 * speed frozen at what the ramp was taken at. Landing gives `boost` speed, and landing on a rider (stomp)
 * knocks them off. `airSteer` is what a lean in the air is worth, as a fraction of the rider's own steering
 * speed on the road (3.3.80): it used to be nothing at all, and a jump at 30 m/s is a full second of road --
 * about a lane and a half of it -- crossed with the hands tied, so the player came down in whatever lane the
 * ramp pointed them at and ate the car standing in it. At 0.45 the base bike moves 3.8 m/s up there: enough
 * to pick which lane to come down in, not enough to cross the road. It is a lean, not a carve.
 */
export const RAMP = { halfW: 1.2, trailHalfW: 1.7, air: 0.035, airSteer: 0.45, minSpeed: 10, boost: 1.08, stompX: 1.1, stompZ: 1.6, before: 10, after: 3 };

// The career ladder (divisions, seasons, rides, upgrade levels) lives in ladder.ts; it reads as part of config.
export * from './ladder';

export const PLAYER_BODY = 0xf2c230;
export const PLAYER_RIDE = 0x2a6fdb;
