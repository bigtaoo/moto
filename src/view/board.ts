// The leaderboard (lifetime takedowns): a title-card button where the platform has a board to show. An
// `in_game` board is drawn here from its entries; a `native_popup` one opens the platform's overlay.
// Player names come from the platform, so they only ever go in as text.

import { icon } from './icons';
import { t } from '../i18n';
import * as platform from '../platform';
import * as funnel from '../funnel';

/** The title card's button, or nothing where there's no board the game can open. */
export function boardButton(): string {
  const ty = platform.boardType();
  return ty === 'in_game' || ty === 'native_popup' ? `<button class="board">${icon('star')} ${t('board')}</button>` : '';
}

function row(e: platform.BoardEntry): HTMLElement {
  const r = document.createElement('div');
  r.className = e.me ? 'br me' : 'br';
  const rank = document.createElement('i');
  rank.textContent = String(e.rank);
  const name = document.createElement('span');
  name.textContent = e.name || '—';
  const score = document.createElement('b');
  score.textContent = String(e.score);
  r.append(rank, name, score);
  return r;
}

/** Wire the title card's board button, if it has one. */
export function wireBoard(root: HTMLElement, app: HTMLElement): void {
  const btn = root.querySelector<HTMLButtonElement>('.board');
  if (!btn) return;
  btn.onclick = () => {
    const ty = platform.boardType();
    funnel.event('board_open', { type: ty });
    if (ty === 'native_popup') return platform.showBoardPopup();
    const el = document.createElement('div');
    el.className = 'overlay boardview';
    el.innerHTML = `<div class="card small"><h2>${icon('star')} ${t('boardTitle')}</h2><div class="rows"><p>…</p></div><button class="primary">${t('back')}</button></div>`;
    el.querySelector('button')!.onclick = () => el.remove();
    app.appendChild(el);
    const rows = el.querySelector<HTMLElement>('.rows')!;
    platform.boardEntries().then((list) => {
      rows.replaceChildren(...(list.length ? list.map(row) : [Object.assign(document.createElement('p'), { textContent: t('boardEmpty') })]));
    }).catch(() => rows.replaceChildren(Object.assign(document.createElement('p'), { textContent: t('boardFail') })));
  };
}
