import { describe, expect, test } from 'vitest';
import { hash, deriveSeed, hashString } from '../core/hash.ts';
import { classifyBiome } from './biome.ts';
import { deriveStarAt, derivePlanetAt, deriveCellSeed, starCountForCell } from './index.ts';
import type { Biome } from './types.ts';

// Determinism is a hard contract: same seed + coordinates ⇒ identical world,
// on every machine, across refactors. These golden values were captured once;
// if a change to the hashing/derivation breaks them, reproducibility broke and
// every previously-shared URL would now point somewhere else.

describe('hash primitives are stable (golden)', () => {
  test('hash / deriveSeed / hashString', () => {
    expect(hash(1, 2, 3)).toBe(1207328215);
    expect(deriveSeed(123456, 7, 8)).toBe(2586801836);
    expect(hashString('fractal-seed')).toBe(1673645971);
  });

  test('hash is order-sensitive and pure', () => {
    expect(hash(1, 2, 3)).not.toBe(hash(3, 2, 1));
    expect(hash(1, 2, 3)).toBe(hash(1, 2, 3));
  });

  test('negative coordinates hash deterministically', () => {
    expect(deriveCellSeed(1673645971, -5, 0, 7)).toBe(deriveCellSeed(1673645971, -5, 0, 7));
    expect(deriveCellSeed(1673645971, -5, 0, 7)).not.toBe(deriveCellSeed(1673645971, 5, 0, 7));
  });
});

describe('derivation is reproducible and matches golden snapshot', () => {
  const u = hashString('fractal-seed');

  test('a known address yields stable star + planet values', () => {
    const star = deriveStarAt(u, [3, -1, 2], 1);
    expect(star.spectralClass).toBe('A');
    expect(star.temperature).toBeCloseTo(9207.171, 2);
    expect(star.luminosity).toBeCloseTo(13.0333, 3);
    expect(star.planetCount).toBe(4);

    const planet = derivePlanetAt(u, [3, -1, 2], 1, 0);
    expect(planet.orbitalRadius).toBeCloseTo(1.05254, 4);
    expect(planet.surfaceTemp).toBeCloseTo(609.646, 2);
    expect(planet.biome).toBe<Biome>('arid');
  });

  test('repeated derivation is bit-identical', () => {
    expect(deriveStarAt(u, [3, -1, 2], 1)).toEqual(deriveStarAt(u, [3, -1, 2], 1));
    expect(derivePlanetAt(u, [3, -1, 2], 1, 0)).toEqual(derivePlanetAt(u, [3, -1, 2], 1, 0));
    expect(starCountForCell(deriveCellSeed(u, 0, 0, 0))).toBe(starCountForCell(deriveCellSeed(u, 0, 0, 0)));
  });
});

describe('biome falls out of physics, not rolls', () => {
  test('classifyBiome boundary cases', () => {
    expect(classifyBiome(1500, 0.5, 0.5)).toBe('molten');
    expect(classifyBiome(300, 0.5, 0.02)).toBe('barren-rock'); // no air → rock regardless
    expect(classifyBiome(100, 0.8, 0.5)).toBe('frozen');
    expect(classifyBiome(260, 0.5, 0.5)).toBe('tundra');
    expect(classifyBiome(295, 0.9, 0.5)).toBe('oceanic');
    expect(classifyBiome(340, 0.1, 0.5)).toBe('desert');
    expect(classifyBiome(310, 0.8, 0.5)).toBe('tropical');
  });

  test('biomes clearly vary across stars and orbital distance', () => {
    const u = hashString('variety-seed');
    const biomes = new Set<Biome>();
    let hotterInnerThanOuter = 0;
    let comparisons = 0;

    for (let c = 0; c < 12; c++) {
      const cell: [number, number, number] = [c, c * 2 - 3, -c];
      for (let s = 0; s < 4; s++) {
        const star = deriveStarAt(u, cell, s);
        let prevTeq = Infinity;
        for (let p = 0; p < star.planetCount; p++) {
          const planet = derivePlanetAt(u, cell, s, p);
          biomes.add(planet.biome);
          // Equilibrium temp must strictly fall with orbital distance for a fixed star.
          if (p > 0) {
            comparisons++;
            if (planet.equilibriumTemp < prevTeq) hotterInnerThanOuter++;
          }
          prevTeq = planet.equilibriumTemp;
        }
      }
    }

    // Many distinct biomes appear across the sampled galaxy.
    expect(biomes.size).toBeGreaterThanOrEqual(5);
    // Inner planets are essentially always hotter than outer ones (T_eq ∝ 1/√a).
    expect(hotterInnerThanOuter / comparisons).toBeGreaterThan(0.95);
  });
});
