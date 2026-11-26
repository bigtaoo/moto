import { describe, it, expect } from 'vitest';
import { World } from './world';
import { botInput } from './ai';
import * as C from './config';

describe('security buggy', () => {
  it('drives round traffic instead of through it', () => {
    let overlaps = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const w = new World({ seed });
      while (!w.over && w.tick < 300 * C.TICK_HZ) {
        botInput(w, 0.5);
        w.step();
        w.events.length = 0;
        const pt = w.patrol;
        if (!pt.active) continue;
        for (const c of w.cars) {
          if (Math.abs(c.x - pt.x) < C.CAR.halfW + C.PATROL.halfW && Math.abs(c.z - pt.z) < C.CAR.halfL + C.PATROL.halfL) overlaps++;
        }
      }
    }
    expect(overlaps).toBe(0);
  });

  it('blocks and squeezes but is solid: no rider ends a tick inside it', () => {
    let inside = 0;
    let presses = 0;
    let pressTicks = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const w = new World({ seed, upgrades: { top: 3, steer: 3, hp: 0 } });
      while (!w.over && w.tick < 300 * C.TICK_HZ) {
        botInput(w, 1, false);
        w.step();
        for (const e of w.events) if (e.type === 'patrolWarn') presses++;
        w.events.length = 0;
        const pt = w.patrol;
        if (!pt.active) continue;
        if (pt.mode === 'block' || pt.mode === 'squeeze') pressTicks++;
        for (const r of w.riders) {
          if (r.state !== 'ride' || r.airT > 0) continue; // off a ramp, riders fly over it
          if (Math.abs(r.x - pt.x) < C.PATROL.halfW + C.PATROL.riderHalfW - 0.01 && Math.abs(r.z - pt.z) < C.PATROL.halfL + 0.59) inside++;
        }
      }
    }
    expect(inside).toBe(0);
    expect(presses).toBeGreaterThan(4);
    expect(pressTicks).toBeGreaterThan(0);
  });

  it('each buggy makes one go and leaves: several per race, none tags along', () => {
    let units = 0;
    let races = 0;
    let longest = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const w = new World({ seed, upgrades: { top: 3, steer: 3, hp: 0 } });
      const warned = new Set<number>();
      let on = 0;
      while (!w.over && w.tick < 300 * C.TICK_HZ) {
        botInput(w, 1, false);
        w.step();
        for (const e of w.events) {
          if (e.type !== 'patrolWarn') continue;
          expect(warned.has(w.patrol.units)).toBe(false); // a buggy never comes back for a second go
          warned.add(w.patrol.units);
        }
        w.events.length = 0;
        on = w.patrol.active ? on + 1 : 0;
        longest = Math.max(longest, on);
      }
      units += w.patrol.units;
      races++;
    }
    expect(units / races).toBeGreaterThanOrEqual(3);
    expect(longest / C.TICK_HZ).toBeLessThan(40); // seconds any one buggy spends on the road
  });

  it('tickets a player who runs, and charges less to one who pulls over', () => {
    const run = { tickets: 0, letGo: 0, fines: 0 };
    const stop = { tickets: 0, letGo: 0, fines: 0 };
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      for (const [comply, acc] of [[false, run], [true, stop]] as const) {
        const w = new World({ seed, upgrades: { top: 3, steer: 3, hp: 1 } });
        while (!w.over && w.tick < 300 * C.TICK_HZ) {
          botInput(w, 0.6, true, comply);
          w.step();
          for (const e of w.events) {
            if (e.type === 'patrolTicket') {
              acc.tickets++;
              expect(e.fine).toBeGreaterThanOrEqual(C.PATROL.ticket);
            }
            if (e.type === 'patrolLetGo') acc.letGo++;
          }
          w.events.length = 0;
        }
        acc.fines += w.fines;
      }
    }
    // running from a buggy that had you is not free any more ...
    expect(run.tickets).toBeGreaterThan(0);
    // (a runner knocked off beside a buggy is stopped whether they meant to be or not)
    expect(run.letGo).toBeLessThan(run.tickets * 0.3);
    // ... and it costs more than stopping for one does
    expect(stop.letGo).toBeGreaterThan(0);
    expect(run.fines).toBeGreaterThan(stop.fines * 2);
    // every ticket is on the bill
    expect(run.fines).toBeGreaterThanOrEqual(run.tickets * C.PATROL.ticket);
  });

  it('slows you while it squeezes you', () => {
    let squeezed = 0;
    let lost = 0;
    // Two dozen seeds, not eight: a squeeze is one long episode rather than a tick here and there, so a
    // handful of seeds means a handful of episodes and one of them carries the whole count.
    for (let seed = 1; seed <= 24; seed++) {
      const w = new World({ seed, upgrades: { top: 3, steer: 3, hp: 0 } });
      while (!w.over && w.tick < 300 * C.TICK_HZ) {
        botInput(w, 1, false);
        const before = w.player.speed;
        w.step();
        w.events.length = 0;
        const p = w.player;
        if (w.patrol.active && w.patrol.mode === 'squeeze' && p.state === 'ride' && p.rubT === C.CONTACT.rubTicks && Math.abs(p.x - w.patrol.x) < 1.5) {
          squeezed++;
          lost += before - p.speed;
        }
      }
    }
    expect(squeezed).toBeGreaterThan(60);
    expect(lost / squeezed).toBeGreaterThan(0.05); // m/s per tick, net of the scooter's own acceleration
    // Its own budget: 3.3.85 took this one to 24 seeds -- three times the file's others -- and left it on
    // vitest's 5 s default, where it ran 4919 ms green and 5393 ms red on the next commit, which had not
    // touched the sim. A test that counts episodes needs the seeds; what it needed was the room to run.
  }, 30_000);
  it('charges a ticket in the money of the division it was written in (3.3.52)', () => {
    // Flat fines meant a ticket was most of a first prize in Rookie Meadow and petty cash in
    // Legend Neon Coast. Each one is now the stage's prize multiplier times the base.
    const bill = (div: number, tier: number) => {
      let total = 0;
      let tickets = 0;
      for (const seed of [1, 2, 3, 4, 5, 6]) {
        const w = new World({ seed, div, tier, upgrades: { top: 3, steer: 3, hp: 1 } });
        while (!w.over && w.tick < 300 * C.TICK_HZ) {
          botInput(w, 0.6, true, false);
          w.step();
          for (const e of w.events) {
            if (e.type === 'patrolTicket') {
              tickets++;
              total += e.fine;
              // never less than the base, never more than the base with every star, times the purse
              expect(e.fine).toBeGreaterThanOrEqual(Math.round(C.PATROL.ticket * w.div.prize));
              expect(e.fine).toBeLessThanOrEqual(Math.round((C.PATROL.ticket + C.HEAT.max * C.PATROL.ticketStar) * w.div.prize));
            }
          }
          w.events.length = 0;
        }
      }
      expect(tickets).toBeGreaterThan(0);
      return total / tickets;
    };
    const rookie = bill(0, 0);
    const legend = bill(4, 2);
    // the top of the ladder pays 10.8x the purse of the first race, so its tickets cost about that much more
    const mul = C.stage(4, 2).prize;
    expect(legend / rookie).toBeGreaterThan(mul * 0.7);
    expect(legend / rookie).toBeLessThan(mul * 1.4);
  }, 30_000);
});
