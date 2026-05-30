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

export type Archetype = 'grazer' | 'sauropod' | 'raptor' | 'beetle';
export const HERBIVORE_ARCHETYPES: Archetype[] = ['grazer', 'sauropod', 'raptor', 'beetle'];

export interface CreatureParams {
  bodyW: number;
  bodyH: number;
  bodyL: number;
  legLen: number;
  legW: number;
  headR: number;
  legCount: number; // 2 (biped), 4 (quadruped), or 6 (hexapod)
  round: boolean; // blob body vs boxy body
  neckSegs: number; // articulated neck segments (0 = head on body)
  neckLen: number;
  neckRise: number; // upward arc per segment (radians)
  tailSegs: number;
  tailLen: number;
  tailDrop: number; // downward arc per tail segment
  spikes: number; // dorsal spikes (menacing guardians); 0 for herbivores
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

// Low-detail ball for small features (eyes) — keeps the triangle count down.
function ball(r: number, x: number, y: number, z: number, c: RGB): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(r, 0).toNonIndexed();
  g.translate(x, y, z);
  return colorize(g, c);
}

const EYE_WHITE: RGB = { r: 0.93, g: 0.94, b: 0.96 };
const PUPIL: RGB = { r: 0.04, g: 0.04, b: 0.06 };

/** Build a creature with feet at y=0, facing +Z. Articulated neck + tail give
 *  distinct dinosaur silhouettes (sauropod, raptor, …). */
