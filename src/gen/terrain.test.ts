import { describe, expect, test } from 'vitest';
import { hashString } from '../core/hash.ts';
import { perlin2, fbm2 } from './noise.ts';
import { deriveStarAt, derivePlanet } from '../universe/index.ts';
import { biomePalette } from '../palette/index.ts';
import { makeTerrain } from './terrain.ts';

describe('noise', () => {
  test('perlin2 is deterministic and roughly bounded', () => {
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < 2000; i++) {
      const x = (i % 50) * 0.37;
      const y = Math.floor(i / 50) * 0.41;
      const a = perlin2(123, x, y);
      const b = perlin2(123, x, y);
      expect(a).toBe(b);
      min = Math.min(min, a);
      max = Math.max(max, a);
    }
    expect(min).toBeGreaterThan(-1.5);
    expect(max).toBeLessThan(1.5);
  });

  test('fbm2 differs by seed but repeats by seed', () => {
    const p = { octaves: 4, lacunarity: 2, gain: 0.5, frequency: 0.01 };
    expect(fbm2(1, 10, 20, p)).toBe(fbm2(1, 10, 20, p));
    expect(fbm2(1, 10, 20, p)).not.toBe(fbm2(2, 10, 20, p));
  });
});

describe('terrain sampler', () => {
  test('height field is deterministic for a given planet', () => {
    const u = hashString('terrain-seed');
    const star = deriveStarAt(u, [1, 2, 3], 0);
    const planet = derivePlanet(star, 1);
    const pal = biomePalette(planet, star);
    const a = makeTerrain(planet, planet.seed, pal);
    const b = makeTerrain(planet, planet.seed, pal);
    for (let i = 0; i < 100; i++) {
      const x = i * 7.3;
      const z = i * 3.1 - 50;
      expect(a.heightAt(x, z)).toBe(b.heightAt(x, z));
    }
  });

  test('writeColor emits valid RGB', () => {
    const u = hashString('terrain-seed');
    const star = deriveStarAt(u, [4, 5, 6], 0);
    const planet = derivePlanet(star, 0);
    const t = makeTerrain(planet, planet.seed, biomePalette(planet, star));
    const buf = new Float32Array(3);
    for (let h = -80; h <= 80; h += 5) {
      t.writeColor(h, buf, 0);
      for (const v of buf) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });
});
