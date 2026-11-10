// A screen in place of the game: no WebGL, or it went and didn't come back.

import { t } from '../i18n';

export function blocker(app: HTMLElement, key: 'noGl' | 'glLost'): HTMLElement {
  const el = document.createElement('div');
  el.className = 'overlay blocker';
  el.innerHTML = `<div class="card small"><p>${t(key)}</p><button class="primary">${t('reload')}</button></div>`;
  el.querySelector('button')!.addEventListener('click', () => location.reload());
  app.appendChild(el);
  return el;
}
