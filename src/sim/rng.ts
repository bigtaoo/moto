// Seeded random numbers (same idea as fang's prng.ts): a full-period LCG whose outputs pass
// through the MurmurHash3 finalizer. Integer-only, so it is exact on every engine. Each concern
// gets its own stream, so adding draws in one system does not shift what another one sees.

export class Prng {
  private state: number;

  constructor(seed: number) {
    this.state = mix32(seed >>> 0) || 1;
  }

  /** Integer in [0, max). */
  int(max: number): number {
    this.state = (Math.imul(1664525, this.state) + 1013904223) >>> 0;
    return mix32(this.state) % max;
  }

  /** Float in [0, 1). */
  float(): number {
    return this.int(0x1000000) / 0x1000000;
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)];
  }
}

function mix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}
