import { afterEach, describe, expect, it } from 'vitest';
import { CODES, type Lang, getLang, loadLang, money, num, ord, resolve, setLang, t } from '.';
import { EN } from './en';
import { ZH } from './zh';
import { DE } from './de';
import { FR } from './fr';
import { ES } from './es';
import { IT } from './it';
import { PT } from './pt';
import { PL } from './pl';
import { RU } from './ru';
import { JA } from './ja';
import { KO } from './ko';
import { VI } from './vi';
import { TR } from './tr';
import { TH } from './th';
import { ID } from './id';

// the game loads these one chunk at a time (src/i18n/more.ts); the test wants them all at once
const ALL = { en: EN, zh: ZH, de: DE, fr: FR, es: ES, it: IT, pt: PT, pl: PL, ru: RU, ja: JA, ko: KO, vi: VI, tr: TR, th: TH, id: ID };

const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('i18n', () => {
  afterEach(() => setLang('en'));

  it('every language has exactly the English keys, with the same placeholders', () => {
    for (const [code, table] of Object.entries(ALL)) {
      expect(Object.keys(table).sort(), code).toEqual(Object.keys(EN).sort());
      for (const k of Object.keys(EN) as (keyof typeof EN)[]) {
        expect(table[k].trim().length, `${code}.${k} is empty`).toBeGreaterThan(0);
        expect(holes(table[k]), `${code}.${k}`).toEqual(holes(EN[k]));
      }
    }
  });

  it('has a table and a name for every language the card offers', () => {
    expect(Object.keys(ALL).sort()).toEqual([...CODES].sort());
  });

  it('picks the language from a platform or browser code', () => {
    expect(setLang('pt-BR')).toBe('pt');
    expect(setLang('DE')).toBe('de');
    expect(setLang('zh-Hans')).toBe('zh');
    expect(resolve('in')).toBe('id'); // Indonesian's old code, still sent by some platforms
    expect(setLang('xx')).toBe('en');
    expect(setLang(undefined)).toBe('en');
    expect(getLang()).toBe('en');
  });

  it('reads English until a language is loaded, then its own words', async () => {
    setLang('de');
    expect(t('settings')).toBe(EN.settings);
    expect(await loadLang('de')).toBe('de');
    expect(t('settings')).toBe(DE.settings);
  });

  it('fills placeholders and writes ordinals per language', () => {
    expect(t('fined', { n: 40 })).toBe('FINED $40 · MOVE ALONG');
    expect(t('finished', { o: ord(2) })).toBe('2nd place!');
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ord)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd']);
    setLang('ru');
    expect(ord(3)).toBe('3-е');
    expect(t('fined', { n: 40 })).toContain('40');
    setLang('fr');
    expect([ord(1), ord(2)]).toEqual(['1re', '2e']);
  });

  it('writes an ordinal in every language, not just the ones with rules', () => {
    // one per language, so a new language cannot be added with a hole where its places go
    const second: Record<Lang, string> = {
      en: '2nd', zh: '第2名', de: '2.', fr: '2e', es: '2.º', it: '2º', pt: '2º', pl: '2.',
      ru: '2-е', ja: '2位', ko: '2위', vi: '2', tr: '2.', th: '2', id: '2',
    };
    for (const [code, want] of Object.entries(second)) {
      setLang(code);
      expect(ord(2), code).toBe(want);
      // some languages put the digit in the middle ("第1名"), so it only has to be in there
      expect(ord(1).includes('1'), code).toBe(true);
    }
    expect(Object.keys(second).sort()).toEqual([...CODES].sort());
  });

  it('groups digits the way the language does, and keeps the dollar sign', () => {
    setLang('en');
    expect(num(12500)).toBe('12,500');
    expect(money(12500)).toBe('$12,500');
    expect(money(-40)).toBe('−$40');
    setLang('de');
    expect(num(12500)).toBe('12.500'); // and cached: the second call takes the stored formatter
    expect(money(12500)).toBe('$12.500');
  });
});
