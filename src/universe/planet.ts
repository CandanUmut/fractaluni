import { makeRNG, rangeFloat, type RNG } from '../core/rng.ts';
import { clamp, clamp01, TAU } from '../core/math.ts';
import { deriveSeed } from '../core/hash.ts';
import { classifyBiome } from './biome.ts';
import type { PlanetProfile, StarProfile } from './types.ts';

// Planet derivation. Properties cascade from the star + the planet's orbital
// slot. Crucially, temperature and biome are DERIVED, not rolled:
//   T_eq = 278.5K * (1-A)^0.25 * L^0.25 / sqrt(a)
//   T_surface = T_eq * (1 + greenhouse * atmosphere)
//   biome = classify(T_surface, water, atmosphere)

const T_EQ_REF = 278.5; // K — equilibrium temp at 1 AU, L=1, A=0.
const GREENHOUSE_MAX = 0.4; // strongest greenhouse multiplier contribution.

/** Lay planets out on a Titius-Bode-like progression. Spacing for each slot is
 *  drawn from an INDEPENDENT per-slot seed and is always > 1, so the cumulative
 *  product is strictly increasing — planets are guaranteed ordered inner→outer,
 *  and the result is identical whether a planet is derived standalone or as part
 *  of a full system. Inner edge scales with sqrt(luminosity). */
function orbitalRadiusFor(star: StarProfile, index: number): number {
  // Inner edge scales fully with sqrt(luminosity) so dim M dwarfs keep their
  // planets close (and warm) while bright stars push them out. This makes the
  // habitable zone land on a real planet often, instead of everything baking.
  let a = 0.4 * Math.sqrt(star.luminosity) + 0.05;
  for (let k = 1; k <= index; k++) {
    const slotRng = makeRNG(deriveSeed(star.seed, 0x0a17 + k));
    a *= 1.24 + slotRng() * 0.46; // spacing in [1.24, 1.70) — tighter, so more
    // planets land in/near the habitable zone instead of flung into deep cold.
  }
  return a;
}

export function derivePlanet(star: StarProfile, index: number): PlanetProfile {
  const seed = deriveSeed(star.seed, index + 1);
  const rng: RNG = makeRNG(seed);

  const orbitalRadius = orbitalRadiusFor(star, index);

  // Mass: mix of small rocky and larger worlds, biased small. Earth masses.
  const massRoll = rng();
  const mass =
    massRoll < 0.7
      ? rangeFloat(rng, 0.05, 3) // rocky
      : rangeFloat(rng, 3, 300); // ice/gas giant

  // Density class → radius. Rocky ~ M^0.27, gaseous puffs up.
  const isGiant = mass > 8;
  const radius = isGiant
    ? rangeFloat(rng, 3.5, 11) * Math.pow(mass / 100, 0.05)
    : Math.pow(mass, 0.27);

  // Surface gravity in g: g = M / R^2 (Earth-relative).
  const gravity = mass / (radius * radius);

  const axialTilt = rangeFloat(rng, 0, 45);

  // Atmosphere retention rises with gravity; giants are thick, tiny worlds thin.
  const atmosphere = clamp01(0.15 + 0.55 * Math.tanh(gravity) + rangeFloat(rng, -0.15, 0.35));

  // Raw water fraction — climate later decides if it's ocean, ice, or vapor.
  // Skewed toward wetter worlds (pow < 1) so oceans/lakes are common, giving
  // visual variety; gas/ice giants carry little surface water.
  const waterFraction = clamp01(Math.pow(rng(), 0.7) * (isGiant ? 0.2 : 1.05));

  // Albedo: ice and clouds raise it; airless rock is darker.
  const albedo = clamp(0.12 + 0.35 * waterFraction + 0.15 * atmosphere, 0.05, 0.85);

  // Equilibrium then greenhouse-adjusted surface temperature.
  const equilibriumTemp =
    T_EQ_REF *
    Math.pow(1 - albedo, 0.25) *
    Math.pow(star.luminosity, 0.25) /
    Math.sqrt(orbitalRadius);
  const surfaceTemp = equilibriumTemp * (1 + GREENHOUSE_MAX * atmosphere);

  const biome = classifyBiome(surfaceTemp, waterFraction, atmosphere);

  // Visual orbital pacing (not physical years): period ∝ a^1.5 / sqrt(Mstar).
  const orbitalPeriod = Math.pow(orbitalRadius, 1.5) / Math.sqrt(star.mass);
  const orbitalPhase = rng() * TAU;

  const inHabitableZone =
    orbitalRadius >= star.habitableZone.inner && orbitalRadius <= star.habitableZone.outer;

  return {
    seed,
    index,
    orbitalRadius,
    orbitalPeriod,
    orbitalPhase,
    mass,
    radius,
    gravity,
    axialTilt,
    waterFraction,
    atmosphere,
    albedo,
    equilibriumTemp,
    surfaceTemp,
    biome,
    inHabitableZone,
  };
}

/** Derive every planet in a system, ordered inner→outer by index. */
export function deriveSystem(star: StarProfile): PlanetProfile[] {
  const planets: PlanetProfile[] = [];
  for (let i = 0; i < star.planetCount; i++) {
    planets.push(derivePlanet(star, i));
  }
  return planets;
}
