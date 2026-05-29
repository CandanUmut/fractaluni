import * as THREE from 'three';
import { FloatingOrigin } from '../core/floatingOrigin.ts';
import { deriveSeed } from '../core/hash.ts';
import { makeRNG } from '../core/rng.ts';
import { clamp } from '../core/math.ts';
import { deriveCellSeed, deriveStarSeed, starCountForCell, deriveStar } from '../universe/index.ts';
import { makeStarPointsMaterial } from '../render/materials.ts';
import type { StarProfile } from '../universe/types.ts';

// World units per galactic cell. The FloatingOrigin uses the same value.
export const CELL_SIZE = 1200;
const MAX_STARS_PER_CELL = 12;
const MARGIN = 80; // keep stars off the cell faces

export interface StarRecord {
  cell: [number, number, number];
  index: number;
  /** offset from cell CENTER, world units, in [-CELL_SIZE/2+MARGIN, +...]. */
  offset: [number, number, number];
  size: number;
  color: [number, number, number];
  profile: StarProfile;
  /** local-space position, recomputed on each re-stream. */
  lx: number;
  ly: number;
  lz: number;
}

const key = (x: number, y: number, z: number): string => `${x},${y},${z}`;

/** Streams an infinite starfield: derives stars per galactic cell, keeps the
 *  cells within `radius` of the player loaded, and renders them all as a single
 *  Points cloud. Re-streams only when the player's origin cell changes. */
export class Starfield {
  readonly points: THREE.Points;
  readonly active: StarRecord[] = [];

  private readonly universeSeed: number;
  private readonly radius: number;
  private readonly geom: THREE.BufferGeometry;
  private readonly posArr: Float32Array;
  private readonly colArr: Float32Array;
  private readonly sizeArr: Float32Array;
  private readonly cache = new Map<string, StarRecord[]>();
  private loadedKey = '';

  constructor(universeSeed: number, radius = 3) {
    this.universeSeed = universeSeed >>> 0;
    this.radius = radius;

    const span = 2 * radius + 1;
    const capacity = span * span * span * MAX_STARS_PER_CELL;
    this.posArr = new Float32Array(capacity * 3);
    this.colArr = new Float32Array(capacity * 3);
    this.sizeArr = new Float32Array(capacity);

    this.geom = new THREE.BufferGeometry();
    this.geom.setAttribute('position', new THREE.BufferAttribute(this.posArr, 3));
    this.geom.setAttribute('color', new THREE.BufferAttribute(this.colArr, 3));
    this.geom.setAttribute('size', new THREE.BufferAttribute(this.sizeArr, 1));
    this.geom.setDrawRange(0, 0);

    this.points = new THREE.Points(this.geom, makeStarPointsMaterial());
    this.points.frustumCulled = false; // cloud always surrounds the camera
  }

  private loadCell(cx: number, cy: number, cz: number): StarRecord[] {
    const k = key(cx, cy, cz);
    const cached = this.cache.get(k);
    if (cached) return cached;

    const cellSeed = deriveCellSeed(this.universeSeed, cx, cy, cz);
    const n = starCountForCell(cellSeed);
    const recs: StarRecord[] = [];
    const half = CELL_SIZE / 2 - MARGIN;

    for (let i = 0; i < n; i++) {
      const starSeed = deriveStarSeed(cellSeed, i);
      const profile = deriveStar(starSeed);
      const pr = makeRNG(deriveSeed(starSeed, 0x05));
      const offset: [number, number, number] = [
        (pr() - 0.5) * 2 * half,
        (pr() - 0.5) * 2 * half,
        (pr() - 0.5) * 2 * half,
      ];
      const size = clamp(1.5 + Math.log10(profile.luminosity + 1) * 1.6, 1.5, 8);
      recs.push({
        cell: [cx, cy, cz],
        index: i,
        offset,
        size,
        color: [
          clamp(profile.color.r * 1.25, 0, 1),
          clamp(profile.color.g * 1.25, 0, 1),
          clamp(profile.color.b * 1.25, 0, 1),
        ],
        profile,
        lx: 0,
        ly: 0,
        lz: 0,
      });
    }
    this.cache.set(k, recs);
    return recs;
  }

  /** Re-stream if the origin cell changed (or force after a config change). */
  update(origin: FloatingOrigin, force = false): void {
    const ox = origin.originCell.x;
    const oy = origin.originCell.y;
    const oz = origin.originCell.z;
    const k = key(ox, oy, oz);
    if (k === this.loadedKey && !force) return;
    this.loadedKey = k;

    const R = this.radius;
    this.active.length = 0;
    for (let dx = -R; dx <= R; dx++) {
      for (let dy = -R; dy <= R; dy++) {
        for (let dz = -R; dz <= R; dz++) {
          const recs = this.loadCell(ox + dx, oy + dy, oz + dz);
          const baseX = dx * CELL_SIZE;
          const baseY = dy * CELL_SIZE;
          const baseZ = dz * CELL_SIZE;
          for (const rec of recs) {
            rec.lx = baseX + rec.offset[0];
            rec.ly = baseY + rec.offset[1];
            rec.lz = baseZ + rec.offset[2];
            this.active.push(rec);
          }
        }
      }
    }

    this.prune(ox, oy, oz);
    this.writeBuffers();
  }

  /** Drop cached cells that are now well outside the load radius. */
  private prune(ox: number, oy: number, oz: number): void {
    const limit = this.radius + 1;
    for (const k of this.cache.keys()) {
      const [x, y, z] = k.split(',').map(Number) as [number, number, number];
      if (
        Math.abs(x - ox) > limit ||
        Math.abs(y - oy) > limit ||
        Math.abs(z - oz) > limit
      ) {
        this.cache.delete(k);
      }
    }
  }

  private writeBuffers(): void {
    const n = this.active.length;
    for (let i = 0; i < n; i++) {
      const r = this.active[i]!;
      this.posArr[i * 3] = r.lx;
      this.posArr[i * 3 + 1] = r.ly;
      this.posArr[i * 3 + 2] = r.lz;
      this.colArr[i * 3] = r.color[0];
      this.colArr[i * 3 + 1] = r.color[1];
      this.colArr[i * 3 + 2] = r.color[2];
      this.sizeArr[i] = r.size;
    }
    (this.geom.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geom.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    (this.geom.getAttribute('size') as THREE.BufferAttribute).needsUpdate = true;
    this.geom.setDrawRange(0, n);
  }

  /** Nearest star to a local-space point within `maxDist`, or null. */
  nearestStar(px: number, py: number, pz: number, maxDist: number): StarRecord | null {
    let best: StarRecord | null = null;
    let bestD2 = maxDist * maxDist;
    for (const r of this.active) {
      const dx = r.lx - px;
      const dy = r.ly - py;
      const dz = r.lz - pz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = r;
      }
    }
    return best;
  }

  dispose(): void {
    this.geom.dispose();
    (this.points.material as THREE.Material).dispose();
    this.cache.clear();
  }
}
