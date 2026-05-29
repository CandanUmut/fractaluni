// Seeded pseudo-random number generator (splitmix32) plus sampling helpers.
// `makeRNG(seed)` returns a stateful closure producing floats in [0,1).
// Determinism contract: same seed ⇒ same sequence, on every machine.

export type RNG = () => number;

/** splitmix32 — small, fast, good-enough statistical quality for procgen. */
export function makeRNG(seed: number): RNG {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
    z = (z ^ (z >>> 15)) >>> 0;
    return z / 4294967296; // [0,1)
  };
}

/** Uniform float in [min, max). */
export function rangeFloat(rng: RNG, min: number, max: number): number {
  return min + (max - min) * rng();
}

/** Uniform integer in [min, max] inclusive. */
export function rangeInt(rng: RNG, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

/** Approx standard normal via sum of uniforms (central limit, n=6 → mean 0, sd≈1). */
export function gaussian(rng: RNG): number {
  let sum = 0;
  for (let i = 0; i < 6; i++) sum += rng();
  return (sum - 3) / Math.sqrt(0.5);
}

/** Pick an index from a weight array, proportional to weights. */
export function weightedIndex(rng: RNG, weights: readonly number[]): number {
  let total = 0;
  for (const w of weights) total += w;
  let r = rng() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i]!;
    if (r < 0) return i;
  }
  return weights.length - 1;
}

/** Pick an element from an array uniformly. */
export function pick<T>(rng: RNG, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)]!;
}
