import { describe, expect, test } from 'vitest';
import { hashString } from '../core/hash.ts';
import { deriveStarAt, deriveSystem } from '../universe/index.ts';
import { biomePalette, type Palette } from './index.ts';
import type { RGB } from '../universe/types.ts';

const valid = (c: RGB): boolean =>
  [c.r, c.g, c.b].every((v) => Number.isFinite(v) && v >= 0 && v <= 1);

function allColors(p: Palette): RGB[] {
  return [p.terrainLow, p.terrainHigh, p.water, p.foliage, p.skyHorizon, p.skyZenith, p.fog, p.sun, p.surface];
}

describe('palette generation', () => {
  test('all derived colors are valid RGB in [0,1]', () => {
    const u = hashString('palette-seed');
    for (let s = 0; s < 6; s++) {
      const star = deriveStarAt(u, [s, 1, -s], 0);
      for (const planet of deriveSystem(star)) {
        const pal = biomePalette(planet, star);
        for (const c of allColors(pal)) expect(valid(c)).toBe(true);
      }
    }
  });

  test('palette is deterministic', () => {
    const u = hashString('palette-seed');
    const star = deriveStarAt(u, [2, 2, 2], 1);
    const planet = deriveSystem(star)[0]!;
    expect(biomePalette(planet, star)).toEqual(biomePalette(planet, star));
  });
});
