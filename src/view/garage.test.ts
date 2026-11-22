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
  const card = { innerHTML: '', querySelectorAll: () => [], querySelector: () => back };
  const shown = new Set<string>(['hidden']);
  const el = {
    addEventListener: () => {},
    querySelector: () => card,
    classList: { contains: (c: string) => shown.has(c), add: (c: string) => shown.add(c), remove: (c: string) => shown.delete(c) },
  };
  return { el: el as unknown as HTMLElement, card, back };
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
    expect(card.innerHTML).toMatch(/class="primary gback" disabled>/);
    now.mockReturnValue(5000);
    expect(g.continue()).toBe(true); // the key is taken, but the race waits
    back.onclick!();
    expect(closed).toEqual([]);
    save.up.top = 1; // bought
    g.redraw();
    expect(g.mustBuy).toBe(false);
    expect(card.innerHTML).toMatch(/class="primary gback">/);
    g.continue();
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