export function creatureGeometry(p: CreatureParams): THREE.BufferGeometry {
  const bodyY = p.legLen + p.bodyH / 2;
  const hr = p.headR;
  const parts: THREE.BufferGeometry[] = [];

  parts.push(
    p.round
      ? blob(p.bodyW / 2, p.bodyH / 2, p.bodyL / 2, 0, bodyY, 0, p.bodyColor)
      : box(p.bodyW, p.bodyH, p.bodyL, 0, bodyY, 0, p.bodyColor),
  );

  // Neck chain rising forward; head at the end (or directly on the body).
  let headX = 0;
  let headY = bodyY + p.bodyH * 0.3;
  let headZ = p.bodyL / 2 + hr * 0.5;
  if (p.neckSegs > 0) {
    let ny = bodyY + p.bodyH * 0.35;
    let nz = p.bodyL / 2;
    let ang = 0.15;
    for (let i = 0; i < p.neckSegs; i++) {
      ang += p.neckRise;
      nz += Math.cos(ang) * p.neckLen;
      ny += Math.sin(ang) * p.neckLen;
      const w = lerp(p.bodyW * 0.45, hr * 0.9, i / p.neckSegs);
      parts.push(box(w, w, p.neckLen * 1.15, 0, ny, nz, p.bodyColor));
    }
    headY = ny + Math.sin(ang) * hr;
    headZ = nz + Math.cos(ang) * hr * 0.6;
  }

  // Head + eyes + snout.
  parts.push(blob(hr * 0.85, hr * 0.85, hr, headX, headY, headZ, p.bodyColor));
  const ex = hr * 0.45;
  for (const sx of [-1, 1]) {
    parts.push(ball(hr * 0.27, sx * ex, headY + hr * 0.2, headZ + hr * 0.45, EYE_WHITE));
    parts.push(ball(hr * 0.15, sx * ex, headY + hr * 0.2, headZ + hr * 0.6, PUPIL));
  }
  parts.push(box(hr * 0.55, hr * 0.45, hr * 0.6, 0, headY - hr * 0.2, headZ + hr * 0.45, p.legColor));

  // Tail chain tapering back + down.
  if (p.tailSegs > 0) {
    let ty = bodyY;
    let tz = -p.bodyL / 2;
    let ang = -0.05;
    for (let i = 0; i < p.tailSegs; i++) {
      ang -= p.tailDrop;
      tz -= Math.cos(ang) * p.tailLen;
      ty = Math.max(0.08, ty + Math.sin(ang) * p.tailLen);
      const w = lerp(p.bodyW * 0.4, 0.06, i / p.tailSegs);
      parts.push(box(w, w, p.tailLen * 1.15, 0, ty, tz, p.legColor));
    }
  }

  // Dorsal spikes (menace).
  if (p.spikes > 0) {
    const spikeColor: RGB = { r: clamp01(p.bodyColor.r * 0.5 + 0.15), g: p.bodyColor.g * 0.4, b: p.bodyColor.b * 0.4 };
    for (let i = 0; i < p.spikes; i++) {
      const t = i / Math.max(1, p.spikes - 1);
      const sz = lerp(p.bodyL * 0.4, -p.bodyL * 0.4, t);
      const h = lerp(0.5, 0.2, Math.abs(t - 0.4)) * p.bodyH * 1.6;
      const spike = new THREE.ConeGeometry(p.headR * 0.32, h, 4).toNonIndexed();
      spike.translate(0, bodyY + p.bodyH * 0.5 + h * 0.4, sz);
      parts.push(colorize(spike, spikeColor));
    }
  }

  // Legs.
  const pairs = Math.max(1, Math.round(p.legCount / 2));
  const lx = p.bodyW / 2 - p.legW / 2;
  for (let i = 0; i < pairs; i++) {
    const tz = pairs === 1 ? 0.5 : i / (pairs - 1);
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

interface Struct {
  bodyW: number; bodyH: number; bodyL: number; legLen: number; legW: number; headR: number;
  legCount: number; round: boolean; neckSegs: number; neckLen: number; neckRise: number;
  tailSegs: number; tailLen: number; tailDrop: number; scaleMin: number; scaleMax: number;
}

function structFor(arch: Archetype): Struct {
  switch (arch) {
    case 'sauropod':
      return { bodyW: 1.5, bodyH: 1.3, bodyL: 3.0, legLen: 1.5, legW: 0.4, headR: 0.5, legCount: 4, round: false, neckSegs: 5, neckLen: 0.8, neckRise: 0.2, tailSegs: 6, tailLen: 0.8, tailDrop: 0.05, scaleMin: 1.4, scaleMax: 2.2 };
    case 'raptor':
      return { bodyW: 0.6, bodyH: 0.95, bodyL: 1.3, legLen: 1.35, legW: 0.18, headR: 0.38, legCount: 2, round: false, neckSegs: 2, neckLen: 0.45, neckRise: 0.32, tailSegs: 4, tailLen: 0.55, tailDrop: 0.03, scaleMin: 0.9, scaleMax: 1.5 };
    case 'beetle':
      return { bodyW: 1.0, bodyH: 0.55, bodyL: 1.3, legLen: 0.5, legW: 0.16, headR: 0.32, legCount: 6, round: true, neckSegs: 0, neckLen: 0, neckRise: 0, tailSegs: 0, tailLen: 0, tailDrop: 0, scaleMin: 0.6, scaleMax: 1.1 };
    case 'grazer':
    default:
      return { bodyW: 0.9, bodyH: 0.8, bodyL: 1.8, legLen: 0.95, legW: 0.22, headR: 0.45, legCount: 4, round: false, neckSegs: 1, neckLen: 0.5, neckRise: 0.28, tailSegs: 1, tailLen: 0.5, tailDrop: 0.1, scaleMin: 0.8, scaleMax: 1.3 };
  }
}

function bodyColorFor(pal: Palette, rng: RNG, predator: boolean): RGB {
  if (predator) {
    return {
      r: clamp01(0.45 + rng() * 0.4),
      g: clamp01(0.08 + pal.foliage.g * 0.15 + rng() * 0.1),
      b: clamp01(0.1 + rng() * 0.2),
    };
  }
  const base: RGB = { r: 0.45, g: 0.36, b: 0.26 };
  const t = rng();
  return {
    r: clamp01(lerp(base.r, pal.foliage.r, t * 0.6) * (0.7 + rng() * 0.6)),
    g: clamp01(lerp(base.g, pal.foliage.g, t * 0.6) * (0.7 + rng() * 0.6)),
    b: clamp01(lerp(base.b, pal.foliage.b, t * 0.6) * (0.7 + rng() * 0.6)),
  };
}

function paramsFromStruct(s: Struct, k: number, bodyColor: RGB, spikes = 0): CreatureParams {
  return {
    bodyW: s.bodyW * k, bodyH: s.bodyH * k, bodyL: s.bodyL * k, legLen: s.legLen * k, legW: s.legW * k, headR: s.headR * k,
    legCount: s.legCount, round: s.round,
    neckSegs: s.neckSegs, neckLen: s.neckLen * k, neckRise: s.neckRise,
    tailSegs: s.tailSegs, tailLen: s.tailLen * k, tailDrop: s.tailDrop,
    spikes,
    bodyColor,
    legColor: { r: bodyColor.r * 0.7, g: bodyColor.g * 0.7, b: bodyColor.b * 0.7 },
  };
}

/** Build params for a herbivore of a given archetype, colored by planet. */
export function speciesParams(arch: Archetype, pal: Palette, rng: RNG): CreatureParams {
  const s = structFor(arch);
  return paramsFromStruct(s, rangeFloat(rng, s.scaleMin, s.scaleMax), bodyColorFor(pal, rng, false));
}

export const GUARDIAN_ARCHETYPES: Archetype[] = ['raptor', 'sauropod', 'beetle'];

/** A menacing, spiked guardian of the given archetype (reddish, larger). */
export function guardianParams(arch: Archetype, pal: Palette, rng: RNG): CreatureParams {
  const s = structFor(arch);
  const scale = arch === 'beetle' ? rangeFloat(rng, 1.6, 2.4) : rangeFloat(rng, 1.5, 2.3);
  return paramsFromStruct(s, scale, bodyColorFor(pal, rng, true), 4 + Math.floor(rng() * 5));
}

/** Back-compat: a raptor guardian. */
export function predatorParams(pal: Palette, rng: RNG): CreatureParams {
  return guardianParams('raptor', pal, rng);
}


interface Critter {
  x: number;
  z: number;
  heading: number;
  turn: number;
  speed: number;
  phase: number;
  hp: number;
  dying: number; // >0 while collapsing after the killing blow
  dead: boolean;
  flee: number; // >0 while bolting away from a recent shot
  attackCd: number; // hostile species: time until the next strike lands
}

// Hostile-species tuning: territorial predators that turn on the player. Reused
// for the "some planets have aggressive wildlife" feature — not a cheap wall, but
// real pressure that leans on the existing health/downed recovery.
const HOSTILE_AGGRO = 42; // notices the player within this range
const HOSTILE_ATTACK_RANGE = 4.0;
const HOSTILE_DMG = 10;
const HOSTILE_ATTACK_CD = 1.6;
const HOSTILE_CHASE = 8;
const HOSTILE_HP = 46;

// Ambient creature counts per species, by biome. Some of these become hostile
// guardians in the scavenger layer; the rest are scenery/life.
const SPECIES_DENSITY: Partial<Record<string, number>> = {
  tropical: 16,
  temperate: 13,
  oceanic: 9,
  tundra: 8,
  arid: 7,
  desert: 5,
  frozen: 5,
};

/** Ambient roaming herds: low-poly procedural creatures that wander and follow
 *  the terrain, seeded per planet. (No ecosystem simulation — reused as both
 *  scenery and, in the scavenger layer, as the basis for deposit guardians.) */
export class AnimalHerds {
  readonly group = new THREE.Group();
  /** Drain the player when an aggressive creature lands a hit (atLocal = strike pos). */
  onAttack: (dmg: number, atLocal: THREE.Vector3) => void = () => {};

  private readonly meshes: THREE.InstancedMesh[] = [];
  private readonly critters: Critter[][] = [];
  private readonly hostileFlags: boolean[] = []; // per species
  private readonly archetypeList: Archetype[] = [];
  private readonly material: THREE.MeshStandardMaterial;
  private readonly hostileMaterial: THREE.MeshStandardMaterial;
  private readonly atVec = new THREE.Vector3();
  private readonly sampler: TerrainSampler;
  /** Local→world height (applies the floating origin), injected by the scene. */
  private readonly heightAt: (x: number, z: number) => number;
  private readonly range = 150;
  private time = 0;
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
    // Aggressive species share a separate material with a faint angry glow so
    // they read as a threat at a glance.
    this.hostileMaterial = new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: true,
      roughness: 0.7,
      metalness: 0.0,
      emissive: new THREE.Color(0x551005),
      emissiveIntensity: 0.6,
    });
    if (planet.biome === 'molten' || planet.biome === 'barren-rock') return;
    const perSpecies = SPECIES_DENSITY[planet.biome] ?? 0;
    if (perSpecies === 0) return;

    const nSpecies = 2;
    // Shuffle the archetype pool per planet so worlds host different creatures.
    const pool = [...HERBIVORE_ARCHETYPES];
    const shuf = makeRNG(deriveSeed(planetSeed, 0xa12c));
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(shuf() * (i + 1));
      [pool[i], pool[j]] = [pool[j]!, pool[i]!];
    }
    for (let s = 0; s < nSpecies; s++) {
      const arch = pool[s % pool.length]!;
      this.archetypeList.push(arch);
      const rng = makeRNG(deriveSeed(planetSeed, 0xfa00, s));
      const geo = creatureGeometry(speciesParams(arch, pal, rng));
      this.addSpecies(geo, this.material, perSpecies, rng, false, 24);
    }

    // Some worlds (not all) host an aggressive species that turns on the player —
    // a different, spiked, reddish predator picked per planet, so attackers vary
    // between worlds (raptor packs / a lumbering brute / a beetle swarm).
    const hrng = makeRNG(deriveSeed(planetSeed, 0xb175));
    if (hrng() < 0.45) {
      const harch = GUARDIAN_ARCHETYPES[Math.floor(hrng() * GUARDIAN_ARCHETYPES.length)]!;
      this.archetypeList.push(harch);
      const geo = creatureGeometry(guardianParams(harch, pal, hrng));
      const count = Math.max(3, Math.round(perSpecies * 0.4));
      this.addSpecies(geo, this.hostileMaterial, count, hrng, true, HOSTILE_HP);
    }
  }

  /** Register one species: its instanced mesh + a fresh critter list. */
  private addSpecies(
    geo: THREE.BufferGeometry,
    mat: THREE.MeshStandardMaterial,
    count: number,
    rng: RNG,
    hostile: boolean,
    hp: number,
  ): void {
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    mesh.count = count;
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Instances roam every frame and the floating origin shifts, so the
    // once-computed bounding sphere goes stale and the raycaster's early-out
    // would wrongly cull the whole mesh — making shots pass through creatures.
    // A generous static sphere disables that faulty early-out; per-instance
    // raycasting still gives accurate hits.
    mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1e5);
    this.meshes.push(mesh);
    this.hostileFlags.push(hostile);
    this.group.add(mesh);

    const list: Critter[] = [];
    for (let i = 0; i < count; i++) {
      list.push({
        x: (rng() - 0.5) * this.range,
        z: (rng() - 0.5) * this.range,
        heading: rng() * TAU,
        turn: 0,
        speed: hostile ? rangeFloat(rng, 4, 7) : rangeFloat(rng, 2.5, 6),
        phase: rng() * TAU,
        hp,
        dying: 0,
        dead: false,
        flee: 0,
        attackCd: rng() * HOSTILE_ATTACK_CD,
      });
    }
    this.critters.push(list);
  }

  /** The per-species instanced meshes (raycast targets for shooting). */
  meshList(): THREE.InstancedMesh[] {
    return this.meshes;
  }

  /** Archetypes present on this planet (for the discovery codex). */
  archetypes(): Archetype[] {
    return this.archetypeList;
  }

  /** Damage the creature at (mesh, instanceId). Returns its local position for
   *  impact FX plus whether the blow was lethal, or null if it wasn't ours. */
  hit(object: THREE.Object3D, instanceId: number, damage: number): { pos: THREE.Vector3; killed: boolean } | null {
    const s = this.meshes.indexOf(object as THREE.InstancedMesh);
    if (s < 0) return null;
    const c = this.critters[s]?.[instanceId];
    if (!c || c.dead || c.dying > 0) return null;
    const gy = this.heightAt(c.x, c.z);
    c.hp -= damage;
    if (!this.hostileFlags[s]) c.flee = 5; // prey bolts; predators press the attack
    if (c.hp <= 0) {
      c.dying = 1.2;
      return { pos: new THREE.Vector3(c.x, gy + 0.6, c.z), killed: true };
    }
    // Wounded: turn to run directly away from the player's recent line of fire.
    return { pos: new THREE.Vector3(c.x, gy + 0.6, c.z), killed: false };
  }

  /** Keep herds in place when the floating origin recenters. */
  shift(dx: number, dz: number): void {
    for (const list of this.critters) {
      for (const c of list) {
        c.x -= dx;
        c.z -= dz;
      }
    }
  }

  update(dt: number, playerLocal: THREE.Vector3): void {
    if (this.meshes.length === 0) return;
    this.time += dt;
    const seaGuard = this.sampler.hasWater ? this.sampler.seaLevel + 0.4 : -Infinity;

    for (let s = 0; s < this.meshes.length; s++) {
      const list = this.critters[s]!;
      const mesh = this.meshes[s]!;
      const hostile = this.hostileFlags[s]!;
      for (let i = 0; i < list.length; i++) {
        const c = list[i]!;

        // Slain creatures: collapse onto their side, then disappear.
        if (c.dead) {
          this.dummy.position.set(0, -1e4, 0);
          this.dummy.scale.setScalar(0);
          this.dummy.updateMatrix();
          mesh.setMatrixAt(i, this.dummy.matrix);
          continue;
        }
        if (c.dying > 0) {
          c.dying -= dt;
          if (c.dying <= 0) c.dead = true;
          const gy = this.heightAt(c.x, c.z);
          const tip = Math.min(Math.PI / 2, (1 - c.dying / 1.2) * (Math.PI / 2));
          this.dummy.position.set(c.x, gy, c.z);
          this.dummy.rotation.set(0, c.heading, tip);
          this.dummy.scale.setScalar(1);
          this.dummy.updateMatrix();
          mesh.setMatrixAt(i, this.dummy.matrix);
          continue;
        }

        // Aggressive species: when the player comes near, chase and strike.
        if (hostile) {
          c.attackCd -= dt;
          const dxp = playerLocal.x - c.x;
          const dzp = playerLocal.z - c.z;
          const pdist = Math.hypot(dxp, dzp);
          if (pdist < HOSTILE_AGGRO) {
            // Smoothly turn toward the player (snapping a big model looks like it
            // spins/flies); the shortest-arc lerp keeps it grounded and natural.
            const target = Math.atan2(dxp, dzp);
            let delta = ((target - c.heading + Math.PI) % TAU + TAU) % TAU - Math.PI;
            c.heading += delta * Math.min(1, dt * 6);
            if (pdist <= HOSTILE_ATTACK_RANGE) {
              if (c.attackCd <= 0) {
                c.attackCd = HOSTILE_ATTACK_CD;
                const gyh = this.heightAt(c.x, c.z);
                this.onAttack(HOSTILE_DMG, this.atVec.set(c.x, gyh + 1, c.z));
              }
            } else {
              // Approach along the current heading, staying on walkable ground.
              const sp = HOSTILE_CHASE * dt;
              const nx = c.x + Math.sin(c.heading) * sp;
              const nz = c.z + Math.cos(c.heading) * sp;
              if (this.heightAt(nx, nz) >= seaGuard) {
                c.x = nx;
                c.z = nz;
              }
            }
            const strike = Math.max(0, 1 - c.attackCd / 0.3); // brief lunge after a hit
            const gy = this.heightAt(c.x, c.z);
            const bob = Math.sin(this.time * (3 + c.speed) + c.phase) * 0.05;
            // Feet stay planted; only a small forward rear-up sells the lunge.
            this.dummy.position.set(c.x, gy + bob, c.z);
            this.dummy.rotation.set(strike * -0.25, c.heading, 0);
            this.dummy.scale.setScalar(1 + strike * 0.12);
            this.dummy.updateMatrix();
            mesh.setMatrixAt(i, this.dummy.matrix);
            continue;
          }
        }

        c.turn += (Math.random() - 0.5) * dt * 2.5; // visual jitter only
        c.turn *= 0.9;
        c.heading += c.turn * dt;
        if (c.flee > 0) c.flee -= dt;

        // Steer back toward the player if it wandered too far.
        const dxp = playerLocal.x - c.x;
        const dzp = playerLocal.z - c.z;
        if (c.flee <= 0 && Math.hypot(dxp, dzp) > this.range) {
          c.heading = lerp(c.heading, Math.atan2(dxp, dzp), 0.04);
        }

        const speed = c.flee > 0 ? c.speed * 3.2 : c.speed;
        const nx = c.x + Math.sin(c.heading) * speed * dt;
        const nz = c.z + Math.cos(c.heading) * speed * dt;
        if (this.heightAt(nx, nz) < seaGuard) {
          c.heading += 2.2 * dt + 0.4; // veer off water
        } else {
          c.x = nx;
          c.z = nz;
        }

        const gy = this.heightAt(c.x, c.z);
        const bob = Math.sin(this.time * (3 + speed) + c.phase) * 0.06;
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
    this.hostileMaterial.dispose();
  }
}
