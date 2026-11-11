import { describe, it, expect } from 'vitest';
import { dragTarget } from './input';

// The measured screen px the bike slides per metre across the road, on a 915x412 phone held each way
// (doc 3.3.30). They differ because the two cameras do: tighter and following harder in landscape.
const LAND = 21.8;
const PORT = 30.6;

describe('dragTarget', () => {
  it('buys a pixel of bike for a pixel of thumb', () => {
    expect(dragTarget(0, LAND, LAND, -7, 7)).toBeCloseTo(1, 6);
    expect(dragTarget(0, -LAND, LAND, -7, 7)).toBeCloseTo(-1, 6);
    expect(dragTarget(2, 3 * PORT, PORT, -7, 7)).toBeCloseTo(5, 6);
  });

  it('asks for the same travel on screen whichever way the phone is held', () => {
    // crossing the whole 14 m road: the thumb goes as far as the bike does, in both orientations
    for (const g of [LAND, PORT]) {
      const px = 14 * g;
      expect(dragTarget(-7, px, g, -7, 7)).toBeCloseTo(7, 6);
      expect(px).toBeLessThan(915); // and it fits in one swipe of a phone screen
    }
  });

  it('holds the target inside the reach it is given', () => {
    expect(dragTarget(0, 9999, LAND, -7, 7)).toBe(7);
    expect(dragTarget(0, -9999, LAND, -7, 7)).toBe(-7);
    expect(dragTarget(6, 2 * LAND, LAND, -7, 6.5)).toBe(6.5);
  });

  it('cannot be made hair-trigger by a missing or degenerate camera', () => {
    // before a race has a view the gain reads 0; a pixel must still be worth only a sliver of road
    expect(dragTarget(0, 8, 0, -7, 7)).toBeCloseTo(1, 6);
    expect(dragTarget(0, 1, 0, -7, 7)).toBeCloseTo(0.125, 6);
    expect(dragTarget(0, 1, -5, -7, 7)).toBeCloseTo(0.125, 6);
  });
});
