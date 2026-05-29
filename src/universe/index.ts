// Public entry point for the pure derivation pipeline. Compose the seed
// hierarchy here:
//   universeSeed → cell(cx,cy,cz) → star(index) → planet(index)

import { deriveSeed } from '../core/hash.ts';
import { makeRNG, rangeInt } from '../core/rng.ts';
import { deriveStar } from './star.ts';
import { derivePlanet, deriveSystem } from './planet.ts';
import type { PlanetProfile, StarProfile, UniverseAddress } from './types.ts';

export * from './types.ts';
export { deriveStar } from './star.ts';
export { derivePlanet, deriveSystem } from './planet.ts';
export { classifyBiome } from './biome.ts';
export { blackbodyRGB } from './blackbody.ts';

const MAX_STARS_PER_CELL = 12;

/** Seed for a galactic cell. */
export function deriveCellSeed(universeSeed: number, cx: number, cy: number, cz: number): number {
  return deriveSeed(universeSeed, cx, cy, cz);
}

/** How many stars a galactic cell contains (deterministic). */
export function starCountForCell(cellSeed: number): number {
  return rangeInt(makeRNG(cellSeed), 0, MAX_STARS_PER_CELL);
}

/** Seed for a star within a cell. */
export function deriveStarSeed(cellSeed: number, starIndex: number): number {
  return deriveSeed(cellSeed, starIndex);
}

export function deriveStarAt(
  universeSeed: number,
  cell: readonly [number, number, number],
  starIndex: number,
): StarProfile {
  const cellSeed = deriveCellSeed(universeSeed, cell[0], cell[1], cell[2]);
  return deriveStar(deriveStarSeed(cellSeed, starIndex));
}

export function derivePlanetAt(
  universeSeed: number,
  cell: readonly [number, number, number],
  starIndex: number,
  planetIndex: number,
): PlanetProfile {
  const star = deriveStarAt(universeSeed, cell, starIndex);
  return derivePlanet(star, planetIndex);
}

/** Resolve a full address into a printable profile bundle (no rendering). */
export function resolveAddress(addr: UniverseAddress): {
  star: StarProfile;
  planets: PlanetProfile[];
  planet?: PlanetProfile;
} {
  const star = deriveStarAt(addr.universeSeed, addr.cell, addr.starIndex);
  const planets = deriveSystem(star);
  const planet = addr.planetIndex !== undefined ? planets[addr.planetIndex] : undefined;
  return planet ? { star, planets, planet } : { star, planets };
}
