import * as THREE from 'three';
import { deriveSeed } from '../core/hash.ts';
import { makeRNG } from '../core/rng.ts';
import { clamp01, inverseLerp, lerp, smoothstep } from '../core/math.ts';
import { fbm2, warpedFbm2, type FbmParams } from './noise.ts';
import type { Biome, PlanetProfile } from '../universe/types.ts';
import type { Palette } from '../palette/index.ts';

// Streamed fBm + domain-warped heightfield terrain, chunked around the player.
// Geometry depends only on the ABSOLUTE chunk index (so terrain is stable and
// deterministic); the chunk's render position is derived from the floating
// origin, so recentering is a cheap reposition — never a rebuild.

export const CHUNK_SIZE = 80; // world units per chunk edge
export const CHUNK_RES = 20; // quads per edge (verts per edge = RES + 1)
export const VIEW_RADIUS = 6; // chunks loaded around the player

// Per-biome relief roughness (0 flat .. 1 jagged).
const ROUGHNESS: Record<Biome, number> = {
  molten: 0.9,
  'barren-rock': 0.85,
  frozen: 0.7,
  tundra: 0.62,
  arid: 0.55,
  desert: 0.5,
  temperate: 0.5,
  tropical: 0.45,
  oceanic: 0.3,
};

export interface TerrainSampler {
  heightAt(worldX: number, worldZ: number): number;
  seaLevel: number;
  maxHeight: number;
  hasWater: boolean;
  /** Write the vertex color for a height into target[offset..offset+2]. */
  writeColor(h: number, target: Float32Array, offset: number): void;
}

export function makeTerrain(
  planet: PlanetProfile,
  planetSeed: number,
  palette: Palette,
): TerrainSampler {
  const rough = ROUGHNESS[planet.biome];

  // Per-planet character: each planet jitters its own scales/amplitudes so even
  // two same-biome worlds feel different (mountainous vs rolling vs archipelago).
  const pr = makeRNG(deriveSeed(planetSeed, 0x7e44a1));
  const contSeed = deriveSeed(planetSeed, 0xc0117);
  const mountSeed = deriveSeed(planetSeed, 0x33077);
  const detailSeed = deriveSeed(planetSeed, 0xde7a11);

  const contFreq = (1 / 1100) * lerp(0.7, 1.5, pr());
  const mountFreq = (1 / 300) * lerp(0.7, 1.6, pr());
  const detailFreq = 1 / 70;

  const contAmp = lerp(26, 70, pr());
  // Mountain height: scales with biome roughness but with a wide per-planet
  // spread, so some worlds are alpine and others nearly flat.
  const mountAmp = lerp(50, 230, rough) * (0.45 + pr() * 1.1);
  const detailAmp = lerp(2, 8, pr());
  const maxHeight = contAmp + mountAmp + detailAmp;

  const warpAmp = 90;
  const warpFreq = 1 / 420;
  const contParams: FbmParams = { octaves: 3, lacunarity: 2, gain: 0.5, frequency: contFreq };
  const mountParams: FbmParams = { octaves: 5, lacunarity: 2.1, gain: 0.5, frequency: mountFreq };
  const detailParams: FbmParams = { octaves: 3, lacunarity: 2, gain: 0.5, frequency: detailFreq };

  const hasWater = planet.waterFraction > 0.05;
  // Sea level sits relative to the continental layer: more water ⇒ higher sea ⇒
  // more ocean. Dry worlds drop it well below the land so no water shows.
  const seaLevel = lerp(-0.62, 0.62, planet.waterFraction) * contAmp;

  const heightAt = (x: number, z: number): number => {
    // Continents (domain-warped) define landmasses and where the sea sits.
    const cont = warpedFbm2(contSeed, x, z, contParams, warpAmp, warpFreq);
    const land = smoothstep(-0.15, 0.28, cont);
    // Ridged mountains, sharpened, rising only on land.
    const m = fbm2(mountSeed, x, z, mountParams);
    let ridge = 1 - Math.abs(m);
    ridge *= ridge;
    const detail = fbm2(detailSeed, x, z, detailParams);
    return cont * contAmp + ridge * land * mountAmp + detail * detailAmp;
  };

  const { terrainLow, terrainHigh, water } = palette;
  // Snow line tracks the planet's surface temperature: cold worlds are white
  // down to sea level (ice worlds); temperate worlds only cap their peaks.
  const coldFactor = clamp01((292 - planet.surfaceTemp) / 70);
  const snowAltitude = lerp(maxHeight * 1.5, seaLevel, coldFactor);
  const shoreBand = Math.max(1.5, contAmp * 0.05);

  const writeColor = (h: number, target: Float32Array, o: number): void => {
    let r: number;
    let g: number;
    let b: number;
    if (hasWater && h < seaLevel) {
      const d = clamp01(inverseLerp(seaLevel, seaLevel - contAmp * 0.8, h));
      r = lerp(water.r, water.r * 0.4, d);
      g = lerp(water.g, water.g * 0.4, d);
      b = lerp(water.b, water.b * 0.5, d);
    } else if (hasWater && h < seaLevel + shoreBand) {
      r = clamp01(terrainLow.r * 1.25 + 0.08);
      g = clamp01(terrainLow.g * 1.2 + 0.06);
      b = clamp01(terrainLow.b * 1.05 + 0.03);
    } else {
      const t = clamp01(inverseLerp(seaLevel, maxHeight * 0.75, h));
      r = lerp(terrainLow.r, terrainHigh.r, t);
      g = lerp(terrainLow.g, terrainHigh.g, t);
      b = lerp(terrainLow.b, terrainHigh.b, t);
      if (h > snowAltitude) {
        const s = clamp01(inverseLerp(snowAltitude, snowAltitude + maxHeight * 0.12, h));
        r = lerp(r, 0.95, s);
        g = lerp(g, 0.96, s);
        b = lerp(b, 0.98, s);
      }
    }
    target[o] = r;
    target[o + 1] = g;
    target[o + 2] = b;
  };

  return { heightAt, seaLevel, maxHeight, hasWater, writeColor };
}

