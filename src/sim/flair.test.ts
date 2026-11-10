import { describe, it, expect } from 'vitest';
import { World } from './world';
import { chainKo } from './flair';
import * as C from './config';

function quiet(): World {
  const w = new World({ seed: 3 });
  while (w.countdown > 0) w.step();
  w.cars.length = 0;
  for (const r of w.riders) if (!r.isPlayer) { r.z = w.player.z - 300; r.speed = 0; r.aggr = 0; }
  return w;
}

/** A parked car just ahead of the player, `gap` metres of air to the side of the player's line. */
function carBeside(w: World, gap: number): void {
  const p = w.player;
  p.speed = 14;
  const x = p.x + C.CAR.halfW + C.CAR.riderHalfW + gap;
  w.cars.push({ id: 999, x, z: p.z + 3, pz: p.z + 3, speed: 0, cruise: 0, lane: 9, color: 0, brushed: false });
  w.input.targetX = p.x;
}

describe('flair', () => {
  it('pays a near miss once per car, and only when it was close', () => {
    for (const [gap, want] of [[0.4, 1], [2.5, 0]] as const) {
      const w = quiet();
      carBeside(w, gap);
      for (let i = 0; i < 30; i++) w.step();
      expect(w.player.state).toBe('ride');
      expect(w.flair.near).toBe(want);
      expect(w.flair.nearPay).toBe(want * C.FLAIR.nearPay);
    }
  });

  it('chains KOs inside the window and pays more per link, up to the cap', () => {
    const w = quiet();
    for (let i = 0; i < 7; i++) chainKo(w);
    expect(w.flair.best).toBe(7);
    const links = [1, 2, 3, 3, 3, 3].reduce((a, n) => a + n * C.FLAIR.chainPay, 0);
    expect(w.flair.chainPay).toBe(links);
    // the window runs out: the next KO starts a new chain
    for (let i = 0; i < C.FLAIR.chainS * C.TICK_HZ + 1; i++) w.step();
    expect(w.flair.chain).toBe(0);
    chainKo(w);
    expect(w.flair.chain).toBe(1);
    expect(w.flair.chainPay).toBe(links);
  });
});
