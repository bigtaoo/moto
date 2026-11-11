import { describe, expect, it } from 'vitest';
import type { SimEvent, World } from './sim/world';
import { HIGHLIGHT, Moments } from './highlight';

/** `note` reads only the tick and who the nemesis is. */
const at = (tick: number, nemesis = 3): World => ({ tick, nemesis }) as World;

const ko = (opts: Partial<Extract<SimEvent, { type: 'hit' }>> = {}): SimEvent =>
  ({ type: 'hit', from: 0, to: 1, side: 1, dmg: 1, ko: true, counter: false, power: 0, ...opts });

describe('the race picks its best moment', () => {
  it('scores a knock-off, and pays more for the nemesis and for a full haymaker', () => {
    const plain = new Moments();
    plain.note(ko(), at(10));
    expect(plain.score).toBe(3);

    const nem = new Moments();
    nem.note(ko({ to: 3 }), at(10));
    expect(nem.score).toBe(5);

    const hay = new Moments();
    hay.note(ko({ to: 3, power: 1 }), at(10));
    expect(hay.score).toBe(6);
  });

  it('ranks a stomp and a boss over an ordinary knock-off', () => {
    const m = new Moments();
    m.note(ko(), at(10));
    m.note({ type: 'land', rider: 0, stomp: 2 }, at(20));
    expect(m.tick).toBe(20);
    m.note(ko(), at(30)); // a 3 does not displace the 5
    expect(m.tick).toBe(20);
    m.note({ type: 'boss', rider: 4, pay: 500 }, at(40));
    expect([m.tick, m.score]).toEqual([40, 6]);
  });

  it('keeps the later of two equally good moments: the end of the race is the fresher one', () => {
    const m = new Moments();
    m.note({ type: 'bowl', rider: 2, pay: 100 }, at(10));
    expect(m.tick).toBe(10);
    m.note({ type: 'bowl', rider: 5, pay: 100 }, at(99));
    expect(m.tick).toBe(99);
  });

  it('counts the player’s own wipeout, but not the one a rival caused', () => {
    const own = new Moments();
    own.note({ type: 'crash', rider: 0, cause: 'car', vx: 1, speed: 30 }, at(12));
    expect([own.tick, own.score]).toEqual([12, 3]);

    // a fall from a blow is the knock-off's moment, not a second one
    const hit = new Moments();
    hit.note({ type: 'crash', rider: 0, cause: 'ko', vx: 1, speed: 30 }, at(12));
    expect(hit.tick).toBe(-1);
  });

  it('ignores what the player did not do, and leaves a dull race without a highlight', () => {
    const m = new Moments();
    m.note(ko({ from: 2 }), at(10)); // a rival knocking off another rival
    m.note({ type: 'land', rider: 4, stomp: 1 }, at(20)); // a rival's stomp
    m.note({ type: 'shove', from: 2, to: 0, into: 'car' }, at(30)); // the player being shoved
    m.note({ type: 'whiff', rider: 0, dodged: true }, at(40));
    expect([m.tick, m.score]).toEqual([-1, 0]);
    expect(m.score < HIGHLIGHT.min).toBe(true); // nothing to show: main.ts skips the replay
  });

  it('pays more for shoving someone into traffic than into the scenery', () => {
    const car = new Moments();
    car.note({ type: 'shove', from: 0, to: 1, into: 'car' }, at(10));
    const wall = new Moments();
    wall.note({ type: 'shove', from: 0, to: 1, into: 'wall' }, at(10));
    expect(car.score).toBeGreaterThan(wall.score);
    expect(wall.score).toBeGreaterThanOrEqual(HIGHLIGHT.min);
  });
});
