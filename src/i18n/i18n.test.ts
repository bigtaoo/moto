import { afterEach, describe, expect, it } from 'vitest';
import { LANGS, getLang, ord, setLang, t } from '.';

const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('i18n', () => {
  afterEach(() => setLang('en'));

  it('every language has exactly the English keys, with the same placeholders', () => {
    const en = LANGS.en;
    for (const [code, table] of Object.entries(LANGS)) {
      expect(Object.keys(table).sort(), code).toEqual(Object.keys(en).sort());
      for (const k of Object.keys(en) as (keyof typeof en)[]) {
        expect(table[k].trim().length, `${code}.${k} is empty`).toBeGreaterThan(0);
        expect(holes(table[k]), `${code}.${k}`).toEqual(holes(en[k]));
      }
    }
  });

  it('picks the language from a platform or browser code', () => {
    expect(setLang('pt-BR')).toBe('pt');
    expect(setLang('DE')).toBe('de');
    expect(setLang('zh')).toBe('en');
    expect(setLang(undefined)).toBe('en');
    expect(getLang()).toBe('en');
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
});
