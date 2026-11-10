// Riders are solid side to side.

import * as C from './config';
import { clamp, type Side } from './types';
import type { World } from './world';

/**
 * After everyone has moved, each pair alongside is set back to the side gap they need, the correction
 * split evenly (a barrier hands its share to the other rider). Two riders pressing equally hold still; one
 * pressing alone shoves both over at half its steering rate. The needed gap fades smoothly with the distance
 * along the road (riders are rounded, not boxes), so riding up from behind eases you aside instead of
 * toggling a hard wall on and off. Nothing is ever kicked back, so nothing jitters.
 */
export function contacts(w: World): void {
  const rs = w.riders;
  const { width, full, clear } = C.CONTACT;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < rs.length; i++) {
      const a = rs[i];
      if (a.state !== 'ride' || a.airT > 0) continue;
      for (let j = i + 1; j < rs.length; j++) {
        const b = rs[j];
        const dz = Math.abs(b.z - a.z);
        if (b.state !== 'ride' || b.airT > 0 || dz >= clear) continue;
        const t = dz <= full ? 0 : (dz - full) / (clear - full);
        const need = width * (1 - t * t * (3 - 2 * t));
        // Which side b is on comes from where they were before this tick, so it can't flip mid-press.
        const oldDx = b.px - a.px;
        const s: Side = oldDx > 0 || (oldDx === 0 && b.x >= a.x) ? 1 : -1;
        const pen = need - (b.x - a.x) * s;
        if (pen <= 1e-4) continue;
        const na = clamp(a.x - s * pen * 0.5, a.lo, a.hi);
        const movedA = (a.x - na) * s;
        const nb = clamp(b.x + s * (pen - movedA), b.lo, b.hi);
        const movedB = (nb - b.x) * s;
        a.x = clamp(na - s * (pen - movedA - movedB), a.lo, a.hi);
        b.x = nb;
        if (pass > 0 || dz > full) continue;
        // squeeze feedback: lean in, grind, lose a little speed; pinned on the barrier loses more
        a.rubT = b.rubT = C.CONTACT.rubTicks;
        a.rubSide = s;
        b.rubSide = -s as Side;
        a.speed *= C.CONTACT.friction;
        b.speed *= C.CONTACT.friction;
        if (movedA < pen * 0.5 - 1e-4) a.speed *= 0.99;
        if (movedB < pen * 0.5 - 1e-4) b.speed *= 0.99;
        if ((w.tick + i + j) % C.CONTACT.rubEvery === 0) {
          w.events.push({ type: 'rub', x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, side: s, player: a.isPlayer || b.isPlayer });
        }
      }
    }
  }
}
