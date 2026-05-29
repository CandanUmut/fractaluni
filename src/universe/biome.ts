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

  // Frozen / cold worlds.
  if (surfaceTemp < FREEZE) return 'frozen';
  if (surfaceTemp < COLD) return 'tundra';

  // Clement → hot range: water fraction decides the character within each band.
  if (surfaceTemp >= HOT) {
    if (waterFraction > 0.5) return 'tropical';
    return waterFraction > 0.25 ? 'arid' : 'desert';
  }
  if (surfaceTemp >= WARM) {
    if (waterFraction > 0.7) return 'tropical';
    if (waterFraction > 0.4) return 'temperate';
    return waterFraction > 0.2 ? 'arid' : 'desert';
  }
  // COLD..WARM — the temperate band.
  if (waterFraction > 0.7) return 'oceanic';
  if (waterFraction > 0.35) return 'temperate';
  return 'tundra';
}
