// What carries over between races: cash, upgrades, grudges, the career, the feuds. Stored through the
// platform (src/platform.ts) as one JSON string.

import type { Upgrades } from './sim/world';
import { DIVISIONS, TIERS, VEHICLES, UPGRADE_MAX } from './sim/config';
import { newCup, newFeud, type Cup, type Feud } from './career';
import { saveData } from './platform';

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
  feud: Feud;
  /** Season (C.TIERS index). */
  tier: number;
  /** Vehicles owned (C.VEHICLES indexes) and the one ridden. */
  garage: { cur: number; owned: number[] };
  /** The player's own sound switch (the host's is separate and not saved). */
  muted: boolean;
  /** Sessions started (analytics: the session number) and the day (UTC days since 1970) of the first one. */
  sessions: number;
  firstDay: number;
}

const num = (v: unknown) => Number(v) || 0;

function readFeud(f: Partial<Feud> | undefined): Feud {
  const out = newFeud();
  if (!f) return out;
  if (Array.isArray(f.beef)) f.beef.forEach((b, i) => { if (i < out.beef.length) out.beef[i] = Math.max(0, num(b)); });
  const n = f.nemesis;
  if (n && n.id >= 1 && n.id < out.beef.length) out.nemesis = { id: Math.floor(n.id), hurt: num(n.hurt), paid: num(n.paid) };
  out.broken = num(f.broken);
  return out;
}

/** The save from its JSON (null or junk: a fresh one). */
export function parseSave(raw: string | null): Save {
  const fresh: Save = {
    cash: 0, up: { top: 0, steer: 0, hp: 0 }, grudges: [], races: 0, best: 0, div: 0, cup: newCup(), titles: 0, feud: newFeud(), tier: 0,
    garage: { cur: 0, owned: [0] }, muted: false, sessions: 0, firstDay: 0,
  };
  try {
    if (!raw) return fresh;
    const s = JSON.parse(raw) as Partial<Save>;
    const cup = newCup();
    if (s.cup && Array.isArray(s.cup.pts)) {
      cup.race = Math.max(0, Math.floor(Number(s.cup.race) || 0));
      s.cup.pts.forEach((p, i) => { if (i < cup.pts.length) cup.pts[i] = Number(p) || 0; });
    }
    const lvl = (v: unknown, max: number) => Math.max(0, Math.min(max, Math.floor(num(v))));
    const owned = [0];
    if (Array.isArray(s.garage?.owned)) for (const v of s.garage.owned) if (Number.isInteger(v) && v > 0 && v < VEHICLES.length && !owned.includes(v)) owned.push(v);
    const cur = Number(s.garage?.cur);
    return {
      cash: Number(s.cash) || 0,
      up: { top: lvl(s.up?.top, UPGRADE_MAX.top), steer: lvl(s.up?.steer, UPGRADE_MAX.steer), hp: lvl(s.up?.hp, UPGRADE_MAX.hp) },
      grudges: Array.isArray(s.grudges) ? s.grudges.filter((n) => typeof n === 'number') : [],
      races: Number(s.races) || 0,
      best: Number(s.best) || 0,
      div: Math.max(0, Math.min(DIVISIONS.length - 1, Math.floor(Number(s.div) || 0))),
      cup,
      titles: Number(s.titles) || 0,
      feud: readFeud(s.feud),
      tier: Math.max(0, Math.min(TIERS.length - 1, Math.floor(num(s.tier)))),
      garage: { cur: owned.includes(cur) ? cur : 0, owned },
      muted: s.muted === true,
      sessions: Math.max(0, Math.floor(num(s.sessions))),
      firstDay: Math.max(0, Math.floor(num(s.firstDay))),
    };
  } catch {
    return fresh;
  }
}

export function storeSave(s: Save): void {
  saveData(JSON.stringify(s));
}
