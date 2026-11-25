import { describe, expect, it } from 'vitest';
import { Sight } from './sight';
import type { Stage } from './stage';
import type { World } from '../sim/world';

// Only the `pack` rule is tested here. The other two measure projected screen pixels and camera pose,
// where an assertion in jsdom would be an ornament (doc 3.3.84); this one is worked out in the sim's own
// metres, so the numbers the doc quotes are numbers a test can hold on to.

/** A world of rivals at (x, z) metres, with the player at the origin. `away` ones ride nowhere. */
const world = (rivals: { x: number; z: number; away?: boolean }[]): World =>
  ({
    riders: [
      { x: 0, z: 0, px: 0, pz: 0, state: 'ride' },
      ...rivals.map((r) => ({ x: r.x, z: r.z, px: r.x, pz: r.z, state: r.away ? 'away' : 'ride' })),
    ],
  }) as unknown as World;

/** How far rival `n` (1-based) is thinned by the pack rule alone, with the camera far enough back that
 *  `blocking` -- which falls off as one over the distance -- is nowhere near the louder of the two. */
function packHide(rivals: { x: number; z: number; away?: boolean }[], n = 1, px = 0): number {
  const sight = new Sight({ cssH: 600 } as unknown as Stage, () => false);
  const w = world(rivals);
  sight.begin(w, [], px, 0, 1, 3);
  const r = rivals[n - 1];
  // A rival off to the side of the player's own line, so `blocking` reads 0 and the max is the pack's.
  return sight.hide(n, px + 99, r.z, 0, px);
}

describe('the pack in front', () => {
  it('leaves one rival alone and walls off three, as the doc has it', () => {
    // One body covers 1.14 m of the 5 m band: 0.228, under the 0.3 it takes to be thinned at all.
    expect(packHide([{ x: 0, z: 12 }])).toBe(0);
    // Two abreast cover 0.456, three 0.684 -- the three the player reported, which land at 0.43 of a
    // possible 1, or the 0.36 the screen reads once `ghost` has had its 0.85 of it.
    expect(packHide([{ x: -1.1, z: 12 }, { x: 0.1, z: 13.6 }])).toBeCloseTo(0.173, 3);
    const three = [{ x: -1.1, z: 12 }, { x: 0.1, z: 13.6 }, { x: 1.2, z: 15.2 }];
    for (const n of [1, 2, 3]) expect(packHide(three, n)).toBeCloseTo(0.4267, 3);
  });

  it('follows the player across the road rather than the middle of it', () => {
    // The same three, with the player steered a lane and a half over: two of them are now off the side
    // of the band he is reading, and what is left of the wall is a fraction of it.
    const three = [{ x: -1.1, z: 12 }, { x: 0.1, z: 13.6 }, { x: 1.2, z: 15.2 }];
    expect(packHide(three, 3, 2.2)).toBeLessThan(0.2);
  });

  it('has no step in it at any edge', () => {
    const at = (x: number, z: number) => packHide([{ x: -1.1, z: 12 }, { x: 0.1, z: 13.6 }, { x: x, z }], 3);
    // Sideways out of the band: a body whose last sliver is over the edge counts for that sliver, not
    // for a whole one, so riding out of the band costs a hair a frame rather than a jump.
    expect(at(3.06, 15.2)).toBeLessThan(0.01);
    expect(Math.abs(at(3.0, 15.2) - at(3.06, 15.2))).toBeLessThan(0.02);
    expect(at(3.07, 15.2)).toBe(0);
    // And out to the horizon: 30 m is where a rival stops counting, and the 6 m before it is the ramp.
    expect(Math.abs(at(1.2, 29.9) - at(1.2, 30))).toBeLessThan(0.01);
    expect(at(1.2, 30.1)).toBe(0);
    expect(at(1.2, 26)).toBeGreaterThan(at(1.2, 28));
  });

  it('counts nobody who is not riding, and nobody in the fight', () => {
    const three = (away: boolean) => [
      { x: -1.1, z: 12 },
      { x: 0.1, z: 13.6 },
      { x: 1.2, z: 15.2, away },
    ];
    expect(packHide(three(true), 1)).toBeLessThan(packHide(three(false), 1));
    // Nearer than 4 m is the fight, not the road: that one is read as a rival, not as a wall.
    expect(packHide([{ x: -1.1, z: 2 }, { x: 0.1, z: 3 }, { x: 1.2, z: 3.5 }], 1)).toBe(0);
  });
});
