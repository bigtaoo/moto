// A whole career, headless: the bot races, the save is settled exactly as in the game, and the cash goes
// on the next ride as soon as it is open and affordable, else on the cheapest upgrade. Prints where the
// career stands after every cup and how long it took (race time plus OVERHEAD_S per race for the
// countdown, results and shop).
// Usage: npx tsx scripts/career.ts [careers] [skill 0..1] [fight|race] [max races]

import { World } from '../src/sim/world';
import * as C from '../src/sim/config';
import { botInput } from '../src/sim/ai';
import { parseSave } from '../src/meta';
import { settleRace, buyUpgrade, chooseRide, rideState, upgradePrice, type UpKey } from '../src/career';

const careers = Number(process.argv[2] ?? 3);
const skill = Number(process.argv[3] ?? 0.8);
const fight = process.argv[4] !== 'race';
const maxRaces = Number(process.argv[5] ?? 300);
const OVERHEAD_S = 20;

const totals: number[] = [];
for (let run = 0; run < careers; run++) {
  const save = parseSave(null);
  let mins = 0;
  let cupMins = 0;
  let cupPlaces = '';
  let edge = 0;
  let raceSecs = 0;
  let done = false;
  console.log(`--- career ${run + 1}`);
  while (!done && save.races < maxRaces) {
    const seed = ((save.races * 7919 + 17 + run * 104729) % 99991) + 1;
    const w = new World({ seed, upgrades: save.up, grudges: save.grudges, div: save.div, tier: save.tier, vehicle: save.garage.cur, nemesis: save.feud.nemesis?.id });
    while (!w.over && w.tick < 400 * C.TICK_HZ) {
      botInput(w, skill, fight);
      w.step();
      w.events.length = 0;
    }
    const of = (f: (r: (typeof w.riders)[number]) => number) => w.riders.map((r) => (r.thug ? 0 : f(r)));
    const at = w.div.name;
    cupPlaces += w.player.place;
    edge = w.player.top - (C.PLAYER_BASE.top + w.div.top);
    raceSecs = Math.max(raceSecs, w.time);
    const s = settleRace(save, {
      place: w.player.place, kos: w.kos, grudgeKos: w.grudgeKos, shoves: w.shoves, fines: w.fines, grudges: [...w.grudges],
      places: of((r) => r.place), koPlayer: of((r) => r.koPlayer), koByPlayer: of((r) => r.koByPlayer),
    });
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
  console.log(`career ${run + 1}: ${save.races} races, ${mins.toFixed(0)} min${done ? '' : ' (not finished)'}`);
}
console.log(`average ${(totals.reduce((a, b) => a + b, 0) / totals.length).toFixed(0)} min`);
