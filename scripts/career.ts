// A whole career, headless: the bot races, the save is settled exactly as in the game, and the cash goes
// on the next ride as soon as it is open and affordable, else on the cheapest upgrade. Prints where the
// career stands after every cup and how long it took (race time plus OVERHEAD_S per race for the
// countdown, results and shop).
// Everything a race pays in the game is paid here too (raceEnd.ts): stunts, the boss on a cup's last race,
// the mutator on its 2nd, the day's challenges and first win, achievements, and the login streak (a day is
// `races a day` races). At the end: what was earned, by source, and when the spare cash would have bought
// every paint and hat.
// Usage: npx tsx scripts/career.ts [careers] [skill 0..1] [fight|race] [max races] [races a day]

import { World } from '../src/sim/world';
import * as C from '../src/sim/config';
import { botInput } from '../src/sim/ai';
import { parseSave } from '../src/meta';
import { settleRace, buyUpgrade, chooseRide, rideState, upgradePrice, CUP_RACES, type UpKey } from '../src/career';
import { stuntPay } from '../src/sim/flair';
import { MUTATOR, MUTATORS } from '../src/sim/fun';
import { dailyFor, scoreDaily } from '../src/daily';
import { afterRace, unlock, visit, dayMult } from '../src/rewards';
import { PAINTS, HAT_PRICE, PAINT_TIER, HAT_TIER } from '../src/shop';

const careers = Number(process.argv[2] ?? 3);
const skill = Number(process.argv[3] ?? 0.8);
const fight = process.argv[4] !== 'race';
const maxRaces = Number(process.argv[5] ?? 300);
const perDay = Number(process.argv[6] ?? 6);
const OVERHEAD_S = 20;
/** Every paint and hat. */
const WARDROBE = PAINTS.reduce((a, p) => a + p.price, 0) + HAT_PRICE.reduce((a, p) => a + p, 0);

const src: Record<string, number> = {};
const add = (k: string, v: number) => (src[k] = (src[k] ?? 0) + v);

