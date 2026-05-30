import { describe, it, expect } from 'vitest';
import { planetHazards, isHazardous } from './hazards.ts';
import type { Biome, PlanetProfile } from '../universe/types.ts';

// Minimal planet stub carrying just the fields planetHazards reads.
function planet(p: { biome: Biome; surfaceTemp: number; atmosphere: number; inHabitableZone: boolean }): PlanetProfile {
  return { biome: p.biome, surfaceTemp: p.surfaceTemp, atmosphere: p.atmosphere, inHabitableZone: p.inHabitableZone } as PlanetProfile;
}

describe('planetHazards', () => {
  it('leaves a temperate habitable world safe', () => {
    const h = planetHazards(planet({ biome: 'temperate', surfaceTemp: 290, atmosphere: 0.6, inHabitableZone: true }));
    expect(h.cold).toBeLessThan(0.05);
    expect(h.toxic).toBeLessThan(0.05);
    expect(isHazardous(h)).toBe(false);
  });

  it('makes a frozen world cold but not toxic', () => {
    const h = planetHazards(planet({ biome: 'frozen', surfaceTemp: 200, atmosphere: 0.5, inHabitableZone: false }));
    expect(h.cold).toBeGreaterThan(0.9);
    expect(h.toxic).toBeLessThan(0.5);
    expect(isHazardous(h)).toBe(true);
  });

  it('makes a molten world fully toxic', () => {
    const h = planetHazards(planet({ biome: 'molten', surfaceTemp: 700, atmosphere: 0.8, inHabitableZone: false }));
    expect(h.toxic).toBe(1);
  });

  it('treats a near-vacuum world as unbreathable (toxic)', () => {
    const h = planetHazards(planet({ biome: 'barren-rock', surfaceTemp: 250, atmosphere: 0.01, inHabitableZone: false }));
    expect(h.toxic).toBeGreaterThan(0.5);
  });

  it('makes a thick non-habitable atmosphere toxic', () => {
    const h = planetHazards(planet({ biome: 'arid', surfaceTemp: 300, atmosphere: 0.95, inHabitableZone: false }));
    expect(h.toxic).toBeGreaterThan(0.5);
  });
});
