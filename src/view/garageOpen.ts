// Opening the garage, and the stop that puts it in front of the next race. Lifted out of main.ts in
// 3.3.69, which was sitting on the 500-line cap with the free race still to wire in.

import { buyable, firstUpInReach, upLevels, type Garage } from './garage';
import * as funnel from '../funnel';
import type { shopActions } from '../shopping';
import type { Save } from '../meta';

/** Whether the garage stop before the next race has come up this session (3.3.62). */
let stopped = false;

/**
 * 3.3.62: no new player on the r43 sandbox bought an upgrade, cup winners with $2,000 and more included,
 * and the garage tile was a scroll below the "next race" button. So once a session, while no upgrade is
 * owned and one is affordable, "next race" goes through the garage first; its button goes on to the race.
 */
export const garageStop = (save: Save): boolean => !stopped && firstUpInReach(save);

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
  if (from === 'stop') stopped = true;
  funnel.event('garage_opened', { from, cash, can_buy: buyable(save), ups, career_race: save.races });
  funnel.setScreen('garage');
  g.show(save, {
    ...acts, next: from === 'stop',
    close: () => {
      funnel.event('garage_closed', { from, sec: Math.round((performance.now() - t0) / 1000), spent: cash - save.cash, ups: upLevels(save) - ups, cash: save.cash });
      funnel.setScreen(screen);
      g.hide();
      back();
    },
  });
}
