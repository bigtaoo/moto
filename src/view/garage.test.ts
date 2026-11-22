import { describe, expect, it, vi } from 'vitest';
import { Garage, garageButton, firstUpInReach, upLevels } from './garage';
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
    buy: () => {}, ride: () => {}, paint: () => {}, hat: () => {}, carry: () => {}, tune: () => {}, repair: () => {}, close: () => closed.push('close'),
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
