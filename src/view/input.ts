// One-finger controls: drag to steer (relative to where the finger went down), tap to slap, press and hold
// still to wind up a haymaker (thrown on letting go). A second finger tapping while the first drags also
// slaps. Keys: arrows/A-D steer, Space/J slap (held: the haymaker), S/Down brake, T taunt, P pause.
// In a portal's iframe the keys go to the portal page until the game's window has the focus: the game asks
// for it at start and again on every press of a finger or mouse in it, and the HUD asks for a click while
// a keyboard player's keys don't reach it (keysReach).

import { ROAD_HALF } from '../sim/config';

const TAP_MS = 230;
const TAP_PX = 14;
/** Keys the page around the game would scroll on: in a portal's iframe they must only drive the game. */
const NO_SCROLL = new Set([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright']);

/** A mouse (and so most likely a keyboard) is the main pointer: a desktop, not a phone or tablet. */
export const DESKTOP = typeof matchMedia === 'function' && matchMedia('(pointer: fine)').matches;

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
}

export class Controls {
  targetX: number | null = null;
  steer = 0;
  brake = false;
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
   */
  constructor(el: HTMLElement, private readonly playerX: () => number, private readonly reach: () => [number, number]) {
    // ask for the keys from the start (a portal's iframe may still keep them until a click), and on every press
    window.focus();
    window.addEventListener('pointerdown', () => window.focus(), true);
    el.addEventListener('pointerdown', this.down);
    window.addEventListener('pointermove', this.move);
    window.addEventListener('pointerup', this.up);
    window.addEventListener('pointercancel', this.up);
    window.addEventListener('keydown', this.key);
    window.addEventListener('keyup', this.key);
    window.addEventListener('blur', () => { this.keys.clear(); this.syncKeys(); });
  }

  /** Metres of road per CSS pixel: the screen's width covers 1.2 road widths. */
  private get scale(): number {
    return (2 * ROAD_HALF * 1.2) / Math.max(320, window.innerWidth);
  }

  reset(): void {
    this.targetX = null;
    this.drag = null;
    this.attack = false;
    this.taunt = false;
    this.steer = 0;
    this.brake = false;
  }

  private readonly down = (e: PointerEvent): void => {
    this.onAny?.();
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (this.drag) {
      // second finger: slap right away
      this.attack = true;
      return;
    }
    const [lo, hi] = this.reach();
    const anchor = Math.max(lo, Math.min(hi, this.targetX ?? this.playerX()));
    this.drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, t0: performance.now(), moved: false, anchor };
  };

  private readonly move = (e: PointerEvent): void => {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    const dx = e.clientX - d.x0;
    if (!d.moved && Math.hypot(dx, e.clientY - d.y0) > TAP_PX) d.moved = true;
    if (!d.moved) return;
    const [lo, hi] = this.reach();
    this.targetX = Math.max(lo, Math.min(hi, d.anchor + dx * this.scale));
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
    this.brake = has('arrowdown', 's');
  }
}
