import { describe, expect, test } from 'vitest';
import { Survival } from './survival.ts';
import type { Biome, PlanetProfile } from '../universe/types.ts';

// Survival only reads surfaceTemp / atmosphere / biome from the profile.
function planet(surfaceTemp: number, atmosphere: number, biome: Biome): PlanetProfile {
  return { surfaceTemp, atmosphere, biome } as unknown as PlanetProfile;
}

describe('survival', () => {
  test('a temperate world is gentle (survivable for a long while)', () => {
    const s = new Survival(planet(289, 0.6, 'temperate'));
    for (let t = 0; t < 120; t++) s.update(0.5, { moving: false, localVegetation: 0.3 });
    expect(s.needs.vitality).toBeGreaterThan(0.5);
  });

  test('a molten world is lethal and time-limited', () => {
    const s = new Survival(planet(1500, 0.4, 'molten'));
    let died = false;
    for (let t = 0; t < 240 && !died; t++) died = s.update(0.5, { moving: false, localVegetation: 0 });
    expect(died).toBe(true);
  });

  test('vegetation moderates warmth on a cold world', () => {
    const bare = new Survival(planet(250, 0.4, 'tundra'));
    const forested = new Survival(planet(250, 0.4, 'tundra'));
    for (let t = 0; t < 120; t++) {
      bare.update(0.5, { moving: false, localVegetation: 0 });
      forested.update(0.5, { moving: false, localVegetation: 0.6 });
    }
    expect(forested.needs.warmth).toBeGreaterThan(bare.needs.warmth);
  });

  test('revive restores needs (instructive failure, not permadeath)', () => {
    const s = new Survival(planet(289, 0.6, 'temperate'));
    s.needs.vitality = 0;
    s.revive();
    expect(s.needs.vitality).toBeGreaterThan(0.3);
  });
});
