import { clamp01, clamp, lerp } from '../core/math.ts';
import type { PlanetProfile } from '../universe/types.ts';

// Light survival: a few needs that pressure decisions without becoming a chore.
// Environmental danger is derived from the v1 planet profile — this is where the
// derivation pipeline pays off: a molten/airless world is lethal and
// time-limited; a temperate one is gentle. You survive *through* the ecosystem
// you shape (forest a patch → moderated temperature + food).
//
// Pure logic; the scene supplies local context and applies eating to the sim.

export interface Needs {
  energy: number; // stamina — spent on activity, restored by rest/food
  warmth: number; // threatened by temperature extremes, eased by vegetation/shade
  food: number; // sustenance — eat flora/fauna
  vitality: number; // health — drops when a need is critical or from hazards
}

export interface SurvivalContext {
  moving: boolean;
  localVegetation: number; // [0,1] at the player's cell — moderates temperature
}

export class Survival {
  readonly needs: Needs = { energy: 1, warmth: 1, food: 1, vitality: 1 };

  private readonly surfaceTemp: number;
  private readonly airless: boolean;
  private readonly molten: boolean;
  /** Last computed thermal stress [0,1], for HUD/feedback. */
  thermalStress = 0;

  constructor(planet: PlanetProfile) {
    this.surfaceTemp = planet.surfaceTemp;
    this.airless = planet.atmosphere < 0.06;
    this.molten = planet.biome === 'molten' || planet.surfaceTemp > 1000;
  }

  /** Advance needs by dt. Returns true if the player just died. */
  update(dt: number, ctx: SurvivalContext): boolean {
    const n = this.needs;

    // Energy: drains with activity, recovers at rest.
    n.energy = clamp01(n.energy - dt * (0.01 + (ctx.moving ? 0.02 : 0)) + (ctx.moving ? 0 : dt * 0.05));

    // Warmth: drifts toward an equilibrium set by how far the *effective*
    // temperature is from comfortable. Local vegetation moderates it (shade /
    // a forested microclimate), so cultivating land makes a place survivable.
    const tEff = lerp(this.surfaceTemp, 289, clamp(ctx.localVegetation * 1.2, 0, 0.6));
    this.thermalStress = clamp01(Math.abs(tEff - 289) / 55);
    const warmthTarget = 1 - this.thermalStress;
    n.warmth = clamp01(n.warmth + (warmthTarget - n.warmth) * Math.min(1, dt * 0.06));

    // Sustenance: slow steady hunger.
    n.food = clamp01(n.food - dt * 0.008);

    // Vitality: harmed by any critical need or environmental hazard; otherwise
    // slowly recovers when the basics are met.
    let harm = 0;
    if (n.energy < 0.06) harm += 0.04;
    if (n.warmth < 0.12) harm += 0.05;
    if (n.food < 0.06) harm += 0.05;
    if (this.airless) harm += 0.035; // suffocation
    if (this.molten) harm += 0.15; // searing
    harm += clamp01((this.thermalStress - 0.7) / 0.3) * 0.05; // temperature extremes

    if (harm > 0) n.vitality = clamp01(n.vitality - dt * harm);
    else if (n.energy > 0.3 && n.food > 0.3 && n.warmth > 0.3) {
      n.vitality = clamp01(n.vitality + dt * 0.02);
    }

    return n.vitality <= 0;
  }

  /** Recover after a blackout (instructive failure, not permadeath). */
  revive(): void {
    this.needs.energy = 0.6;
    this.needs.warmth = 0.6;
    this.needs.food = 0.6;
    this.needs.vitality = 0.6;
  }

  get hazardLabel(): string {
    if (this.molten) return 'SEARING — leave soon';
    if (this.airless) return 'NO AIR — leave soon';
    if (this.thermalStress > 0.7) return this.surfaceTemp > 289 ? 'extreme heat' : 'extreme cold';
    return '';
  }
}
