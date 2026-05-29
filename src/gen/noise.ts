import { hash, deriveSeed } from '../core/hash.ts';
import { TAU } from '../core/math.ts';

// Deterministic gradient (Perlin-style) noise + fBm + domain warping. Gradients
// come from the integer hash at each lattice point, so there's no permutation
// table and the field is identical for a given seed on every machine.

const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);

function gradDot(seed: number, ix: number, iy: number, dx: number, dy: number): number {
  const ang = (hash(seed, ix, iy) / 4294967296) * TAU;
  return Math.cos(ang) * dx + Math.sin(ang) * dy;
}

/** 2D gradient noise, output roughly in [-1, 1]. */
export function perlin2(seed: number, x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const u = fade(fx);
  const v = fade(fy);

  const n00 = gradDot(seed, ix, iy, fx, fy);
  const n10 = gradDot(seed, ix + 1, iy, fx - 1, fy);
  const n01 = gradDot(seed, ix, iy + 1, fx, fy - 1);
  const n11 = gradDot(seed, ix + 1, iy + 1, fx - 1, fy - 1);

  const nx0 = n00 + u * (n10 - n00);
  const nx1 = n01 + u * (n11 - n01);
  // Scale toward [-1,1] (gradient noise peaks near ~0.7).
  return (nx0 + v * (nx1 - nx0)) * 1.4;
}

export interface FbmParams {
  octaves: number;
  lacunarity: number;
  gain: number;
  frequency: number;
}

/** Fractal Brownian motion: stacked Perlin octaves, normalized to ~[-1, 1]. */
export function fbm2(seed: number, x: number, y: number, p: FbmParams): number {
  let amp = 1;
  let freq = p.frequency;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < p.octaves; i++) {
    sum += amp * perlin2(deriveSeed(seed, i), x * freq, y * freq);
    norm += amp;
    amp *= p.gain;
    freq *= p.lacunarity;
  }
  return norm > 0 ? sum / norm : 0;
}

/** Domain-warped fBm: offset the sample point by another fBm field before
 *  sampling. This is what gives natural, non-grid-aligned coastlines/ridges. */
export function warpedFbm2(
  seed: number,
  x: number,
  y: number,
  p: FbmParams,
  warpAmp: number,
  warpFreq: number,
): number {
  const ws = deriveSeed(seed, 0x9a71);
  const wp: FbmParams = { octaves: 2, lacunarity: 2, gain: 0.5, frequency: warpFreq };
  const wx = fbm2(ws, x, y, wp);
  const wy = fbm2(deriveSeed(ws, 1), x + 41.7, y + 13.2, wp);
  return fbm2(seed, x + warpAmp * wx, y + warpAmp * wy, p);
}
