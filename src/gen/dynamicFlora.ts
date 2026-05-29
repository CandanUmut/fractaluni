import * as THREE from 'three';
import { buildPlant, type LSystemConfig } from './lsystem.ts';
import { CHUNK_SIZE, type TerrainSampler } from './terrain.ts';
import { clamp, lerp } from '../core/math.ts';
import { deriveSeed } from '../core/hash.ts';
import { makeRNG } from '../core/rng.ts';
import type { Ecosystem } from '../sim/ecosystem.ts';
import type { Palette } from '../palette/index.ts';

// Visualizes the LIVE vegetation field as instanced saplings, sampled where the
// field is dense and re-placed periodically. This is what makes planting,
// clearing and natural spread visible in 3D (baseline flora is the static
// backdrop; this layer is the responsive one).

const MAXV = 150;
const RESAMPLE = 1.4; // seconds

interface Sprout {
  ax: number;
  az: number;
  scale: number;
  rotY: number;
  active: boolean;
}

export class DynamicFlora {
  readonly group = new THREE.Group();
  private readonly mesh: THREE.InstancedMesh;
  private readonly mat: THREE.MeshStandardMaterial;
  private readonly sampler: TerrainSampler;
  private readonly sprouts: Sprout[] = [];
  private readonly dummy = new THREE.Object3D();
  private t = 0;

  constructor(planetSeed: number, pal: Palette, sampler: TerrainSampler) {
    this.sampler = sampler;
    const cfg: LSystemConfig = {
      axiom: 'FX',
      rules: { X: 'F[+FL][-FL][&L][^L]' },
      depth: 2,
      angle: 30,
      angleJitter: 0.3,
      segLen: 0.55,
      segLenFalloff: 0.8,
      baseRadius: 0.1,
      radiusFalloff: 0.74,
      radialSegments: 4,
      leafSize: 0.5,
      hasLeaves: true,
      trunkColor: { r: 0.3, g: 0.2, b: 0.12 },
      leafColor: pal.foliage,
    };
    const geo = buildPlant(cfg, makeRNG(deriveSeed(planetSeed, 0xd1f10)));
    this.mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 });
    this.mesh = new THREE.InstancedMesh(geo, this.mat, MAXV);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.mesh);
    for (let i = 0; i < MAXV; i++) this.sprouts.push({ ax: 0, az: 0, scale: 1, rotY: 0, active: false });
  }

  update(dt: number, eco: Ecosystem, ocx: number, ocz: number): void {
    this.t -= dt;
    if (this.t <= 0) {
      this.t = RESAMPLE;
      this.resample(eco);
    }
    // Re-place every frame in local space (handles floating-origin shifts).
    let count = 0;
    for (const s of this.sprouts) {
      if (!s.active) continue;
      this.dummy.position.set(
        s.ax - ocx * CHUNK_SIZE,
        this.sampler.heightAt(s.ax, s.az),
        s.az - ocz * CHUNK_SIZE,
      );
      this.dummy.rotation.set(0, s.rotY, 0);
      this.dummy.scale.setScalar(s.scale);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(count++, this.dummy.matrix);
    }
    this.mesh.count = count;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  private resample(eco: Ecosystem): void {
    const desired = clamp(Math.round(eco.totalVegetation() / 28), 0, MAXV);
    for (let i = 0; i < this.sprouts.length; i++) {
      const s = this.sprouts[i]!;
      if (i >= desired) {
        s.active = false;
        continue;
      }
      const k = eco.sampleCell(eco.vegetation, Math.random());
      if (k < 0) {
        s.active = false;
        continue;
      }
      const ci = k % eco.width;
      const cj = Math.floor(k / eco.width);
      const [cx, cz] = eco.worldCenter(ci, cj);
      s.ax = cx + (Math.random() - 0.5) * 14;
      s.az = cz + (Math.random() - 0.5) * 14;
      s.scale = lerp(0.7, 2.0, eco.vegetation[k]!);
      s.rotY = Math.random() * Math.PI * 2;
      s.active = true;
    }
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}
