import * as THREE from 'three';
import { deriveSeed, hashString } from '../core/hash.ts';
import { makeRNG } from '../core/rng.ts';
import { CHUNK_SIZE, type TerrainSampler } from '../gen/terrain.ts';
import { chunkNodeSpecs } from '../gen/nodes.ts';
import { creatureGeometry, predatorParams } from './animals.ts';
import type { ResourceType, ResourceWeight } from '../universe/resources.ts';
import type { Palette } from '../palette/index.ts';
import type { Effects } from '../render/effects.ts';
import type { PlanetDiff } from '../sim/planetDiff.ts';

// PvE guardians: hostile creatures that defend valuable (rare/exotic) deposits.
// Simple AI — idle near home → aggro → approach → attack (drains energy, never
// lethal). Reuses the predator morphology. Killed guardians persist (diff) and
// drop loot. Richer deposits are better guarded.

const RADIUS = 4; // chunks around the player
const AGGRO = 44;
const ATTACK_RANGE = 4.5;
const SPEED = 10;
const ATTACK_DMG = 14;
const ATTACK_CD = 1.2;

export interface Guardian {
  key: string;
  homeX: number;
  homeZ: number;
  ax: number;
  az: number;
  health: number;
  maxHealth: number;
  heading: number;
  attackCd: number;
  flash: number;
  lootType: ResourceType;
  lootAmount: number;
  mesh: THREE.Mesh;
  mat: THREE.MeshStandardMaterial;
}

export class GuardianManager {
  readonly group = new THREE.Group();
  /** Drain the player's energy when a guardian lands a hit. */
  onAttack: (dmg: number) => void = () => {};
  /** Award loot when a guardian dies. */
  onKill: (type: ResourceType, amount: number, atX: number, atZ: number) => void = () => {};

  private readonly active = new Map<string, Guardian>();
  private readonly planetSeed: number;
  private readonly sampler: TerrainSampler;
  private readonly diff: PlanetDiff;
  private readonly palette: ResourceWeight[];
  private readonly pal: Palette;
  private loadedKey = ' ';

  constructor(planetSeed: number, sampler: TerrainSampler, diff: PlanetDiff, palette: ResourceWeight[], pal: Palette) {
    this.planetSeed = planetSeed;
    this.sampler = sampler;
    this.diff = diff;
    this.palette = palette;
    this.pal = pal;
  }

  invalidate(): void {
    this.loadedKey = ' ';
  }

  private restream(centerCX: number, centerCZ: number): void {
    const need = new Set<string>();
    for (let dz = -RADIUS; dz <= RADIUS; dz++) {
      for (let dx = -RADIUS; dx <= RADIUS; dx++) {
        const cx = centerCX + dx;
        const cz = centerCZ + dz;
        for (const spec of chunkNodeSpecs(this.planetSeed, this.palette, cx, cz)) {
          if (spec.type.hardness < 2) continue; // only valuable deposits are guarded
          const guards = spec.type.tier === 'exotic' ? 2 : 1;
          for (let i = 0; i < guards; i++) {
            const key = `g:${spec.key}:${i}`;
            if (this.diff.cells.get(key)?.guardianDead) continue;
            need.add(key);
            if (!this.active.has(key)) this.spawn(key, spec.ax, spec.az, spec.type, i);
          }
        }
      }
    }
    for (const [k, g] of this.active) {
      if (!need.has(k)) {
        this.disposeGuardian(g);
        this.active.delete(k);
      }
    }
  }

  private spawn(key: string, nodeX: number, nodeZ: number, type: ResourceType, i: number): void {
    const rng = makeRNG(deriveSeed(this.planetSeed, 0x6a4d, hashString(key)));
    const params = predatorParams(this.pal, rng);
    const geo = creatureGeometry(params);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.7 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.scale.setScalar(type.tier === 'exotic' ? 2.4 : 1.9);
    const ang = (i / 2) * Math.PI * 2 + rng() * 2;
    const ax = nodeX + Math.cos(ang) * 5;
    const az = nodeZ + Math.sin(ang) * 5;
    const g: Guardian = {
      key,
      homeX: nodeX,
      homeZ: nodeZ,
      ax,
      az,
      health: type.tier === 'exotic' ? 95 : 55,
      maxHealth: type.tier === 'exotic' ? 95 : 55,
      heading: rng() * Math.PI * 2,
      attackCd: 0,
      flash: 0,
      lootType: type,
      lootAmount: type.tier === 'exotic' ? 9 : 5,
      mesh,
      mat,
    };
    mesh.userData.guardian = g;
    this.group.add(mesh);
    this.active.set(key, g);
  }

