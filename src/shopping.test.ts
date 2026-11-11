import { beforeEach, describe, expect, it, vi } from 'vitest';
import { upgradePrice } from './career';
import { parseSave, type Save } from './meta';
import { carryPrice } from './shop';
import * as C from './sim/config';

const host = vi.hoisted(() => ({
  sent: [] as { name: string; data: Record<string, unknown> }[],
  saved: [] as string[],
  coins: 0,
  bought: 0,
  ad: false,
}));

vi.mock('./platform', () => ({
  track: (name: string, data?: Record<string, unknown>) => { host.sent.push({ name, data: data ?? {} }); },
  saveData: (json: string) => { host.saved.push(json); },
  showRewarded: () => Promise.resolve(host.ad),
}));
vi.mock('./view/audio', () => ({ sfx: { coin: () => { host.coins++; } } }));
vi.mock('./telemetry', () => ({ bought: () => { host.bought++; } }));

const { counted, shopActions, streakDouble } = await import('./shopping');

/** Just enough of a button for `streakDouble` to wire itself to. */
function button() {
  return { disabled: false, onclick: null as null | (() => void) } as unknown as HTMLButtonElement;
}
/** Tap it. The handler never looks at the event, so none is made (there is no DOM here). */
const click = (btn: HTMLButtonElement) => (btn.onclick as unknown as () => void)();

/** A save with money in it, and the buttons wired to it. */
function shop(cash = 10_000) {
  const save: Save = parseSave(null);
  save.cash = cash;
  let redraws = 0;
  const won: { id: string; pay: number }[] = [];
  const act = shopActions(save, () => { redraws++; }, (u) => won.push(...u));
  return { save, act, won, redraws: () => redraws };
}

const named = (name: string) => host.sent.filter((e) => e.name === name);

beforeEach(() => {
  host.sent.length = 0;
  host.saved.length = 0;
  host.coins = 0;
  host.bought = 0;
  host.ad = false;
});

