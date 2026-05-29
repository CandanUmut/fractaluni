import type { Biome } from './types.ts';

// Biome is CLASSIFIED from physics, never rolled. Inputs:
//   surfaceTemp  (Kelvin)  — after greenhouse
//   waterFraction [0,1]    — raw hydrosphere extent
//   atmosphere    [0,1]    — 0 airless, 1 thick
//
// The decision tree reads top-down: the most decisive constraints first
// (extreme heat, no air), then a temperature×water grid for clement worlds.

const FREEZE = 250; // K — below this, surface water is locked as ice.
const COLD = 273;
const WARM = 305;
const HOT = 330;
const MOLTEN = 1000;

export function classifyBiome(
  surfaceTemp: number,
  waterFraction: number,
  atmosphere: number,
): Biome {
  // Extremes dominate regardless of water.
  if (surfaceTemp >= MOLTEN) return 'molten';
  if (atmosphere < 0.06) return 'barren-rock';

  // Frozen worlds.
  if (surfaceTemp < FREEZE) return 'frozen';

  // Cold-but-not-frozen.
  if (surfaceTemp < COLD) return 'tundra';

  // Clement range: classify by temperature and how wet it is.
  const wet = waterFraction > 0.6;
  const moist = waterFraction > 0.3;

  if (surfaceTemp >= HOT) {
    return moist ? 'arid' : 'desert';
  }
  if (surfaceTemp >= WARM) {
    if (wet) return 'tropical';
    return moist ? 'temperate' : 'arid';
  }
  // COLD..WARM — the temperate band.
  if (waterFraction > 0.85) return 'oceanic';
  if (wet) return 'temperate';
  if (moist) return 'temperate';
  return 'tundra';
}
