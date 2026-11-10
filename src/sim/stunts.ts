// The player's showing off and the big moments: bowling riders over with the tumbling body, landing a ramp on
// someone, the taunt after a takedown, and the boss of the cup's last race.

import * as C from './config';
import { BOWL, TAUNT, BOSS } from './fun';
import { clamp, type Rider } from './types';
import type { World } from './world';
import { knockOff } from './combat';

/** Down and tumbling: the player leans the body sideways, and riders in its way are bowled over. */
export function bowl(w: World, r: Rider): void {
  if (!r.isPlayer || r.speed < BOWL.minSpeed) return;
  const inp = w.input;
  const dir = inp.targetX !== null ? clamp((inp.targetX - r.x) * 0.7, -1, 1) : clamp(inp.steer, -1, 1);
  if (dir !== 0) {
    const x = w.road.clampX(r.x + dir * BOWL.slide * C.DT, r.z);
    r.slide += x - r.x;
    r.x = x;
  }
  for (const o of w.riders) {
    if (r.bowled >= BOWL.max) return;
    if (o === r || o.state !== 'ride' || o.airT > 0 || o.invT > 0) continue;
    if (Math.abs(o.x - r.x) > BOWL.x || Math.abs(o.z - r.z) > BOWL.z) continue;
    r.bowled++;
    r.atkSide = o.x >= r.x ? 1 : -1;
    o.hitBy = r.id;
    w.flair.bowls++;
    w.flair.bowlPay += BOWL.pay;
    w.events.push({ type: 'bowl', rider: o.id, pay: BOWL.pay });
    knockOff(w, o, r);
  }
}

/** Down off a ramp: a little faster, and anyone landed on is knocked off. */
export function land(w: World, r: Rider): void {
  r.speed = Math.min(r.speed * C.RAMP.boost, r.top * 1.15);
  let stomp = -1;
  for (const o of w.riders) {
    if (o === r || o.state !== 'ride' || o.airT > 0 || o.invT > 0) continue;
    if (Math.abs(o.x - r.x) < C.RAMP.stompX && Math.abs(o.z - r.z) < C.RAMP.stompZ) {
      stomp = o.id;
      r.atkSide = o.x >= r.x ? 1 : -1;
      o.hitBy = r.id;
      knockOff(w, o, r);
      break;
    }
  }
  w.events.push({ type: 'land', rider: r.id, stomp });
}

/** The player's taunt key: within the window after a takedown it pays a little and costs some pace. */
export function taunt(w: World, p: Rider): void {
  if (w.tauntT > 0) w.tauntT--;
  if (!w.input.taunt) return;
  w.input.taunt = false;
  if (w.tauntT === 0 || p.state !== 'ride') return;
  w.tauntT = 0;
  p.speed *= TAUNT.slow;
  w.flair.taunts++;
  w.flair.tauntPay += TAUNT.pay;
  w.events.push({ type: 'taunt', pay: TAUNT.pay });
}

/** The cup's last race: one rival (never the nemesis) is the boss. */
export function crownBoss(w: World): void {
  const ids = w.riders.filter((r) => !r.isPlayer && !r.thug && r.id !== w.nemesis).map((r) => r.id);
  const b = w.riders[ids[w.funRng.int(ids.length)]];
  b.boss = true;
  b.hp = b.maxHp = b.maxHp + BOSS.hp;
  b.top += BOSS.top;
  b.aggr = Math.min(1, b.aggr + BOSS.aggr);
  w.boss = b.id;
}

/** Called when the player puts someone down: the taunt window opens, and the boss' first fall pays its bounty. */
export function playerDowned(w: World, v: Rider): void {
  w.tauntT = TAUNT.ticks;
  if (!v.boss || w.flair.bossPay > 0) return;
  const pay = Math.round(BOSS.pay * w.div.prize);
  w.flair.bossPay = pay;
  w.events.push({ type: 'boss', rider: v.id, pay });
}
