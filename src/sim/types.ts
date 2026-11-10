// The sim's data shapes and events, shared by World and the modules that work on it.

import type * as C from './config';

export type Side = -1 | 1;
export type CrashCause = 'ko' | 'car' | 'wall' | 'cones';

export interface Rider {
  id: number;
  name: string;
  isPlayer: boolean;
  x: number;
  z: number;
  px: number;
  pz: number;
  vx: number;
  speed: number;
  top: number;
  accel: number;
  steer: number;
  hp: number;
  maxHp: number;
  wantX: number;
  braking: boolean;
  /** 'away': a thug not on the road right now. */
  state: 'ride' | 'down' | 'away';
  /** Down: ticks left lying on the road; then runT counts ticks spent running back to the scooter. */
  downT: number;
  runT: number;
  /** Down: where the scooter is (it slides on without the rider), last tick's spot, and its speed. */
  bikeX: number;
  bikeZ: number;
  bikePX: number;
  bikePZ: number;
  bikeV: number;
  bikeVx: number;
  invT: number;
  atkT: number;
  atkSide: Side;
  atkCd: number;
  /** Ticks the player has held the slap (C.CHARGE), and the power of the swing under way (0: a plain one). */
  charge: number;
  power: number;
  hitT: number;
  weapon: C.WeaponKind | null;
  finished: boolean;
  place: number;
  aggr: number;
  aware: number;
  body: number;
  ride: number;
  /** Times this rival knocked the player off, and the player them. */
  koPlayer: number;
  koByPlayer: number;
  /** Ticks left of shoulder-to-shoulder pressing, and which side the other rider is on. */
  rubT: number;
  rubSide: Side;
  /** Not in the race: one of the shoulder thugs. */
  thug: boolean;
  /** Ticks left of hunting the leader (rivals). */
  huntT: number;
  /** Thug plan and ticks spent in it; its part when two come together. */
  gang: 'lurk' | 'attack' | 'back' | 'leave';
  gangT: number;
  role: 'strike' | 'block' | 'pincer';
  /** Target speed the AI sets while riding with someone (thugs always, rivals while harassing). */
  pace: number;
  // --- how an AI rider sees and moves (unused for the player) ---
  /** Ticks late it sees the others: everyone reacts to where you were, not where you are. */
  react: number;
  /** Sideways speed and how fast it can change: an AI rider has to start and stop a lane change. */
  latV: number;
  latAcc: number;
  /** What it is up to, for how many more ticks before it thinks again, and the lane (C.LANE_X index) it rides in. */
  intent: 'race' | 'harass' | 'back';
  intentT: number;
  lane: number;
  /** Line picked to get round traffic, held this many more ticks so it doesn't flip-flop. */
  escX: number;
  escT: number;
  /** Harassing: whom, from which side, how far out, and a slow drift so it never sits dead still. */
  foe: number;
  foeSide: Side;
  foeOff: number;
  wob: number;
  wobTo: number;
  /** Who landed the last blow on this rider (-1: nobody yet). */
  hitBy: number;
  /** Ticks left of being carried by a blow (no steering), and of a crash still counting for whoever struck. */
  stagT: number;
  shoveT: number;
  /** Ticks left wide open after swinging at the player and missing. */
  openT: number;
  /** The swing under way: whom it is aimed at (-1: nobody) and where they were and how they were moving then. */
  aim: number;
  aimX: number;
  aimZ: number;
  aimVx: number;
  aimV: number;
  /** Where it was over the last C.AI.memory ticks (ring buffer, indexed by tick), for the others' late view of it. */
  hx: number[];
  hz: number[];
  hv: number[];
  /** Where it can ride this tick (the barrier, the cones, a trail's sides): set by World.move. */
  lo: number;
  hi: number;
  /** Ticks left in the air off a ramp, out of how many. */
  airT: number;
  airMax: number;
  /** The trail (World.road.cuts index) it has made up its mind about, and whether it takes it. */
  cutId: number;
  cutTake: boolean;
}

/** What an AI makes of another rider: where they were a reaction time ago, carried forward. */
export interface Seen {
  x: number;
  z: number;
  speed: number;
  vx: number;
}

export interface Car {
  id: number;
  x: number;
  z: number;
  pz: number;
  speed: number;
  /** The speed it drives at when nothing holds it up. */
  cruise: number;
  lane: number;
  color: number;
  /** The player already passed it close (a near miss counts once a car). */
  brushed: boolean;
}

export interface Pickup {
  id: number;
  x: number;
  z: number;
  kind: C.WeaponKind;
}

