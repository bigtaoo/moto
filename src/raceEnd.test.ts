import { describe, expect, it, vi } from 'vitest';
import * as C from './sim/config';
import { botInput } from './sim/ai';
import { World } from './sim/world';
import { CUP_RACES } from './career';
import { parseSave, type Save } from './meta';

/** The host: a race must settle the same whether or not there is a Bridge, a board or an ad to offer. */
const host = vi.hoisted(() => ({ scores: [] as number[], saved: [] as string[], ad: false }));
vi.mock('./platform', async (orig) => ({
  ...(await orig<typeof import('./platform')>()),
  track: () => {},
  submitScore: (n: number) => { host.scores.push(n); },
  saveData: (json: string) => { host.saved.push(json); },
  rewardedReady: () => host.ad,
}));

const { settleWorld } = await import('./raceEnd');

/** A bot race run to the finish, with the save it should be paid into. */
function raced(opts: ConstructorParameters<typeof World>[0] = { seed: 7 }): { w: World; save: Save } {
  const w = new World(opts);
  while (!w.over && w.tick < 400 * C.TICK_HZ) {
    botInput(w);
    w.step();
    w.events.length = 0;
  }
  return { w, save: parseSave(null) };
}

describe('a cup race settles into the save', () => {
  it('pays the race, the day and nothing else into the cash, and counts the race', () => {
    host.scores.length = 0;
    host.saved.length = 0;
    const { w, save } = raced();
    const res = settleWorld(save, w, 2);
    const achPay = res.ach.reduce((n, a) => n + a.pay, 0);
    expect(res.ach.length).toBeGreaterThan(0); // the first race always wins one
    expect(save.cash).toBe(res.earned + res.daily.cash + res.daily.firstWin + achPay);
    expect(save.races).toBe(1);
    expect(save.best).toBe(res.place);
    expect(save.life.kos).toBe(w.kos);
    expect(save.carry).toBeNull(); // a weapon bought for this race is spent
    expect(host.saved.length).toBe(1); // written once, after everything is paid
    expect(host.scores).toEqual([save.life.kos]);
  });

  it('reports the race the results screen draws', () => {
    const { w, save } = raced();
    const res = settleWorld(save, w, 0);
    expect(res.place).toBe(w.player.place);
    expect(res.total).toBe(w.racers);
    expect(res.kos).toBe(w.kos);
    expect(res.koBonus).toBe(w.kos * C.KO_BONUS);
    expect(res.shoveBonus).toBe(w.shoves * C.SHOVE_BONUS);
    expect(res.time).toBe(w.time);
    expect(res.earned).toBeGreaterThanOrEqual(0);
    expect(res.league.races).toBe(CUP_RACES);
    expect(res.league.race).toBe(1);
    expect(res.league.table.filter((r) => r.me).length).toBe(1);
    expect(res.league.table.every((r) => r.name.length > 0)).toBe(true);
    expect(res.grudges.length).toBe(save.grudges.length);
  });

  it('keeps the thugs out of the league table', () => {
    const { w, save } = raced({ seed: 3, div: 3 });
    const res = settleWorld(save, w, 1);
    expect(w.riders.some((r) => r.thug)).toBe(true); // the later divisions send them
    expect(res.league.table.length).toBe(C.ROSTER.length + 1);
    expect(res.total).toBe(w.racers);
  });

  it('offers to double only what was actually won, and only when an ad is there', () => {
    host.ad = false;
    const a = raced();
    expect(settleWorld(a.save, a.w, 0).double).toBe(0);

    host.ad = true;
    const b = raced();
    const res = settleWorld(b.save, b.w, 0);
    expect(res.double).toBe(res.earned > 0 ? res.earned : 0);
    expect(res.doubled).toBe(false);
    host.ad = false;
  });

  it('scores the day’s challenges at the division it was raced in', () => {
    const { w, save } = raced();
    const res = settleWorld(save, w, 3);
    expect(res.daily.rows.length).toBeGreaterThan(0);
    expect(res.daily.cash).toBeGreaterThanOrEqual(0);
    expect(res.daily.done.every((k) => res.daily.rows.some((r) => r.kind === k && r.done))).toBe(true);
    // the race's own numbers went in: a challenge that counts KOs has seen them
    expect(save.daily.prog.some((p) => p > 0) || w.kos + w.shoves === 0).toBe(true);
  });

  it('settles two races in a row without losing the first', () => {
    const { w, save } = raced();
    const one = settleWorld(save, w, 0);
    const cashAfterOne = save.cash;
    const two = raced({ seed: 11 });
    const res = settleWorld(save, two.w, 0);
    expect(save.races).toBe(2);
    expect(res.league.race).toBe(2);
    expect(save.cash).toBe(cashAfterOne + res.earned + res.daily.cash + res.daily.firstWin + res.ach.reduce((n, a) => n + a.pay, 0));
    expect(save.life.kos).toBe(one.kos + res.kos);
  });
});