const totals: number[] = [];
for (let run = 0; run < careers; run++) {
  const save = parseSave(null);
  let mins = 0;
  let cupMins = 0;
  let cupPlaces = '';
  let edge = 0;
  let raceSecs = 0;
  let done = false;
  let day = 1000;
  let wardrobeAt = '';
  console.log(`--- career ${run + 1}`);
  while (!done && save.races < maxRaces) {
    if (save.races % perDay === 0) {
      const sp = visit(save.streak, day++, dayMult(C.stage(save.div, save.tier, save.endless).prize), save.races > 0);
      save.cash += sp;
      add('streak', sp);
      add('achievements', unlock(save).reduce((a, u) => a + u.pay, 0));
    }
    const seed = ((save.races * 7919 + 17 + run * 104729) % 99991) + 1;
    const mutator = save.cup.race === MUTATOR.race ? MUTATORS[Math.floor(save.races / 20) % MUTATORS.length] : undefined;
    const w = new World({ seed, upgrades: save.up, grudges: save.grudges, div: save.div, tier: save.tier, endless: save.endless, vehicle: save.garage.cur,
      nemesis: save.feud.nemesis?.id, boss: save.cup.race === CUP_RACES - 1, mutator });
    let falls = 0;
    while (!w.over && w.tick < 400 * C.TICK_HZ) {
      botInput(w, skill, fight);
      w.step();
      for (const e of w.events) if (e.type === 'crash' && e.rider === 0) falls++;
      w.events.length = 0;
    }
    const of = (f: (r: (typeof w.riders)[number]) => number) => w.riders.map((r) => (r.thug ? 0 : f(r)));
    const at = w.div.name;
    cupPlaces += w.player.place;
    edge = w.player.top - (C.PLAYER_BASE.top + w.div.top);
    raceSecs = Math.max(raceSecs, w.time);
    const s = settleRace(save, {
      place: w.player.place, kos: w.kos, grudgeKos: w.grudgeKos, shoves: w.shoves, nearPay: w.flair.nearPay, chainPay: w.flair.chainPay, stuntPay: stuntPay(w.flair),
      mutator: w.mutator !== null, fines: w.fines, grudges: [...w.grudges],
      places: of((r) => r.place), koPlayer: of((r) => r.koPlayer), koByPlayer: of((r) => r.koByPlayer),
    });
    const base = Math.round(s.prize / (w.mutator ? MUTATOR.prize : 1));
    add('prize', base);
    add('mutator', s.prize - base);
    add('ko+grudge+shove', s.koBonus + s.grudgeBonus + s.shoveBonus);
    add('feud', s.feud.cash);
    add('cup', s.end?.bonus ?? 0);
    add('fines', -s.fines);
    add('near+chain', s.nearPay + s.chainPay);
    add('bowl', w.flair.bowlPay);
    add('taunt', w.flair.tauntPay);
    add('boss', w.flair.bossPay);
    save.daily = dailyFor(save.daily, day);
    const daily = scoreDaily(save.daily, { place: w.player.place, kos: w.kos, shoves: w.shoves, falls, grudge: w.grudgeKos + w.revenge }, dayMult(w.div.prize));
    save.cash += daily.cash + daily.firstWin;
    add('daily', daily.cash);
    add('first win', daily.firstWin);
    add('achievements', afterRace(save, { place: w.player.place, falls, kos: w.kos, near: w.flair.near, chain: w.flair.best }).reduce((a, u) => a + u.pay, 0));
    const m = (w.time + OVERHEAD_S) / 60;
    mins += m;
    cupMins += m;
    // spend: the next ride first, then the cheapest upgrade, until nothing is affordable
    for (let v = C.VEHICLES.length - 1; v > save.garage.cur; v--) {
      const st = rideState(save, v);
      if (st === 'owned' || (st === 'buy' && save.cash >= C.VEHICLES[v].price)) { chooseRide(save, v); break; }
    }
    const nextRide = C.VEHICLES.findIndex((_, i) => i > save.garage.cur && rideState(save, i) === 'buy');
    const saving = nextRide > 0 ? C.VEHICLES[nextRide].price : 0;
    // save up for the next ride once it is within two races' earnings
    const keep = saving && saving - save.cash < s.earned * 2 ? saving : 0;
    for (;;) {
      const keys: UpKey[] = ['top', 'steer', 'hp'];
      const k = keys.map((k) => [k, upgradePrice(save, k)] as const).filter(([, p]) => p !== null).sort((a, b) => a[1]! - b[1]!)[0];
      if (!k || save.cash - k[1]! < keep || !buyUpgrade(save, k[0])) break;
    }
    // the bot buys no paints or hats: the cash it sits on is what they could have had (once all are on sale)
    if (!wardrobeAt && save.tier >= Math.max(...PAINT_TIER, ...HAT_TIER) && save.cash - keep >= WARDROBE) wardrobeAt = `${at}, race ${save.races}`;
    if (s.end) {
      const e = s.end;
      console.log(`${at.padEnd(22)} cup ${e.rank}${e.promoted ? ' ↑' : e.champion ? ' ★' : '  '} [${cupPlaces}] edge ${edge.toFixed(1).padStart(4)} max ${raceSecs.toFixed(0)}s ${cupMins.toFixed(0).padStart(3)} min | total ${save.races} races ${mins.toFixed(0)} min | $${save.cash} up ${save.up.top}/${save.up.steer}/${save.up.hp} ride ${C.VEHICLES[save.garage.cur].name} | nemeses broken ${save.feud.broken}`);
      cupMins = 0;
      cupPlaces = '';
      raceSecs = 0;
      if (e.champion && !e.nextTier) done = true;
    }
  }
  totals.push(mins);
  console.log(`career ${run + 1}: ${save.races} races, ${mins.toFixed(0)} min${done ? '' : ' (not finished)'}, ${day - 1000} days; every paint and hat ($${WARDROBE}) affordable from spare cash at: ${wardrobeAt || 'never'}`);
}
const all = Object.values(src).reduce((a, b) => a + b, 0);
for (const [k, v] of Object.entries(src).sort((a, b) => b[1] - a[1])) console.log(`${k.padEnd(16)} ${String(Math.round(v / careers)).padStart(8)}  ${((v / all) * 100).toFixed(1).padStart(5)}%`);
console.log(`average ${(totals.reduce((a, b) => a + b, 0) / totals.length).toFixed(0)} min`);
