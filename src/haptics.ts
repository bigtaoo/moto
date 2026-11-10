// Short buzzes on phones for the hits that matter: the player's blows, being hit, KOs and crashes. Off on
// desktops and where the browser has no vibration (iOS Safari); the pause menu switches it off (saved).

import { DESKTOP } from './view/input';

/** The device can buzz at all (the pause menu shows the switch only then). */
export const CAN_BUZZ = !DESKTOP && typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

let on = true;
let last = 0;

export function setHaptics(enabled: boolean): void {
  on = enabled;
  if (!enabled && CAN_BUZZ) try { navigator.vibrate(0); } catch { /* ignore */ }
}

/** One buzz of `ms` (or a pattern); buzzes closer than 60 ms apart are dropped so a brawl doesn't drone. */
export function buzz(ms: number | number[]): void {
  if (!on || !CAN_BUZZ) return;
  const now = performance.now();
  if (now - last < 60) return;
  last = now;
  // a cross-origin iframe may refuse without a gesture: harmless
  try { navigator.vibrate(ms); } catch { /* ignore */ }
}
