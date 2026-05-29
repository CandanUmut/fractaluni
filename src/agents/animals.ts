import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makeRNG, rangeFloat, type RNG } from '../core/rng.ts';
import { deriveSeed } from '../core/hash.ts';
import { clamp, clamp01, lerp, TAU } from '../core/math.ts';
import type { PlanetProfile, RGB } from '../universe/types.ts';
import type { Palette } from '../palette/index.ts';
import { CHUNK_SIZE, type TerrainSampler } from '../gen/terrain.ts';
import { SIM_CELL } from '../sim/planetDiff.ts';
import type { Ecosystem } from '../sim/ecosystem.ts';

// Roaming animals: low-poly procedural morphology assembled from primitives
// (body, head, 4 legs, tail), consistent per species per planet. Movement via
// steering behaviours (wander + soft separation + terrain following). Rendered
// as one InstancedMesh per species; positions follow the floating origin.

interface CreatureParams {
  bodyW: number;
  bodyH: number;
  bodyL: number;
  legLen: number;
  legW: number;
  headR: number;
  legCount: number; // 2 (biped), 4 (quadruped), or 6 (hexapod)
  round: boolean; // blob body vs boxy body
  neck: number; // head forward/up offset multiplier (giraffe vs lizard)
  bodyColor: RGB;
  legColor: RGB;
}

function colorize(g: THREE.BufferGeometry, c: RGB): THREE.BufferGeometry {
  const n = g.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

function box(w: number, h: number, d: number, x: number, y: number, z: number, c: RGB): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  g.translate(x, y, z);
  return colorize(g, c);
}

function blob(rx: number, ry: number, rz: number, x: number, y: number, z: number, c: RGB): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, 1).toNonIndexed();
  g.scale(rx, ry, rz);
  g.translate(x, y, z);
  return colorize(g, c);
}

/** Build a creature with feet at y=0, facing +Z. Body plan varies by params. */
function creatureGeometry(p: CreatureParams): THREE.BufferGeometry {
  const bodyY = p.legLen + p.bodyH / 2;
  const parts: THREE.BufferGeometry[] = [];

  // Body — boxy or blobby.
  parts.push(
    p.round
      ? blob(p.bodyW / 2, p.bodyH / 2, p.bodyL / 2, 0, bodyY, 0, p.bodyColor)
      : box(p.bodyW, p.bodyH, p.bodyL, 0, bodyY, 0, p.bodyColor),
  );

  // Head, set forward and up by the neck factor.
  const hr = p.headR;
  parts.push(
    blob(hr * 0.8, hr * 0.8, hr * 0.95, 0, bodyY + p.bodyH * 0.4 * p.neck, p.bodyL / 2 + hr * 0.6, p.bodyColor),
  );
  // Tail.
  parts.push(box(p.legW * 0.8, p.legW * 0.8, p.bodyL * 0.4, 0, bodyY, -p.bodyL / 2 - p.bodyL * 0.18, p.legColor));

  // Legs: distribute pairs along the body length.
  const pairs = Math.max(1, Math.round(p.legCount / 2));
  const lx = p.bodyW / 2 - p.legW / 2;
  for (let i = 0; i < pairs; i++) {
    const tz = pairs === 1 ? -0.2 : i / (pairs - 1); // 0..1 front→back
    const lz = (0.5 - tz) * (p.bodyL - 2 * p.legW);
    for (const sx of [-1, 1]) {
      parts.push(box(p.legW, p.legLen, p.legW, sx * lx, p.legLen / 2, lz, p.legColor));
    }
  }

  const merged = mergeGeometries(parts, false);
  for (const g of parts) g.dispose();
  merged.computeVertexNormals();
  return merged;
}

