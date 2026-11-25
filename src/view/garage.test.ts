import { describe, expect, it, vi } from 'vitest';
import { Garage, garageButton, firstUpInReach, gearGap, stopStack, stopPick, upLevels } from './garage';
import { garageStop } from './garageOpen';
import { careerGear } from '../sim/config';
import { parseSave } from '../meta';
import { upgradePrice } from '../career';

describe('the garage button', () => {
  it('nudges toward the first upgrade, and only an upgrade', () => {
    const save = parseSave(null);
    save.cash = upgradePrice(save, 'top')!;
    expect(garageButton(save)).toContain('nudge');
    save.up.top = 1;
    expect(garageButton(save)).not.toContain('nudge');
  });

  it('knows the moment of the first upgrade: none owned, one affordable (the garage stop, 3.3.62)', () => {
    const save = parseSave(null);
    expect(firstUpInReach(save)).toBe(false); // nothing affordable
    save.cash = upgradePrice(save, 'top')!;
    expect(firstUpInReach(save)).toBe(true);
    save.up.steer = 1;
    expect(firstUpInReach(save)).toBe(false); // one owned already
    save.up.top = 2;
    expect(upLevels(save)).toBe(3);
  });
});

// 3.3.64: the stop holds the race back until the first upgrade is bought. vitest runs in node, so the
// overlay is a stand-in with just enough of an element for the garage to draw into.
function fakeOverlay() {
  const back = { onclick: null as null | (() => void) };
  const first = { onclick: null as null | (() => void) };
  const card = {
    innerHTML: '', querySelectorAll: () => [],
    // the stop's foot button is the purchase since 3.3.72, and `.gback` is what the other ways out use
    querySelector: (q: string) => (q === '.gfirst' ? (card.innerHTML.includes('gfirst') ? first : null) : back),
  };
  const shown = new Set<string>(['hidden']);
  const el = {
    addEventListener: () => {},
    querySelector: () => card,
    classList: { contains: (c: string) => shown.has(c), add: (c: string) => shown.add(c), remove: (c: string) => shown.delete(c) },
  };
  return { el: el as unknown as HTMLElement, card, back, first };
}

describe('the garage stop before a race (3.3.64)', () => {
  const acts = (closed: string[]) => ({
    buy: () => {}, buyLevels: () => {}, ride: () => {}, paint: () => {}, hat: () => {}, carry: () => {}, tune: () => {}, repair: () => {}, close: () => closed.push('close'),
  });

  it('will not go on to the race until the first upgrade is bought', () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(0);
    const { el, card, back } = fakeOverlay();
    const g = new Garage(el);
    const save = parseSave(null);
    save.cash = upgradePrice(save, 'top')!;
    const closed: string[] = [];
    g.show(save, { ...acts(closed), next: true });
    expect(g.mustBuy).toBe(true);
    expect(card.innerHTML).not.toContain('class="back'); // no way out but the race
    back.onclick!(); // the small button the other screens' Back uses
    expect(closed).toEqual([]);
    save.up.top = 1; // bought
    g.redraw();
    expect(g.mustBuy).toBe(false);
    expect(card.innerHTML).toMatch(/class="primary gback">/);
    now.mockReturnValue(5000);
    g.continue();
    expect(closed).toEqual(['close']);
    now.mockRestore();
  });

  // 3.3.72: the stop used to be three rows at one price with nothing to tell them apart and a disabled
  // button at the foot. 16 of 126 new players left on it. Now the foot button is the purchase.
  it('fits the level it recommends and goes racing in one tap', () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(0);
    const { el, card, first } = fakeOverlay();
    const g = new Garage(el);
    const save = parseSave(null);
    save.cash = upgradePrice(save, 'hp')!;
    const closed: string[] = [];
    const bought: string[] = [];
    g.show(save, {
      ...acts(closed), next: true,
      buy: (k) => { bought.push(k); save.up[k] = 1; save.cash = 0; g.redraw(); },
    });
    expect(card.innerHTML).toContain('class="primary gfirst"');
    expect(card.innerHTML).toContain('Takes a hit and stays on'); // every row says what it does
    expect(card.innerHTML).toContain('class="up rec"');
    expect(card.innerHTML).not.toContain('class="tabs"'); // one tab is not a choice
    first.onclick!();
    expect(bought).toEqual(['hp']);
    expect(closed).toEqual(['close']);
    now.mockRestore();
  });

  it('takes Enter on the stop as that same one tap', () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(0);
    const { el } = fakeOverlay();
    const g = new Garage(el);
    const save = parseSave(null);
    save.cash = upgradePrice(save, 'hp')!;
    const closed: string[] = [];
    const bought: string[] = [];
    g.show(save, { ...acts(closed), next: true, buy: (k) => { bought.push(k); save.up[k] = 1; g.redraw(); } });
    expect(g.continue()).toBe(true); // too soon: the screen has not been up long enough to read
    expect(bought).toEqual([]);
    now.mockReturnValue(5000);
    expect(g.continue()).toBe(true);
    expect(bought).toEqual(['hp']);
    expect(closed).toEqual(['close']);
    now.mockRestore();
  });

  it('lets the player out of a garage they opened themselves, upgrade or not', () => {
    const { el, back } = fakeOverlay();
    const g = new Garage(el);
    const save = parseSave(null);
    save.cash = upgradePrice(save, 'top')!;
    const closed: string[] = [];
    g.show(save, acts(closed));
    expect(g.mustBuy).toBe(false);
    back.onclick!();
    expect(closed).toEqual(['close']);
  });
});

