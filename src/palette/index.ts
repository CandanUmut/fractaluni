import { hslToRgb, mixRGB, scaleRGB } from '../core/color.ts';
import { clamp, clamp01, lerp } from '../core/math.ts';
import { makeRNG } from '../core/rng.ts';
import { deriveSeed } from '../core/hash.ts';
import type { Biome, PlanetProfile, RGB, StarProfile } from '../universe/types.ts';

// Palette generator: biome + star ⇒ a coherent color set. Built in HSL so hues
// stay harmonious; tinted by the star's light color and modulated by the
// planet's temperature, water, and atmosphere. Pure (no Three.js).

export interface Palette {
  /** Elevation gradient: valleys/shore → peaks. */
  terrainLow: RGB;
  terrainHigh: RGB;
  water: RGB;
  foliage: RGB;
  skyHorizon: RGB;
  skyZenith: RGB;
  fog: RGB;
  /** The star's light color, for the directional sun + point light. */
  sun: RGB;
  /** Representative whole-planet color for the system/galaxy view. */
  surface: RGB;
}

interface BiomeBase {
  hue: number; // 0..1
  sat: number;
  lightLow: number;
  lightHigh: number;
  foliageHue: number;
  foliageSat: number;
  waterHue: number;
  waterSat: number;
  waterLight: number;
}

const BIOME: Record<Biome, BiomeBase> = {
  frozen: { hue: 0.58, sat: 0.1, lightLow: 0.72, lightHigh: 0.96, foliageHue: 0.5, foliageSat: 0.08, waterHue: 0.55, waterSat: 0.25, waterLight: 0.7 },
  tundra: { hue: 0.14, sat: 0.18, lightLow: 0.42, lightHigh: 0.72, foliageHue: 0.3, foliageSat: 0.25, waterHue: 0.56, waterSat: 0.3, waterLight: 0.42 },
  temperate: { hue: 0.27, sat: 0.38, lightLow: 0.3, lightHigh: 0.62, foliageHue: 0.31, foliageSat: 0.55, waterHue: 0.57, waterSat: 0.45, waterLight: 0.4 },
  tropical: { hue: 0.34, sat: 0.55, lightLow: 0.28, lightHigh: 0.56, foliageHue: 0.36, foliageSat: 0.7, waterHue: 0.5, waterSat: 0.55, waterLight: 0.45 },
  arid: { hue: 0.1, sat: 0.42, lightLow: 0.42, lightHigh: 0.68, foliageHue: 0.25, foliageSat: 0.4, waterHue: 0.5, waterSat: 0.35, waterLight: 0.42 },
  desert: { hue: 0.08, sat: 0.6, lightLow: 0.46, lightHigh: 0.74, foliageHue: 0.22, foliageSat: 0.35, waterHue: 0.5, waterSat: 0.3, waterLight: 0.45 },
  molten: { hue: 0.02, sat: 0.85, lightLow: 0.12, lightHigh: 0.5, foliageHue: 0.05, foliageSat: 0.0, waterHue: 0.04, waterSat: 0.9, waterLight: 0.45 },
  oceanic: { hue: 0.5, sat: 0.35, lightLow: 0.34, lightHigh: 0.58, foliageHue: 0.33, foliageSat: 0.5, waterHue: 0.56, waterSat: 0.5, waterLight: 0.42 },
  'barren-rock': { hue: 0.08, sat: 0.05, lightLow: 0.28, lightHigh: 0.56, foliageHue: 0.0, foliageSat: 0.0, waterHue: 0.0, waterSat: 0.0, waterLight: 0.3 },
};

export function biomePalette(planet: PlanetProfile, star: StarProfile): Palette {
  const base = BIOME[planet.biome];
  const sun = scaleRGB(star.color, 1.0);

  // Per-planet jitter: shift hue/sat/lightness a little so two same-biome worlds
  // never look identical, while staying within the biome's harmonious range.
  const jr = makeRNG(deriveSeed(planet.seed, 0x9a1e77e));
  const hueShift = (jr() - 0.5) * 0.07;
  const satMul = 0.85 + jr() * 0.35;
  const lightShift = (jr() - 0.5) * 0.09;
  const b: BiomeBase = {
    ...base,
    hue: base.hue + hueShift,
    sat: clamp01(base.sat * satMul),
    lightLow: clamp01(base.lightLow + lightShift),
    lightHigh: clamp01(base.lightHigh + lightShift),
    foliageHue: base.foliageHue + hueShift * 0.5,
    waterHue: base.waterHue + hueShift * 0.4,
  };

  const terrainLow = hslToRgb(b.hue, b.sat, b.lightLow);
  const terrainHigh = hslToRgb(b.hue + 0.02, b.sat * 0.8, b.lightHigh);
  const water = hslToRgb(b.waterHue, b.waterSat, b.waterLight);
  const foliage = hslToRgb(b.foliageHue, b.foliageSat, lerp(0.45, 0.3, clamp01(planet.surfaceTemp / 320)));

  // Sky: thicker atmosphere → brighter, more saturated dome; thin → near-black
  // space. Tinted toward the star's color so each system reads differently.
  const atmo = planet.atmosphere;
  const skyBaseHue = lerp(0.62, b.waterHue, 0.2);
  const skyZenith = mixRGB(
    hslToRgb(skyBaseHue, 0.5 * atmo, lerp(0.02, 0.32, atmo)),
    sun,
    0.12 * atmo,
  );
  const skyHorizon = mixRGB(
    hslToRgb(skyBaseHue - 0.04, 0.45 * atmo, lerp(0.05, 0.62, atmo)),
    sun,
    0.35 * atmo,
  );
  const fog = mixRGB(skyHorizon, terrainLow, 0.25);

  // Whole-planet color for distant views: blend land and water by hydrosphere.
  const surface = mixRGB(
    mixRGB(terrainLow, terrainHigh, 0.5),
    water,
    clamp(planet.waterFraction, 0, 0.85),
  );

  return { terrainLow, terrainHigh, water, foliage, skyHorizon, skyZenith, fog, sun, surface };
}
