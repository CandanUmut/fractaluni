import { clamp01, lerp } from '../core/math.ts';
import { SIM_CELL } from './planetDiff.ts';

// v2 Phase B — the local ecosystem as coupled low-res fields. Pure and headless
// (fields in, fields out, given a tick) so it's testable and tunable without
// rendering. Few variables, visible couplings:
//   moisture     — diffuses; sourced by water; lost to heat/evaporation.
//   temperature  — static-ish here (biome + elevation lapse); drives suitability.
//   vegetation   — logistic growth toward a moisture×temperature carrying
//                  capacity, plus neighbor spread, with die-off where unsuitable.
//
// Populations (herbivores/predators) layer on in Phase C.

const IDEAL_TEMP = 289; // K — vegetation's happy temperature
const TEMP_SIGMA = 26;

// Population coupling (Lotka-Volterra-flavored, with caps for stability).
const GRAZE = 0.16; // vegetation eaten per herbivore
const H_GROW = 0.32; // herbivore growth per unit vegetation
const H_DEATH = 0.05; // herbivore baseline death
const H_PRED = 0.09; // herbivore loss per predator
const P_GROW = 0.05; // predator growth per herbivore
const P_DEATH = 0.12; // predator baseline death
const H_MIGRATE = 0.12;
const P_MIGRATE = 0.1;
const H_MAX = 8;
const P_MAX = 4;

export interface EcosystemConfig {
  /** Grid dimensions in cells. */
  width: number;
  height: number;
  /** Sim-cell coords of cell (0,0). */
  originGX: number;
  originGZ: number;
  /** Baseline terrain elevation at a world point. */
  elevationAt: (worldX: number, worldZ: number) => number;
  seaLevel: number;
  hasWater: boolean;
  surfaceTemp: number;
  atmosphere: number;
  waterFraction: number;
}

export type FieldName = 'vegetation' | 'moisture' | 'temperature' | 'herbivore' | 'predator';

export class Ecosystem {
  readonly width: number;
  readonly height: number;
  readonly originGX: number;
  readonly originGZ: number;

  readonly vegetation: Float32Array;
  readonly moisture: Float32Array;
  readonly herbivore: Float32Array;
  readonly predator: Float32Array;
  /** Temperature suitability [0,1] (precomputed; near-static in Phase B). */
  readonly tempSuit: Float32Array;
  readonly isWater: Uint8Array;
  private readonly baseTemp: Float32Array;

  private readonly cfg: EcosystemConfig;
  private readonly tmp: Float32Array;
  private readonly tmpV: Float32Array;
  private readonly tmpH: Float32Array;
  private readonly tmpP: Float32Array;

  constructor(cfg: EcosystemConfig) {
    this.cfg = cfg;
    this.width = cfg.width;
    this.height = cfg.height;
    this.originGX = cfg.originGX;
    this.originGZ = cfg.originGZ;
    const n = cfg.width * cfg.height;
    this.vegetation = new Float32Array(n);
    this.moisture = new Float32Array(n);
    this.herbivore = new Float32Array(n);
    this.predator = new Float32Array(n);
    this.tempSuit = new Float32Array(n);
    this.baseTemp = new Float32Array(n);
    this.isWater = new Uint8Array(n);
    this.tmp = new Float32Array(n);
    this.tmpV = new Float32Array(n);
    this.tmpH = new Float32Array(n);
    this.tmpP = new Float32Array(n);
    this.seed();
  }

  private idx(i: number, j: number): number {
    return j * this.width + i;
  }

  worldCenter(i: number, j: number): [number, number] {
    return [
      (this.originGX + i) * SIM_CELL + SIM_CELL / 2,
      (this.originGZ + j) * SIM_CELL + SIM_CELL / 2,
    ];
  }

  /** Compute the baseline fields from the v1 terrain/biome. */
  private seed(): void {
    const { elevationAt, seaLevel, hasWater, surfaceTemp, atmosphere, waterFraction } = this.cfg;
    for (let j = 0; j < this.height; j++) {
      for (let i = 0; i < this.width; i++) {
        const k = this.idx(i, j);
        const [wx, wz] = this.worldCenter(i, j);
        const elev = elevationAt(wx, wz);
        const above = Math.max(0, elev - seaLevel);
        const water = hasWater && elev < seaLevel ? 1 : 0;
        this.isWater[k] = water;
        // Temperature drops with altitude (lapse rate).
        const t = surfaceTemp - above * 0.05;
        this.baseTemp[k] = t;
        const d = (t - IDEAL_TEMP) / TEMP_SIGMA;
        this.tempSuit[k] = Math.exp(-d * d);
        // Initial moisture: water is saturated; land starts from humidity.
        this.moisture[k] = water
          ? 1
          : clamp01(0.18 + waterFraction * 0.4 + atmosphere * 0.2 - above * 0.0015);
        // A little starter vegetation where conditions allow, so it can spread.
        const cap = this.moisture[k]! * this.tempSuit[k]!;
        this.vegetation[k] = water ? 0 : 0.12 * cap;
        // Starter populations: herbivores where there's forage, few predators.
        this.herbivore[k] = water ? 0 : 0.5 * this.vegetation[k]!;
        this.predator[k] = 0.15 * this.herbivore[k]!;
      }
    }
  }

