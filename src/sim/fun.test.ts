import { describe, it, expect } from 'vitest';
import { World, type Rider, type SimEvent } from './world';
import { botInput } from './ai';
import { crash } from './combat';
import { Recorder, playReplay } from './replay';
import { BOSS, TAUNT, weeklyMutator, MUTATORS } from './fun';
import * as C from './config';

/** Past the countdown, no traffic, every rival placid and sent far back except `keep`. */
function quiet(opts: ConstructorParameters<typeof World>[0] = { seed: 1 }): World {
  const w = new World(opts);
  while (w.countdown > 0) w.step();
  for (const r of w.riders) r.aggr = 0;
  w.hazards.length = 0;
  return w;
}
function run(w: World, ticks: number, keep: Rider[], each?: () => void): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    w.cars.length = 0;
    for (const r of w.riders) if (!r.isPlayer && !keep.includes(r)) { r.z = w.player.z - 300; r.speed = 0; }
    each?.();
    w.step();
    out.push(...w.events);
    w.events.length = 0;
  }
  return out;
}

describe('bowling', () => {
  it('the tumbling player, leaned sideways, knocks a rider off: a takedown that pays', () => {
    const w = quiet();
    const p = w.player;
    const r = w.riders[1];
    p.x = p.px = 0;
    p.speed = 20;
    crash(w, p, 'wall', 0);
    r.x = r.px = r.wantX = 1.6;
    r.z = r.pz = p.z + 2;
    r.speed = 10;
    r.latV = r.vx = 0;
    r.invT = 0;
    w.input.targetX = 6; // lean right, into its line
    const ev = run(w, 20, [r], () => { r.wantX = 1.6; r.latAcc = 0; });
    expect(ev.some((e) => e.type === 'bowl' && e.rider === r.id)).toBe(true);
    expect(r.state).toBe('down');
    expect(w.flair.bowls).toBe(1);
    expect(w.flair.bowlPay).toBeGreaterThan(0);
    expect(w.kos).toBe(1);
  });

  it('a body lying still bowls nobody', () => {
    const w = quiet();
    const p = w.player;
    const r = w.riders[1];
    p.speed = 0;
    crash(w, p, 'wall', 0);
    r.x = r.px = p.x;
    r.z = r.pz = p.z;
    r.speed = 0;
    r.invT = 0;
    run(w, 3, [r]);
    expect(w.flair.bowls).toBe(0);
  });
});

describe('the oil can', () => {
  it('poured behind, it puts down whoever rides over it, and that counts for the pourer', () => {
    const w = quiet();
    const p = w.player;
    const r = w.riders[1];
    p.x = p.px = p.wantX = 0;
    w.input.targetX = 0;
    p.weapon = 'oil';
    expect(w.tryAttack(p)).toBe(true);
    expect(p.weapon).toBe(null);
    expect(w.slicks.length).toBe(1);
    r.x = r.px = r.wantX = w.slicks[0].x;
    r.z = r.pz = w.slicks[0].z - 8;
    r.speed = p.speed + 4;
    r.invT = 0;
    const ev = run(w, 40, [r], () => { r.wantX = w.slicks[0]?.x ?? r.x; r.latAcc = 0; });
    const c = ev.find((e) => e.type === 'crash' && e.rider === r.id);
    expect(c && c.type === 'crash' && c.cause).toBe('oil');
    expect(ev.some((e) => e.type === 'shove' && e.from === p.id && e.to === r.id && e.into === 'oil')).toBe(true);
    expect(w.shoves).toBe(1);
    expect(w.slicks.length).toBe(0);
  });
});

describe('roadside hazards', () => {
  it.each([
    [0, 'cow'],
    [1, 'weed'],
    [2, 'leaves'],
    [3, 'ice'],
    [4, 'hydrant'],
  ] as const)('division %i has its own (%s), the same every replay', (div, kind) => {
    const a = new World({ seed: 3, div });
    const b = new World({ seed: 3, div });
    expect(a.hazards.length).toBeGreaterThan(0);
    expect(a.hazards.every((h) => h.kind === kind)).toBe(true);
    expect(b.hazards.map((h) => [h.x, h.z])).toEqual(a.hazards.map((h) => [h.x, h.z]));
    for (const h of a.hazards) expect(h.z).toBeLessThan(a.length);
  });

  it('riding into a cow is a crash', () => {
    const w = new World({ seed: 1, div: 0 });
    while (w.countdown > 0) w.step();
    const p = w.player;
    const cow = w.hazards[0];
    p.z = p.pz = cow.z - 3;
    p.x = p.px = p.wantX = cow.x;
    p.invT = 0;
    const ev: SimEvent[] = [];
    for (let i = 0; i < 20 && p.state === 'ride'; i++) {
      w.input.targetX = cow.x;
      w.step();
      ev.push(...w.events);
      w.events.length = 0;
    }
    expect(ev.some((e) => e.type === 'crash' && e.rider === p.id && e.cause === 'cow')).toBe(true);
  });

  it('ice keeps a sideways shove going much further than tarmac', () => {
    const drift = (onIce: boolean): number => {
      const w = new World({ seed: 1, div: 3 });
      while (w.countdown > 0) w.step();
      const ice = w.hazards[0];
      if (!onIce) w.hazards.length = 0;
      const p = w.player;
      p.z = p.pz = ice.z + 1;
      p.x = p.px = p.wantX = ice.cx - 2;
      w.input.targetX = null;
      w.input.steer = 0;
      p.vx = 6;
      const x0 = p.x;
      for (let i = 0; i < 8; i++) { w.cars.length = 0; w.step(); }
      return p.x - x0;
    };
    expect(drift(true)).toBeGreaterThan(drift(false) * 1.5);
  });
});

