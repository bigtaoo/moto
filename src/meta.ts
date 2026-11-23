// What carries over between races: cash, upgrades, grudges, the career, the feuds. Stored through the
// platform (src/platform.ts) as one JSON string.

import type { Upgrades } from './sim/world';
import { DIVISIONS, TIERS, VEHICLES, UPGRADE_MAX, upgradeCost, ROSTER, WEAPON, type WeaponKind } from './sim/config';
import { PAINTS, HATS } from './shop';
import { newCup, newFeud, GATE_AT, FIRST_CUP, CUP_RACES, type Cup, type Feud } from './career';
import { TUNE_MAX } from './tune';
import { saveData } from './platform';
import { readDaily, today, type Daily } from './daily';
import { newDailyRace, readDailyRace, type DailyRace } from './dailyRace';
import type { QualityMode } from './view/quality';
import { isLang, type Lang } from './i18n';
import { newStreak, ACH_IDS, type Streak, type Life } from './rewards';

export interface Save {
  cash: number;
  /**
   * The wardrobe's own purse (3.3.79): what showing off pays -- near misses, KO chains, riders bowled over,
   * taunts, the boss' bounty -- kept apart from the race money, and the only money paints and hats take.
   */
  show: number;
  up: Upgrades;
  grudges: number[];
  races: number;
  best: number;
  /** Division index into DIVISIONS: where this cup is being run. */
  div: number;
  /** The highest division reached this season. The cup may be run at any division up to it (3.3.69). */
  reach: number;
  cup: Cup;
  /** Times the top division's cup was won. */
  titles: number;
  /** Top-three cups in a row at a season's last division, towards `GATE_AT` (src/career.ts). */
  gate: number;
  /** Levels past the career: titles in the last season's top division (C.ENDLESS). */
  endless: number;
  feud: Feud;
  /** Season (C.TIERS index). */
  tier: number;
  /** Vehicles owned (C.VEHICLES indexes) and the one ridden. */
  garage: { cur: number; owned: number[] };
  /** Paint jobs owned (src/shop.ts PAINTS indexes) and the one worn. */
  paint: { cur: number; owned: number[] };
  /** Hats owned (src/shop.ts HATS indexes; 0 is none) and the one worn. */
  hat: { cur: number; owned: number[] };
  /** The dummy launch's best score (src/sim/launch.ts). */
  launchBest: number;
  /** A weapon bought for the next race (src/shop.ts), spent when that race pays out. */
  carry: WeaponKind | null;
  /** Levels fitted for the next race only (src/tune.ts), spent when that race pays out. */
  tune: { top: number; steer: number; hp: number };
  /** How dented the ride is, 0 (mint) to 1 (a wreck); it costs levels until it is repaired (src/tune.ts). */
  wear: number;
  /** The player's own sound switch (the host's is separate and not saved). */
  muted: boolean;
  /** Sessions started (analytics: the session number) and the day (UTC days since 1970) of the first one. */
  sessions: number;
  firstDay: number;
  /** The pause menu's switches: music and effects apart (under the sound switch), and the graphics setting. */
  musicOff: boolean;
  sfxOff: boolean;
  /** Phone vibration switched off (src/haptics.ts). */
  hapticsOff: boolean;
  quality: QualityMode;
  /** The language the player picked in the settings card, or null to follow the platform (src/i18n). */
  lang: Lang | null;
  /** Calm motion (src/view/motion.ts): the player's pick, or null to follow the system's reduce-motion. */
  calm: boolean | null;
  /** Today's challenges and first win (src/daily.ts). */
  daily: Daily;
  /** The daily challenge race: today's best score and runs (src/dailyRace.ts). */
  drace: DailyRace;
  /** Every daily race's best score added up: what the public daily board ranks (3.3.77). */
  dpts: number;
  /** Days in a row the game was opened, and what today's visit paid (src/rewards.ts). */
  streak: Streak;
  /** Achievements won (src/rewards.ts ids) and the lifetime counts they need. */
  ach: string[];
  life: Life;
}

const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

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
  /** 3.3.35 renamed two knockdown achievements with their targets: an old save keeps what it won. */
const WAS: Record<string, string> = { koRace: 'kos25', koLife: 'kos1000' };

