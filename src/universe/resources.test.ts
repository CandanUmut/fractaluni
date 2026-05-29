import { describe, expect, test } from 'vitest';
import { planetResources, planetDanger, RESOURCES } from './resources.ts';
import type { Biome, PlanetProfile, StarProfile } from './types.ts';

const star = {} as StarProfile;
function planet(over: Partial<PlanetProfile>): PlanetProfile {
  return {
    seed: 123,
    biome: 'temperate' as Biome,
    surfaceTemp: 289,
    atmosphere: 0.6,
    gravity: 1,
    waterFraction: 0.5,
    ...over,
  } as PlanetProfile;
}

const hasTier = (ids: string[], tier: string): boolean => ids.some((id) => RESOURCES[id]!.tier === tier);

describe('resource derivation', () => {
  test('gentle worlds carry only common resources', () => {
    const ids = planetResources(planet({ biome: 'temperate' }), star).map((r) => r.type.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(hasTier(ids, 'exotic')).toBe(false);
  });

  test('harsh worlds unlock rare/exotic resources', () => {
    const molten = planetResources(planet({ biome: 'molten', surfaceTemp: 1400, atmosphere: 0.2 }), star).map((r) => r.type.id);
    expect(hasTier(molten, 'exotic')).toBe(true);
    expect(planetDanger(planet({ biome: 'molten', surfaceTemp: 1400 }))).toBeGreaterThan(0.55);
  });

  test('palette is deterministic and danger-sensitive', () => {
    const ids = (p: PlanetProfile): string[] => planetResources(p, star).map((r) => r.type.id).sort();
    const frozen = planet({ biome: 'frozen', surfaceTemp: 200 });
    expect(ids(frozen)).toEqual(ids(frozen)); // deterministic
    expect(ids(frozen)).toContain('ice'); // frozen worlds offer ice
    // A gentle world and a hostile world carry different palettes (tiers differ).
    const gentle = ids(planet({ biome: 'temperate' }));
    const hostile = ids(planet({ biome: 'molten', surfaceTemp: 1400, atmosphere: 0.2 }));
    expect(gentle).not.toEqual(hostile);
  });
});
