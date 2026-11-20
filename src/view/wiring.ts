// The browser and the HUD chrome wired to the game: the pause menu's settings, the keys and taps that
// are not steering, and the page going away. Lifted out of main.ts in 3.3.34, which had grown to four
// lines under the 500-line cap with no room for the next change.

import { sfx, unlockAudio, hold, setChannel } from './audio';
import { setCalm, MOTION } from './motion';
import { setHaptics } from '../haptics';
import * as funnel from '../funnel';
import { storeSave, type Save } from '../meta';
import { cupRaces } from '../career';
import { loadLang, resolve } from '../i18n';
import * as platform from '../platform';
import type { Hud } from './hud';
import type { Controls } from './input';
import type { Stage } from './stage';

/** What the pause menu and the page chrome need to reach back into the game. */
export interface Wiring {
  save: () => Save;
  hud: Hud;
  controls: Controls;
  stage: () => Stage | undefined;
  titleEl: HTMLElement;
  /** Where the game is right now. */
  at: () => 'title' | 'race' | 'results';
  paused: () => boolean;
  setPaused: (on: boolean) => void;
  /** Leave the race for the title card. */
  home: () => void;
  /** Restart the race the player is in (the pause menu's own button). */
  restart: () => void;
  /** Start a race from the title card. */
  start: () => void;
  /** The player's own sound switch. */
  toggleSound: () => void;
  /** Draw every screen again after the language changed. */
  relocalize: () => void;
}

/** A pause-menu setting changed: into the save and the analytics. */
function setting(save: Save, name: string, value: string | boolean): void {
  storeSave(save);
  funnel.event('settings_changed', { setting: name, value });
}

/** The pause menu's buttons: resume, restart, the switches, how-to and the way home. */
export function wireMenu(w: Wiring): void {
  const set = (name: string, value: string | boolean) => setting(w.save(), name, value);
  w.hud.menu.on = {
    resume: () => w.setPaused(false),
    restart: w.restart,
    music: (on) => { w.save().musicOff = !on; setChannel('music', on); set('music', on); },
    sfx: (on) => { w.save().sfxOff = !on; setChannel('sfx', on); set('sfx', on); },
    haptics: (on) => { w.save().hapticsOff = !on; setHaptics(on); set('haptics', on); },
    shake: (on) => { w.save().calm = !on; setCalm(w.save().calm); set('shake', on); },
    quality: (q) => { w.save().quality = q; w.stage()?.setQualityMode(q); set('quality', q); },
    // the words arrive in their own chunk, so the screens redraw once it is here (3.3.39)
    lang: (l) => { w.save().lang = l; set('lang', l ?? 'auto'); void loadLang(l ?? platform.language()).then(() => w.relocalize()); },
    home: w.home,
  };
}

/** The menu's switches as they stand, for `Menu.show`. */
export const menuSettings = (s: Save) =>
  ({ music: !s.musicOff, sfx: !s.sfxOff, haptics: !s.hapticsOff, quality: s.quality, shake: !MOTION.calm, lang: s.lang, auto: resolve(platform.language()), cupOf: cupRaces(s.cup) });

/** Everything outside the race that listens: keys, the HUD's own buttons, the page going away. */
export function wireChrome(w: Wiring): void {
  const { hud, controls, titleEl } = w;
  controls.onPause = () => w.setPaused(!w.paused());
  controls.onAny = () => { unlockAudio(); funnel.input(); };
  // any first tap or key unlocks sound (iOS wants it in the gesture's own handler, which may be the release)
  for (const ev of ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown']) document.addEventListener(ev, () => { unlockAudio(); funnel.input(); }, true);
  document.addEventListener('click', (e) => { if ((e.target as Element).closest?.('button')) sfx.click(); });
  // Enter or Space: start from the title, go on from the results (a focused button takes its own key)
  document.addEventListener('keydown', (e) => {
    if (e.repeat || (e.key !== 'Enter' && e.key !== ' ')) return;
    const b = (e.target as Element).closest?.('button');
    if (b) { if (e.key === ' ') b.click(); return; }
    if (w.at() === 'title' && !titleEl.classList.contains('hidden')) w.start();
    else if (w.at() === 'results') { if (!hud.garage.continue()) hud.results.continue(); }
    else return;
    e.preventDefault();
  });
  hud.muteBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
  hud.muteBtn.addEventListener('click', () => w.toggleSound());
  hud.pauseBtn.addEventListener('click', () => w.setPaused(true));
  // a click, not a press: a finger steering across the screen when the button comes up doesn't buy an ad
  for (const ev of ['pointerdown', 'pointerup'] as const) hud.tauntBtn.addEventListener(ev, (e) => e.stopPropagation());
  hud.tauntBtn.addEventListener('pointerdown', () => { controls.taunt = true; });
  // a hidden page is silent whatever screen it is on, and a race pauses
  document.addEventListener('visibilitychange', () => {
    hold('hidden', document.hidden);
    if (document.hidden) w.setPaused(true);
  });
  titleEl.querySelector('button')!.addEventListener('click', () => w.start());
  window.addEventListener('resize', () => { w.stage()?.resize(); hud.resize(); });
}
