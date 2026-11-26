// A keyboard player in a portal's iframe has no keys until they click inside it: they scroll the portal's
// page, and the Bridge holds the game paused for as long as it lacks the focus. The HUD asks for that click,
// and the countdown waits for it so a race doesn't start without them. This is the waiting: how long this
// countdown has stood asking, whether the keys have ever arrived at all, and the one funnel event that says
// how long the wait was.

/**
 * Seconds the countdown waits for a keyboard player's click before starting anyway -- but only once the keys
 * have reached the game at least once this session (`held`). A player who has never had the focus has never
 * played a tick, and is better held on the countdown with the ask on screen than dropped into a race they
 * cannot steer; one who had it and lost it to an ad only needs the race to go on while `grab()` works.
 */
const HOLD_S = 3;

export class KeyWait {
  /** The keys have reached the game at least once this session. */
  private held = false;
  /** Seconds this race's countdown has stood waiting for them. */
  private waited = 0;

  /** `report` is called with the whole wait, in whole seconds, once a countdown stops asking. */
  constructor(private readonly report: (seconds: number, held: boolean) => void) {}

  /**
   * Call once a frame. `reach` is whether the keys are reaching the game now; `asking` whether the countdown
   * is standing still asking for the click. Returns true while the race should go on waiting -- held only so
   * long, since a player whose keys never arrive is better off racing with the ask still on screen than
   * staring at a frozen countdown (any click in the game fixes it). The count carries on past the hold, so
   * the telemetry still reports the whole wait.
   */
  frame(dt: number, reach: boolean, asking: boolean): boolean {
    if (!this.held && reach) this.held = true;
    if (asking) this.waited += dt;
    else if (this.waited > 0) {
      this.report(Math.round(this.waited), this.held);
      this.waited = 0;
    }
    return asking && (!this.held || this.waited < HOLD_S);
  }
}
