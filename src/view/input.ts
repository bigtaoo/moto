// One-finger controls: drag to steer (relative to where the finger went down), tap to slap, press and hold
// still to wind up a haymaker (thrown on letting go). A second finger tapping while the first drags also
// slaps. Keys: arrows/A-D steer, Space/J slap (held: the haymaker), S/Down brake, T taunt, P pause.
// In a portal's iframe the keys go to the portal page until the game's window has the focus: the game asks
// for it at start and again on every press of a finger or mouse in it, and the HUD asks for a click while
// a keyboard player's keys don't reach it (keysReach).

const TAP_MS = 230;
const TAP_PX = 14;
/** A camera this flat would make a pixel of thumb worth half the road: a floor, never reached in practice. */
const MIN_GAIN = 8;
/** Keys the page around the game would scroll on: in a portal's iframe they must only drive the game. */
const NO_SCROLL = new Set([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright']);

/** A mouse (and so most likely a keyboard) is the main pointer: a desktop, not a phone or tablet. */
export const DESKTOP = typeof matchMedia === 'function' && matchMedia('(pointer: fine)').matches;

/** What the player is driving the bike with. */
export type ControlKind = 'key' | 'mouse' | 'touch';
let seenKind: ControlKind | null = null;
/**
 * 3.3.65: the guidance used to key off `DESKTOP`, which is what the device *could* do. Of 83 desktop
 * sessions in the first race of r46, 17 steered with the mouse and 7 by touch (a touch laptop matches
 * `pointer: fine`), yet all of them were told to press Space - and those keyboard-worded cards went
 * unanswered by 46% of keyboard players against 8% of mouse players. So the wording follows what the
 * player has actually pressed, and only falls back on the device until they press anything.
 */
export const controlKind = (): ControlKind => seenKind ?? (DESKTOP ? 'key' : 'touch');
/** Called from the handlers that drive the bike, so a click only to give the iframe focus does not count. */
const sawKind = (k: ControlKind): void => { seenKind = k; };

/** What to call each control, in the words of whatever the player is actually pressing. */
export const STEER_WORD = { key: 'hintSteerKeys', mouse: 'hintSteerDrag', touch: 'hintSteerDrag' } as const;
export const SLAP_WORD = { key: 'hintSlapKeys', mouse: 'hintSlapClick', touch: 'hintSlapTap' } as const;
export const SLAP_BIG_WORD = { key: 'slapNowKeys', mouse: 'slapNowClick', touch: 'slapNowTap' } as const;

/**
 * Where a drag of `dx` CSS px from `anchor` (metres across the road) points, held inside [lo, hi].
 * `pxPerMetre` is how far the bike itself slides on screen for a metre across the road
 * (RaceView.steerPxPerMetre), so a pixel of thumb buys a pixel of bike: the bike stays under the finger
 * instead of trailing it. Sizing the drag off the window's width instead made the same gesture mean three
 * different things on a phone held one way or the other (doc 3.3.30).
 */
export function dragTarget(anchor: number, dx: number, pxPerMetre: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, anchor + dx / Math.max(MIN_GAIN, pxPerMetre)));
}

/** Whether key presses reach the game now (a portal's iframe keeps them until a click in it). */
export function keysReach(): boolean {
  return document.hasFocus();
}

interface Touch {
  id: number;
  x0: number;
  y0: number;
  t0: number;
  moved: boolean;
  anchor: number;
  /** Screen px per metre when the finger went down: held for the drag's life so it can't warp mid-swipe. */
  gain: number;
}

export class Controls {
  targetX: number | null = null;
  steer = 0;
  /**
   * 3.3.66: a phone had no brake at all -- arrows and S were the only way to slow down, so every touch
   * player drove flat out into every pile-up. The HUD's brake button sets this while a finger is on it.
   */
  holdBrake = false;
  /** Held: the brake, from the keys or from the button under the thumb. */
  get brake(): boolean {
    return this.keyBrake || this.holdBrake;
  }
  private keyBrake = false;
  /** Set when a slap is asked for; main consumes it. */
  attack = false;
  /** Set by T (or the HUD's button) for the taunt; main consumes it. */
  taunt = false;
  onPause: (() => void) | null = null;
  /** A finger held still past a tap, or Space/J held: winding up a haymaker (C.CHARGE). */
  get charge(): boolean {
    const d = this.drag;
    if (d && !d.moved && performance.now() - d.t0 >= TAP_MS) return true;
    return this.keys.has(' ') || this.keys.has('j');
  }
  onAny: (() => void) | null = null;
  private drag: Touch | null = null;
  private readonly keys = new Set<string>();

