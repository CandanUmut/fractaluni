// Deterministic integer hashing — the backbone of the whole universe.
// Pure, fast, stateless. NO Math.random() may ever touch world generation;
// every "random" value flows from these functions.
//
// All arithmetic is forced into uint32 via `>>> 0` and Math.imul so results are
// bit-identical across machines/browsers (JS numbers are float64, but these ops
// are defined on 32-bit integers).

/** Mix a single uint32 (murmur3 finalizer). */
function mix32(x: number): number {
  x = x >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b) >>> 0;
  x ^= x >>> 16;
  return x >>> 0;
}

/** Hash an arbitrary list of integers to a uint32. Order matters.
 *  Negative ints are fine (`>>> 0` reinterprets the two's-complement bits). */
export function hash(...ints: number[]): number {
  let h = 0x811c9dc5; // FNV-1a offset basis
  for (let i = 0; i < ints.length; i++) {
    const v = mix32(ints[i]! | 0);
    h = (h ^ v) >>> 0;
    h = Math.imul(h, 0x01000193) >>> 0; // FNV prime
  }
  return mix32(h);
}

/** Fork a child seed from a parent seed plus discriminator keys.
 *  This is how the seed hierarchy is built: every entity derives its seed
 *  from its parent's seed + its identifying indices. */
export function deriveSeed(parentSeed: number, ...keys: number[]): number {
  return hash(parentSeed >>> 0, ...keys);
}

/** Hash a string seed (as typed in the URL) into a uint32 universe seed. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h = (h ^ s.charCodeAt(i)) >>> 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return mix32(h);
}
