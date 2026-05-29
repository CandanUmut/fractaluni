import { weightedIndex, type RNG } from '../core/rng.ts';
import { clamp01 } from '../core/math.ts';
import type { PlanetProfile, StarProfile } from './types.ts';

// Resources are DERIVED from the planet profile (relational, never sprinkled):
// star class + biome + composition decide which resources exist, their rarity,
// and their hardness. Richer/rarer resources correlate with harsher, more
// dangerous worlds — so progression pulls the player toward hostile planets.

export type ResourceTier = 'common' | 'rare' | 'exotic';

export interface ResourceType {
  id: string;
  name: string;
  tier: ResourceTier;
  /** Display/ore color. */
  color: number;
  /** Sell value per unit. */
  value: number;
  /** Tool tier required to extract (1 basic drill … 3 needs top tool or bombs). */
  hardness: number;
}

export const RESOURCES: Record<string, ResourceType> = {
  // Drilled straight from the ground anywhere on a planet — abundant, low value.
  regolith: { id: 'regolith', name: 'Regolith', tier: 'common', color: 0x8c7a5e, value: 1, hardness: 1 },
  ferrite: { id: 'ferrite', name: 'Ferrite', tier: 'common', color: 0x9aa3b0, value: 5, hardness: 1 },
  silica: { id: 'silica', name: 'Silica', tier: 'common', color: 0xd8d2b8, value: 4, hardness: 1 },
  ice: { id: 'ice', name: 'Ice', tier: 'common', color: 0xbfe6ff, value: 3, hardness: 1 },
  carbon: { id: 'carbon', name: 'Carbon', tier: 'common', color: 0x3a3a40, value: 6, hardness: 1 },
  cuprite: { id: 'cuprite', name: 'Cuprite', tier: 'rare', color: 0xd07a3a, value: 14, hardness: 2 },
  sulfur: { id: 'sulfur', name: 'Sulfur', tier: 'rare', color: 0xe8d24a, value: 12, hardness: 2 },
  titanite: { id: 'titanite', name: 'Titanite', tier: 'rare', color: 0xc0c8d8, value: 18, hardness: 2 },
  obsidian: { id: 'obsidian', name: 'Obsidian', tier: 'common', color: 0x1c1c22, value: 7, hardness: 1 },
  biogel: { id: 'biogel', name: 'Biogel', tier: 'rare', color: 0x6fe089, value: 16, hardness: 2 },
  helium3: { id: 'helium3', name: 'Helium-3', tier: 'rare', color: 0xbfefff, value: 22, hardness: 2 },
  iridite: { id: 'iridite', name: 'Iridite', tier: 'exotic', color: 0x9affd0, value: 40, hardness: 3 },
  voidcrystal: { id: 'voidcrystal', name: 'Void Crystal', tier: 'exotic', color: 0xb27aff, value: 55, hardness: 3 },
  pyronium: { id: 'pyronium', name: 'Pyronium', tier: 'exotic', color: 0xff5a3a, value: 70, hardness: 3 },
  cryostone: { id: 'cryostone', name: 'Cryostone', tier: 'exotic', color: 0x7ad0ff, value: 48, hardness: 3 },
};

export interface ResourceWeight {
  type: ResourceType;
  weight: number;
}

/** How dangerous/harsh a planet is [0,1] — gates access to rarer resources. */
export function planetDanger(planet: PlanetProfile): number {
  let d = 0;
  if (planet.biome === 'molten') d += 0.6;
  if (planet.biome === 'barren-rock') d += 0.35;
  if (planet.atmosphere < 0.06) d += 0.3; // airless
  d += clamp01((Math.abs(planet.surfaceTemp - 289) - 60) / 240) * 0.5; // temperature extremes
  d += clamp01((planet.gravity - 1.4) / 2) * 0.25; // crushing gravity
  return clamp01(d);
}

/** The weighted resource palette a planet carries. */
export function planetResources(planet: PlanetProfile, _star: StarProfile): ResourceWeight[] {
  const danger = planetDanger(planet);
  const out: ResourceWeight[] = [];
  const add = (id: string, w: number): void => {
    if (w > 0) out.push({ type: RESOURCES[id]!, weight: w });
  };

  // Commons keyed to biome/composition.
  const b = planet.biome;
  add('ferrite', 3 + (b === 'barren-rock' || b === 'molten' ? 3 : 0));
  add('silica', b === 'desert' || b === 'arid' ? 4 : 2);
  add('ice', b === 'frozen' || b === 'tundra' || planet.waterFraction > 0.6 ? 5 : 0.5);
  add('carbon', b === 'tropical' || b === 'temperate' || b === 'oceanic' ? 4 : 1);
  add('obsidian', b === 'molten' ? 4 : b === 'barren-rock' ? 1.5 : 0);

  // Rares appear on moderately harsh worlds.
  if (danger > 0.25) {
    add('cuprite', 2);
    add('sulfur', b === 'molten' || b === 'arid' ? 3 : 1);
    add('titanite', planet.gravity > 1.1 ? 3 : 1);
    add('biogel', b === 'tropical' || b === 'oceanic' || b === 'temperate' ? 3 : 0);
    add('helium3', planet.atmosphere < 0.2 ? 3 : 0);
  }
  // Exotics only on the harshest, most dangerous worlds.
  if (danger > 0.55) {
    add('iridite', planet.atmosphere < 0.1 ? 3 : 1);
    add('voidcrystal', b === 'frozen' ? 3 : 1);
    add('pyronium', b === 'molten' ? 4 : 0.5);
    add('cryostone', b === 'frozen' || b === 'tundra' ? 3 : 0);
  }
  return out;
}

/** Pick a resource type from a planet's palette. */
export function pickResource(palette: ResourceWeight[], rng: RNG): ResourceType {
  const i = weightedIndex(rng, palette.map((p) => p.weight));
  return palette[i]!.type;
}
