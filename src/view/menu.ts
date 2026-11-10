// The pause menu: resume, restart the race, music and effects, the graphics setting, and how to play.

import { icon } from './icons';
import { DESKTOP } from './input';
import { CAN_BUZZ } from '../haptics';
import type { QualityMode } from './quality';
import { CUP_RACES } from '../career';
import { t, type Key } from '../i18n';

export interface MenuSettings { music: boolean; sfx: boolean; haptics: boolean; quality: QualityMode; }

export interface MenuActions {
  resume: () => void;
  restart: () => void;
  music: (on: boolean) => void;
  sfx: (on: boolean) => void;
  haptics: (on: boolean) => void;
  quality: (q: QualityMode) => void;
}

const QUALITIES: QualityMode[] = ['auto', 'low', 'high'];
const Q_NAMES: Record<QualityMode, Key> = { auto: 'qAuto', low: 'qLow', high: 'qHigh' };

export class Menu {
  /** Set by the game; the menu calls these. */
  on: MenuActions = { resume() {}, restart() {}, music() {}, sfx() {}, haptics() {}, quality() {} };
  private settings: MenuSettings = { music: true, sfx: true, haptics: true, quality: 'auto' };
  private help = false;

  constructor(private readonly el: HTMLElement) {
    el.addEventListener('click', (e) => {
      const b = (e.target as Element).closest<HTMLButtonElement>('button[data-a]');
      if (b) this.act(b.dataset.a!);
    });
  }

  get open(): boolean {
    return !this.el.classList.contains('hidden');
  }

  show(on: boolean, s?: MenuSettings): void {
    if (s) this.settings = { ...s };
    this.help = false;
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
      case 'resume': this.on.resume(); return;
      case 'restart': this.on.restart(); return;
      case 'music': s.music = !s.music; this.on.music(s.music); break;
      case 'sfx': s.sfx = !s.sfx; this.on.sfx(s.sfx); break;
      case 'haptics': s.haptics = !s.haptics; this.on.haptics(s.haptics); break;
      case 'quality': s.quality = QUALITIES[(QUALITIES.indexOf(s.quality) + 1) % QUALITIES.length]; this.on.quality(s.quality); break;
      case 'help': this.help = true; break;
      case 'back': this.help = false; break;
    }
    this.draw();
    (this.el.querySelector(`button[data-a="${a === 'help' ? 'back' : a === 'back' ? 'help' : a}"]`) as HTMLButtonElement | null)?.focus({ preventScroll: true });
  }

  private draw(): void {
    const card = this.el.querySelector('.card') as HTMLElement;
    const s = this.settings;
    if (this.help) {
      const tips = [t(DESKTOP ? 'hintKeys' : 'hint'), t('howTell'), t('howShove'), t('howHeat'), t('howCup', { n: CUP_RACES }), `${t('nem')}: ${t('nemTip')}`];
      card.innerHTML = `<h2>${t('howTo')}</h2><ul class="howto">${tips.map((x) => `<li>${x}</li>`).join('')}</ul>
        <button class="primary" data-a="back">${t('back')}</button>`;
      return;
    }
    const sw = (a: string, label: string, val: string, on = true) =>
      `<button class="opt ${on ? '' : 'off'}" data-a="${a}"><span>${label}</span><b>${val}</b></button>`;
    card.innerHTML = `<h2>${t('paused')}</h2>
      <button class="primary" data-a="resume">${icon('play')} ${t('resume')}</button>
      <div class="opts">
        ${sw('music', t('music'), t(s.music ? 'on' : 'off'), s.music)}
        ${sw('sfx', t('effects'), t(s.sfx ? 'on' : 'off'), s.sfx)}
        ${CAN_BUZZ ? sw('haptics', t('vibration'), t(s.haptics ? 'on' : 'off'), s.haptics) : ''}
        ${sw('quality', t('graphics'), t(Q_NAMES[s.quality]))}
        <button class="opt" data-a="help"><span>${t('howTo')}</span><b>?</b></button>
        <button class="opt" data-a="restart"><span>${t('restart')}</span><b>${icon('left')}</b></button>
      </div>`;
  }
}
