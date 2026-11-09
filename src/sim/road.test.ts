import { describe, it, expect } from 'vitest';
import { World, type Rider, type SimEvent } from './world';
import { Road } from './road';
import { Prng } from './rng';
import * as C from './config';

/** A division-`div` world past the countdown, its rivals placid. */
function world(div: number, seed: number): World {
  const w = new World({ seed, div });
  while (w.countdown > 0) w.step();
  for (const r of w.riders) r.aggr = 0;
  return w;
}
/** The first seed whose road has what `has` looks for. */
function seedWith(div: number, has: (w: World) => boolean): World {
  for (let seed = 1; seed < 300; seed++) {
    const w = new World({ seed, div });
    if (has(w)) return world(div, seed);
  }
  throw new Error('no such road');
}
/** Nobody else on the road: no traffic, no buggy, the other riders far back. */
function clear(w: World, keep: Rider[] = [], cars = true): void {
  if (cars) w.cars.length = 0;
  w.patrol.active = false;
  for (const r of w.riders) if (!r.isPlayer && !keep.includes(r)) { r.z = w.player.z - 300; r.speed = 0; }
}
function place(w: World, x: number, z: number): void {
  const p = w.player;
  p.x = p.px = p.wantX = x;
  p.z = p.pz = z;
  p.speed = p.top;
  p.vx = 0;
  p.invT = 0;
  w.input.targetX = x;
}
function run(w: World, until: () => boolean, each?: () => void, keep: Rider[] = [], cars = true): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < 60 * C.TICK_HZ && !until(); i++) {
    clear(w, keep, cars);
    each?.();
    w.step();
    out.push(...w.events);
    w.events.length = 0;
  }
  return out;
}
const crashOf = (ev: SimEvent[], rider = 0) => {
  const e = ev.find((x) => x.type === 'crash' && x.rider === rider);
  return e && e.type === 'crash' ? e.cause : null;
};

