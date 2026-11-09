// What carries over between races: cash, upgrades, grudges. Saved in localStorage when it is available.

import type { Upgrades } from './sim/world';

export interface Save {
  cash: number;
  up: Upgrades;
  grudges: number[];
  races: number;
  best: number;
}

const KEY = 'dummy-brawl-v1';

export function loadSave(): Save {
  const fresh: Save = { cash: 0, up: { top: 0, steer: 0, hp: 0 }, grudges: [], races: 0, best: 0 };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fresh;
    const s = JSON.parse(raw) as Partial<Save>;
    return {
      cash: Number(s.cash) || 0,
      up: { top: s.up?.top ?? 0, steer: s.up?.steer ?? 0, hp: s.up?.hp ?? 0 },
      grudges: Array.isArray(s.grudges) ? s.grudges.filter((n) => typeof n === 'number') : [],
      races: Number(s.races) || 0,
      best: Number(s.best) || 0,
    };
  } catch {
    return fresh;
  }
}

export function storeSave(s: Save): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // private mode or blocked storage: progress lasts for this page only
  }
}
