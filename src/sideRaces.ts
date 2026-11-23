// The three races beside the career are settled here: the security shift (src/shift.ts), the free race
// (src/free.ts) and the daily challenge (src/dailyRace.ts). None of them moves the cup, so none of them
// goes near src/raceEnd.ts; all each one has to do is pay, store the save, send its event and put a
// results card up. Lifted out of main.ts in 3.3.76, which had no room left for a third one.

import { settleShift } from './shift';
import { settleFree, type Free } from './free';
import { settleDailyRace } from './dailyRace';
import { today } from './daily';
import { storeSave, type Save } from './meta';
import * as funnel from './funnel';
import { openFree } from './view/scenes';
import type { Results } from './view/results';
import type { World } from './sim/world';

/** What a side race needs of main.ts: the save, where to draw, and the three ways out of the card. */
export interface SideCtx {
  save: Save;
  app: HTMLElement;
  results: Results;
  /** The screen is now the results card. */
  shown: () => void;
  /** Start the next race (`shift` for a security shift). */
  next: (placement: string, shift?: boolean) => void;
  home: () => void;
  /** Take a free race's stake and line it up as the next race. */
  stake: (f: Free) => void;
  /** Security shifts run this session, for the event. */
  shifts: number;
}

/** A free race is over: the stake pays by place, and nothing in the career has moved. */
export function finishFree(c: SideCtx, w: World, f: Free): void {
  const r = settleFree(c.save, w, f);
  storeSave(c.save);
  funnel.event('free_end', { place: r.place, stake: r.stake, paid: r.paid, div: f.div, tier: f.tier });
  c.shown();
  c.results.showFree(r, c.save, {
    again: () => { if (c.save.cash >= f.stake) { c.stake(f); c.next('free_end'); } },
    pick: () => openFree(c.app, c.save, (n) => { c.stake(n); c.next('free_end'); }),
    home: c.home,
  });
}

/** A security shift is over: its bounty, then back to the cup or another shift. */
export function finishShift(c: SideCtx, w: World): void {
  const r = settleShift(c.save, w);
  storeSave(c.save);
  funnel.event('shift_end', { caught: r.caught, of: r.of, cash: r.earned, n: c.shifts });
  c.shown();
  c.results.showShift(r, c.save, { again: () => c.next('shift_end'), shift: () => c.next('shift_end', true), home: c.home });
}

/** Today's challenge is over: one score, today's best kept, and the first run of the day paid. */
export function finishDaily(c: SideCtx, w: World, falls: number): void {
  const r = settleDailyRace(c.save, w, falls, today());
  storeSave(c.save);
  funnel.event('drace_end', { score: r.score.total, place: r.score.place, best: r.best, runs: r.runs, paid: r.paid });
  c.shown();
  c.results.showDailyRace(r, c.save, { again: () => c.next('drace_end'), home: c.home });
}
