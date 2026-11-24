// 3.3.64: the first slap, taught by force on a desktop. On the r45 sandbox 6 of 10 Windows players left in
// race 1 and most never slapped: the controls line names Space for six seconds at the start, when nobody is
// near enough to hit. Mobile players, whose tap is the slap, all found it. So in a desktop rookie's first race
// the first time a rival comes into reach the race all but stops and a big card asks for the key; the slap,
// or a few seconds with no key, lets it go.

import type { Hint } from './view/hud';

// 3.3.65: each half of the controls line stays up until that control has been used, not for six seconds from
// GO: on r46 a tenth of desktop players took over 28 s to steer and over 34 s to slap, so the whole tail went
// hunting after the line had gone.
let usedSteer = false, usedSlap = false;
/** The player drove the bike with this control, so its half of the line has done its job. */
export const usedControl = (k: 'steer' | 'slap'): void => { if (k === 'steer') usedSteer = true; else usedSlap = true; };
/** What the controls line should say while `teach` (a rookie racing, with no bigger card up). */
export const hintNeed = (teach: boolean): Hint | 'off' =>
  teach && (!usedSteer || !usedSlap) ? { steer: !usedSteer, slap: !usedSlap } : 'off';

/** How fast the race runs while the card is up. */
export const COACH_SLOW = 0.12;
/** Real seconds the card waits for the key before the race runs on without it. */
export const COACH_LIMIT_S = 4;
/** How many times a race the card may come up when the key never came. */
export const COACH_TRIES = 2;

export interface CoachReport {
  slapped: boolean;
  /** How long the card was up, in milliseconds. */
  ms: number;
  /** Which time this race the card came up; 0 when the player never needed it. */
  n: number;
  /**
   * The player found the slap on their own, before the card ever came up. 3.3.65: without this the coach
   * only ever reported on the players it had to teach, so the self-taught ones were invisible and the card's
   * answer rate could not be read against them.
   */
  early: boolean;
}

export class SlapCoach {
  private phase: 'off' | 'wait' | 'on' = 'off';
  private t = 0;
  private tries = 0;

  constructor(private readonly report: (r: CoachReport) => void) {}

  /** A new race: `on` when this is a desktop rookie's first race. */
  arm(on: boolean): void {
    this.phase = on ? 'wait' : 'off';
    this.t = 0;
    this.tries = 0;
  }

  get on(): boolean {
    return this.phase === 'on';
  }

  /** The player swung. Before the card ever came up, they have found the key on their own. */
  swung(): void {
    if (this.phase === 'on') this.end(true);
    else if (this.phase === 'wait') {
      this.phase = 'off';
      this.report({ slapped: true, ms: 0, n: 0, early: true });
    }
  }

  /**
   * Once a frame while the race is running (countdown over, not paused). `dt`: real seconds; `inReach`: a
   * rival can be slapped right now. Returns what to scale the race's time by.
   */
  frame(dt: number, inReach: boolean): number {
    if (this.phase === 'wait' && inReach) {
      this.phase = 'on';
      this.t = 0;
      this.tries++;
    }
    if (this.phase !== 'on') return 1;
    this.t += dt;
    if (!inReach || this.t >= COACH_LIMIT_S) this.end(false);
    return this.phase === 'on' ? COACH_SLOW : 1;
  }

  /** The race is over or left: a card still up comes down without a report. */
  stop(): void {
    this.phase = 'off';
  }

  private end(slapped: boolean): void {
    this.report({ slapped, ms: Math.round(this.t * 1000), n: this.tries, early: false });
    this.phase = slapped || this.tries >= COACH_TRIES ? 'off' : 'wait';
  }
}

// 3.3.82: the first steer, asked for before GO. On r51 (11-24 telemetry) 15 of 53 first-race sessions
// never sent a single input event and left in 2-23 s, and merged over 11-23/11-24 only 65% of the people
// dropped into race 1 ever steered once (n=136, +-8). Everything the rounds before this one changed sits
// downstream of that: of the players who do touch the controls, 89% finish race 1 and 84% start race 2.
// So the countdown now stops on its last beat and asks, and the grid is steerable (World.gridSteer) so the
// ask has an answer the bike gives back immediately. It lets go on the first steer, or after START_LIMIT_S
// either way -- nobody is held on a screen they did not ask for.

/** Real seconds the countdown waits for the first steer before it runs on without one. */
export const START_LIMIT_S = 4;
/** Countdown ticks left when the card comes up: one second, so a beat is left to play after they steer. */
export const START_AT = 30;

export interface StartReport {
  /** They steered -- before the card (`shown` false) or in answer to it. */
  steered: boolean;
  /** How long the card was up, in milliseconds. */
  ms: number;
  /** The card came up at all; false when the player steered during the first beat on their own. */
  shown: boolean;
}

export class StartCoach {
  private phase: 'off' | 'wait' | 'on' | 'done' = 'off';
  private t = 0;

  constructor(private readonly report: (r: StartReport) => void) {}

  /** A new race: `on` when this is a new player's very first one. */
  arm(on: boolean): void {
    this.phase = on ? 'wait' : 'off';
    this.t = 0;
  }

  get on(): boolean {
    return this.phase === 'on';
  }

  /**
   * Once a frame. `live`: a real player is on the race screen and not paused; `countdown`: ticks left;
   * `steered`: a steering control is being used right now. Returns whether the countdown must stand still.
   */
  frame(dt: number, live: boolean, countdown: number, steered: boolean): boolean {
    if (this.phase === 'off' || this.phase === 'done') return false;
    if (countdown <= 0) { // GO came without us: nothing left to teach here
      if (this.phase === 'on') this.end(false);
      else this.phase = 'off';
      return false;
    }
    if (!live) return this.phase === 'on'; // paused with the card up: keep the count still, don't age it
    if (steered) {
      this.end(true);
      return false;
    }
    if (this.phase === 'wait') {
      if (countdown > START_AT) return false;
      this.phase = 'on';
      this.t = 0;
    }
    this.t += dt;
    if (this.t >= START_LIMIT_S) {
      this.end(false);
      return false;
    }
    return true;
  }

  /** The race was left or restarted: a card still up comes down without a report. */
  stop(): void {
    this.phase = 'off';
  }

  private end(steered: boolean): void {
    const shown = this.phase === 'on';
    this.phase = 'done';
    this.report({ steered, ms: Math.round(this.t * 1000), shown });
  }
}
