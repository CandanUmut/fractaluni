import { hashString } from '../core/hash.ts';
import { resolveAddress } from './index.ts';
import type { PlanetProfile, StarProfile } from './types.ts';

// Human-readable formatting of derived profiles, for the debug HUD and console.

const f = (x: number, d = 2): string => x.toFixed(d);

export function formatStar(s: StarProfile): string[] {
  return [
    `STAR  class ${s.spectralClass}  seed ${s.seed}`,
    `  temp ${f(s.temperature, 0)} K   color rgb(${f(s.color.r)}, ${f(s.color.g)}, ${f(s.color.b)})`,
    `  radius ${f(s.radius)} R⊙   mass ${f(s.mass)} M⊙   lum ${f(s.luminosity, 3)} L⊙`,
    `  habitable zone ${f(s.habitableZone.inner)}–${f(s.habitableZone.outer)} AU   planets ${s.planetCount}`,
  ];
}

export function formatPlanet(p: PlanetProfile): string[] {
  return [
    `PLANET #${p.index}  ${p.biome}${p.inHabitableZone ? '  (habitable zone)' : ''}`,
    `  orbit ${f(p.orbitalRadius)} AU   tilt ${f(p.axialTilt, 0)}°`,
    `  mass ${f(p.mass)} M⊕   radius ${f(p.radius)} R⊕   gravity ${f(p.gravity)} g`,
    `  water ${f(p.waterFraction)}   atmo ${f(p.atmosphere)}   albedo ${f(p.albedo)}`,
    `  T_eq ${f(p.equilibriumTemp, 0)} K   T_surf ${f(p.surfaceTemp, 0)} K`,
  ];
}

/** Print a full system (and optional focused planet) for a string seed + indices. */
export function profileToLines(
  seedString: string,
  cell: readonly [number, number, number],
  starIndex: number,
  planetIndex?: number,
): string[] {
  const universeSeed = hashString(seedString);
  const addr =
    planetIndex !== undefined
      ? { universeSeed, cell, starIndex, planetIndex }
      : { universeSeed, cell, starIndex };
  const { star, planets, planet } = resolveAddress(addr);
  const lines = [
    `seed "${seedString}" → u32 ${universeSeed}   cell [${cell.join(',')}]`,
    ...formatStar(star),
    `system biomes: ${planets.map((p) => p.biome).join(', ')}`,
  ];
  if (planet) lines.push('', ...formatPlanet(planet));
  return lines;
}
