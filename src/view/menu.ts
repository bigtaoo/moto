// The pause menu: resume, restart the race, music and effects, the graphics setting, and how to play.
// The same card, minus the race's own rows, is the title's settings: before 3.3.37 a player had to
// start a race and pause it to reach the sound switches, the graphics setting or how to play.

import { icon } from './icons';
import { DESKTOP } from './input';
import { CAN_BUZZ } from '../haptics';
import type { QualityMode } from './quality';
import { CUP_RACES } from '../career';
import { t, NATIVE, LANGS, type Key, type Lang } from '../i18n';

export interface MenuSettings { music: boolean; sfx: boolean; haptics: boolean; quality: QualityMode; shake: boolean; lang: Lang | null; auto: Lang; }

export interface MenuActions {
  resume: () => void;
  restart: () => void;
  music: (on: boolean) => void;
  sfx: (on: boolean) => void;
  haptics: (on: boolean) => void;
  shake: (on: boolean) => void;
  quality: (q: QualityMode) => void;
  /** A language picked by hand, or null to go back to following the platform. */
  lang: (l: Lang | null) => void;
  /** Leave the race and go back to the title card. */
  home: () => void;
}

const QUALITIES: QualityMode[] = ['auto', 'low', 'high'];
const CODES = Object.keys(LANGS) as Lang[];
const Q_NAMES: Record<QualityMode, Key> = { auto: 'qAuto', low: 'qLow', high: 'qHigh' };

export class Menu {
  /** Set by the game; the menu calls these. */
  on: MenuActions = { resume() {}, restart() {}, music() {}, sfx() {}, haptics() {}, shake() {}, quality() {}, lang() {}, home() {} };
  private settings: MenuSettings = { music: true, sfx: true, haptics: true, quality: 'auto', shake: true, lang: null, auto: 'en' };
  /** The card's page: the switches, how to play, or the list of languages. */
  private page: 'main' | 'help' | 'langs' = 'main';
  /** 'pause' is the race's menu; 'settings' is the same card off the road, with a Done instead. */
  private mode: 'pause' | 'settings' = 'pause';

  constructor(private readonly el: HTMLElement) {
    el.addEventListener('click', (e) => {
      const b = (e.target as Element).closest<HTMLButtonElement>('button[data-a]');
      if (b) this.act(b.dataset.a!);
    });
  }

  get open(): boolean {
    return !this.el.classList.contains('hidden');
  }

  show(on: boolean, s?: MenuSettings, mode: 'pause' | 'settings' = 'pause'): void {
    if (s) this.settings = { ...s };
    this.page = 'main';
    this.mode = mode;
    this.el.classList.toggle('hidden', !on);
    if (on) this.draw();
  }

  /** The text again in the current language. */
  localize(): void {
    if (this.open) this.draw();
  }

  private act(a: string): void {
    const s = this.settings;
    switch (a) {
      case 'resume': if (this.mode === 'settings') { this.show(false); return; } this.on.resume(); return;
      case 'restart': this.on.restart(); return;
      case 'music': s.music = !s.music; this.on.music(s.music); break;
      case 'sfx': s.sfx = !s.sfx; this.on.sfx(s.sfx); break;
      case 'haptics': s.haptics = !s.haptics; this.on.haptics(s.haptics); break;
      case 'shake': s.shake = !s.shake; this.on.shake(s.shake); break;
      case 'quality': s.quality = QUALITIES[(QUALITIES.indexOf(s.quality) + 1) % QUALITIES.length]; this.on.quality(s.quality); break;
      case 'home': this.on.home(); return;
      case 'help': this.page = 'help'; break;
      case 'langs': this.page = 'langs'; break;
      case 'back': this.page = 'main'; break;
      default:
        if (a.startsWith('l:')) {
          const c = a.slice(2);
          s.lang = (CODES.includes(c as Lang) ? c : null) as Lang | null;
          this.on.lang(s.lang);
          break;
        }
    }
    this.draw();
    const BACK: Record<string, string> = { help: 'back', langs: 'back', back: 'help' };
    (this.el.querySelector(`button[data-a="${BACK[a] ?? a}"]`) as HTMLButtonElement | null)?.focus({ preventScroll: true });
  }

  private draw(): void {
    const card = this.el.querySelector('.card') as HTMLElement;
    const s = this.settings;
    const sw = (a: string, label: string, val: string, on = true) =>
      `<button class="opt ${on ? '' : 'off'}" data-a="${a}"><span>${label}</span><b>${val}</b></button>`;
    if (this.page === 'langs') {
      const cur = s.lang;
      card.innerHTML = `<h2>${t('language')}</h2>
        <div class="opts langs">
          ${sw('l:', t('langAuto'), s.auto.toUpperCase(), cur === null)}
          ${CODES.map((c) => sw(`l:${c}`, NATIVE[c], c.toUpperCase(), cur === c)).join('')}
        </div>
        <button class="primary" data-a="back">${icon('left')} ${t('back')}</button>`;
      return;
    }
    if (this.page === 'help') {
      const tips = [t(DESKTOP ? 'hintKeys' : 'hint'), t('howTell'), t(DESKTOP ? 'howChargeKeys' : 'howCharge'), t('howShove'), t('howTaunt'), t('howHeat'), t('howCup', { n: CUP_RACES }), `${t('nem')}: ${t('nemTip')}`];
      card.innerHTML = `<h2>${t('howTo')}</h2><ul class="howto">${tips.map((x) => `<li>${x}</li>`).join('')}</ul>
        <button class="primary" data-a="back">${t('back')}</button>`;
      return;
    }
    const race = this.mode === 'pause';
    card.innerHTML = `<h2>${t(race ? 'paused' : 'settings')}</h2>
      <button class="primary" data-a="resume">${icon(race ? 'play' : 'left')} ${t(race ? 'resume' : 'back')}</button>
      <div class="opts">
        ${sw('music', t('music'), t(s.music ? 'on' : 'off'), s.music)}
        ${sw('sfx', t('effects'), t(s.sfx ? 'on' : 'off'), s.sfx)}
        ${CAN_BUZZ ? sw('haptics', t('vibration'), t(s.haptics ? 'on' : 'off'), s.haptics) : ''}
        ${sw('shake', t('shake'), t(s.shake ? 'on' : 'off'), s.shake)}
        ${sw('quality', t('graphics'), t(Q_NAMES[s.quality]))}
        ${sw('langs', t('language'), (s.lang ?? s.auto).toUpperCase())}
        <button class="opt" data-a="help"><span>${t('howTo')}</span><b>?</b></button>
      </div>
      ${race ? `<div class="opts">
        <button class="opt" data-a="restart"><span>${icon('left')} ${t('restart')}</span></button>
        <button class="opt" data-a="home"><span>${icon('left')} ${t('toMenu')}</span></button>
      </div>` : ''}`;
  }
}