/**
 * The security buggy on the road right now, if any. Each one makes a single go at the player and then
 * leaves the race; the next one is a different buggy, from behind or waiting ahead.
 */
export interface Patrol {
  active: boolean;
  /**
   * chase: ride up from behind. lurk: cruise slowly in a side lane ahead, waiting. block: sit in front of
   * the player, slowing and shadowing their line. squeeze: draw level and shove them toward the shoulder.
   * halt: the player did pull over; it draws up beside them, warns them and lets them go.
   * leave: pull off the player's line and drop out.
   */
  mode: 'chase' | 'lurk' | 'block' | 'squeeze' | 'halt' | 'leave';
  t: number;
  /** Which side of the player it works from. */
  side: Side;
  /** Buggies sent so far this race. */
  units: number;
  /** This buggy's plan, rolled when it is sent: where it comes from and which move it makes. */
  from: 'behind' | 'ahead';
  move: 'block' | 'squeeze';
  /** Its rolled numbers: ticks it presses for, metres ahead it blocks at, where it pulls out, lurking pace. */
  press: number;
  blockAhead: number;
  pullOutAt: number;
  pace: number;
  /** Ticks until the next buggy, once this one has gone. */
  wait: number;
  /** Squeezing: which way it shoves the player (away from its own side). */
  push: Side;
  /** Ticks it has actually been at it (level with them, or in front of them); its press time counts these. */
  hold: number;
  /** The driver: ticks late it sees the player, top speed, sideways speed. */
  react: number;
  top: number;
  vx: number;
  /** Blocking: the lane it holds and ticks since it last switched. */
  laneX: number;
  laneT: number;
  /** Ticks the player has looked stopped; ticks spent pulled up beside them; what it goes back to if they take off. */
  slowT: number;
  haltT: number;
  resume: 'block' | 'squeeze';
  x: number;
  z: number;
  px: number;
  pz: number;
  speed: number;
}

export type SimEvent =
  | { type: 'swing'; rider: number; side: Side; aim: number; windup: number; power: number }
  | { type: 'hit'; from: number; to: number; side: Side; dmg: number; ko: boolean; counter: boolean; power: number }
  | { type: 'whiff'; rider: number; dodged: boolean }
  | { type: 'shove'; from: number; to: number; into: 'car' | 'wall' | 'cones' }
  | { type: 'steal'; from: number; to: number; kind: C.WeaponKind; took: boolean }
  | { type: 'crash'; rider: number; cause: CrashCause; vx: number; speed: number }
  | { type: 'recover'; rider: number }
  | { type: 'pickup'; rider: number; kind: C.WeaponKind }
  | { type: 'drop'; pickup: number }
  | { type: 'patrolWarn' }
  | { type: 'patrolLetGo'; fine: number }
  | { type: 'finish'; rider: number; place: number }
  | { type: 'grudge'; rider: number }
  | { type: 'rub'; x: number; z: number; side: Side; player: boolean }
  | { type: 'hunt'; rider: number }
  | { type: 'ambush'; riders: number[] }
  | { type: 'jump'; rider: number }
  | { type: 'land'; rider: number; stomp: number }
  | { type: 'nearMiss'; pay: number }
  | { type: 'combo'; n: number; pay: number }
  | { type: 'go' }
  | { type: 'caught'; rider: number }
  | { type: 'over' };

export interface Upgrades {
  top: number;
  steer: number;
  hp: number;
}

export interface Input {
  /** Lateral target in metres (drag steering); null while keys steer. */
  targetX: number | null;
  steer: number;
  brake: boolean;
  attack: boolean;
  /** The slap held down: winds up a haymaker, thrown on letting go (C.CHARGE). */
  charge: boolean;
  /** Down: back on the scooter right now (paid for with a rewarded ad, once a race). */
  remount: boolean;
}

export interface WorldOpts {
  seed: number;
  upgrades?: Upgrades;
  /** Rival ids that hold a grudge from earlier races. */
  grudges?: number[];
  /** The player's nemesis (a rival id), if they have one. */
  nemesis?: number;
  length?: number;
  /** Division (C.DIVISIONS index): where the race is and how hard. */
  div?: number;
  /** Season (C.TIERS index): harder again on top of the division. */
  tier?: number;
  /** Levels past the career (the last season only, see C.ENDLESS). */
  endless?: number;
  /** The player's ride (C.VEHICLES index). */
  vehicle?: number;
  /** A weapon the player brings to the start (bought in the shop). */
  weapon?: C.WeaponKind;
  /** A security shift instead of a race (src/sim/chase.ts). */
  chase?: boolean;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