  /** Carrying capacity at a cell from current moisture × temperature suitability. */
  capacityAt(k: number): number {
    return this.moisture[k]! * this.tempSuit[k]!;
  }

  /** Advance the simulation by `dt` sim-seconds (one tick). */
  step(dt: number): void {
    const w = this.width;
    const h = this.height;
    const atmo = this.cfg.atmosphere;

    // --- Moisture: diffuse, re-source from water, precipitate, evaporate. ---
    const D = 0.18;
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const k = this.idx(i, j);
        const avg = this.neighborAvg(this.moisture, i, j);
        let m = lerp(this.moisture[k]!, avg, D);
        m += atmo * 0.015 * dt; // precipitation
        const heat = Math.max(0, (this.baseTemp[k]! - 300) / 30);
        m -= heat * 0.05 * dt; // evaporation
        this.tmp[k] = this.isWater[k] ? 1 : clamp01(m);
      }
    }
    this.moisture.set(this.tmp);

    // --- Vegetation: logistic growth to capacity + neighbor spread + die-off. ---
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const k = this.idx(i, j);
        if (this.isWater[k]) {
          this.tmpV[k] = 0;
          continue;
        }
        const v = this.vegetation[k]!;
        const cap = this.capacityAt(k);
        const nAvg = this.neighborAvg(this.vegetation, i, j);
        const grow = 0.6 * v * (1 - v / Math.max(cap, 1e-3));
        const spread = 0.25 * (nAvg - v);
        const graze = GRAZE * this.herbivore[k]! * v; // overgrazing collapses veg
        let dv = grow + spread - graze;
        if (cap < 0.08) dv -= 0.5 * v; // unfavorable → recede
        this.tmpV[k] = clamp01(v + dt * dv);
      }
    }
    this.vegetation.set(this.tmpV);

    // --- Herbivores: grow on vegetation, die to predators; migrate (diffuse). ---
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const k = this.idx(i, j);
        const H = this.herbivore[k]!;
        const P = this.predator[k]!;
        const V = this.vegetation[k]!;
        const dH = H * (H_GROW * V - H_DEATH - H_PRED * P);
        const migrate = H_MIGRATE * (this.neighborAvg(this.herbivore, i, j) - H);
        this.tmpH[k] = Math.max(0, Math.min(H_MAX, H + dt * (dH + migrate)));
      }
    }
    // --- Predators: grow on herbivores, die otherwise; migrate toward prey. ---
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const k = this.idx(i, j);
        const H = this.herbivore[k]!;
        const P = this.predator[k]!;
        const dP = P * (P_GROW * H - P_DEATH);
        const migrate = P_MIGRATE * (this.neighborAvg(this.predator, i, j) - P);
        this.tmpP[k] = Math.max(0, Math.min(P_MAX, P + dt * (dP + migrate)));
      }
    }
    this.herbivore.set(this.tmpH);
    this.predator.set(this.tmpP);
  }

  /** 4-neighbor average with edge clamping. */
  private neighborAvg(f: Float32Array, i: number, j: number): number {
    const w = this.width;
    const h = this.height;
    const xl = i > 0 ? i - 1 : i;
    const xr = i < w - 1 ? i + 1 : i;
    const yt = j > 0 ? j - 1 : j;
    const yb = j < h - 1 ? j + 1 : j;
    return (
      (f[j * w + xl]! + f[j * w + xr]! + f[yt * w + i]! + f[yb * w + i]!) * 0.25
    );
  }

  field(name: FieldName): Float32Array {
    if (name === 'vegetation') return this.vegetation;
    if (name === 'moisture') return this.moisture;
    if (name === 'herbivore') return this.herbivore;
    if (name === 'predator') return this.predator;
    return this.tempSuit;
  }

  private total(f: Float32Array): number {
    let s = 0;
    for (let k = 0; k < f.length; k++) s += f[k]!;
    return s;
  }

  totalVegetation(): number {
    return this.total(this.vegetation);
  }
  totalHerbivores(): number {
    return this.total(this.herbivore);
  }
  totalPredators(): number {
    return this.total(this.predator);
  }

  /** Pick a cell index with probability proportional to a field value (for
   *  sampled rendering). Returns -1 if the field is empty. `r` ∈ [0,1). */
  sampleCell(f: Float32Array, r: number): number {
    const total = this.total(f);
    if (total <= 1e-6) return -1;
    let acc = r * total;
    for (let k = 0; k < f.length; k++) {
      acc -= f[k]!;
      if (acc < 0) return k;
    }
    return f.length - 1;
  }
}
