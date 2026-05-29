import * as THREE from 'three';
import type { AppScene } from './AppScene.ts';
import type { BloomSettings } from '../render/composer.ts';
import { deriveStarAt, derivePlanet } from '../universe/index.ts';
import { biomePalette } from '../palette/index.ts';
import { makeTerrain, ChunkManager, CHUNK_SIZE } from '../gen/terrain.ts';
import { SkyDome } from '../render/sky.ts';
import { Water } from '../render/water.ts';
import { SurfaceController } from './controls/SurfaceController.ts';
import { rgbToHex } from '../core/color.ts';
import { clamp, lerp, DEG2RAD, TAU } from '../core/math.ts';
import { makeRNG } from '../core/rng.ts';
import { deriveSeed } from '../core/hash.ts';
import type { PlanetProfile, StarProfile } from '../universe/types.ts';

/** Walkable, infinitely-streamed planet surface. Chunked fBm terrain, water at
 *  sea level, gradient sky + colored sun, biome fog. Floating origin (XZ) keeps
 *  precision intact while roaming. "Take off" (T/Backspace) returns to the system. */
export class SurfaceScene implements AppScene {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly bloom: BloomSettings = { strength: 0.5, radius: 0.7, threshold: 0.65 };

  onTakeOff: (() => void) | null = null;

  private readonly star: StarProfile;
  private readonly planet: PlanetProfile;
  private readonly chunks: ChunkManager;
  private readonly sky: SkyDome;
  private readonly water: Water | null;
  private readonly controller: SurfaceController;
  private readonly sampler: ReturnType<typeof makeTerrain>;

  // Floating origin on XZ (Y stays near the ground).
  private originCX = 0;
  private originCZ = 0;

  constructor(
    universeSeed: number,
    cell: readonly [number, number, number],
    starIndex: number,
    planetIndex: number,
    dom: HTMLElement,
  ) {
    this.star = deriveStarAt(universeSeed, cell, starIndex);
    this.planet = derivePlanet(this.star, planetIndex);
    const pal = biomePalette(this.planet, this.star);
    this.sampler = makeTerrain(this.planet, this.planet.seed, pal);

    // Sky/fog/background.
    this.scene.background = new THREE.Color(rgbToHex(pal.skyHorizon));
    const fogDensity = lerp(0.0016, 0.006, this.planet.atmosphere);
    this.scene.fog = new THREE.FogExp2(rgbToHex(pal.fog), fogDensity);

    // Sun direction (seeded), directional light + ambient.
    const rng = makeRNG(deriveSeed(this.planet.seed, 0x5a));
    const az = rng() * TAU;
    const el = lerp(20, 60, rng()) * DEG2RAD;
    const sunDir = new THREE.Vector3(
      Math.cos(el) * Math.cos(az),
      Math.sin(el),
      Math.cos(el) * Math.sin(az),
    );
    const sun = new THREE.DirectionalLight(rgbToHex(pal.sun), 2.4);
    sun.position.copy(sunDir).multiplyScalar(1000);
    this.scene.add(sun);
    this.scene.add(new THREE.AmbientLight(rgbToHex(pal.skyZenith), 0.7));

    this.sky = new SkyDome(pal.skyHorizon, pal.skyZenith, pal.sun, sunDir);
    this.scene.add(this.sky.mesh);

    // Terrain.
    this.chunks = new ChunkManager(this.sampler);
    this.scene.add(this.chunks.group);

    // Water (omitted for near-dry worlds).
    if (this.sampler.hasWater) {
      this.water = new Water(pal.water);
      this.scene.add(this.water.mesh);
    } else {
      this.water = null;
    }

    // Camera + controller. Spawn just above the terrain at local origin.
    this.camera = new THREE.PerspectiveCamera(72, 1, 0.1, 12000);
    this.camera.position.set(0, 0, 0);
    const heightAtLocal = (x: number, z: number): number =>
      this.sampler.heightAt(this.originCX * CHUNK_SIZE + x, this.originCZ * CHUNK_SIZE + z);
    this.controller = new SurfaceController(this.camera, dom, heightAtLocal);
    // Gravity scales with planet gravity for a touch of physical flavor.
    this.controller.gravity = -32 * clamp(this.planet.gravity, 0.4, 2.2);
    this.controller.placeOnGround();

    // Prime the full view radius synchronously during the descent transition so
    // the surface is fully present on the first rendered frame (no pop-in burst).
    let guard = 0;
    while (!this.chunks.fullyLoaded && guard++ < 500) {
      this.chunks.update(0, 0, 0, 0);
    }

    window.addEventListener('keydown', this.onKeyDown);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if ((e.key === 'Backspace' || e.key === 't' || e.key === 'T') && this.onTakeOff) {
      e.preventDefault();
      this.onTakeOff();
    }
  };

  update(dt: number): void {
    this.controller.update(dt);

    // Floating-origin recenter on XZ (whole chunks).
    const sx = Math.round(this.camera.position.x / CHUNK_SIZE);
    const sz = Math.round(this.camera.position.z / CHUNK_SIZE);
    if (sx !== 0 || sz !== 0) {
      this.camera.position.x -= sx * CHUNK_SIZE;
      this.camera.position.z -= sz * CHUNK_SIZE;
      this.originCX += sx;
      this.originCZ += sz;
    }

    this.chunks.update(this.originCX, this.originCZ, this.originCX, this.originCZ);
    this.sky.follow(this.camera.position);
    if (this.water) this.water.update(dt, this.camera.position, this.sampler.seaLevel);
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    this.controller.dispose();
    this.chunks.dispose();
    this.sky.dispose();
    this.water?.dispose();
  }

  hudLines(): string[] {
    const p = this.planet;
    const lines = [
      `scene: surface — ${p.biome}  ${p.surfaceTemp.toFixed(0)}K  gravity ${p.gravity.toFixed(2)}g`,
      `mode: ${this.controller.mode}  (G to toggle walk/fly)`,
    ];
    if (!this.controller.isLocked) {
      lines.push('click to capture mouse · WASD move · Space jump/up · Shift sprint/boost');
    }
    lines.push('[T] take off to system');
    return lines;
  }
}
