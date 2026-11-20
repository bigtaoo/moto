import { describe, expect, it } from 'vitest';
import { garageButton, firstUpInReach, upLevels } from './garage';
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
