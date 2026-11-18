import { describe, expect, it } from 'vitest';
import { garageButton } from './garage';
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
});
