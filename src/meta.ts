// What carries over between races: cash, upgrades, grudges, the career. Saved in localStorage when it is available.

import type { Upgrades } from './sim/world';
import { DIVISIONS } from './sim/config';
import { newCup, type Cup } from './career';

export interface Save {
  cash: number;
  up: Upgrades;
  grudges: number[];
  races: number;
  best: number;
  /** Division index into DIVISIONS. */
  div: number;
  cup: Cup;
  /** Times the top division's cup was won. */
  titles: number;
}

const KEY = 'dummy-brawl-v1';

export function loadSave(): Save {
  const fresh: Save = { cash: 0, up: { top: 0, steer: 0, hp: 0 }, grudges: [], races: 0, best: 0, div: 0, cup: newCup(), titles: 0 };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fresh;
    const s = JSON.parse(raw) as Partial<Save>;
    const cup = newCup();
    if (s.cup && Array.isArray(s.cup.pts)) {
      cup.race = Math.max(0, Math.floor(Number(s.cup.race) || 0));
      s.cup.pts.forEach((p, i) => { if (i < cup.pts.length) cup.pts[i] = Number(p) || 0; });
    }
    return {
      cash: Number(s.cash) || 0,
      up: { top: s.up?.top ?? 0, steer: s.up?.steer ?? 0, hp: s.up?.hp ?? 0 },
      grudges: Array.isArray(s.grudges) ? s.grudges.filter((n) => typeof n === 'number') : [],
      races: Number(s.races) || 0,
      best: Number(s.best) || 0,
      div: Math.max(0, Math.min(DIVISIONS.length - 1, Math.floor(Number(s.div) || 0))),
      cup,
      titles: Number(s.titles) || 0,
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