// ---- Chunk streaming -------------------------------------------------------

interface Chunk {
  cx: number;
  cz: number;
  mesh: THREE.Mesh;
}

const key = (x: number, z: number): string => `${x},${z}`;

/** Shared triangle index for every chunk grid (identical topology). */
function buildIndex(res: number): THREE.BufferAttribute {
  const quads = res * res;
  const idx = new Uint16Array(quads * 6);
  const stride = res + 1;
  let p = 0;
  for (let z = 0; z < res; z++) {
    for (let x = 0; x < res; x++) {
      const a = z * stride + x;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      idx[p++] = a; idx[p++] = c; idx[p++] = b;
      idx[p++] = b; idx[p++] = c; idx[p++] = d;
    }
  }
  return new THREE.BufferAttribute(idx, 1);
}

const MAX_BUILDS_PER_UPDATE = 3;

/** Loads/unloads/pools terrain chunks around the player. */
export class ChunkManager {
  readonly group = new THREE.Group();
  private readonly sampler: TerrainSampler;
  private readonly material: THREE.MeshStandardMaterial;
  private readonly index: THREE.BufferAttribute;
  private readonly chunks = new Map<string, Chunk>();
  private readonly pool: THREE.BufferGeometry[] = [];
  private originCX = 0;
  private originCZ = 0;

  constructor(sampler: TerrainSampler) {
    this.sampler = sampler;
    this.index = buildIndex(CHUNK_RES);
    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: true,
      roughness: 0.95,
      metalness: 0.0,
    });
  }

  /** `centerCX/CZ` = player's absolute chunk; origin = floating-origin chunk. */
  update(centerCX: number, centerCZ: number, originCX: number, originCZ: number): void {
    this.originCX = originCX;
    this.originCZ = originCZ;

    // Reposition all live chunks relative to the (possibly shifted) origin.
    for (const c of this.chunks.values()) {
      c.mesh.position.set((c.cx - originCX) * CHUNK_SIZE, 0, (c.cz - originCZ) * CHUNK_SIZE);
    }

    // Unload chunks beyond the keep radius.
    const keep = VIEW_RADIUS + 1;
    for (const [k, c] of this.chunks) {
      if (Math.abs(c.cx - centerCX) > keep || Math.abs(c.cz - centerCZ) > keep) {
        this.group.remove(c.mesh);
        this.pool.push(c.mesh.geometry as THREE.BufferGeometry);
        this.chunks.delete(k);
      }
    }

    // Build missing chunks nearest-first, a few per frame to avoid hitches.
    const needed: { cx: number; cz: number; d2: number }[] = [];
    for (let dz = -VIEW_RADIUS; dz <= VIEW_RADIUS; dz++) {
      for (let dx = -VIEW_RADIUS; dx <= VIEW_RADIUS; dx++) {
        const cx = centerCX + dx;
        const cz = centerCZ + dz;
        if (!this.chunks.has(key(cx, cz))) {
          needed.push({ cx, cz, d2: dx * dx + dz * dz });
        }
      }
    }
    needed.sort((a, b) => a.d2 - b.d2);
    for (let i = 0; i < Math.min(MAX_BUILDS_PER_UPDATE, needed.length); i++) {
      this.build(needed[i]!.cx, needed[i]!.cz);
    }
  }

  /** True once every chunk in the view radius is built (used to gate spawn-in). */
  get fullyLoaded(): boolean {
    const span = 2 * VIEW_RADIUS + 1;
    return this.chunks.size >= span * span;
  }

  private build(cx: number, cz: number): void {
    const stride = CHUNK_RES + 1;
    const vertCount = stride * stride;
    const geo = this.pool.pop() ?? this.makeGeometry(vertCount);
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const col = geo.getAttribute('color') as THREE.BufferAttribute;
    const posArr = pos.array as Float32Array;
    const colArr = col.array as Float32Array;

    const baseX = cx * CHUNK_SIZE;
    const baseZ = cz * CHUNK_SIZE;
    const step = CHUNK_SIZE / CHUNK_RES;

    let v = 0;
    for (let z = 0; z <= CHUNK_RES; z++) {
      for (let x = 0; x <= CHUNK_RES; x++) {
        const lx = x * step;
        const lz = z * step;
        const h = this.sampler.heightAt(baseX + lx, baseZ + lz);
        posArr[v * 3] = lx;
        posArr[v * 3 + 1] = h;
        posArr[v * 3 + 2] = lz;
        this.sampler.writeColor(h, colArr, v * 3);
        v++;
      }
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    geo.computeBoundingSphere();

    let mesh = (geo.userData.mesh as THREE.Mesh | undefined) ?? undefined;
    if (!mesh) {
      mesh = new THREE.Mesh(geo, this.material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      geo.userData.mesh = mesh;
    }
    mesh.position.set((cx - this.originCX) * CHUNK_SIZE, 0, (cz - this.originCZ) * CHUNK_SIZE);
    this.group.add(mesh);
    this.chunks.set(key(cx, cz), { cx, cz, mesh });
  }

  private makeGeometry(vertCount: number): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertCount * 3), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(vertCount * 3), 3));
    geo.setIndex(this.index);
    return geo;
  }

  dispose(): void {
    for (const c of this.chunks.values()) c.mesh.geometry.dispose();
    for (const g of this.pool) g.dispose();
    this.material.dispose();
    this.chunks.clear();
    this.pool.length = 0;
  }
}
