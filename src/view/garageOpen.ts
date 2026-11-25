// Opening the garage, and the stop that puts it in front of the next race. Lifted out of main.ts in
// 3.3.69, which was sitting on the 500-line cap with the free race still to wire in.

import { buyable, gearGap, stopPick, upLevels, type Garage } from './garage';
import { rung } from '../sim/config';
import * as funnel from '../funnel';
import type { shopActions } from '../shopping';
import type { Save } from '../meta';

/** The rung of the ladder the garage stop has already come up for this session; -1 before any (3.3.83). */
let stoppedAt = -1;

/**
 * 3.3.62: no new player on the r43 sandbox bought an upgrade, cup winners with $2,000 and more included,
 * and the garage tile was a scroll below the "next race" button. So while no upgrade is owned and one is
 * affordable, "next race" goes through the garage first; its button goes on to the race.
 *
 * 3.3.83: that stop used to be a once-a-session tutorial beat, and the level 3.3.64 made it sell was
 * toughness -- which disarmed it, because it only came up while the garage was empty. So on r53 every
 * new player met it once, at race 1, bought `hp`, and never saw the garage again: 38 of the 47 opens in
 * the cohort were that one stop, 9 were voluntary, and the median upgrade count sat at 1 from race 2 to
 * race 18 while the cash climbed past $19,000 unspent. Meanwhile the first promotion stepped the rivals
 * 7.1 m/s in a single race and the median finish went 1st to 7th, with 63% quitting race 4 mid-race.
 *
 * So the stop is no longer a beat in the opening: it is the ladder's gear check. It comes up once at
 * every rung the player arrives at under-geared for, and `gearGap` keeps it honest at both ends --
 * a player whose garage has kept up with the field never sees it at all.
 *
 * The rung, not the division: a new tier sends `save.div` back to 0 (src/career.ts), and the first
 * division of the Pro season is the widest gear step in the game -- the one stop that must not be
 * swallowed by "we already stopped at division 0 this session". And the gate asks `stopPick`, which is
 * exactly what the screen will put on sale: `buyable` counts tune-ups, rides and the paints bought out
 * of the show purse, so it would open a stop with nothing in it to buy.
 */
export const garageStop = (save: Save): boolean =>
  stoppedAt !== rung(save.div, save.tier) && stopPick(save) !== null;

/**
 * The garage over the card that asked for it; `back` puts that card up again when it closes (3.3.40).
 * `from` says which way in it was (analytics, 3.3.62); `stop`: it stands before the next race, and `back`
 * starts that race. `screen` is the funnel's screen to go back to.
 */
export function openGarage(
  g: Garage, save: Save, acts: ReturnType<typeof shopActions>,
  back: () => void, from: 'results' | 'title' | 'stop', screen: string,
): void {
  const t0 = performance.now();
  const cash = save.cash;
  const ups = upLevels(save);
  if (from === 'stop') stoppedAt = rung(save.div, save.tier);
  funnel.event('garage_opened', { from, cash, can_buy: buyable(save), ups, up_top: save.up.top, div: save.div, gap: gearGap(save), career_race: save.races });
  funnel.setScreen('garage');
  g.show(save, {
    ...acts, next: from === 'stop',
    close: () => {
      funnel.event('garage_closed', { from, sec: Math.round((performance.now() - t0) / 1000), spent: cash - save.cash, ups: upLevels(save) - ups, up_top: save.up.top, div: save.div, cash: save.cash });
      funnel.setScreen(screen);
      g.hide();
      back();
    },
  });
}
