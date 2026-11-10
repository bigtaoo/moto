import { describe, it, expect } from 'vitest';
import { World, type Rider, type SimEvent as WorldEvent } from './world';
import { botInput } from './ai';
import * as C from './config';

/** A world past the countdown, the road cleared of traffic and the rivals sent far back, all of them placid. */
function quietRoad(seed = 1): World {
  const w = new World({ seed });
  while (w.countdown > 0) w.step();
  for (const r of w.riders) r.aggr = 0;
  clear(w);
  return w;
}
function clear(w: World, keep: Rider[] = []): void {
  w.cars.length = 0;
  for (const r of w.riders) if (!r.isPlayer && !keep.includes(r)) { r.z = w.player.z - 300; r.speed = 0; }
}
/** Put `r` level with the player at `x`, the player at `px`, both riding straight at the same pace. */
function alongside(w: World, r: Rider, x: number, px: number): void {
  const p = w.player;
  p.x = p.px = p.wantX = px;
  w.input.targetX = px;
  r.x = r.px = r.wantX = x;
  r.z = r.pz = p.z;
  r.speed = p.speed;
  r.latV = r.vx = 0;
  r.atkCd = r.atkT = 0;
  r.invT = 0;
}
function run(w: World, ticks: number, keep: Rider[], each?: () => void): WorldEvent[] {
  const out: WorldEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    clear(w, keep);
    each?.();
    w.step();
    out.push(...w.events);
    w.events.length = 0;
  }
  return out;
}