describe('road features and divisions', () => {
  it('places each division its features, apart and inside the race', () => {
    for (let d = 0; d < C.DIVISIONS.length; d++) {
      const div = C.DIVISIONS[d];
      let placed = 0;
      for (let seed = 1; seed <= 40; seed++) {
        const road = new Road(C.RACE_LEN, div, new Prng(seed));
        const lanes = road.ramps.filter((r) => !r.trail);
        expect(road.works.length).toBeLessThanOrEqual(div.works);
        expect(road.cuts.length).toBeLessThanOrEqual(div.cuts);
        expect(lanes.length).toBeLessThanOrEqual(div.ramps);
        placed += road.works.length + road.cuts.length + lanes.length;
        const spans: [number, number][] = [
          ...road.works.map((x): [number, number] => [x.z0 - C.WORKS.taper, x.z1 + C.WORKS.out]),
          ...road.cuts.map((x): [number, number] => [x.z0 - 10, x.z1]),
          ...lanes.map((x): [number, number] => [x.z - 20, x.z + 20]),
        ];
        for (const [a, b] of spans) {
          expect(a).toBeGreaterThanOrEqual(60);
          expect(b).toBeLessThanOrEqual(C.RACE_LEN - 60);
        }
        for (let i = 0; i < spans.length; i++) {
          for (let j = i + 1; j < spans.length; j++) {
            expect(spans[i][1] <= spans[j][0] || spans[j][1] <= spans[i][0]).toBe(true);
          }
        }
      }
      // on a full-length road nearly all of them fit
      expect(placed).toBeGreaterThanOrEqual(0.9 * 40 * (div.works + div.cuts + div.ramps));
    }
  });

  it('makes the rivals faster and sharper, the traffic and the buggies busier up the ladder', () => {
    const lo = new World({ seed: 5, div: 0 });
    const hi = new World({ seed: 5, div: 4 });
    const d = C.DIVISIONS[4];
    for (let i = 1; i <= C.ROSTER.length; i++) {
      expect(hi.riders[i].top).toBeCloseTo(lo.riders[i].top + C.TIERS[0].top[4], 6);
      expect(hi.riders[i].aware).toBeGreaterThan(lo.riders[i].aware);
    }
    expect(hi.patrolCount).toBe(lo.patrolCount + d.patrol);
    expect(hi.cars.length).toBeGreaterThanOrEqual(lo.cars.length);
  });

  it('riding into the cones throws the player off; a lane over rides past', () => {
    const into = seedWith(4, (w) => w.road.works.length > 0);
    const wk = into.road.works[0];
    place(into, C.LANE_X[3], wk.z0 - C.WORKS.taper - 20);
    expect(crashOf(run(into, () => into.player.state !== 'ride' || into.player.z > wk.z1))).toBe('cones');

    const past = seedWith(4, (w) => w.road.works.length > 0);
    place(past, C.LANE_X[2], wk.z0 - C.WORKS.taper - 20);
    const ev = run(past, () => past.player.z > wk.z1 + 10);
    expect(crashOf(ev)).toBe(null);
    expect(past.player.z).toBeGreaterThan(wk.z1 + 10);
  });

  it('cars merge out of a coned-off lane, or wait short of the cones until they can', () => {
    for (const boxedIn of [false, true]) {
      const w = seedWith(4, (x) => x.road.works.length > 0);
      const wk = w.road.works[0];
      const start = wk.z0 - C.WORKS.taper;
      w.cars.length = 0;
      place(w, 0, start - 60);
      w.player.speed = 0;
      w.input.brake = true;
      const car = { id: 900, x: C.LANE_X[3], z: start - 50, pz: start - 50, speed: 15, cruise: 15, lane: 3, color: 0 };
      w.cars.push(car);
      if (boxedIn) w.cars.push({ id: 901, x: C.LANE_X[2], z: start - 50, pz: start - 50, speed: 15, cruise: 15, lane: 2, color: 0 });
      let intoCones = false;
      run(w, () => car.z > wk.z1 || !w.cars.includes(car), () => {
        w.cars.splice(0, w.cars.length, ...w.cars.filter((c) => c.id >= 900));
        if (car.lane === 3 && car.z + C.CAR.halfL > start - 1 && car.z < wk.z1 + C.WORKS.out) intoCones = true;
      }, [], false);
      expect(intoCones).toBe(false);
      expect(car.lane).toBe(2);
    }
  });

  it('a trail: in through the opening, held on it between the openings, and quicker than the road', () => {
    const ticks: number[] = [];
    for (const take of [true, false]) {
      const w = seedWith(2, (x) => x.road.cuts.length > 0);
      const c = w.road.cuts[0];
      const s = c.side;
      place(w, take ? s * C.EDGE : s * C.LANE_X[2], c.z0 - 30);
      let held = true;
      let onTrail = false;
      let n = 0;
      const ev = run(w, () => w.player.z > c.z1 + 10 || w.player.state !== 'ride', () => {
        n++;
        const p = w.player;
        if (!take) return;
        const mid = p.z > c.z0 + C.CUT.gap + 20 && p.z < c.z1 - C.CUT.merge - 20;
        if (w.road.trailAt(p.x, p.z) !== 0) onTrail = true;
        if (mid) {
          // try to steer back onto the road through the barrier
          w.input.targetX = 0;
          if (p.x * s < C.CUT.inner - 1e-6) held = false;
        } else w.input.targetX = p.z > c.z1 - C.CUT.merge ? s * C.LANE_X[2] : s * C.CUT.mid;
      });
      expect(crashOf(ev)).toBe(null);
      if (take) {
        expect(onTrail).toBe(true);
        expect(held).toBe(true);
        expect(ev.some((e) => e.type === 'jump')).toBe(true); // the trail's own ramp
      }
      ticks.push(n);
    }
    expect(ticks[0]).toBeLessThan(ticks[1] * 0.95);
  });

  it('caught halfway across when the opening ends: into the post', () => {
    const w = seedWith(2, (x) => x.road.cuts.length > 0);
    const c = w.road.cuts[0];
    place(w, c.side * 8, c.z0 + C.CUT.gap - 6);
    expect(crashOf(run(w, () => w.player.state !== 'ride' || w.player.z > c.z0 + C.CUT.gap + 10))).toBe('wall');
  });

  it('a ramp: out of reach in the air, lands faster, and on whoever is below', () => {
    const w = seedWith(4, (x) => x.road.ramps.some((r) => !r.trail));
    const ramp = w.road.ramps.find((r) => !r.trail)!;
    const p = w.player;
    const r = w.riders[1];
    place(w, ramp.x, ramp.z - 15);
    let before = 0;
    let swung: boolean | null = null;
    const ev = run(w, () => (before > 0 && p.airT === 0) || p.z > ramp.z + 80, () => {
      if (p.airT === 0) return;
      before = p.speed;
      if (swung === null) swung = w.tryAttack(p);
      if (p.airT === 2) {
        // someone right where it comes down
        r.state = 'ride';
        r.x = r.px = r.wantX = p.x;
        r.z = r.pz = p.z; // level with it: both move on alike till it comes down
        r.speed = p.speed;
        r.latV = r.vx = 0;
        r.latAcc = 0;
        r.invT = 0;
      }
    }, [r]);
    expect(ev.some((e) => e.type === 'jump' && e.rider === 0)).toBe(true);
    expect(swung).toBe(false);
    const land = ev.find((e) => e.type === 'land');
    expect(land && land.type === 'land' && land.stomp).toBe(r.id);
    expect(r.state).not.toBe('ride');
    expect(p.speed).toBeGreaterThan(before);
  });
});
