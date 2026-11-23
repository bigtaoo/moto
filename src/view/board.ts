// The leaderboards: a title-card button for lifetime takedowns, and one on the day's page for daily
// points (3.3.77). An `in_game` board is drawn here from its entries; a `native_popup` one opens the
// platform's overlay. Player names come from the platform, so they only ever go in as text.

import { icon } from './icons';
import { t } from '../i18n';
import * as platform from '../platform';
import * as funnel from '../funnel';

/** Whether the platform has a board this game can open at all. */
const have = (): boolean => { const ty = platform.boardType(); return ty === 'in_game' || ty === 'native_popup'; };

/** The title card's button, or nothing where there's no board the game can open. */
export function boardButton(): string {
  // 3.3.67: a tile like the ones beside it. It used to be a bare centred button under the grid, the one
  // thing on the lobby that matched nothing else on it.
  return have() ? `<button class="shift board"><span>${icon('star')} ${t('board')}</span></button>` : '';
}

/** The daily points board, at the foot of the day's page under the race that feeds it (3.3.77). */
export const dailyBoardButton = (): string =>
  have() ? `<button class="shift dboardgo"><span>${icon('star')} ${t('boardDaily')}</span><small>${t('boardDailyTip')}</small></button>` : '';

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

function load(rows: HTMLElement, which: platform.BoardId): void {
  rows.replaceChildren(line('…'));
  platform.boardEntries(which).then((list) => {
    rows.replaceChildren(...(list.length ? list.map(row) : [line(t('boardEmpty'))]));
  }).catch(() => rows.replaceChildren(line(t('boardFail'))));
}

/** The optional sign-in, inside the board and nowhere else: a guest's score lands with no name, and this
 *  puts one on it. Only where the platform can sign them in and they haven't — never at launch (1.2.2). */
function signInButton(card: HTMLElement, rows: HTMLElement, which: platform.BoardId): void {
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
    platform.resendScore(); // every board's score again, under the name they now have
    load(rows, which);
  };
  card.insertBefore(b, rows.nextSibling);
}

/** One board, as a card over whatever is behind it. */
export function openBoard(app: HTMLElement, which: platform.BoardId): void {
  const ty = platform.boardType();
  funnel.event('board_open', { type: ty, board: which });
  if (ty === 'native_popup') return platform.showBoardPopup(which);
  const el = document.createElement('div');
  el.className = 'overlay boardview';
  const head = which === 'daily_points' ? t('boardDaily') : t('boardTitle');
  el.innerHTML = `<div class="card small"><h2>${icon('star')} ${head}</h2><div class="rows"></div><button class="primary">${t('back')}</button></div>`;
  el.querySelector('button')!.onclick = () => el.remove();
  app.appendChild(el);
  const rows = el.querySelector<HTMLElement>('.rows')!;
  load(rows, which);
  signInButton(el.querySelector<HTMLElement>('.card')!, rows, which);
}

/** Wire the title card's board button, if it has one. */
export function wireBoard(root: HTMLElement, app: HTMLElement): void {
  const btn = root.querySelector<HTMLButtonElement>('.board');
  if (btn) btn.onclick = () => openBoard(app, 'takedowns');
}
