// A second-level page off the title card. Until 3.3.66 the day's challenges and the achievements were two
// folds on the card itself: closed they cost 80 px of a card that already overflowed a 640 px phone by 3 px,
// and open they took it to 1019 px -- 379 px of it below the fold, with the card's own scroll the only way
// down. Each is a tile now, and the tile opens its list on a page of its own.

import { icon } from './icons';
import { t } from '../i18n';

/**
 * Open a card over `app` holding `body`, closed by its Back button, the backdrop or Escape.
 * The Back button is small, white and at the top, the same way out as every other second-level page.
 * Returns the page, and the way to close it from inside: a pick on one of its own buttons (3.3.69).
 */
export function openPage(app: HTMLElement, title: string, body: string): { el: HTMLElement; close: () => void } {
  const el = document.createElement('div');
  el.className = 'overlay subpage';
  el.innerHTML = `<div class="card small"><div class="ghead"><h2>${title}</h2>
    <button class="back">${icon('left')} ${t('back')}</button></div><div class="pbody">${body}</div></div>`;
  const close = (): void => {
    el.remove();
    document.removeEventListener('keydown', key);
  };
  const key = (e: KeyboardEvent): void => { if (e.key === 'Escape') close(); };
  el.querySelector<HTMLButtonElement>('.back')!.onclick = close;
  // a tap on the backdrop, not on the card
  el.onclick = (e) => { if (e.target === el) close(); };
  document.addEventListener('keydown', key);
  app.appendChild(el);
  return { el, close };
}
