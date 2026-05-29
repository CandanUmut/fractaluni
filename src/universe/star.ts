import { makeRNG, rangeFloat, rangeInt, weightedIndex, type RNG } from '../core/rng.ts';
import { blackbodyRGB } from './blackbody.ts';
import type { SpectralClass, StarProfile } from './types.ts';

// Star derivation. The causal chain: spectral class → temperature → (color,
// radius, mass) → luminosity (Stefan-Boltzmann from R and T) → habitable zone.
// Nothing downstream is rolled independently of these.

const SUN_TEMP = 5772; // K, used as the luminosity reference point.

const CLASSES: readonly SpectralClass[] = ['O', 'B', 'A', 'F', 'G', 'K', 'M'];

// Weighted toward M/K dwarfs (as in reality), but rarer classes are boosted a
// little from their true abundance so the galaxy stays visually varied.
const CLASS_WEIGHTS: readonly number[] = [0.4, 1.2, 3, 6, 12, 26, 51];

interface ClassBand {
  tempMin: number;
  tempMax: number;
  radiusMin: number; // solar radii
  radiusMax: number;
  massMin: number; // solar masses
  massMax: number;
}

// Representative main-sequence bands per class.
const BANDS: Record<SpectralClass, ClassBand> = {
  O: { tempMin: 30000, tempMax: 45000, radiusMin: 6.6, radiusMax: 12, massMin: 16, massMax: 60 },
  B: { tempMin: 10000, tempMax: 30000, radiusMin: 1.8, radiusMax: 6.6, massMin: 2.1, massMax: 16 },
  A: { tempMin: 7500, tempMax: 10000, radiusMin: 1.4, radiusMax: 1.8, massMin: 1.4, massMax: 2.1 },
  F: { tempMin: 6000, tempMax: 7500, radiusMin: 1.15, radiusMax: 1.4, massMin: 1.04, massMax: 1.4 },
  G: { tempMin: 5200, tempMax: 6000, radiusMin: 0.96, radiusMax: 1.15, massMin: 0.8, massMax: 1.04 },
  K: { tempMin: 3700, tempMax: 5200, radiusMin: 0.7, radiusMax: 0.96, massMin: 0.45, massMax: 0.8 },
  M: { tempMin: 2400, tempMax: 3700, radiusMin: 0.1, radiusMax: 0.7, massMin: 0.08, massMax: 0.45 },
};

export function deriveStar(seed: number): StarProfile {
  const rng: RNG = makeRNG(seed);

  const spectralClass = CLASSES[weightedIndex(rng, CLASS_WEIGHTS)]!;
  const band = BANDS[spectralClass];

  const temperature = rangeFloat(rng, band.tempMin, band.tempMax);
  const radius = rangeFloat(rng, band.radiusMin, band.radiusMax);
  const mass = rangeFloat(rng, band.massMin, band.massMax);

  // Stefan-Boltzmann: L/Lsun = (R/Rsun)^2 * (T/Tsun)^4.
  const luminosity = radius * radius * Math.pow(temperature / SUN_TEMP, 4);

  // Habitable zone scales with sqrt(L): conservative inner/outer flux bounds.
  const sqrtL = Math.sqrt(luminosity);
  const habitableZone = { inner: 0.95 * sqrtL, outer: 1.67 * sqrtL };

  // Hotter, brighter stars tend to host slightly fewer detected planets here;
  // keep it modest for performance and legibility.
  const planetCount = rangeInt(rng, 2, 8);

  return {
    seed,
    spectralClass,
    temperature,
    radius,
    mass,
    luminosity,
    color: blackbodyRGB(temperature),
    habitableZone,
    planetCount,
  };
}
