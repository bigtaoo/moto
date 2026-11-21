// The two pickers that let the player say where they race (3.3.69): the free race's track and stake, and
// which division this season's next cup is run at. Both are a list of stages on a second-level page, and
// both are the same list: everywhere the career has been.

import { icon } from './icons';
import { openPage } from './subpage';
import { t, money } from '../i18n';
import { scenes, stakes, FREE_BACK, type Free, type Scene } from '../free';
import { reached } from '../career';
import type { Save } from '../meta';

/** One stage as a tile: its name, the odds it pays at, and a mark on the one the cup is at. */
const sceneTile = (s: Scene, i: number, odds: boolean): string =>
  `<button class="shift pick${s.here ? ' on' : ''}" data-i="${i}"><span>${icon('flag')} ${s.name}</span>
    <small>${s.here ? t('sceneHere') : odds ? t('sceneOdds', { n: s.edge.toFixed(1) }) : t('scenePurse', { n: s.prize.toFixed(1) })}</small></button>`;

/** Wire every tile on a page to `go`, and close the page behind it. */
function wirePicks(page: { el: HTMLElement; close: () => void }, go: (i: number) => void): void {
  for (const b of page.el.querySelectorAll<HTMLButtonElement>('.pick')) {
    b.onclick = () => {
      page.close();
      go(Number(b.dataset.i));
    };
  }
}

/**
 * The free race: pick the stake, then the track. The stake is a share of what the player has, so the bet
 * keeps up with the career; the tiles quote the odds, which fall away on a stage the career has outgrown.
 */
export function openFree(app: HTMLElement, save: Save, go: (f: Free) => void): void {
  const list = scenes(save);
  // 0 first and chosen by default: riding a track the player likes must cost nothing. A stake is something
  // they go out of their way to put up, and at an outgrown stage it is a bad bet -- which is the point.
  const bets = [0, ...stakes(save.cash)];
  let bet = 0;
  const rules = t('freeRules', { a: FREE_BACK[0].toFixed(1), b: FREE_BACK[1].toFixed(1), c: FREE_BACK[2].toFixed(1) });
  const chip = (b: number): string =>
    `<button class="bet${b === bet ? ' on' : ''}" data-b="${b}">${b === 0 ? t('freeNoStake') : money(b)}</button>`;
  const tiles = (): string => list.map((s, i) => sceneTile(s, i, bet > 0)).join('');
  const body = `<p class="ptip">${rules}</p>
      <div class="bets">${bets.map(chip).join('')}</div>
      <div class="tiles scenes">${tiles()}</div>`;
  const page = openPage(app, t('freeRace'), body);
  const grid = page.el.querySelector('.scenes') as HTMLElement;
  const wire = (): void => wirePicks(page, (i) => go({ div: list[i].div, tier: list[i].tier, stake: bet }));
  for (const b of page.el.querySelectorAll<HTMLButtonElement>('.bet')) {
    b.onclick = () => {
      bet = Number(b.dataset.b);
      for (const o of page.el.querySelectorAll<HTMLButtonElement>('.bet')) o.classList.toggle('on', o === b);
      // with nothing at stake the odds mean nothing: the tiles go back to quoting the stage's purse
      grid.innerHTML = tiles();
      wire();
    };
  }
  wire();
}

/** Where the next cup runs: this season's divisions, as far as the career has climbed. */
export function openStop(app: HTMLElement, save: Save, go: (div: number) => void): void {
  const list = scenes(save).filter((s) => s.tier === save.tier && s.div <= reached(save));
  const body = `<p class="ptip">${t('stopTip')}</p>
    <div class="tiles scenes">${list.map((s, i) => sceneTile(s, i, false)).join('')}</div>`;
  wirePicks(openPage(app, t('stopPick'), body), (i) => go(list[i].div));
}