describe('the results screen does the shopping', () => {
  it('an upgrade is paid for, counted, saved and redrawn', () => {
    const { save, act, redraws } = shop();
    const price = upgradePrice(save, 'top');
    expect(price).toBeGreaterThan(0);

    act.buy('top');

    expect(save.up.top).toBe(1);
    expect(save.cash).toBe(10_000 - price!);
    expect(named('upgrade_purchased')[0].data).toMatchObject({ upgrade_id: 'top', level: 1, price, cash: save.cash });
    expect(host.bought).toBe(1); // the purchase counter the ad side reads
    expect(host.coins).toBe(1);
    expect(host.saved.length).toBe(1);
    expect(JSON.parse(host.saved[0]).cash).toBe(save.cash);
    expect(redraws()).toBe(1);
  });

  it('a purchase the player cannot afford changes nothing at all', () => {
    const { save, act, redraws } = shop(0);
    act.buy('top');
    act.carry('bat');

    expect(save.up.top).toBe(0);
    expect(save.carry).toBe(null);
    expect(host.sent).toEqual([]);
    expect(host.saved).toEqual([]); // no write, so a failed tap cannot clobber the save
    expect(host.coins).toBe(0);
    expect(redraws()).toBe(0);
  });

  it('choosing something already owned is free: it saves and redraws, but does not jingle', () => {
    const { save, act, redraws } = shop();
    act.paint(0); // the paint the player starts in

    expect(save.paint.cur).toBe(0);
    expect(save.cash).toBe(10_000);
    expect(named('paint_chosen')[0].data).toMatchObject({ paint: 0, bought: false, price: 0 });
    expect(host.coins).toBe(0);
    expect(host.bought).toBe(0);
    expect(host.saved.length).toBe(1);
    expect(redraws()).toBe(1);
  });

  it('a hat and a ride report whether they had to be bought', () => {
    const { save, act } = shop();
    act.hat(4); // locked until the Pro season
    expect(save.hat.cur).toBe(0);
    expect(named('hat_chosen')).toEqual([]);

    act.hat(1);
    expect(save.hat.cur).toBe(1);
    expect(named('hat_chosen')[0].data).toMatchObject({ hat: 1, bought: true });
    expect((named('hat_chosen')[0].data.price as number) > 0).toBe(true);

    act.hat(0); // back to the free one, already owned
    expect(named('hat_chosen')[1].data).toMatchObject({ hat: 0, bought: false, price: 0 });
  });

  it('a weapon is carried one at a time', () => {
    const { save, act } = shop();
    const price = carryPrice(save, 'bat');
    act.carry('bat');
    expect(save.carry).toBe('bat');
    expect(save.cash).toBe(10_000 - price);
    expect(named('weapon_bought')[0].data).toMatchObject({ weapon: 'bat', price });

    act.carry('pan'); // one is already in the bag
    expect(save.carry).toBe('bat');
    expect(named('weapon_bought').length).toBe(1);
  });

  it('counts the achievements a purchase won, with one jingle for the lot', () => {
    const save = parseSave(null);
    save.ach = ['a', 'b'];
    const got = counted(save, [{ id: 'rich', pay: 250 }, { id: 'stylish', pay: 100 }]);

    expect(got.length).toBe(2);
    expect(named('achievement').map((e) => e.data)).toEqual([
      { id: 'rich', n: 2, cash: 250 },
      { id: 'stylish', n: 2, cash: 100 },
    ]);
    expect(host.coins).toBe(1);

    counted(save, []);
    expect(host.coins).toBe(1); // nothing won, nothing heard
  });

  it('a ride is bought once and then just ridden', () => {
    const { save, act, won } = shop(50_000);
    save.div = 2; // rung 2: the Shopping Cart is on sale
    const price = C.VEHICLES[1].price;
    // buying a ride can win an achievement, and `unlock` pays that straight back into the save
    const paid = () => won.reduce((n, a) => n + a.pay, 0);

    act.ride(1);
    expect(save.garage.cur).toBe(1);
    expect(save.garage.owned).toContain(1);
    expect(save.cash).toBe(50_000 - price + paid());
    expect(named('ride_chosen')[0].data).toMatchObject({ ride: 1, bought: true, price });

    const after = save.cash;
    act.ride(0);
    act.ride(1); // owned now, so free
    expect(save.cash).toBe(after);
    expect(named('ride_chosen')[2].data).toMatchObject({ ride: 1, bought: false, price: 0 });
  });

  it('a ride the season has not opened yet cannot be bought at any price', () => {
    const { save, act } = shop(1_000_000);
    act.ride(3); // rung 6, and the player is on rung 0
    expect(save.garage.cur).toBe(0);
    expect(save.cash).toBe(1_000_000);
    expect(host.sent).toEqual([]);
  });

  describe("the streak's double-pay ad", () => {
    it('pays once when the ad plays, and not again', async () => {
      const { save } = shop(0);
      save.streak.pay = 300;
      const btn = button();
      let redraws = 0;
      streakDouble(save, btn, () => { redraws++; });
      host.ad = true;

      click(btn);
      expect(btn.disabled).toBe(true); // no double tap while the ad is up
      await vi.waitFor(() => expect(redraws).toBe(1));
      expect(save.cash).toBe(300);
      expect(save.streak.doubled).toBe(true);
      expect(host.saved.length).toBe(1);
      expect(host.coins).toBe(1);

      btn.disabled = false;
      click(btn);
      await vi.waitFor(() => expect(redraws).toBe(2));
      expect(save.cash).toBe(300); // already doubled today
      expect(host.saved.length).toBe(1);
    });

    it('pays nothing when the ad does not play, and still redraws', async () => {
      const { save } = shop(0);
      save.streak.pay = 300;
      const btn = button();
      let redraws = 0;
      streakDouble(save, btn, () => { redraws++; });

      click(btn);
      await vi.waitFor(() => expect(redraws).toBe(1));
      expect(save.cash).toBe(0);
      expect(save.streak.doubled).toBe(false);
      expect(host.saved).toEqual([]);
    });
  });
});
