// A replay is the race's options plus the player's input on every tick it changed. Played back on
// the same SIM_VERSION it reproduces the race exactly, which the final hash proves. Used by the tests
// and for bug reports (`__game.replay()` in the browser console).

import { SIM_VERSION } from './config';
import { hashState } from './hash';
import { World, type Input, type WorldOpts } from './world';

/** [tick, targetX, steer, brake (0/1), taps (bits: 1 attack, 2 remount; they last one tick)] */
export type InputRow = [number, number | null, number, number, number];

export interface Replay {
  v: number;
  opts: WorldOpts;
  /** Inputs as they stood before each tick's step; a row only when something changed or attack is held. */
  rows: InputRow[];
  /** The tick the recording stopped at, and the state hash there. */
  end: number;
  hash: string;
}

export class Recorder {
  private readonly rows: InputRow[] = [];
  private last: InputRow | null = null;

  private readonly opts: WorldOpts;

  constructor(opts: WorldOpts) {
    this.opts = structuredClone(opts); // the caller's save may change later
  }

  /** Call right before `w.step()`, after the input is set for this tick. */
  capture(w: World): void {
    const i = w.input;
    const row: InputRow = [w.tick, i.targetX, i.steer, i.brake ? 1 : 0, (i.attack ? 1 : 0) | (i.remount ? 2 : 0)];
    const l = this.last;
    if (l && !row[4] && l[1] === row[1] && l[2] === row[2] && l[3] === row[3] && !l[4]) return;
    this.rows.push(row);
    this.last = row;
  }

  finish(w: World): Replay {
    return { v: SIM_VERSION, opts: structuredClone(this.opts), rows: this.rows.map((r) => [...r] as InputRow), end: w.tick, hash: hashState(w) };
  }
}

function apply(inp: Input, row: InputRow, tick: number): void {
  inp.targetX = row[1];
  inp.steer = row[2];
  inp.brake = row[3] === 1;
  const now = row[0] === tick;
  inp.attack = now && (row[4] & 1) !== 0;
  inp.remount = now && (row[4] & 2) !== 0;
}

/** Re-run a replay. `ok` is false when the final state differs from the recorded one. */
export function playReplay(r: Replay, onTick?: (w: World) => void): { world: World; hash: string; ok: boolean } {
  if (r.v !== SIM_VERSION) throw new Error(`replay is for sim v${r.v}, this build runs v${SIM_VERSION}`);
  const w = new World(structuredClone(r.opts));
  let k = 0;
  let cur: InputRow | null = null;
  while (w.tick < r.end) {
    while (k < r.rows.length && r.rows[k][0] <= w.tick) cur = r.rows[k++];
    if (cur) apply(w.input, cur, w.tick);
    w.step();
    w.events.length = 0;
    onTick?.(w);
  }
  const hash = hashState(w);
  return { world: w, hash, ok: hash === r.hash };
}