function speciesParams(pal: Palette, rng: RNG): CreatureParams {
  // Body color blends an earthy base with the planet's foliage, varied per
  // species (occasionally vivid on exotic worlds via the foliage palette).
  const base: RGB = { r: 0.45, g: 0.36, b: 0.26 };
  const t = rng();
  const bodyColor: RGB = {
    r: clamp01(lerp(base.r, pal.foliage.r, t * 0.6) * (0.7 + rng() * 0.6)),
    g: clamp01(lerp(base.g, pal.foliage.g, t * 0.6) * (0.7 + rng() * 0.6)),
    b: clamp01(lerp(base.b, pal.foliage.b, t * 0.6) * (0.7 + rng() * 0.6)),
  };
  const scale = rangeFloat(rng, 0.7, 1.7);
  const legCount = [2, 4, 4, 6][Math.floor(rng() * 4)]!; // quadrupeds most common
  const round = rng() < 0.4;
  return {
    bodyW: (round ? 1.0 : 0.9) * scale,
    bodyH: (legCount === 2 ? 1.0 : 0.8) * scale,
    bodyL: (legCount === 6 ? 2.2 : 1.8) * scale,
    legLen: rangeFloat(rng, 0.6, 1.4) * scale,
    legW: 0.22 * scale,
    headR: rangeFloat(rng, 0.35, 0.6) * scale,
    legCount,
    round,
    neck: rangeFloat(rng, 0.5, 2.2),
    bodyColor,
    legColor: { r: bodyColor.r * 0.7, g: bodyColor.g * 0.7, b: bodyColor.b * 0.7 },
  };
}

/** A leaner, reddish predator body plan, distinct from the herbivores. */
function predatorParams(pal: Palette, rng: RNG): CreatureParams {
  const t = rng();
  const bodyColor: RGB = {
    r: clamp01(0.45 + t * 0.35 + rng() * 0.15),
    g: clamp01(0.1 + pal.foliage.g * 0.15 + rng() * 0.1),
    b: clamp01(0.12 + rng() * 0.18),
  };
  const scale = rangeFloat(rng, 1.1, 1.9);
  return {
    bodyW: 0.7 * scale,
    bodyH: 0.7 * scale,
    bodyL: 2.1 * scale,
    legLen: rangeFloat(rng, 0.85, 1.4) * scale,
    legW: 0.2 * scale,
    headR: 0.45 * scale,
    legCount: 4,
    round: false,
    neck: 0.7,
    bodyColor,
    legColor: { r: bodyColor.r * 0.6, g: bodyColor.g * 0.6, b: bodyColor.b * 0.6 },
  };
}

interface Agent {
  ax: number; // absolute world x
  az: number;
  tx: number; // absolute target x
  tz: number;
  heading: number;
  speed: number;
  phase: number;
  species: number;
  active: boolean;
}

const MAX_HERB = 70;
const MAX_PRED = 22;
const RESAMPLE = 0.6; // seconds between re-sampling the population fields

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
}

/** Renders herbivore + predator population FIELDS as a representative sample of
 *  visible creatures. The count and placement follow the field densities (more
 *  creatures where the population is dense); there is no per-animal life cycle —
 *  the sim is the fields, these are just their visualization. */
export class AnimalHerds {
  readonly group = new THREE.Group();
  private readonly material: THREE.MeshStandardMaterial;
  private readonly sampler: TerrainSampler;
  private readonly herbMeshes: THREE.InstancedMesh[] = [];
  private predMesh: THREE.InstancedMesh | null = null;
  private readonly herbAgents: Agent[] = [];
  private readonly predAgents: Agent[] = [];
  private readonly lifeless: boolean;
  private resampleT = 0;
  private time = 0;
  private readonly dummy = new THREE.Object3D();

