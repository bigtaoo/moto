// The results screen's shop: paint jobs and hats for the dummy (bought once; the dearest go on sale in a later
// season) and a weapon to bring to the next race (bought per race). The rules live in src/shop.ts; this is
// only the HTML.

import type { Save } from '../meta';
import { PAINTS, HATS, wearState, wearPrice, wearTier, carryPrice } from '../shop';
import { TIERS, type WeaponKind } from '../sim/config';
import { icon } from './icons';
import { t, money, type Key } from '../i18n';

const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');
const KINDS: WeaponKind[] = ['pan', 'bat', 'oil'];
const CARRY_KEY = { pan: 'carryPan', bat: 'carryBat', oil: 'carryOil' } as const;

/** A paint's or hat's button state: disabled or not, and what its tag says. */
function tag(save: Save, k: 'paint' | 'hat', i: number): { st: string; off: boolean; label: string } {
  const st = wearState(save, k, i);
  const price = wearPrice(k, i);
  const off = st === 'on' || st === 'locked' || (st === 'buy' && save.cash < price);
  const label = st === 'on' ? t('wearing') : st === 'owned' ? t('wearIt')
    : st === 'locked' ? `${icon('lock')} ${TIERS[wearTier(k, i)].name}` : money(price);
  return { st, off, label };
}

export function shopHtml(save: Save): string {
  const paints = PAINTS.map((p, i) => {
    const { st, off, label } = tag(save, 'paint', i);
    return `<button class="paint ${st}" data-p="${i}" ${off ? 'disabled' : ''} title="${t(`paint${i}` as Key)}">
      <span class="sw" style="background:linear-gradient(135deg, ${hex(p.body)} 0 55%, ${hex(p.ride)} 55%)"><i style="background:${hex(p.mark)}"></i></span>
      <b>${t(`paint${i}` as Key)}</b><i>${label}</i></button>`;
  }).join('');
  const hats = HATS.map((_, i) => {
    const { st, off, label } = tag(save, 'hat', i);
    return `<button class="paint hat ${st}" data-h="${i}" ${off ? 'disabled' : ''}><b>${t(`hat${i}` as Key)}</b><i>${label}</i></button>`;
  }).join('');
  const carry = KINDS.map((k) => {
    const price = carryPrice(save, k);
    const mine = save.carry === k;
    const off = save.carry !== null || save.cash < price;
    return `<button class="carry ${mine ? 'on' : ''}" data-w="${k}" ${off ? 'disabled' : ''}>
      <b>${t(CARRY_KEY[k])}</b><i>${mine ? t('packed') : money(price)}</i></button>`;
  }).join('');
  return `<div class="shop"><div class="cuphead">${t('paintShop')}</div><div class="paints">${paints}</div>
    <div class="cuphead">${t('hatShop')}</div><div class="paints">${hats}</div>
    <div class="cuphead">${t('bringWeapon')}</div><div class="carries">${carry}</div><small class="tip">${t('carryTip')}</small></div>`;
}

/** Wire the shop's buttons; `guard` holds taps until the screen can be read. */
export function bindShop(card: HTMLElement, guard: (f: () => void) => () => void, on: { paint: (i: number) => void; hat: (i: number) => void; carry: (k: WeaponKind) => void }): void {
  card.querySelectorAll<HTMLButtonElement>('.hat').forEach((b) => { b.onclick = guard(() => on.hat(Number(b.dataset.h))); });
  card.querySelectorAll<HTMLButtonElement>('.paint:not(.hat)').forEach((b) => { b.onclick = guard(() => on.paint(Number(b.dataset.p))); });
  card.querySelectorAll<HTMLButtonElement>('.carry').forEach((b) => { b.onclick = guard(() => on.carry(b.dataset.w as WeaponKind)); });
}
