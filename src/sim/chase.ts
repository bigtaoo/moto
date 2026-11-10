// A security shift: the same road and field, but the player is the track's security. The runners get away at a
// slightly lower top speed while the player is held on the line for a few seconds; every runner the player
// knocks off is caught and leaves the road. The shift ends once nobody is left to catch, or when the player
// finishes. No buggies, hunters or thugs (world.ts skips them).

import * as C from './config';
import type { Rider } from './types';
import type { World } from './world';

/** The field, slowed a touch so the player can catch up after the hold. */
export function chaseSetup(w: World): void {
  for (const r of w.riders) if (!r.isPlayer && !r.thug) r.top *= C.CHASE.slow;
}

/** A runner the player knocked off: caught, off the road for good. */
export const nabbed = (w: World, r: Rider): boolean => w.chase && !r.isPlayer && !r.thug && r.koByPlayer > 0;

/** Runners on the shift (the whole field). */
export const runners = (w: World): Rider[] => w.riders.filter((r) => !r.isPlayer && !r.thug);

/** Called from credit(): the first takedown of a runner catches them. */
export function onCredit(w: World, v: Rider): void {
  if (v.koByPlayer !== 1 || v.thug) return;
  w.caught++;
  w.events.push({ type: 'caught', rider: v.id });
}

/** Nobody left to catch (all caught and off the road, or got away over the line): wrap up shortly. */
export function chaseEnd(w: World): void {
  if (w.overT > 0) return;
  const open = runners(w).some((r) => !r.finished && !(nabbed(w, r) && r.state === 'away'));
  if (!open) w.overT = w.tick + Math.round(1.6 * C.TICK_HZ);
}

/** What a shift pays: a bounty per runner caught, a bonus for catching the lot. */
export function shiftPay(caught: number, of: number, mult: number): number {
  return Math.round((caught * C.CHASE.bounty + (caught >= of && of > 0 ? C.CHASE.sweep : 0)) * mult);
}
