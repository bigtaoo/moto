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

const line = (text: string): HTMLElement => Object.assign(document.createElement('p'), { textContent: text });

function load(rows: HTMLElement): void {
  rows.replaceChildren(line('…'));
  platform.boardEntries().then((list) => {
    rows.replaceChildren(...(list.length ? list.map(row) : [line(t('boardEmpty'))]));
  }).catch(() => rows.replaceChildren(line(t('boardFail'))));
}

/** The optional sign-in, inside the board and nowhere else: a guest's score lands with no name, and this
 *  puts one on it. Only where the platform can sign them in and they haven't — never at launch (1.2.2). */
function signInButton(card: HTMLElement, rows: HTMLElement): void {
  if (!platform.canSignIn()) return;
  const b = document.createElement('button');
  b.className = 'x2 signin';
  b.textContent = t('boardSignIn');
  b.onclick = async () => {
    b.disabled = true;
    funnel.event('board_signin');
    const ok = await platform.signIn();
    if (!ok) { b.disabled = false; return; } // closed or refused: the board stays as it was
    b.remove();
    platform.resendScore(); // the same score again, under the name they now have
    load(rows);
  };
  card.insertBefore(b, rows.nextSibling);
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
    el.innerHTML = `<div class="card small"><h2>${icon('star')} ${t('boardTitle')}</h2><div class="rows"></div><button class="primary">${t('back')}</button></div>`;
    el.querySelector('button')!.onclick = () => el.remove();
    app.appendChild(el);
    const rows = el.querySelector<HTMLElement>('.rows')!;
    load(rows);
    signInButton(el.querySelector<HTMLElement>('.card')!, rows);
  };
}