describe('the taunt', () => {
  it('right after a takedown it pays and costs pace; any other time it does nothing', () => {
    const w = quiet();
    const p = w.player;
    w.input.taunt = true;
    run(w, 1, []);
    expect(w.flair.taunts).toBe(0);
    const r = w.riders[1];
    r.z = p.z;
    r.x = p.x + 1;
    r.invT = 0;
    p.atkSide = 1;
    w.tauntT = 0;
    // a takedown
    r.hitBy = p.id;
    r.shoveT = 1;
    crash(w, r, 'wall', 3);
    expect(w.tauntT).toBe(TAUNT.ticks);
    p.speed = 15;
    const v = p.speed;
    w.input.taunt = true;
    const ev = run(w, 1, [r]);
    expect(ev.some((e) => e.type === 'taunt')).toBe(true);
    expect(p.speed).toBeLessThan(v);
    expect(w.flair.tauntPay).toBe(TAUNT.pay);
    w.input.taunt = true;
    run(w, 1, [r]);
    expect(w.flair.taunts).toBe(1); // once per takedown
  });

  it('a taunt rides in the replay and plays back to the same state', () => {
    const w = new World({ seed: 4 });
    const rec = new Recorder({ seed: 4 });
    let taunted = 0;
    while (!w.over && w.tick < 90 * C.TICK_HZ) {
      botInput(w, 1);
      if (w.tauntT > 0) w.input.taunt = true;
      rec.capture(w);
      w.step();
      for (const e of w.events) if (e.type === 'taunt') taunted++;
      w.events.length = 0;
    }
    expect(taunted).toBeGreaterThan(0);
    const out = playReplay(rec.finish(w));
    expect(out.ok).toBe(true);
    expect(out.world.flair.taunts).toBe(taunted);
  });
});

describe('the cup boss', () => {
  it('one rival, never the nemesis, is bigger, tougher and pays once when put down', () => {
    const w = new World({ seed: 2, boss: true, nemesis: 3 });
    const bosses = w.riders.filter((r) => r.boss);
    expect(bosses.length).toBe(1);
    const b = bosses[0];
    expect(b.id).toBe(w.boss);
    expect(b.id).not.toBe(w.nemesis);
    expect(b.isPlayer).toBe(false);
    const plain = new World({ seed: 2, nemesis: 3 }).riders[b.id];
    expect(b.maxHp).toBe(plain.maxHp + BOSS.hp);
    expect(b.top).toBeCloseTo(plain.top + BOSS.top);
    while (w.countdown > 0) w.step();
    b.hitBy = w.player.id;
    b.shoveT = 1;
    crash(w, b, 'wall', 3);
    const ev = w.events.filter((e) => e.type === 'boss');
    expect(ev.length).toBe(1);
    expect(w.flair.bossPay).toBe(Math.round(BOSS.pay * w.div.prize));
    expect(new World({ seed: 2 }).boss).toBe(-1);
  });
});

describe('the weekly mutator', () => {
  it('turns over every week, through all of them', () => {
    const week = 7 * 86_400_000;
    const seen = new Set<string>();
    for (let i = 0; i < MUTATORS.length; i++) seen.add(weeklyMutator(Date.UTC(2026, 10, 9) + i * week));
    expect(seen.size).toBe(MUTATORS.length);
    // Monday to Sunday is one week
    expect(weeklyMutator(Date.UTC(2026, 10, 9, 0, 1))).toBe(weeklyMutator(Date.UTC(2026, 10, 15, 23, 59)));
    expect(weeklyMutator(Date.UTC(2026, 10, 15, 23, 59))).not.toBe(weeklyMutator(Date.UTC(2026, 10, 16, 0, 1)));
  });

  it('bats: everyone starts with one and every pickup is one', () => {
    const w = new World({ seed: 1, mutator: 'bats' });
    expect(w.riders.filter((r) => !r.thug).every((r) => r.weapon === 'bat')).toBe(true);
    expect(w.pickups.every((p) => p.kind === 'bat')).toBe(true);
  });

  it('more traffic, more buggies, longer flights', () => {
    const plain = new World({ seed: 1, div: 2 });
    expect(new World({ seed: 1, div: 2, mutator: 'police' }).patrolCount).toBeGreaterThan(plain.patrolCount);
    const air = (mutator?: 'lowgrav'): number => {
      const w = new World({ seed: 1, mutator });
      while (!w.over && w.tick < 200 * C.TICK_HZ) {
        botInput(w, 1, false);
        w.step();
        w.events.length = 0;
        const r = w.riders.find((o) => o.airMax > 0);
        if (r) return r.airMax / r.speed;
      }
      return 0;
    };
    expect(air('lowgrav')).toBeGreaterThan(air() * 1.5);
  });
});
