// A cup race is over: pay it into the save (the race, the day's challenges, achievements, the leaderboard)
// and put together what the results screen shows. The screen and its ads are main.ts'.

import * as C from './sim/config';
import type { World } from './sim/world';
import { stuntPay } from './sim/flair';
import type { Save } from './meta';
import { storeSave } from './meta';
import { CUP_RACES, riderName, settleRace } from './career';
import { dailyFor, scoreDaily, today } from './daily';
import { afterRace } from './rewards';
import { counted } from './shopping';
import type { RaceResult } from './view/results';
import * as platform from './platform';
import * as funnel from './funnel';
import * as tele from './telemetry';

/** `falls`: times the player came off this race. */
export function settleWorld(save: Save, w: World, falls: number): RaceResult {
  const place = w.player.place;
  const of = (f: (r: (typeof w.riders)[number]) => number) => w.riders.map((r) => (r.thug ? 0 : f(r)));
  const s = settleRace(save, {
    place, kos: w.kos, grudgeKos: w.grudgeKos, shoves: w.shoves, nearPay: w.flair.nearPay, chainPay: w.flair.chainPay, stuntPay: stuntPay(w.flair),
    mutator: w.mutator !== null, fines: w.fines, grudges: [...w.grudges],
    places: of((r) => r.place), koPlayer: of((r) => r.koPlayer), koByPlayer: of((r) => r.koByPlayer),
  });
  // the day's challenges and first win, paid at the division the race was run in
  save.daily = dailyFor(save.daily, today());
  const daily = scoreDaily(save.daily, { place, kos: w.kos, shoves: w.shoves, falls, grudge: w.grudgeKos + w.revenge }, w.div.prize);
  save.cash += daily.cash + daily.firstWin;
  const ach = afterRace(save, { place, falls, kos: w.kos, near: w.flair.near, chain: w.flair.best });
  platform.submitScore(save.life.kos);
  storeSave(save);
  funnel.raceDone(place);
  tele.raceEnd(s);
  for (const kind of daily.done) funnel.event('daily_done', { kind, done: daily.rows.filter((r) => r.done).length });
  if (daily.firstWin) funnel.event('first_win', { cash: daily.firstWin });
  counted(save, ach);
  const table = s.table.map((r) => ({ name: riderName(r.id), pts: r.pts, rank: r.rank, me: r.id === 0 }));
  const res: RaceResult = {
    place, total: w.racers, prize: s.prize, kos: w.kos, koBonus: s.koBonus, grudgeKos: w.grudgeKos, grudgeBonus: s.grudgeBonus,
    shoves: w.shoves, shoveBonus: s.shoveBonus, flair: { ...w.flair }, fines: s.fines, earned: s.earned, time: w.time, grudges: save.grudges.map((id) => w.riders[id].name),
    league: { div: w.div.name, race: s.cupRace, races: CUP_RACES, table, end: s.end, next: C.stage(save.div, save.tier, save.endless).name, season: C.TIERS[save.tier].name },
    feud: { out: s.feud, nemesis: save.feud.nemesis, name: riderName },
    daily,
    ach,
    mutator: w.mutator,
    double: s.earned > 0 && platform.rewardedReady() ? s.earned : 0,
    doubled: false,
  };
  if (res.double) tele.adOffer('double_cash');
  return res;
}
