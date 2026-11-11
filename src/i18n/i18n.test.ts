import { afterEach, describe, expect, it } from 'vitest';
import { LANGS, type Lang, getLang, money, num, ord, setLang, t } from '.';

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

  it('writes an ordinal in every language, not just the two with rules', () => {
    // one per language, so a new language cannot be added with a hole where its places go
    const second: Record<Lang, string> = { en: '2nd', ru: '2-е', es: '2.º', pt: '2º', tr: '2.', de: '2.', fr: '2e' };
    for (const [code, want] of Object.entries(second)) {
      setLang(code);
      expect(ord(2), code).toBe(want);
      expect(ord(1).startsWith('1'), code).toBe(true);
    }
    expect(Object.keys(second).sort()).toEqual(Object.keys(LANGS).sort());
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