// 3.3.83: the stop stopped being a beat in the opening and became the ladder's gear check. On r53 every
// new player met it once, at race 1, bought toughness, and never opened the garage again -- while the
// first promotion stepped the rivals 7.1 m/s in one race. 15 of the 16 who got there owned no top speed
// at all, their median finish was 7th, and 10 of them quit in the middle of that race.
describe('the gear check in front of a new division (3.3.83)', () => {
  const acts = (closed: string[] = []) => ({
    buy: () => {}, buyLevels: () => {}, ride: () => {}, paint: () => {}, hat: () => {}, carry: () => {}, tune: () => {}, repair: () => {}, close: () => closed.push('close'),
  });
  it('asks careerGear what the field is riding, so the two cannot drift apart', () => {
    const save = parseSave(null);
    expect(gearGap(save)).toBe(0); // the rookie division races the stock scooter by design
    save.div = 1;
    expect(gearGap(save)).toBe(careerGear(1, 0).up.top); // five levels behind on the first promotion
    save.up.top = 2;
    expect(gearGap(save)).toBe(careerGear(1, 0).up.top - 2);
    save.up.top = 9;
    expect(gearGap(save)).toBe(0); // never negative: a player ahead of the field is not sold anything
  });

  it('prices the stack the cash reaches, and stops at the season cap', () => {
    const save = parseSave(null);
    save.div = 1;
    save.cash = 1_000_000;
    const all = stopStack(save);
    expect(all.n).toBe(careerGear(1, 0).up.top);
    expect(all.cost).toBe(3952); // 250 + 400 + 640 + 1024 + 1638, against a 7.1 m/s step
    save.cash = 700;
    expect(stopStack(save)).toEqual({ n: 2, cost: 650 }); // 250 + 400; the third is 640 and out of reach
    save.cash = 100;
    expect(stopStack(save).n).toBe(0);
  });

  it('sells speed where the field is faster, the first upgrade where it is not, and nothing to the player who has kept up', () => {
    const save = parseSave(null);
    expect(stopPick(save)).toBe(null); // race 1, no cash
    save.cash = upgradePrice(save, 'hp')!;
    expect(stopPick(save)).toBe('hp'); // 3.3.64's opening buy, unchanged
    save.div = 1;
    expect(stopPick(save)).toBe('top'); // behind the division: speed first
    save.up.top = 9;
    expect(stopPick(save)).toBe(null); // caught up with the field, and nothing else is pressed on them
  });

  it('comes up once at each rung of the ladder, not once for the career', async () => {
    // its own copy of the module: `stoppedAt` is session state, and this is the one test that writes it
    vi.resetModules();
    const { garageStop: stops, openGarage: open } = await import('./garageOpen');
    const save = parseSave(null);
    save.cash = 1_000_000;
    const now = vi.spyOn(performance, 'now').mockReturnValue(0);
    const see = () => open(new Garage(fakeOverlay().el), save, acts(), () => {}, 'stop', 'results');
    expect(stops(save)).toBe(true); // the rookie's first upgrade
    see();
    expect(stops(save)).toBe(false); // seen it, this rung
    save.div = 1;
    expect(stops(save)).toBe(true); // a new division, a new field to keep up with
    see();
    expect(stops(save)).toBe(false);
    // the promotion to Pro sends `save.div` back to 0 (src/career.ts) across the widest gear step in
    // the game. Keyed on the division alone, the one stop that matters most would be swallowed here.
    save.tier = 1;
    save.div = 0;
    expect(careerGear(0, 1).up.top).toBeGreaterThan(0);
    expect(stops(save)).toBe(true);
    now.mockRestore();
  });

  it('leaves alone the player whose garage has kept up', () => {
    const save = parseSave(null);
    save.cash = 1_000_000;
    save.div = 3;
    save.up.top = 9;
    save.up.steer = 9;
    save.up.hp = 9;
    expect(garageStop(save)).toBe(false);
  });

  it('fits the whole stack in one tap, a level at a time so each one lands in the funnel', () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(0);
    const { el, card, first } = fakeOverlay();
    const g = new Garage(el);
    const save = parseSave(null);
    save.div = 1;
    save.cash = 5500; // what the r53 cohort was holding, unspent, when it met this division
    const closed: string[] = [];
    const bought: string[] = [];
    g.show(save, {
      ...acts(closed), next: true,
      buyLevels: (k, n) => {
        for (let i = 0; i < n; i++) { bought.push(k); save.cash -= upgradePrice(save, k) ?? 0; save.up[k]++; }
        g.redraw();
      },
    });
    expect(g.mustBuy).toBe(true);
    expect(card.innerHTML).toContain('Dust Bowl'); // the hint names the division they have just reached
    first.onclick!();
    expect(bought).toEqual(['top', 'top', 'top', 'top', 'top']);
    expect(save.up.top).toBe(5);
    expect(closed).toEqual(['close']);
    now.mockRestore();
  });
});