  update(dt: number, playerX: number, playerZ: number, originCX: number, originCZ: number): void {
    const key = `${originCX},${originCZ}`;
    if (key !== this.loadedKey) {
      this.loadedKey = key;
      this.restream(originCX, originCZ);
    }

    for (const g of this.active.values()) {
      g.attackCd -= dt;
      g.flash = Math.max(0, g.flash - dt * 4);

      const dpx = playerX - g.ax;
      const dpz = playerZ - g.az;
      const pdist = Math.hypot(dpx, dpz);

      let tx: number;
      let tz: number;
      if (pdist < AGGRO) {
        tx = dpx;
        tz = dpz; // chase the player
        if (pdist < ATTACK_RANGE && g.attackCd <= 0) {
          g.attackCd = ATTACK_CD;
          g.flash = 0.25;
          this.onAttack(ATTACK_DMG);
        }
      } else {
        tx = g.homeX - g.ax;
        tz = g.homeZ - g.az; // drift home
      }

      const tlen = Math.hypot(tx, tz);
      if (tlen > ATTACK_RANGE * 0.6) {
        g.heading = Math.atan2(tx, tz);
        const sp = (pdist < AGGRO ? SPEED : SPEED * 0.4) * dt;
        g.ax += Math.sin(g.heading) * sp;
        g.az += Math.cos(g.heading) * sp;
      }

      const gy = this.sampler.heightAt(g.ax, g.az);
      const lunge = g.flash > 0 ? Math.sin(g.flash * 12) * 0.3 : 0;
      g.mesh.position.set(g.ax - originCX * CHUNK_SIZE, gy + lunge, g.az - originCZ * CHUNK_SIZE);
      g.mesh.rotation.set(0, g.heading, 0);
      const f = g.flash > 0 ? 1.15 : 1;
      g.mesh.scale.setScalar((g.lootType.tier === 'exotic' ? 2.4 : 1.9) * f);
      g.mat.emissive.setRGB(g.flash, 0, 0);
    }
  }

  meshes(): THREE.Object3D[] {
    const out: THREE.Object3D[] = [];
    for (const g of this.active.values()) out.push(g.mesh);
    return out;
  }

  static guardianOf(obj: THREE.Object3D | null): Guardian | null {
    return (obj?.userData.guardian as Guardian | undefined) ?? null;
  }

  /** Apply damage to a specific guardian (gun/drill). */
  damage(g: Guardian, dmg: number, effects: Effects): void {
    if (!this.active.has(g.key)) return;
    g.health -= dmg;
    g.flash = 0.2;
    effects.burst(g.mesh.position.clone().setY(g.mesh.position.y + 1), new THREE.Color(0xff5a4a), 6, 5, 0.3, -6, 5);
    if (g.health <= 0) this.kill(g, effects);
  }

  /** Area damage (bombs). */
  damageNear(localX: number, localZ: number, originCX: number, originCZ: number, radius: number, dmg: number, effects: Effects): void {
    const ax = localX + originCX * CHUNK_SIZE;
    const az = localZ + originCZ * CHUNK_SIZE;
    for (const g of [...this.active.values()]) {
      if (Math.hypot(g.ax - ax, g.az - az) <= radius) this.damage(g, dmg, effects);
    }
  }

  private kill(g: Guardian, effects: Effects): void {
    effects.burst(g.mesh.position.clone().setY(g.mesh.position.y + 1), new THREE.Color(0xff7a4a), 40, 9, 0.7, -10, 8);
    effects.addShake(0.04);
    this.diff.cells.set(g.key, { ...(this.diff.cells.get(g.key) ?? {}), guardianDead: true });
    this.onKill(g.lootType, g.lootAmount, g.mesh.position.x, g.mesh.position.z);
    this.disposeGuardian(g);
    this.active.delete(g.key);
  }

  private disposeGuardian(g: Guardian): void {
    this.group.remove(g.mesh);
    g.mesh.geometry.dispose();
    g.mat.dispose();
  }

  dispose(): void {
    for (const g of this.active.values()) this.disposeGuardian(g);
    this.active.clear();
  }
}
