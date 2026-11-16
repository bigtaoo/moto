import { describe, it, expect } from 'vitest';
import { World } from './world';
import * as C from './config';

/** A world past the countdown with nobody fighting. */
function quiet(): World {
  const w = new World({ seed: 5 });
  while (w.countdown > 0) w.step();
  for (const r of w.riders) if (!r.isPlayer) { r.z = w.player.z - 300; r.speed = 0; r.aggr = 0; }
  return w;
}

describe('traffic sway', () => {
  it('reaches across the lane boundary, so the painted line is no safe lane', () => {
    const w = quiet();
    w.cars.length = 0;
    const id = w.nextId;
    const lane = 2;
    w.cars.push({ id, x: C.LANE_X[lane], z: w.player.z + 200, pz: w.player.z + 200,
      speed: 12, cruise: 12, lane, color: 0, brushed: false });
    const boundary = (C.LANE_X[1] + C.LANE_X[2]) / 2; // the line the player would ride
    const hit = C.CAR.halfW + C.CAR.riderHalfW;
    let nearest = Infinity;
    let widest = 0;
    for (let i = 0; i < C.TRAFFIC.swayS * C.TICK_HZ * 2; i++) {
      w.step();
      const c = w.cars.find((o) => o.id === id);
      if (!c) break;
      nearest = Math.min(nearest, Math.abs(c.x - boundary));
      widest = Math.max(widest, Math.abs(c.x - C.LANE_X[lane]));
    }
    expect(nearest).toBeLessThan(hit); // a rider on the line gets clipped at some point
    expect(widest).toBeLessThanOrEqual(C.TRAFFIC.sway + 0.01); // ...but the car never leaves its lane
  });
});
