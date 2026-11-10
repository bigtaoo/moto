// The results screen's shop: paint jobs for the dummy (bought once) and a weapon to bring to the next race
// (bought per race). The rules live in src/shop.ts; this is only the HTML.

import type { Save } from '../meta';
import { PAINTS, paintState, carryPrice } from '../shop';
import type { WeaponKind } from '../sim/config';
import { t, money, type Key } from '../i18n';

const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');
const KINDS: WeaponKind[] = ['pan', 'bat'];

export function shopHtml(save: Save): string {
  const paints = PAINTS.map((p, i) => {
    const st = paintState(save, i);
    const off = st === 'on' || (st === 'buy' && save.cash < p.price);
    const label = st === 'on' ? t('wearing') : st === 'owned' ? t('wearIt') : money(p.price);
    return `<button class="paint ${st}" data-p="${i}" ${off ? 'disabled' : ''} title="${t(`paint${i}` as Key)}">
      <span class="sw" style="background:linear-gradient(135deg, ${hex(p.body)} 0 55%, ${hex(p.ride)} 55%)"><i style="background:${hex(p.mark)}"></i></span>
      <b>${t(`paint${i}` as Key)}</b><i>${label}</i></button>`;
  }).join('');
  const carry = KINDS.map((k) => {
    const price = carryPrice(save, k);
    const mine = save.carry === k;
    const off = save.carry !== null || save.cash < price;
    return `<button class="carry ${mine ? 'on' : ''}" data-w="${k}" ${off ? 'disabled' : ''}>
      <b>${t(k === 'pan' ? 'carryPan' : 'carryBat')}</b><i>${mine ? t('packed') : money(price)}</i></button>`;
  }).join('');
  return `<div class="shop"><div class="cuphead">${t('paintShop')}</div><div class="paints">${paints}</div>
    <div class="cuphead">${t('bringWeapon')}</div><div class="carries">${carry}</div><small class="tip">${t('carryTip')}</small></div>`;
}

/** Wire the shop's buttons; `guard` holds taps until the screen can be read. */
export function bindShop(card: HTMLElement, guard: (f: () => void) => () => void, on: { paint: (i: number) => void; carry: (k: WeaponKind) => void }): void {
  card.querySelectorAll<HTMLButtonElement>('.paint').forEach((b) => { b.onclick = guard(() => on.paint(Number(b.dataset.p))); });
  card.querySelectorAll<HTMLButtonElement>('.carry').forEach((b) => { b.onclick = guard(() => on.carry(b.dataset.w as WeaponKind)); });
}
