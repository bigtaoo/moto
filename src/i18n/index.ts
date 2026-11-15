// UI text in the player's language. The language comes from the platform (Playgama Bridge
// `platform.language`, else the browser), the settings card overrides it, `?lang=xx` overrides both for
// testing, and anything not listed falls back to English. Division, season, rider and ride names are
// proper nouns and stay as they are. English is in the main bundle; the rest load on demand (./more).

import { EN, type Key, type Table } from './en';
import { MORE } from './more';

export type { Key };

/** The fifteen languages the game speaks, in the order the settings card lists them. */
export const CODES = ['en', 'zh', 'de', 'fr', 'es', 'it', 'pt', 'pl', 'ru', 'ja', 'ko', 'vi', 'tr', 'th', 'id'] as const;
export type Lang = (typeof CODES)[number];

export const isLang = (c: unknown): c is Lang => typeof c === 'string' && (CODES as readonly string[]).includes(c);

/** What each language calls itself: a player who opened the wrong one has to read their own name. */
export const NATIVE: Record<Lang, string> = {
  en: 'English', zh: '简体中文', de: 'Deutsch', fr: 'Français', es: 'Español', it: 'Italiano', pt: 'Português',
  pl: 'Polski', ru: 'Русский', ja: '日本語', ko: '한국어', vi: 'Tiếng Việt', tr: 'Türkçe', th: 'ไทย', id: 'Bahasa Indonesia',
};

/** Ordinal numbers as each language writes a race place. */
const ORD: Record<Lang, (n: number) => string> = {
  en: (n) => n + (n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'),
  zh: (n) => `第${n}名`,
  de: (n) => `${n}.`,
  fr: (n) => (n === 1 ? '1re' : `${n}e`),
  es: (n) => `${n}.º`,
  it: (n) => `${n}º`,
  pt: (n) => `${n}º`,
  pl: (n) => `${n}.`,
  ru: (n) => `${n}-е`,
  ja: (n) => `${n}位`,
  ko: (n) => `${n}위`,
  vi: (n) => `${n}`,
  tr: (n) => `${n}.`,
  th: (n) => `${n}`,
  id: (n) => `${n}`,
};

/** The tables in memory: English from the start, the others once `loadLang` has fetched them. */
const TABLES: Partial<Record<Lang, Table>> = { en: EN as Table };

let lang: Lang = 'en';

/** The language a code like "ru" or "pt-BR" names; unknown codes give English. */
export function resolve(code: string | null | undefined): Lang {
  const c = String(code ?? '').slice(0, 2).toLowerCase();
  // "in" is Indonesian's old ISO code, and some platforms still send it
  const l = c === 'in' ? 'id' : c;
  return isLang(l) ? l : 'en';
}

/** Pick the language from a code like "ru" or "pt-BR"; a table not loaded yet reads English until it is. */
export function setLang(code: string | null | undefined): Lang {
  lang = resolve(code);
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
  return lang;
}

/** Fetch a language's chunk, then switch to it. The only way to switch and be sure of the words. */
export async function loadLang(code: string | null | undefined): Promise<Lang> {
  const want = resolve(code);
  const load = TABLES[want] ? null : MORE[want];
  if (load) {
    try {
      TABLES[want] = await load();
    } catch {
      return setLang('en'); // offline mid-session: English is already here
    }
  }
  return setLang(want);
}

export const getLang = (): Lang => lang;

/** The text for `key` in the current language, with `{name}` placeholders filled in. */
export function t(key: Key, vars?: Record<string, string | number>): string {
  const s = TABLES[lang]?.[key] ?? EN[key];
  return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? show(vars[k]) : m)) : s;
}

const fmts = new Map<Lang, Intl.NumberFormat>();
/** A whole number as the language groups its digits: 12,500 · 12 500 · 12.500. */
export function num(n: number): string {
  let f = fmts.get(lang);
  if (!f) {
    f = new Intl.NumberFormat(lang, { maximumFractionDigits: 0 });
    fmts.set(lang, f);
  }
  return f.format(n);
}
const show = (v: string | number): string => (typeof v === 'number' ? num(v) : v);

/** Cash: "$12,500" (the dollar sign is the game's, in every language). */
export const money = (n: number): string => (n < 0 ? '−$' : '$') + num(Math.abs(n));

/** A race place as an ordinal ("1st", "1-е", "第1"). */
export const ord = (n: number): string => ORD[lang](n);
