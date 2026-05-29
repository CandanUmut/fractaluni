import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { deriveSeed } from '../core/hash.ts';
import { makeRNG, rangeFloat } from '../core/rng.ts';
import { CHUNK_SIZE, type TerrainSampler } from './terrain.ts';
import { planetResources, pickResource, type ResourceType, type ResourceWeight } from '../universe/resources.ts';
import type { PlanetProfile, StarProfile } from '../universe/types.ts';
import type { PlanetDiff } from '../sim/planetDiff.ts';

// Resource deposit nodes: seeded per surface chunk (deterministic + persistent),
// type/richness/hardness derived from the planet. Streamed around the player and
// rendered as individual meshes (so raycasts return the node directly). Mined-out
// nodes are recorded in the sparse diff and stay gone on return.

const NODE_RADIUS = 4; // chunks around the player

export interface DepositNode {
  key: string;
  ax: number;
  az: number;
  type: ResourceType;
  richness: number;
  maxRichness: number;
  mesh: THREE.Mesh;
}

interface NodeSpec {
  key: string;
  ax: number;
  az: number;
  type: ResourceType;
  richness: number;
}

export class NodeManager {
  readonly group = new THREE.Group();
  private readonly active = new Map<string, DepositNode>();
  private readonly palette: ResourceWeight[];
  private readonly planetSeed: number;
  private readonly sampler: TerrainSampler;
  private readonly diff: PlanetDiff;
  private loadedKey = ' ';

  constructor(planet: PlanetProfile, planetSeed: number, star: StarProfile, sampler: TerrainSampler, diff: PlanetDiff) {
    this.palette = planetResources(planet, star);
    this.planetSeed = planetSeed;
    this.sampler = sampler;
    this.diff = diff;
  }

  /** Deterministic node specs for a chunk (independent of depletion state). */
  private specsForChunk(cx: number, cz: number): NodeSpec[] {
    if (this.palette.length === 0) return [];
    const rng = makeRNG(deriveSeed(this.planetSeed, 0x0de, cx, cz));
    const count = Math.floor(rng() * 3.3); // 0..3
    const out: NodeSpec[] = [];
    for (let i = 0; i < count; i++) {
      const ax = cx * CHUNK_SIZE + rng() * CHUNK_SIZE;
      const az = cz * CHUNK_SIZE + rng() * CHUNK_SIZE;
      const type = pickResource(this.palette, rng);
      const tierMul = type.tier === 'exotic' ? 0.55 : type.tier === 'rare' ? 0.8 : 1;
      const richness = Math.round(rangeFloat(rng, 30, 85) * tierMul);
      out.push({ key: `${cx},${cz},${i}`, ax, az, type, richness });
    }
    return out;
  }

  update(centerCX: number, centerCZ: number, originCX: number, originCZ: number): void {
    const key = `${centerCX},${centerCZ}`;
    if (key !== this.loadedKey) {
      this.loadedKey = key;
      const need = new Set<string>();
      for (let dz = -NODE_RADIUS; dz <= NODE_RADIUS; dz++) {
        for (let dx = -NODE_RADIUS; dx <= NODE_RADIUS; dx++) {
          for (const spec of this.specsForChunk(centerCX + dx, centerCZ + dz)) {
            if (this.diff.cells.get(spec.key)?.depleted) continue;
            need.add(spec.key);
            if (!this.active.has(spec.key)) this.spawn(spec);
          }
        }
      }
      for (const [k, node] of this.active) {
        if (!need.has(k)) {
          this.disposeNode(node);
          this.active.delete(k);
        }
      }
    }
    // Reposition active nodes in local space (over the floating origin), on terrain.
    for (const node of this.active.values()) {
      node.mesh.position.set(
        node.ax - originCX * CHUNK_SIZE,
        this.sampler.heightAt(node.ax, node.az) - 0.3,
        node.az - originCZ * CHUNK_SIZE,
      );
    }
  }

