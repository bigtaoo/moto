// A replay is the race's options plus the player's input on every tick it changed. Played back on
// the same SIM_VERSION it reproduces the race exactly, which the final hash proves. Used by the tests
// for bug reports (`__game.replay()` in the browser console) and for the results' highlight (src/highlight.ts).

import { SIM_VERSION } from './config';
import { hashState } from './hash';
import { World, type Input, type WorldOpts } from './world';

/** [tick, targetX, steer, brake (0/1), bits: 1 attack and 2 remount and 8 taunt (taps: they last one tick), 4 charge (held)] */
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
    const row: InputRow = [w.tick, i.targetX, i.steer, i.brake ? 1 : 0, (i.attack ? 1 : 0) | (i.remount ? 2 : 0) | (i.charge ? 4 : 0) | (i.taunt ? 8 : 0)];
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
  inp.taunt = now && (row[4] & 8) !== 0;
  // a row is kept every tick it is held, and for the tick it is let go
  inp.charge = (row[4] & 4) !== 0;
}

/** A replay played a tick at a time. The tick's events are left on the world for the caller. */
export class Playback {
  readonly world: World;
  private k = 0;
  private cur: InputRow | null = null;

  constructor(private readonly r: Replay) {
    if (r.v !== SIM_VERSION) throw new Error(`replay is for sim v${r.v}, this build runs v${SIM_VERSION}`);
    this.world = new World(structuredClone(r.opts));
  }

  get done(): boolean {
    return this.world.tick >= this.r.end;
  }

  step(): void {
    const w = this.world;
    const rows = this.r.rows;
    while (this.k < rows.length && rows[this.k][0] <= w.tick) this.cur = rows[this.k++];
    if (this.cur) apply(w.input, this.cur, w.tick);
    w.step();
  }
}

/** Re-run a replay. `ok` is false when the final state differs from the recorded one. */
export function playReplay(r: Replay, onTick?: (w: World) => void): { world: World; hash: string; ok: boolean } {
  const p = new Playback(r);
  const w = p.world;
  while (!p.done) {
    p.step();
    w.events.length = 0;
    onTick?.(w);
  }
  const hash = hashState(w);
  return { world: w, hash, ok: hash === r.hash };
}
