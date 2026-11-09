// One-finger controls: drag to steer (relative to where the finger went down), tap to slap.
// A second finger tapping while the first drags also slaps. Keys: arrows/A-D steer, Space/J slap, S/Down brake, P pause.

import { ROAD_HALF, EDGE } from '../sim/config';

const TAP_MS = 230;
const TAP_PX = 14;

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
  onPause: (() => void) | null = null;
  onAny: (() => void) | null = null;
  private drag: Touch | null = null;
  private readonly keys = new Set<string>();

  constructor(el: HTMLElement, private readonly playerX: () => number) {
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
    const anchor = this.targetX ?? this.playerX();
    this.drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, t0: performance.now(), moved: false, anchor };
  };

  private readonly move = (e: PointerEvent): void => {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    const dx = e.clientX - d.x0;
    if (!d.moved && Math.hypot(dx, e.clientY - d.y0) > TAP_PX) d.moved = true;
    if (d.moved) this.targetX = Math.max(-EDGE, Math.min(EDGE, d.anchor + dx * this.scale));
  };

  private readonly up = (e: PointerEvent): void => {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    if (!d.moved && performance.now() - d.t0 < TAP_MS) this.attack = true;
    this.drag = null;
  };

  private readonly key = (e: KeyboardEvent): void => {
    const k = e.key.toLowerCase();
    if (e.type === 'keydown') {
      this.onAny?.();
      if (k === 'p') { this.onPause?.(); return; }
      if ((k === ' ' || k === 'j') && !e.repeat) this.attack = true;
      if (k === ' ') e.preventDefault();
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