describe('fights: shoves, dodges, counters, steals', () => {
  it.each([
    ['a bat, the rider in the outer lane', 'bat', C.LANE_X[3]],
    ['a fist, the rider riding wide', null, C.LANE_X[3] + 0.5],
  ] as const)('a blow carries the rider sideways and into the barrier (%s); that counts for the striker', (_, weapon, x) => {
    const w = quietRoad();
    const r = w.riders[1];
    alongside(w, r, x, x - 2);
    r.latAcc = 0; // holding its line
    w.player.weapon = weapon;
    expect(w.tryAttack(w.player)).toBe(true);
    let steered = 0;
    const ev = run(w, 20, [r], () => { if (r.stagT > 0 && Math.abs(r.latV) > 0) steered++; });
    const hit = ev.find((e) => e.type === 'hit');
    expect(hit && hit.type === 'hit' && hit.ko).toBe(false);
    expect(steered).toBe(0);
    const crash = ev.find((e) => e.type === 'crash');
    expect(crash && crash.type === 'crash' && crash.cause).toBe('wall');
    expect(ev.some((e) => e.type === 'shove' && e.from === 0 && e.to === r.id && e.into === 'wall')).toBe(true);
    expect(w.shoves).toBe(1);
  });

  it('mid-road the same blow only knocks them off line', () => {
    const w = quietRoad();
    const r = w.riders[1];
    alongside(w, r, C.LANE_X[1] + 2, C.LANE_X[1]);
    w.tryAttack(w.player);
    const ev = run(w, 40, [r]);
    expect(ev.some((e) => e.type === 'hit')).toBe(true);
    expect(ev.some((e) => e.type === 'crash')).toBe(false);
    expect(r.shoveT).toBe(0);
  });

  it('holding the slap winds up a haymaker: thrown on letting go, it reaches further and hits harder', () => {
    const w = quietRoad();
    const r = w.riders[1];
    const p = w.player;
    const x = C.LANE_X[1];
    const far = x + C.ATTACK.reachX + 0.4 + C.CHARGE.reach * 0.6; // past a slap's reach, inside a full haymaker's
    alongside(w, r, far, x);
    r.latAcc = 0;
    const keep = () => { r.x = r.px = r.wantX = far; r.z = r.pz = p.z; r.speed = p.speed; r.latV = r.vx = 0; };
    // let go too soon: nothing thrown
    w.input.charge = true;
    let ev = run(w, C.CHARGE.min - 2, [r], keep);
    w.input.charge = false;
    ev.push(...run(w, 10, [r], keep));
    expect(ev.some((e) => e.type === 'swing' && e.rider === 0)).toBe(false);
    // a plain slap from here misses
    w.tryAttack(p);
    expect(run(w, 20, [r], keep).some((e) => e.type === 'hit')).toBe(false);
    // held to full, then a two-damage blow that lands from out here
    const hp = r.hp;
    w.input.charge = true;
    run(w, C.CHARGE.full + 3, [r], keep);
    expect(p.charge).toBe(C.CHARGE.full);
    w.input.charge = false;
    ev = run(w, 10, [r], keep);
    const sw = ev.find((e) => e.type === 'swing' && e.rider === 0);
    expect(sw && sw.type === 'swing' && sw.power).toBe(1);
    const hit = ev.find((e) => e.type === 'hit');
    expect(hit && hit.type === 'hit' && [hit.dmg, hit.power]).toEqual([2, 1]);
    expect(r.hp).toBe(hp - 2);
    expect(p.charge).toBe(0);
  });

  it("an AI rider's blow lands only after its wind-up, at where the target was heading", () => {
    const w = quietRoad();
    const r = w.riders[1];
    alongside(w, r, C.LANE_X[1], C.LANE_X[1] + 2);
    w.tryAttack(r);
    const ev = run(w, C.ATTACK.windupAI + 2, [r]);
    const at = ev.findIndex((e) => e.type === 'hit');
    expect(at).toBeGreaterThanOrEqual(0);
    const hit = ev[at];
    expect(hit.type === 'hit' && hit.to).toBe(0);
    // the swing was the first event, the hit came no earlier than the wind-up
    let ticks = 0;
    const w2 = quietRoad();
    const r2 = w2.riders[1];
    alongside(w2, r2, C.LANE_X[1], C.LANE_X[1] + 2);
    w2.tryAttack(r2);
    while (!w2.events.some((e) => e.type === 'hit') && ticks < 30) { w2.events.length = 0; clear(w2, [r2]); w2.step(); ticks++; }
    expect(ticks).toBe(C.ATTACK.windupAI);
  });

  it('swerving out of a telegraphed swing makes it miss and leaves the swinger open to a counter that takes its weapon', () => {
    const w = quietRoad();
    const r = w.riders[1];
    const p = w.player;
    alongside(w, r, C.LANE_X[1], C.LANE_X[1] + 1.8);
    r.weapon = 'bat';
    r.hp = 3;
    w.tryAttack(r);
    // the player swerves away as soon as the arm goes up
    w.input.targetX = C.LANE_X[3];
    const ev = run(w, C.ATTACK.windupAI + 1, [r]);
    expect(ev.some((e) => e.type === 'hit')).toBe(false);
    const whiff = ev.find((e) => e.type === 'whiff');
    expect(whiff && whiff.type === 'whiff' && whiff.dodged).toBe(true);
    expect(r.openT).toBeGreaterThan(C.ATTACK.windup + 2);
    // back in close while it's still off balance
    alongside(w, r, r.x, r.x + 1.8);
    r.openT = C.ATTACK.open;
    p.weapon = null;
    w.tryAttack(p);
    const ev2 = run(w, C.ATTACK.windup + 1, [r]);
    const hit = ev2.find((e) => e.type === 'hit');
    expect(hit && hit.type === 'hit' && hit.counter).toBe(true);
    expect(hit && hit.type === 'hit' && hit.dmg).toBe(1 + C.ATTACK.counterDmg);
    expect(ev2.some((e) => e.type === 'steal' && e.from === 0 && e.took && e.kind === 'bat')).toBe(true);
    expect(p.weapon).toBe('bat');
    expect(r.weapon).toBe(null);
  });

  it('an open rider does not swing again until it has recovered', () => {
    const w = quietRoad();
    const r = w.riders[1];
    alongside(w, r, C.LANE_X[1], C.LANE_X[1] + 1.8);
    r.aggr = 1;
    r.openT = C.ATTACK.open;
    r.intent = 'harass';
    r.foe = 0;
    const ev = run(w, C.ATTACK.open - 2, [r], () => { w.player.z = r.z; w.player.x = r.x + 1.8; });
    expect(ev.some((e) => e.type === 'swing' && e.rider === r.id)).toBe(false);
  });
});

describe('heat and fines', () => {
  it('heat cools off on its own', () => {
    const w = quietRoad();
    w.heat = 2;
    run(w, 10 * C.TICK_HZ, []);
    expect(w.heat).toBeCloseTo(2 - 10 * C.HEAT.decay, 1);
  });

  it('pulling over costs a fine that grows with the heat, and cools it', () => {
    let letGo = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const w = new World({ seed, upgrades: { top: 3, steer: 3, hp: 0 } });
      w.heat = C.HEAT.max;
      let paid = 0;
      while (!w.over && w.tick < 300 * C.TICK_HZ) {
        botInput(w, 1, false, true);
        const before = w.heat;
        w.step();
        for (const e of w.events) if (e.type === 'patrolLetGo') {
          letGo++;
          paid += e.fine;
          expect(e.fine).toBeGreaterThanOrEqual(C.PATROL.fine);
          expect((e.fine - C.PATROL.fine) % C.PATROL.fineStar).toBe(0);
          expect(w.heat).toBeLessThanOrEqual(Math.max(0, before - C.HEAT.comply) + 0.01);
        }
        w.events.length = 0;
      }
      expect(w.fines).toBe(paid);
    }
    expect(letGo).toBeGreaterThan(5);
  });
});
