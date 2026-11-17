// A security shift: the same road and field, but the player is the track's security. The runners get away at a
// slightly lower top speed while the player is held on the line for a few seconds; every runner the player
// knocks off is caught and leaves the road. The shift ends once nobody is left to catch, or when the player
// finishes. No buggies, hunters or thugs (world.ts skips them).

import * as C from './config';
import type { Rider } from './types';
import type { World } from './world';

/**
 * The runners ride at CHASE.slow of their own top speed -- but a field that cannot keep up makes the hunt a
 * matter of gear, not of riding: at the bottom of the ladder a capped scooter (37 m/s against a field of 26)
 * rode away from the runners and crossed the line with four of seven never caught. So the handicap is taken
 * against the player's own pace when that is the faster of the two, scaling the field and keeping its own
 * spread. The scale only ever goes up from the flat handicap -- a field that already
 * rides with the player keeps its usual handicap, and is never slowed further (3.3.47).
 */
export function chaseSetup(w: World): void {
  const field = runners(w);
  if (!field.length) return;
  const mean = field.reduce((a, r) => a + r.top, 0) / field.length;
  const k = Math.max(C.CHASE.slow, (w.player.top * C.CHASE.slow) / mean);
  for (const r of field) r.top *= k;
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