  constructor(planet: PlanetProfile, planetSeed: number, pal: Palette, sampler: TerrainSampler) {
    this.sampler = sampler;
    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: true,
      roughness: 0.85,
      metalness: 0.0,
    });
    this.lifeless = planet.biome === 'molten' || planet.biome === 'barren-rock';
    if (this.lifeless) return;

    const nHerb = 2;
    for (let s = 0; s < nHerb; s++) {
      const rng = makeRNG(deriveSeed(planetSeed, 0xfa00, s));
      const geo = creatureGeometry(speciesParams(pal, rng));
      const mesh = new THREE.InstancedMesh(geo, this.material, MAX_HERB);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.herbMeshes.push(mesh);
      this.group.add(mesh);
    }
    const predGeo = creatureGeometry(predatorParams(pal, makeRNG(deriveSeed(planetSeed, 0xfeed))));
    this.predMesh = new THREE.InstancedMesh(predGeo, this.material, MAX_PRED);
    this.predMesh.count = 0;
    this.predMesh.frustumCulled = false;
    this.predMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.predMesh);

    for (let i = 0; i < MAX_HERB; i++) {
      this.herbAgents.push(this.newAgent(i % nHerb, rangeFloat(makeRNG(i + 1), 2.5, 6)));
    }
    for (let i = 0; i < MAX_PRED; i++) {
      this.predAgents.push(this.newAgent(0, rangeFloat(makeRNG(i + 99), 4, 8)));
    }
  }

  private newAgent(species: number, speed: number): Agent {
    return { ax: 0, az: 0, tx: 0, tz: 0, heading: 0, speed, phase: Math.random() * TAU, species, active: false };
  }

  update(dt: number, eco: Ecosystem, originCX: number, originCZ: number): void {
    if (this.lifeless) return;
    this.time += dt;
    this.resampleT -= dt;
    if (this.resampleT <= 0) {
      this.resampleT = RESAMPLE;
      this.assign(this.herbAgents, eco, eco.herbivore, clamp(Math.round(eco.totalHerbivores() / 60), 0, MAX_HERB));
      this.assign(this.predAgents, eco, eco.predator, clamp(Math.round(eco.totalPredators() / 36), 0, MAX_PRED));
    }
    this.render(this.herbAgents, this.herbMeshes, dt, originCX, originCZ);
    if (this.predMesh) this.render(this.predAgents, [this.predMesh], dt, originCX, originCZ);
  }

  /** Re-target the first `desired` agents to cells sampled ∝ population. */
  private assign(agents: Agent[], eco: Ecosystem, field: Float32Array, desired: number): void {
    for (let i = 0; i < agents.length; i++) {
      const a = agents[i]!;
      if (i < desired) {
        const k = eco.sampleCell(field, Math.random());
        if (k < 0) {
          a.active = false;
          continue;
        }
        const ci = k % eco.width;
        const cj = Math.floor(k / eco.width);
        const [cx, cz] = eco.worldCenter(ci, cj);
        a.tx = cx + (Math.random() - 0.5) * SIM_CELL;
        a.tz = cz + (Math.random() - 0.5) * SIM_CELL;
        if (!a.active) {
          a.ax = a.tx;
          a.az = a.tz;
          a.active = true;
        }
      } else {
        a.active = false;
      }
    }
  }

  private render(
    agents: Agent[],
    meshes: THREE.InstancedMesh[],
    dt: number,
    ocx: number,
    ocz: number,
  ): void {
    const counts = meshes.map(() => 0);
    for (const a of agents) {
      if (!a.active) continue;
      // Steer toward the assigned cell; idle-wander once arrived.
      const dx = a.tx - a.ax;
      const dz = a.tz - a.az;
      const dist = Math.hypot(dx, dz);
      if (dist > 1.5) {
        const want = Math.atan2(dx, dz);
        a.heading += wrapAngle(want - a.heading) * Math.min(1, dt * 2.5);
        a.ax += Math.sin(a.heading) * a.speed * dt;
        a.az += Math.cos(a.heading) * a.speed * dt;
      } else {
        a.heading += (Math.random() - 0.5) * dt;
      }

      const meshIdx = meshes.length === 1 ? 0 : a.species;
      const mesh = meshes[meshIdx]!;
      const bob = Math.sin(this.time * (3 + a.speed) + a.phase) * 0.06;
      this.dummy.position.set(a.ax - ocx * CHUNK_SIZE, this.sampler.heightAt(a.ax, a.az) + bob, a.az - ocz * CHUNK_SIZE);
      this.dummy.rotation.set(0, a.heading, 0);
      this.dummy.scale.setScalar(1);
      this.dummy.updateMatrix();
      mesh.setMatrixAt(counts[meshIdx]!, this.dummy.matrix);
      counts[meshIdx]!++;
    }
    for (let i = 0; i < meshes.length; i++) {
      meshes[i]!.count = counts[i]!;
      meshes[i]!.instanceMatrix.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const m of this.herbMeshes) m.geometry.dispose();
    this.predMesh?.geometry.dispose();
    this.material.dispose();
  }
}
