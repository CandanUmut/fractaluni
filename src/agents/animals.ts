import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makeRNG, rangeFloat, type RNG } from '../core/rng.ts';
import { deriveSeed } from '../core/hash.ts';
import { clamp01, lerp, TAU } from '../core/math.ts';
import type { PlanetProfile, RGB } from '../universe/types.ts';
import type { Palette } from '../palette/index.ts';
import type { TerrainSampler } from '../gen/terrain.ts';

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
  bodyColor: RGB;
  legColor: RGB;
}

function box(
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  c: RGB,
): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  g.translate(x, y, z);
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

/** Build a creature with feet at y=0, facing +Z. */
function creatureGeometry(p: CreatureParams): THREE.BufferGeometry {
  const bodyY = p.legLen + p.bodyH / 2;
  const parts: THREE.BufferGeometry[] = [];
  // Body.
  parts.push(box(p.bodyW, p.bodyH, p.bodyL, 0, bodyY, 0, p.bodyColor));
  // Head (front, slightly raised).
  const hr = p.headR;
  parts.push(box(hr * 1.4, hr * 1.4, hr * 1.6, 0, bodyY + p.bodyH * 0.4, p.bodyL / 2 + hr * 0.6, p.bodyColor));
  // Tail.
  parts.push(box(p.legW * 0.8, p.legW * 0.8, p.bodyL * 0.4, 0, bodyY, -p.bodyL / 2 - p.bodyL * 0.18, p.legColor));
  // Four legs.
  const lx = p.bodyW / 2 - p.legW / 2;
  const lz = p.bodyL / 2 - p.legW;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      parts.push(box(p.legW, p.legLen, p.legW, sx * lx, p.legLen / 2, sz * lz, p.legColor));
    }
  }
  const merged = mergeGeometries(parts, false);
  for (const g of parts) g.dispose();
  merged.computeVertexNormals();
  return merged;
}

function speciesParams(pal: Palette, rng: RNG): CreatureParams {
  // Earthy body color: blend foliage with a warm brown, varied per species.
  const base: RGB = { r: 0.45, g: 0.36, b: 0.26 };
  const t = rng();
  const bodyColor: RGB = {
    r: clamp01(lerp(base.r, pal.foliage.r, t * 0.5) * (0.7 + rng() * 0.5)),
    g: clamp01(lerp(base.g, pal.foliage.g, t * 0.5) * (0.7 + rng() * 0.5)),
    b: clamp01(lerp(base.b, pal.foliage.b, t * 0.5) * (0.7 + rng() * 0.5)),
  };
  const scale = rangeFloat(rng, 0.7, 1.6);
  return {
    bodyW: 0.9 * scale,
    bodyH: 0.8 * scale,
    bodyL: 1.8 * scale,
    legLen: rangeFloat(rng, 0.6, 1.3) * scale,
    legW: 0.22 * scale,
    headR: 0.4 * scale,
    bodyColor,
    legColor: { r: bodyColor.r * 0.7, g: bodyColor.g * 0.7, b: bodyColor.b * 0.7 },
  };
}

interface Critter {
  x: number;
  z: number;
  heading: number;
  turn: number;
  speed: number;
  phase: number;
}

const SPECIES_DENSITY: Partial<Record<string, number>> = {
  tropical: 14,
  temperate: 12,
  oceanic: 8,
  tundra: 7,
  arid: 6,
  desert: 4,
  frozen: 4,
};

export class AnimalHerds {
  readonly group = new THREE.Group();
  private readonly meshes: THREE.InstancedMesh[] = [];
  private readonly critters: Critter[][] = [];
  private readonly material: THREE.MeshStandardMaterial;
  private readonly sampler: TerrainSampler;
  /** Local→world height, injected by the scene (applies the floating origin). */
  private readonly heightAt: (x: number, z: number) => number;
  private readonly range = 140;
  private time = 0;

  // scratch
  private readonly dummy = new THREE.Object3D();

  constructor(
    planet: PlanetProfile,
    planetSeed: number,
    pal: Palette,
    sampler: TerrainSampler,
    heightAtLocal: (x: number, z: number) => number,
  ) {
    this.sampler = sampler;
    this.heightAt = heightAtLocal;
    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: true,
      roughness: 0.85,
      metalness: 0.0,
    });

    if (planet.biome === 'molten' || planet.biome === 'barren-rock') return;
    const perSpecies = SPECIES_DENSITY[planet.biome] ?? 0;
    if (perSpecies === 0) return;

    const nSpecies = 2;
    for (let s = 0; s < nSpecies; s++) {
      const rng = makeRNG(deriveSeed(planetSeed, 0xfa00, s));
      const geo = creatureGeometry(speciesParams(pal, rng));
      const mesh = new THREE.InstancedMesh(geo, this.material, perSpecies);
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.meshes.push(mesh);
      this.group.add(mesh);

      const list: Critter[] = [];
      for (let i = 0; i < perSpecies; i++) {
        list.push({
          x: (rng() - 0.5) * this.range,
          z: (rng() - 0.5) * this.range,
          heading: rng() * TAU,
          turn: 0,
          speed: rangeFloat(rng, 2.5, 6),
          phase: rng() * TAU,
        });
      }
      this.critters.push(list);
    }
  }

  shift(dx: number, dz: number): void {
    for (const list of this.critters) for (const c of list) {
      c.x -= dx;
      c.z -= dz;
    }
  }

  update(dt: number, playerLocal: THREE.Vector3): void {
    if (this.meshes.length === 0) return;
    this.time += dt;
    const seaGuard = this.sampler.hasWater ? this.sampler.seaLevel + 0.4 : -Infinity;

    for (let s = 0; s < this.meshes.length; s++) {
      const list = this.critters[s]!;
      const mesh = this.meshes[s]!;
      for (let i = 0; i < list.length; i++) {
        const c = list[i]!;
        // Wander: random walk on turn rate.
        c.turn += (Math.random() - 0.5) * dt * 2.5; // visual jitter only
        c.turn *= 0.9;
        c.heading += c.turn * dt;

        // Steer back toward the player if wandering too far.
        const dxp = playerLocal.x - c.x;
        const dzp = playerLocal.z - c.z;
        if (Math.hypot(dxp, dzp) > this.range) {
          const want = Math.atan2(dxp, dzp);
          c.heading = lerp(c.heading, want, 0.04);
        }

        const fx = Math.sin(c.heading);
        const fz = Math.cos(c.heading);
        const nx = c.x + fx * c.speed * dt;
        const nz = c.z + fz * c.speed * dt;

        // Terrain following + avoid water by veering away.
        const groundNext = this.heightAt(nx, nz);
        if (groundNext < seaGuard) {
          c.heading += 2.2 * dt + 0.4; // veer off the water
        } else {
          c.x = nx;
          c.z = nz;
        }

        const gy = this.heightAt(c.x, c.z);
        const bob = Math.sin(this.time * (3 + c.speed) + c.phase) * 0.06;

        this.dummy.position.set(c.x, gy + bob, c.z);
        this.dummy.rotation.set(0, c.heading, 0);
        this.dummy.scale.setScalar(1);
        this.dummy.updateMatrix();
        mesh.setMatrixAt(i, this.dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const m of this.meshes) m.geometry.dispose();
    this.material.dispose();
  }
}
