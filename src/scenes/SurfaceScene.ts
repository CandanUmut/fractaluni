import * as THREE from 'three';
import type { AppScene } from './AppScene.ts';
import type { BloomSettings } from '../render/composer.ts';
import type { ColorGradeSettings } from '../render/colorGrade.ts';
import { deriveStarAt, derivePlanet } from '../universe/index.ts';
import { biomePalette } from '../palette/index.ts';
import { makeTerrain, ChunkManager, CHUNK_SIZE } from '../gen/terrain.ts';
import { FloraManager } from '../gen/flora.ts';
import { BirdFlock, birdColor } from '../agents/boids.ts';
import { AnimalHerds } from '../agents/animals.ts';
import { SkyDome } from '../render/sky.ts';
import { Water } from '../render/water.ts';
import { Viewmodel } from '../render/viewmodel.ts';
import { SurfaceController } from './controls/SurfaceController.ts';
import { rgbToHex } from '../core/color.ts';
import { clamp, lerp, DEG2RAD, TAU } from '../core/math.ts';
import { makeRNG } from '../core/rng.ts';
import { deriveSeed } from '../core/hash.ts';
import type { PlanetProfile, StarProfile } from '../universe/types.ts';

/** First-person walkable planet surface (v3 scavenger base): streamed fBm
 *  terrain, water, gradient sky + colored sun, biome fog, flora, ambient fauna,
 *  and a first-person controller + viewmodel. Floating origin (XZ) keeps
 *  precision intact. "Take off" (T/Backspace) returns to the system. */
export class SurfaceScene implements AppScene {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly bloom: BloomSettings = { strength: 0.5, radius: 0.7, threshold: 0.65 };
  readonly colorGrade: ColorGradeSettings;

  onTakeOff: (() => void) | null = null;

  private readonly star: StarProfile;
  private readonly planet: PlanetProfile;
  private readonly chunks: ChunkManager;
  private readonly flora: FloraManager;
  private readonly birds: BirdFlock | null;
  private readonly herds: AnimalHerds;
  private readonly sky: SkyDome;
  private readonly water: Water | null;
  private readonly controller: SurfaceController;
  private readonly viewmodel = new Viewmodel();
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

    this.colorGrade = {
      tint: { r: lerp(1, pal.sun.r, 0.2), g: lerp(1, pal.sun.g, 0.2), b: lerp(1, pal.sun.b, 0.2) },
      exposure: 1.04,
      contrast: 1.08,
      saturation: 1.12,
    };

    // Sky / fog / background.
    this.scene.background = new THREE.Color(rgbToHex(pal.skyHorizon));
    this.scene.fog = new THREE.FogExp2(rgbToHex(pal.fog), lerp(0.0016, 0.006, this.planet.atmosphere));

    // Sun (seeded direction) + ambient.
    const rng = makeRNG(deriveSeed(this.planet.seed, 0x5a));
    const az = rng() * TAU;
    const el = lerp(20, 60, rng()) * DEG2RAD;
    const sunDir = new THREE.Vector3(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az));
    const sun = new THREE.DirectionalLight(rgbToHex(pal.sun), 2.4);
    sun.position.copy(sunDir).multiplyScalar(1000);
    this.scene.add(sun);
    this.scene.add(new THREE.AmbientLight(rgbToHex(pal.skyZenith), 0.7));

    this.sky = new SkyDome(pal.skyHorizon, pal.skyZenith, pal.sun, sunDir);
    this.scene.add(this.sky.mesh);

    // Terrain + flora.
    this.chunks = new ChunkManager(this.sampler);
    this.scene.add(this.chunks.group);
    this.flora = new FloraManager(this.planet, this.planet.seed, pal, this.sampler);
    this.scene.add(this.flora.group);

    // Water (omitted for near-dry worlds).
    if (this.sampler.hasWater) {
      this.water = new Water(pal.water);
      this.scene.add(this.water.mesh);
    } else {
      this.water = null;
    }

    // First-person camera + controller.
    this.camera = new THREE.PerspectiveCamera(75, 1, 0.1, 12000);
    this.camera.position.set(0, 0, 0);
    const heightAtLocal = (x: number, z: number): number =>
      this.sampler.heightAt(this.originCX * CHUNK_SIZE + x, this.originCZ * CHUNK_SIZE + z);
    this.controller = new SurfaceController(this.camera, dom, heightAtLocal);
    this.controller.eyeHeight = 1.7; // human-scale eye height for FP
    this.controller.gravity = -32 * clamp(this.planet.gravity, 0.4, 2.2);
    this.controller.placeOnGround();

    // Fauna (ambient). Lifeless biomes get none.
    const lifeless = this.planet.biome === 'molten' || this.planet.biome === 'barren-rock';
    if (!lifeless) {
      this.birds = new BirdFlock(deriveSeed(this.planet.seed, 0xb1d5), 90, birdColor(pal.foliage), heightAtLocal);
      this.scene.add(this.birds.mesh);
    } else {
      this.birds = null;
    }
    this.herds = new AnimalHerds(this.planet, this.planet.seed, pal, this.sampler, heightAtLocal);
    this.scene.add(this.herds.group);

    // Prime the full view radius so the surface is present on the first frame.
    let guard = 0;
    while (!this.chunks.fullyLoaded && guard++ < 500) this.chunks.update(0, 0, 0, 0);

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
      this.birds?.shift(sx * CHUNK_SIZE, sz * CHUNK_SIZE);
      this.herds.shift(sx * CHUNK_SIZE, sz * CHUNK_SIZE);
    }

    this.chunks.update(this.originCX, this.originCZ, this.originCX, this.originCZ);
    this.flora.update(this.originCX, this.originCZ, this.originCX, this.originCZ);
    this.birds?.update(dt, this.camera.position);
    this.herds.update(dt, this.camera.position);
    this.sky.follow(this.camera.position);
    if (this.water) this.water.update(dt, this.camera.position, this.sampler.seaLevel);

    // First-person viewmodel sway/bob.
    const sway = this.controller.sway;
    this.viewmodel.update(dt, {
      moving: this.controller.isMoving,
      swayX: sway.x,
      swayY: sway.y,
      speed01: this.controller.speed01,
    });
  }

  resize(width: number, height: number): void {
    const aspect = width / Math.max(1, height);
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.viewmodel.resize(aspect);
  }

  /** Viewmodel is drawn after the world composite so it never clips terrain. */
  renderOverlay(renderer: THREE.WebGLRenderer): void {
    this.viewmodel.render(renderer);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    this.controller.dispose();
    this.chunks.dispose();
    this.flora.dispose();
    this.birds?.dispose();
    this.herds.dispose();
    this.sky.dispose();
    this.water?.dispose();
    this.viewmodel.dispose();
  }

  hudLines(): string[] {
    const p = this.planet;
    const s = this.star;
    const lines = [
      `scene: surface — ${p.biome}${p.inHabitableZone ? ' (habitable zone)' : ''}`,
      `star ${s.spectralClass} ${s.temperature.toFixed(0)}K · orbit ${p.orbitalRadius.toFixed(2)} AU · gravity ${p.gravity.toFixed(2)}g`,
    ];
    if (!this.controller.isLocked) {
      lines.push('click to capture mouse · WASD move · mouse look · Shift sprint · Space jump/jetpack');
    }
    lines.push('[T] take off to system');
    return lines;
  }
}
