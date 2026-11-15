// Every language but English is its own chunk, fetched the moment someone picks it. Bundled together
// the fourteen tables weigh more than the whole game's JS budget (3.3.39), and a player reads one.

import type { Table } from './en';
import type { Lang } from '.';

type Loader = () => Promise<Table>;

/** The table for a language, loaded on demand. English is already in the main bundle. */
export const MORE: Partial<Record<Lang, Loader>> = {
  zh: () => import('./zh').then((m) => m.ZH),
  de: () => import('./de').then((m) => m.DE),
  fr: () => import('./fr').then((m) => m.FR),
  es: () => import('./es').then((m) => m.ES),
  it: () => import('./it').then((m) => m.IT),
  pt: () => import('./pt').then((m) => m.PT),
  pl: () => import('./pl').then((m) => m.PL),
  ru: () => import('./ru').then((m) => m.RU),
  ja: () => import('./ja').then((m) => m.JA),
  ko: () => import('./ko').then((m) => m.KO),
  vi: () => import('./vi').then((m) => m.VI),
  tr: () => import('./tr').then((m) => m.TR),
  th: () => import('./th').then((m) => m.TH),
  id: () => import('./id').then((m) => m.ID),
};
