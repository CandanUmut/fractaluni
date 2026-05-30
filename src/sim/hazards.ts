import { clamp01, smoothstep } from '../core/math.ts';
import type { PlanetProfile } from '../universe/types.ts';

// Planet hazards, derived (never rolled) from the profile — the same numbers that
// classify the biome decide how hostile it is to stand on. Two pressures:
//   cold  → drains the player's Warmth (frozen/tundra worlds)
//   toxic → drains the player's Air    (molten, near-vacuum, or thick non-HZ air)
// Both correlate with planetDanger, so the richest deposits sit on the worlds you
// can't yet linger on — that's the pull toward crafting protection (Phase 3).

export interface PlanetHazards {
  cold: number; // 0..1 severity
  toxic: number; // 0..1 severity
}

export function planetHazards(p: PlanetProfile): PlanetHazards {
  // Cold ramps in below ~258K and maxes out by ~205K.
  const cold = smoothstep(258, 205, p.surfaceTemp);

  // Toxic / unbreathable air: molten worlds are worst; thick atmospheres on
  // worlds outside the habitable zone are poisonous; near-vacuum suffocates; and
  // searing heat makes the air itself harmful.
  let toxic = 0;
  if (p.biome === 'molten') {
    toxic = 1;
  } else {
    const thick = p.inHabitableZone ? 0 : smoothstep(0.5, 0.95, p.atmosphere);
    const vacuum = smoothstep(0.12, 0.0, p.atmosphere);
    const searing = smoothstep(355, 430, p.surfaceTemp);
    toxic = clamp01(Math.max(thick, vacuum, searing));
  }

  return { cold, toxic };
}

/** True if a planet has any hazard worth surfacing in the UI / survey. */
export function isHazardous(h: PlanetHazards): boolean {
  return h.cold > 0.04 || h.toxic > 0.04;
}
