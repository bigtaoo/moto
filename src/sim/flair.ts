// Flair, paid on top of the prize: slipping past a car close without touching it (a near miss), and
// chaining knockouts (KOs, stomps and shoves into traffic) within a few seconds of each other.

import * as C from './config';
import type { World } from './world';

export interface Flair {
  /** Near misses this race and what they paid. */
  near: number;
  nearPay: number;
  /** The KO chain running now, ticks left to extend it, the longest chain this race and what chains paid. */
  chain: number;
  chainT: number;
  best: number;
  chainPay: number;
  /** Riders bowled over with the tumbling body, taunts, and what they paid; the boss' bounty (src/sim/stunts.ts). */
  bowls: number;
  bowlPay: number;
  taunts: number;
  tauntPay: number;
  bossPay: number;
}

export const newFlair = (): Flair => ({ near: 0, nearPay: 0, chain: 0, chainT: 0, best: 0, chainPay: 0, bowls: 0, bowlPay: 0, taunts: 0, tauntPay: 0, bossPay: 0 });

/** Cash from the player's stunts this race (bowling, taunts, the boss' bounty). */
export const stuntPay = (f: Flair): number => f.bowlPay + f.tauntPay + f.bossPay;

/** The player put someone down: extend the chain (the second link on pays, more each link up to a cap). */
export function chainKo(w: World): void {
  const f = w.flair;
  f.chain = f.chainT > 0 ? f.chain + 1 : 1;
  f.chainT = Math.round(C.FLAIR.chainS * C.TICK_HZ);
  f.best = Math.max(f.best, f.chain);
  if (f.chain < 2) return;
  const pay = C.FLAIR.chainPay * Math.min(f.chain - 1, C.FLAIR.chainMax);
  f.chainPay += pay;
  w.events.push({ type: 'combo', n: f.chain, pay });
}

/** Each tick, after the traffic: the chain runs down, and cars the player just passed close count. */
export function updateFlair(w: World): void {
  const f = w.flair;
  if (f.chainT > 0 && --f.chainT === 0) f.chain = 0;
  const p = w.player;
  if (p.state !== 'ride' || p.airT > 0 || p.invT > 0 || p.speed < C.FLAIR.nearSpeed) return;
  for (const c of w.cars) {
    if (c.brushed || (c.pz > p.pz) === (c.z > p.z)) continue;
    const gap = Math.abs(p.x - c.x) - C.CAR.halfW - C.CAR.riderHalfW;
    if (gap < 0 || gap > C.FLAIR.nearGap) continue;
    c.brushed = true;
    f.near++;
    f.nearPay += C.FLAIR.nearPay;
    w.events.push({ type: 'nearMiss', pay: C.FLAIR.nearPay });
  }
}
