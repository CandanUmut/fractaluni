import * as THREE from 'three';
import type { PlanetProfile } from '../universe/types.ts';
import { makeRNG, rangeFloat, type RNG } from '../core/rng.ts';
import { deriveSeed } from '../core/hash.ts';
import { clamp } from '../core/math.ts';

// Light weather: cheap camera-following precipitation that drifts in and out so
// the planet's mood changes. Rain (bluish points) on temperate, wet worlds; snow
// (slow drifting flakes) on cold ones. While it's falling, SurfaceScene reads
// `intensity` to thicken the fog and dim the sun a touch. Particles live in a box
// around the camera, so they're floating-origin free.

export type WeatherKind = 'none' | 'rain' | 'snow';

const BOX = 70; // half-extent of the precipitation volume around the camera
const TOP = 55; // spawn height above the camera
const RAIN_COUNT = 900;
const SNOW_COUNT = 650;

/** Decide what weather a planet can have from its derived profile. */
function weatherFor(p: PlanetProfile): WeatherKind {
  if (p.atmosphere < 0.18) return 'none'; // no air -> no precipitation
  if (p.biome === 'molten' || p.biome === 'barren-rock') return 'none';
  if (p.biome === 'frozen' || p.biome === 'tundra' || p.surfaceTemp < 273)
    return p.waterFraction > 0.05 || p.atmosphere > 0.35 ? 'snow' : 'none';
  if ((p.biome === 'temperate' || p.biome === 'tropical' || p.biome === 'oceanic') && p.waterFraction > 0.15)
    return 'rain';
  return 'none';
}

export class Weather {
  readonly group = new THREE.Group();
  readonly kind: WeatherKind;
  /** 0..1 current precipitation strength, smoothed. */
  intensity = 0;

  private readonly obj: THREE.Object3D | null = null;
  private readonly geom: THREE.BufferGeometry | null = null;
  private readonly pos: Float32Array | null = null;
  private readonly vel: Float32Array | null = null; // per-particle fall + drift
  private readonly mat: THREE.Material | null = null;
  private readonly count: number = 0;
  private readonly rng: RNG;

  // Slow on/off cycle so weather rolls through rather than being constant.
  private target = 0;
  private timer: number;
  private readonly windX: number;
  private readonly windZ: number;

  constructor(planet: PlanetProfile) {
    this.kind = weatherFor(planet);
    this.rng = makeRNG(deriveSeed(planet.seed, 0x3ea7));
    this.timer = rangeFloat(this.rng, 8, 30); // first spell starts soon-ish
    this.windX = rangeFloat(this.rng, -3, 3);
    this.windZ = rangeFloat(this.rng, -3, 3);

    if (this.kind === 'none') return;

    const snow = this.kind === 'snow';
    this.count = snow ? SNOW_COUNT : RAIN_COUNT;
    this.pos = new Float32Array(this.count * 3);
    this.vel = new Float32Array(this.count * 3);
    for (let i = 0; i < this.count; i++) {
      this.respawn(i, true);
      if (snow) {
        this.vel[i * 3] = rangeFloat(this.rng, -1.2, 1.2);
        this.vel[i * 3 + 1] = -rangeFloat(this.rng, 2, 4);
        this.vel[i * 3 + 2] = rangeFloat(this.rng, -1.2, 1.2);
      } else {
        this.vel[i * 3] = 0;
        this.vel[i * 3 + 1] = -rangeFloat(this.rng, 32, 46);
        this.vel[i * 3 + 2] = 0;
      }
    }

    this.geom = new THREE.BufferGeometry();
    this.geom.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.PointsMaterial({
      color: snow ? 0xeef4ff : 0x9fb4d8,
      size: snow ? 0.5 : 0.32,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.obj = new THREE.Points(this.geom, this.mat);
    this.obj.frustumCulled = false;
    this.group.add(this.obj);
  }

  private respawn(i: number, anywhere: boolean): void {
    if (!this.pos) return;
    this.pos[i * 3] = (this.rng() - 0.5) * 2 * BOX;
    this.pos[i * 3 + 1] = anywhere ? this.rng() * (TOP + BOX) - BOX * 0.4 : TOP;
    this.pos[i * 3 + 2] = (this.rng() - 0.5) * 2 * BOX;
  }

  update(dt: number, camPos: THREE.Vector3): void {
    if (this.kind === 'none') return;

    // March the weather state machine: alternate clear and precipitating spells.
    this.timer -= dt;
    if (this.timer <= 0) {
      if (this.target > 0.5) {
        this.target = 0;
        this.timer = rangeFloat(this.rng, 45, 110); // clear spell
      } else {
        this.target = rangeFloat(this.rng, 0.5, 1);
        this.timer = rangeFloat(this.rng, 30, 75); // wet spell
      }
    }
    this.intensity += (this.target - this.intensity) * (1 - Math.exp(-dt * 0.4));

    this.group.position.copy(camPos);
    if (this.mat) (this.mat as THREE.PointsMaterial).opacity = clamp(this.intensity, 0, 1) * 0.85;

    if (!this.pos || !this.vel || this.intensity < 0.02) {
      if (this.geom) this.geom.setDrawRange(0, 0);
      return;
    }

    // Only simulate the fraction of particles the current intensity calls for.
    const active = Math.ceil(this.count * clamp(this.intensity, 0, 1));
    const wx = this.windX;
    const wz = this.windZ;
    for (let i = 0; i < active; i++) {
      const x = i * 3;
      this.pos[x] = this.pos[x]! + (this.vel[x]! + wx) * dt;
      this.pos[x + 1] = this.pos[x + 1]! + this.vel[x + 1]! * dt;
      this.pos[x + 2] = this.pos[x + 2]! + (this.vel[x + 2]! + wz) * dt;
      // Recycle once below the box, or if it drifted out of the column.
      if (
        this.pos[x + 1]! < -BOX * 0.5 ||
        Math.abs(this.pos[x]!) > BOX ||
        Math.abs(this.pos[x + 2]!) > BOX
      ) {
        this.respawn(i, false);
      }
    }
    (this.geom!.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    this.geom!.setDrawRange(0, active);
  }

  dispose(): void {
    this.geom?.dispose();
    this.mat?.dispose();
  }
}
