// The law and the heat: the test-site security buggies, and how much attention the player has drawn.
// Split out of config.ts, which was sitting exactly on the 500-line cap with no room for the next
// balance round; config.ts re-exports all of it, so the rest of the game still reads these through
// `import * as C from './config'`.

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
  /**
   * Both fines below are written in the first division's money and charged times the stage's prize
   * multiplier (3.3.52), so a ticket is the same bite out of the purse wherever you are racing.
   *
   * Pulling over costs a fine: this much, plus `fineStar` for each full star of heat.
   */
  fine: 8,
  fineStar: 5,
  /** Running from one that had you costs more than pulling over did: this much, plus `ticketStar` a star. */
  ticket: 40,
  ticketStar: 25,
  /** Blocking: it only follows a lane change it is sure of, the player this far past the lane line, ... */
  laneCommit: 0.3,
  /** ... sticks with a lane at least this long, ... */
  laneHold: 12,
  /** ... and inside its lane it shades toward the player's side by up to this much. */
  laneShade: 0.6,
};

/**
 * Heat (0..max stars): fighting where a security buggy can see it, and running from one, makes the next
 * ones come sooner and keener; pulling over cools it. From `rough` stars up a squeezing buggy stops leaving
 * a gap for traffic, so running is a real risk.
 */
export const HEAT = {
  max: 3,
  near: 30, // metres from the buggy within which a fight counts
  hit: 0.15, // per blow the player lands there ...
  down: 0.4, // ... and per rider they knock off there
  flee: 0.7, // a buggy that pressed them gave up without them pulling over
  comply: 1, // taken off when they pull over
  decay: 0.04, // per second
  gap: 0.6, // the wait for the next buggy is divided by 1 + gap * heat ...
  units: 1, // ... extra buggies per star ...
  press: 0.25, // ... press time times 1 + press * heat ...
  react: 1.5, // ... and ticks off its reaction per star
  rough: 2,
};