  private spawn(spec: NodeSpec): void {
    const rng = makeRNG(deriveSeed(this.planetSeed, 0xc1a, spec.key.length, Math.floor(spec.ax)));
    const parts: THREE.BufferGeometry[] = [];
    const base = new THREE.IcosahedronGeometry(0.9, 0);
    base.scale(1, 0.5, 1);
    parts.push(base);
    const n = 3 + Math.floor(rng() * 4);
    for (let i = 0; i < n; i++) {
      const c = new THREE.OctahedronGeometry(rangeFloat(rng, 0.3, 0.7), 0);
      const h = rangeFloat(rng, 0.6, 1.6);
      c.scale(1, h, 1);
      c.translate((rng() - 0.5) * 1.1, h * 0.5, (rng() - 0.5) * 1.1);
      parts.push(c);
    }
    const geo = mergeGeometries(parts, false);
    for (const p of parts) p.dispose();
    geo.computeVertexNormals();

    const exotic = spec.type.tier === 'exotic';
    const mat = new THREE.MeshStandardMaterial({
      color: spec.type.color,
      flatShading: true,
      roughness: 0.4,
      metalness: spec.type.tier === 'common' ? 0.3 : 0.6,
      emissive: new THREE.Color(spec.type.color),
      emissiveIntensity: exotic ? 0.5 : spec.type.tier === 'rare' ? 0.2 : 0.05,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.scale.setScalar(rangeFloat(rng, 1, 1.8));
    const node: DepositNode = { key: spec.key, ax: spec.ax, az: spec.az, type: spec.type, richness: spec.richness, maxRichness: spec.richness, mesh };
    mesh.userData.node = node;
    this.group.add(mesh);
    this.active.set(spec.key, node);
  }

  /** Force a re-stream next update (e.g. after the persisted diff loads). */
  invalidate(): void {
    this.loadedKey = ' ';
  }

  /** Meshes to include in weapon raycasts. */
  meshes(): THREE.Object3D[] {
    const out: THREE.Object3D[] = [];
    for (const n of this.active.values()) out.push(n.mesh);
    return out;
  }

  static nodeOf(obj: THREE.Object3D | null): DepositNode | null {
    return (obj?.userData.node as DepositNode | undefined) ?? null;
  }

  /** Extract from a node; marks it depleted in the diff when empty. */
  extract(node: DepositNode, amount: number): { gained: number; depleted: boolean } {
    const take = Math.min(amount, node.richness);
    node.richness -= take;
    const f = Math.max(0.08, node.richness / node.maxRichness);
    node.mesh.scale.setScalar((0.5 + 0.9 * f) * 1.2);
    if (node.richness <= 0.01) {
      this.diff.cells.set(node.key, { ...(this.diff.cells.get(node.key) ?? {}), depleted: true });
      this.disposeNode(node);
      this.active.delete(node.key);
      return { gained: take, depleted: true };
    }
    return { gained: take, depleted: false };
  }

  /** Nearest active nodes (for the compass), sorted by distance to (lx,lz) local. */
  nearby(originCX: number, originCZ: number, lx: number, lz: number, maxDist: number): { node: DepositNode; dx: number; dz: number; dist: number }[] {
    const out: { node: DepositNode; dx: number; dz: number; dist: number }[] = [];
    for (const node of this.active.values()) {
      const nx = node.ax - originCX * CHUNK_SIZE;
      const nz = node.az - originCZ * CHUNK_SIZE;
      const dx = nx - lx;
      const dz = nz - lz;
      const dist = Math.hypot(dx, dz);
      if (dist <= maxDist) out.push({ node, dx, dz, dist });
    }
    out.sort((a, b) => a.dist - b.dist);
    return out;
  }

  private disposeNode(node: DepositNode): void {
    this.group.remove(node.mesh);
    node.mesh.geometry.dispose();
    (node.mesh.material as THREE.Material).dispose();
  }

  dispose(): void {
    for (const n of this.active.values()) this.disposeNode(n);
    this.active.clear();
  }
}
