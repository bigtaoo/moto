// UI text in the player's language. The language comes from the platform (Playgama Bridge
// `platform.language`, else the browser), `?lang=xx` overrides it for testing, and anything not listed
// falls back to English. Division, season, rider and ride names are proper nouns and stay as they are.

import { EN, type Key, type Table } from './en';
import { RU } from './ru';
import { ES } from './es';
import { PT } from './pt';
import { TR } from './tr';
import { DE } from './de';
import { FR } from './fr';

export type { Key };

export const LANGS = { en: EN as Table, ru: RU, es: ES, pt: PT, tr: TR, de: DE, fr: FR };
export type Lang = keyof typeof LANGS;

/** Ordinal numbers as each language writes a race place. */
const ORD: Record<Lang, (n: number) => string> = {
  en: (n) => n + (n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'),
  ru: (n) => `${n}-е`,
  es: (n) => `${n}.º`,
  pt: (n) => `${n}º`,
  tr: (n) => `${n}.`,
  de: (n) => `${n}.`,
  fr: (n) => (n === 1 ? '1re' : `${n}e`),
};

let lang: Lang = 'en';

/** Pick the language from a code like "ru" or "pt-BR"; unknown codes give English. */
export function setLang(code: string | null | undefined): Lang {
  const c = String(code ?? '').slice(0, 2).toLowerCase();
  lang = c in LANGS ? (c as Lang) : 'en';
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
  return lang;
}

export const getLang = (): Lang => lang;

/** The text for `key` in the current language, with `{name}` placeholders filled in. */
export function t(key: Key, vars?: Record<string, string | number>): string {
  const s = LANGS[lang][key] ?? EN[key];
  return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;
}

/** A race place as an ordinal ("1st", "1-е", "1."). */
export const ord = (n: number): string => ORD[lang](n);
