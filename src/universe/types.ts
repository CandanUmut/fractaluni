// Pure data types for the derivation pipeline. No Three.js here.

export type SpectralClass = 'O' | 'B' | 'A' | 'F' | 'G' | 'K' | 'M';

/** Linear RGB in [0,1]. Kept framework-free; the render layer converts to THREE.Color. */
export interface RGB {
  r: number;
  g: number;
  b: number;
}

export interface StarProfile {
  seed: number;
  spectralClass: SpectralClass;
  /** Effective surface temperature, Kelvin. */
  temperature: number;
  /** Radius in solar radii. */
  radius: number;
  /** Mass in solar masses. */
  mass: number;
  /** Bolometric luminosity in solar luminosities (derived from R and T). */
  luminosity: number;
  /** Blackbody-ish emissive color derived from temperature. */
  color: RGB;
  /** Habitable zone bounds in AU (derived from luminosity). */
  habitableZone: { inner: number; outer: number };
  /** How many planets this system has. */
  planetCount: number;
}

export type Biome =
  | 'molten'
  | 'barren-rock'
  | 'desert'
  | 'arid'
  | 'temperate'
  | 'tropical'
  | 'oceanic'
  | 'tundra'
  | 'frozen';

export interface PlanetProfile {
  seed: number;
  index: number;
  /** Orbital semi-major axis in AU. */
  orbitalRadius: number;
  /** Orbital period in (arbitrary, derived) years — Kepler-ish for visual pacing. */
  orbitalPeriod: number;
  /** Initial orbital phase angle, radians. */
  orbitalPhase: number;
  /** Planet mass in Earth masses. */
  mass: number;
  /** Planet radius in Earth radii (derived from mass + density class). */
  radius: number;
  /** Surface gravity in g (derived from mass and radius). */
  gravity: number;
  /** Axial tilt in degrees. */
  axialTilt: number;
  /** Fraction of surface that is liquid/ice water [0,1] (raw, pre-climate). */
  waterFraction: number;
  /** Atmosphere density [0,1], 0 = airless, 1 = thick. */
  atmosphere: number;
  /** Bond albedo [0,1], derived from water + ice + atmosphere. */
  albedo: number;
  /** Equilibrium (no-greenhouse) temperature, Kelvin. */
  equilibriumTemp: number;
  /** Surface temperature after greenhouse adjustment, Kelvin. */
  surfaceTemp: number;
  /** Classified biome — falls out of the numbers above, never rolled directly. */
  biome: Biome;
  /** True if within the star's habitable zone. */
  inHabitableZone: boolean;
}

/** A fully-resolved location: which universe, cell, star, and (optionally) planet. */
export interface UniverseAddress {
  universeSeed: number;
  cell: readonly [number, number, number];
  starIndex: number;
  planetIndex?: number;
}