const fresh: Save = {
    cash: 0, show: 0, up: { top: 0, steer: 0, hp: 0 }, grudges: [], races: 0, best: 0, div: 0, reach: 0, cup: newCup(FIRST_CUP), titles: 0, gate: 0, endless: 0, feud: newFeud(), tier: 0,
    garage: { cur: 0, owned: [0] }, paint: { cur: 0, owned: [0] }, hat: { cur: 0, owned: [0] }, launchBest: 0, carry: null, tune: { top: 0, steer: 0, hp: 0 }, wear: 0, muted: false, sessions: 0, firstDay: 0, musicOff: false, sfxOff: false, hapticsOff: false, quality: 'auto', lang: null, calm: null, daily: readDaily(null, today()), drace: newDailyRace(today()), dpts: 0,
    streak: newStreak(), ach: [], life: { kos: 0, wins: 0 },
  };
  try {
    if (!raw) return fresh;
    const s = JSON.parse(raw) as Partial<Save>;
    // a career that has not finished a race yet starts on the short first cup, also when an older build
    // stored its save before that race (3.3.60)
    const cup = newCup(s.cup?.of === FIRST_CUP || (!num(s.races) && !num(s.cup?.race)) ? FIRST_CUP : CUP_RACES);
    if (s.cup && Array.isArray(s.cup.pts)) {
      cup.race = Math.max(0, Math.floor(Number(s.cup.race) || 0));
      s.cup.pts.forEach((p, i) => { if (i < cup.pts.length) cup.pts[i] = Number(p) || 0; });
    }
    const lvl = (v: unknown, max: number) => Math.max(0, Math.min(max, Math.floor(num(v))));
    /**
     * A level that no longer exists is paid back. 3.3.42 cut toughness from six levels to three, and a
     * save from before that has up to three levels the garage will not sell any more: taking them away
     * without the money back would be a silent $4,000 fine on the players who had got furthest.
     */
    const refund = (v: unknown, max: number) => {
      let back = 0;
      for (let k = max; k < Math.min(99, Math.floor(num(v))); k++) back += upgradeCost(k);
      return back;
    };
    const owned = [0];
    if (Array.isArray(s.garage?.owned)) for (const v of s.garage.owned) if (Number.isInteger(v) && v > 0 && v < VEHICLES.length && !owned.includes(v)) owned.push(v);
    const cur = Number(s.garage?.cur);
    /** A wardrobe: what's owned (index 0 always) and what's worn, of `n` things. */
    const kept = (k: { cur?: unknown; owned?: unknown } | undefined, n: number) => {
      const own = [0];
      if (Array.isArray(k?.owned)) for (const v of k.owned) if (Number.isInteger(v) && v > 0 && v < n && !own.includes(v)) own.push(v);
      const c = Number(k?.cur);
      return { cur: own.includes(c) ? c : 0, owned: own };
    };
    /** A count or amount: a whole number, 0 or more (junk, NaN or a negative is 0). */
    const count = (v: unknown) => Math.max(0, Math.floor(num(v)));
    // a rival id the race can look up: anything else would throw at the finish, after the race had paid out
    const grudges = Array.isArray(s.grudges) ? s.grudges.filter((n, i, a) => Number.isInteger(n) && n >= 1 && n <= ROSTER.length && a.indexOf(n) === i) : [];
    const div = Math.max(0, Math.min(DIVISIONS.length - 1, Math.floor(num(s.div))));
    return {
      cash: count(s.cash) + refund(s.up?.top, UPGRADE_MAX.top) + refund(s.up?.steer, UPGRADE_MAX.steer) + refund(s.up?.hp, UPGRADE_MAX.hp),
      // a save from before 3.3.79 has its flair money already spent or sitting in `cash`: the show purse
      // starts empty rather than being paid twice
      show: count(s.show),
      up: { top: lvl(s.up?.top, UPGRADE_MAX.top), steer: lvl(s.up?.steer, UPGRADE_MAX.steer), hp: lvl(s.up?.hp, UPGRADE_MAX.hp) },
      grudges,
      races: count(s.races),
      best: count(s.best),
      div,
      // a save from before 3.3.69 has been everywhere up to where it stands
      reach: Math.max(div, Math.min(DIVISIONS.length - 1, count(s.reach))),
      cup,
      titles: count(s.titles),
      gate: Math.min(GATE_AT - 1, count(s.gate)),
      endless: count(s.endless),
      feud: readFeud(s.feud),
      tier: Math.max(0, Math.min(TIERS.length - 1, Math.floor(num(s.tier)))),
      garage: { cur: owned.includes(cur) ? cur : 0, owned },
      paint: kept(s.paint, PAINTS.length),
      hat: kept(s.hat, HATS.length),
      launchBest: count(s.launchBest),
      carry: typeof s.carry === 'string' && Object.keys(WEAPON).includes(s.carry) ? s.carry : null,
      tune: { top: lvl(s.tune?.top, TUNE_MAX), steer: lvl(s.tune?.steer, TUNE_MAX), hp: lvl(s.tune?.hp, TUNE_MAX) },
      wear: Math.max(0, Math.min(1, num(s.wear))),
      muted: s.muted === true,
      sessions: count(s.sessions),
      firstDay: count(s.firstDay),
      musicOff: s.musicOff === true,
      sfxOff: s.sfxOff === true,
      hapticsOff: s.hapticsOff === true,
      quality: s.quality === 'low' || s.quality === 'high' ? s.quality : 'auto',
      lang: isLang(s.lang) ? s.lang : null,
      calm: typeof s.calm === 'boolean' ? s.calm : null,
      daily: readDaily(s.daily, today()),
      drace: readDailyRace(s.drace, today()),
      dpts: count(s.dpts),
      streak: { day: count(s.streak?.day), n: count(s.streak?.n), pay: count(s.streak?.pay), doubled: s.streak?.doubled === true },
      ach: Array.isArray(s.ach) ? ACH_IDS.filter((id) => s.ach!.includes(id) || s.ach!.includes(WAS[id])) : [],
      life: { kos: count(s.life?.kos), wins: count(s.life?.wins) },
    };
  } catch {
    return fresh;
  }
}

export function storeSave(s: Save): void {
  saveData(JSON.stringify(s));
}