  /**
   * @param playerX where the player is across the road
   * @param reach how far across the player can ride right now: a drag starts from inside it, so pushing out
   *   against the barrier (to slip into a trail's opening when it comes) doesn't leave the next drag offset
   * @param gain screen px the bike moves per metre across the road (0 before a race has a view)
   */
  constructor(private readonly el: HTMLElement, private readonly playerX: () => number, private readonly reach: () => [number, number], private readonly gain: () => number = () => 0) {
    // focusable without a tab stop, so grab() has something inside the document to put the focus on
    el.tabIndex = -1;
    el.style.outline = 'none';
    // ask for the keys from the start (a portal's iframe may still keep them until a click), and on every press
    this.grab();
    window.addEventListener('pointerdown', () => this.grab(), true);
    el.addEventListener('pointerdown', this.down);
    window.addEventListener('pointermove', this.move);
    window.addEventListener('pointerup', this.up);
    window.addEventListener('pointercancel', this.up);
    window.addEventListener('keydown', this.key);
    window.addEventListener('keyup', this.key);
    window.addEventListener('blur', () => { this.keys.clear(); this.syncKeys(); });
  }

  /**
   * Ask the portal's iframe for the keyboard back. An interstitial takes the focus and hands it to the ad's
   * own frame, not back to the game, so without this every race after an ad opened with the HUD asking for a
   * click (3.7.2: `keys_wait` 1-6 s, 37 times over 12 sessions).
   *
   * `window.focus()` on one's own cross-origin iframe is ignored without a user gesture, and `keysReach()`
   * asks `document.hasFocus()`, so the focus has to land on an element *inside* the document: focusing the
   * canvas is what makes the embedder focus the frame. Both, in that order, costs nothing.
   */
  grab(): void {
    window.focus();
    try { this.el.focus({ preventScroll: true }); } catch { /* not focusable yet */ }
  }

  reset(): void {
    this.targetX = null;
    this.drag = null;
    this.attack = false;
    this.taunt = false;
    this.steer = 0;
    this.keyBrake = false;
    this.holdBrake = false;
  }

  private readonly down = (e: PointerEvent): void => {
    this.onAny?.();
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    sawKind(e.pointerType === 'touch' ? 'touch' : 'mouse');
    if (this.drag) {
      // second finger: slap right away
      this.attack = true;
      return;
    }
    const [lo, hi] = this.reach();
    const anchor = Math.max(lo, Math.min(hi, this.targetX ?? this.playerX()));
    this.drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, t0: performance.now(), moved: false, anchor, gain: this.gain() };
  };

  private readonly move = (e: PointerEvent): void => {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    const dx = e.clientX - d.x0;
    if (!d.moved && Math.hypot(dx, e.clientY - d.y0) > TAP_PX) {
      // the travel spent proving this is not a tap starts the drag over: counting it would snap the bike
      // sideways the moment the finger passed TAP_PX
      d.moved = true;
      d.x0 = e.clientX;
      return;
    }
    if (!d.moved) return;
    const [lo, hi] = this.reach();
    this.targetX = dragTarget(d.anchor, dx, d.gain, lo, hi);
  };

  private readonly up = (e: PointerEvent): void => {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    if (!d.moved && performance.now() - d.t0 < TAP_MS) this.attack = true;
    this.drag = null;
  };

  private readonly key = (e: KeyboardEvent): void => {
    const k = e.key.toLowerCase();
    // arrows and Space must not scroll a portal page around the game's iframe
    if (NO_SCROLL.has(k)) e.preventDefault();
    if (e.type === 'keydown') {
      this.onAny?.();
      if (k === 'p') { this.onPause?.(); return; }
      if (k === 't' && !e.repeat) this.taunt = true;
      if ((k === ' ' || k === 'j') && !e.repeat) this.attack = true;
      if (NO_SCROLL.has(k) || k === 'a' || k === 'd' || k === 'j' || k === 's') sawKind('key');
      this.keys.add(k);
    } else {
      this.keys.delete(k);
    }
    this.syncKeys();
  };

  private syncKeys(): void {
    const has = (...ks: string[]) => ks.some((k) => this.keys.has(k));
    const s = (has('arrowright', 'd') ? 1 : 0) - (has('arrowleft', 'a') ? 1 : 0);
    if (s !== 0) this.targetX = null;
    this.steer = s;
    this.keyBrake = has('arrowdown', 's');
  }
}
