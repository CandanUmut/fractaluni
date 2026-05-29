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
import { SurfaceController } from './controls/SurfaceController.ts';
import { rgbToHex } from '../core/color.ts';
import { planetPath, loadDiff, saveDiff } from '../sim/persistence.ts';
import { emptyDiff, cellKeyOf, cellCenter, parseCellKey, SIM_CELL, type PlanetDiff } from '../sim/planetDiff.ts';
import { Ecosystem } from '../sim/ecosystem.ts';
import { DynamicFlora } from '../gen/dynamicFlora.ts';
import { Survival } from '../sim/survival.ts';
import { worldClock } from '../sim/worldClock.ts';
import { FieldOverlay } from '../ui/fieldOverlay.ts';
import type { CellEdit } from '../sim/planetDiff.ts';
import { clamp, lerp, DEG2RAD, TAU } from '../core/math.ts';
import { makeRNG } from '../core/rng.ts';
import { deriveSeed } from '../core/hash.ts';
import type { PlanetProfile, StarProfile } from '../universe/types.ts';

const SIM_DT = 0.1; // sim-seconds per fixed ecosystem tick
const MAX_STEPS_PER_FRAME = 40; // cap so fast-forward never stalls a frame

/** Walkable, infinitely-streamed planet surface. Chunked fBm terrain, water at
 *  sea level, gradient sky + colored sun, biome fog. Floating origin (XZ) keeps
 *  precision intact while roaming. "Take off" (T/Backspace) returns to the system. */
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
  private readonly sampler: ReturnType<typeof makeTerrain>;

  // Floating origin on XZ (Y stays near the ground).
  private originCX = 0;
  private originCZ = 0;

  // v2 Phase A: sparse persistent diff over the pure baseline.
  private readonly diffKey: string;
  private diff: PlanetDiff = emptyDiff();
  private readonly markerGroup = new THREE.Group();
  private readonly markerGeo: THREE.CylinderGeometry;
  private readonly markerMat: THREE.MeshStandardMaterial;
  private markers: { gx: number; gz: number; mesh: THREE.Mesh }[] = [];

  // v2 Phase B: local ecosystem field sim + time controls + debug overlay.
  private readonly eco: Ecosystem;
  private readonly dynamicFlora: DynamicFlora;
  private readonly overlay: FieldOverlay;
  private simAccum = 0;
  private timeScale = 1;
  private paused = false;

  // v2 Phase F: region-scale "broader powers", unlocked by cultivation progress.
  private regionMode = false;
  private actionsPerformed = 0;
  private caughtUp = '';

  // v2 Phase D: lightly-gathered resources spent on embodied transformation.
  private seeds = 3;
  private samples = 2;
  private lastAction = '';

  // v2 Phase E: light survival.
  private readonly survival: Survival;
  private prevX = 0;
  private prevZ = 0;

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

    // Color grade tints the whole scene toward the star's light for a coherent,
    // system-specific atmosphere.
    this.colorGrade = {
      tint: {
        r: lerp(1, pal.sun.r, 0.2),
        g: lerp(1, pal.sun.g, 0.2),
        b: lerp(1, pal.sun.b, 0.2),
      },
      exposure: 1.04,
      contrast: 1.08,
      saturation: 1.12,
    };

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

    // Flora (streamed alongside terrain).
    this.flora = new FloraManager(this.planet, this.planet.seed, pal, this.sampler);
    this.scene.add(this.flora.group);

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

    // Fauna (seeded per planet). Lifeless biomes get neither.
    const lifeless = this.planet.biome === 'molten' || this.planet.biome === 'barren-rock';
    if (!lifeless) {
      this.birds = new BirdFlock(deriveSeed(this.planet.seed, 0xb1d5), 90, birdColor(pal.foliage), heightAtLocal);
      this.scene.add(this.birds.mesh);
    } else {
      this.birds = null;
    }
    this.herds = new AnimalHerds(this.planet, this.planet.seed, pal, this.sampler);
    this.scene.add(this.herds.group);

    // v2 Phase A: persistent diff. Markers prove the load/apply/save plumbing.
    this.diffKey = planetPath(universeSeed, cell, starIndex, planetIndex);
    this.markerGeo = new THREE.CylinderGeometry(0.5, 0.7, 8, 6);
    this.markerGeo.translate(0, 4, 0);
    this.markerMat = new THREE.MeshStandardMaterial({
      color: 0x0a2a30,
      emissive: new THREE.Color(0x24e0ff),
      emissiveIntensity: 2.2,
      flatShading: true,
    });
    this.scene.add(this.markerGroup);
    void loadDiff(this.diffKey).then((d) => {
      if (d) {
        this.diff = d;
        this.rebuildMarkers();
        this.applyDiffToEco();
        // Coarse catch-up: advance the sim by the in-world time since last visit,
        // in a few large steps, so the world has plausibly "moved on".
        const away = worldClock.seconds - d.lastVisited;
        if (away > 2) this.catchUp(away);
      }
    });

    // Ecosystem field sim over a fixed region centered on the spawn point.
    const GRID = 96;
    this.eco = new Ecosystem({
      width: GRID,
      height: GRID,
      originGX: -GRID / 2,
      originGZ: -GRID / 2,
      elevationAt: (x, z) => this.sampler.heightAt(x, z),
      seaLevel: this.sampler.seaLevel,
      hasWater: this.sampler.hasWater,
      surfaceTemp: this.planet.surfaceTemp,
      atmosphere: this.planet.atmosphere,
      waterFraction: this.planet.waterFraction,
    });
    const hudRoot = document.getElementById('hud') ?? document.body;
    this.overlay = new FieldOverlay(hudRoot, GRID, GRID);

    this.dynamicFlora = new DynamicFlora(this.planet.seed, pal, this.sampler);
    this.scene.add(this.dynamicFlora.group);

    this.survival = new Survival(this.planet);

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
    } else if (e.key === 'm' || e.key === 'M') {
      this.toggleMarker();
    } else if (e.key === 'k' || e.key === 'K') {
      this.paused = !this.paused;
    } else if (e.key === 'l' || e.key === 'L') {
      this.timeScale = this.timeScale >= 16 ? 1 : this.timeScale * 4; // 1→4→16→1
    } else if (e.key === 'j' || e.key === 'J') {
      for (let i = 0; i < 200; i++) this.eco.step(SIM_DT); // skip ahead ~20s
    } else if (e.key === 'o' || e.key === 'O') {
      this.overlay.setVisible(!this.overlay.visible);
    } else if (e.key === 'i' || e.key === 'I') {
      this.overlay.cycle();
    } else if (e.key === 'x' || e.key === 'X') {
      this.gather();
    } else if (e.key === 'f' || e.key === 'F') {
      this.act('plant', this.actRadius());
    } else if (e.key === 'c' || e.key === 'C') {
      this.act('clear', this.actRadius());
    } else if (e.key === 'v' || e.key === 'V') {
      this.act('water', this.actRadius());
    } else if (e.key === 'h' || e.key === 'H') {
      this.act('herb', this.actRadius());
    } else if (e.key === 'y' || e.key === 'Y') {
      this.act('pred', this.actRadius());
    } else if (e.key === 'e' || e.key === 'E') {
      this.eat();
    } else if (e.key === 'b' || e.key === 'B') {
      if (this.regionUnlocked()) {
        this.regionMode = !this.regionMode;
        this.lastAction = `region (broad) tools ${this.regionMode ? 'ON' : 'off'}`;
      } else {
        this.lastAction = `region tools locked — transform ${5 - this.actionsPerformed} more time(s) to unlock`;
      }
    }
  };

  private regionUnlocked(): boolean {
    return this.actionsPerformed >= 5;
  }

  private actRadius(): number {
    return this.regionMode && this.regionUnlocked() ? 6 : 1;
  }

  /** Eat: hunt a local herd, or forage local vegetation — consumes the field. */
  private eat(): void {
    const c = this.playerGridCell();
    if (!c) {
      this.lastAction = 'out of the simulated region';
      return;
    }
    const n = this.survival.needs;
    if (this.eco.herbivore[c.k]! > 0.5) {
      this.eco.herbivore[c.k] = Math.max(0, this.eco.herbivore[c.k]! - 1.5);
      n.food = Math.min(1, n.food + 0.45);
      n.energy = Math.min(1, n.energy + 0.15);
      this.lastAction = 'hunted a herbivore — well fed';
    } else if (this.eco.vegetation[c.k]! > 0.2) {
      this.eco.vegetation[c.k] = Math.max(0, this.eco.vegetation[c.k]! - 0.3);
      n.food = Math.min(1, n.food + 0.28);
      this.lastAction = 'foraged some vegetation';
    } else {
      this.lastAction = 'nothing here to eat — grow or find food';
    }
  }

  private respawn(): void {
    this.camera.position.set(0, 0, 0);
    this.originCX = 0;
    this.originCZ = 0;
    this.controller.placeOnGround();
    this.survival.revive();
    this.seeds = Math.floor(this.seeds / 2);
    this.samples = Math.floor(this.samples / 2);
    this.prevX = 0;
    this.prevZ = 0;
    this.lastAction = 'You blacked out and woke at your landing site.';
  }

  private playerGridCell(): { i: number; j: number; k: number; gx: number; gz: number } | null {
    const absX = this.originCX * CHUNK_SIZE + this.camera.position.x;
    const absZ = this.originCZ * CHUNK_SIZE + this.camera.position.z;
    const gx = Math.floor(absX / SIM_CELL);
    const gz = Math.floor(absZ / SIM_CELL);
    const [i, j] = this.eco.gridIndex(gx, gz);
    if (!this.eco.inGrid(i, j)) return null;
    return { i, j, k: j * this.eco.width + i, gx, gz };
  }

  private editCell(gx: number, gz: number, edit: CellEdit): void {
    const key = `${gx},${gz}`;
    this.diff.cells.set(key, { ...(this.diff.cells.get(key) ?? {}), ...edit });
  }

  /** Gather a seed (on vegetation) or a creature sample (near a herd). */
  private gather(): void {
    const c = this.playerGridCell();
    if (!c) {
      this.lastAction = 'out of the simulated region';
      return;
    }
    if (this.eco.vegetation[c.k]! > 0.2 && this.seeds < 9) {
      this.seeds++;
      this.lastAction = 'gathered a seed';
    } else if (this.eco.herbivore[c.k]! > 0.6 && this.samples < 9) {
      this.samples++;
      this.lastAction = 'gathered a creature sample';
    } else {
      this.lastAction = 'nothing to gather here (stand on growth / near a herd)';
    }
  }

  /** Visit every in-grid cell within `radius` of (i,j), passing its grid index
   *  and absolute sim-cell coords. radius 1 = a small patch; large = a region. */
  private forEachInRadius(
    i: number,
    j: number,
    radius: number,
    fn: (k: number, gx: number, gz: number) => void,
  ): void {
    const r2 = radius * radius;
    for (let dj = -radius; dj <= radius; dj++) {
      for (let di = -radius; di <= radius; di++) {
        if (di * di + dj * dj > r2) continue;
        const ii = i + di;
        const jj = j + dj;
        if (!this.eco.inGrid(ii, jj)) continue;
        fn(jj * this.eco.width + ii, this.eco.originGX + ii, this.eco.originGZ + jj);
      }
    }
  }

  /** Embodied transformation. radius>1 are the region-scale "broader powers" —
   *  the same verbs, batched, writing a larger diff. */
  private act(kind: 'plant' | 'clear' | 'water' | 'herb' | 'pred', radius: number): void {
    const c = this.playerGridCell();
    if (!c) {
      this.lastAction = 'out of the simulated region';
      return;
    }
    const region = radius > 1;
    const scope = region ? 'across the region' : 'here';
    const eco = this.eco;

    if (kind === 'plant') {
      const cost = region ? 3 : 1;
      if (this.seeds < cost) {
        this.lastAction = `need ${cost} seed(s) — press X on vegetation to gather`;
        return;
      }
      this.seeds -= cost;
      this.forEachInRadius(c.i, c.j, radius, (k, gx, gz) => {
        if (!eco.isWater[k]) eco.vegetation[k] = Math.max(eco.vegetation[k]!, 0.75);
        this.editCell(gx, gz, { planted: true, cleared: false });
      });
      this.lastAction = `afforested ${scope} — it will grow and spread`;
    } else if (kind === 'clear') {
      this.forEachInRadius(c.i, c.j, radius, (k, gx, gz) => {
        eco.vegetation[k] = 0;
        this.editCell(gx, gz, { cleared: true, planted: false });
      });
      this.lastAction = `cleared vegetation ${scope}`;
    } else if (kind === 'water') {
      this.forEachInRadius(c.i, c.j, radius, (k, gx, gz) => {
        const ii = k % eco.width;
        const jj = Math.floor(k / eco.width);
        eco.applyEdit(ii, jj, { water: true });
        this.editCell(gx, gz, { water: true });
      });
      this.lastAction = `flooded ${scope} — moisture will spread`;
    } else if (kind === 'herb' || kind === 'pred') {
      const cost = region ? 3 : 1;
      if (this.samples < cost) {
        this.lastAction = `need ${cost} sample(s) — press X near a herd to gather`;
        return;
      }
      this.samples -= cost;
      const amt = region ? 1.5 : kind === 'herb' ? 4 : 2;
      this.forEachInRadius(c.i, c.j, radius, (k, gx, gz) => {
        if (kind === 'herb') {
          eco.herbivore[k] = Math.min(8, eco.herbivore[k]! + amt);
          this.editCell(gx, gz, { herb: amt });
        } else {
          eco.predator[k] = Math.min(4, eco.predator[k]! + amt);
          this.editCell(gx, gz, { pred: amt });
        }
      });
      this.lastAction = `introduced ${kind === 'herb' ? 'herbivores' : 'predators'} ${scope}`;
    }

    this.actionsPerformed++;
    this.persist();
  }

  private applyDiffToEco(): void {
    for (const [key, edit] of this.diff.cells) {
      const [gx, gz] = parseCellKey(key);
      const [i, j] = this.eco.gridIndex(gx, gz);
      this.eco.applyEdit(i, j, edit);
    }
  }

  /** Place/remove a persistent marker on the player's current sim cell. */
  private toggleMarker(): void {
    const absX = this.originCX * CHUNK_SIZE + this.camera.position.x;
    const absZ = this.originCZ * CHUNK_SIZE + this.camera.position.z;
    const key = cellKeyOf(absX, absZ);
    const existing = this.diff.cells.get(key);
    if (existing?.marker) this.diff.cells.delete(key);
    else this.diff.cells.set(key, { ...existing, marker: true });
    this.rebuildMarkers();
    this.persist();
  }

  private rebuildMarkers(): void {
    for (const m of this.markers) this.markerGroup.remove(m.mesh);
    this.markers = [];
    for (const [key, edit] of this.diff.cells) {
      if (!edit.marker) continue;
      const [gx, gz] = parseCellKey(key);
      const mesh = new THREE.Mesh(this.markerGeo, this.markerMat);
      this.markerGroup.add(mesh);
      this.markers.push({ gx, gz, mesh });
    }
  }

  private persist(): void {
    this.diff.lastVisited = worldClock.seconds;
    void saveDiff(this.diffKey, this.diff);
  }

  /** Advance the ecosystem by elapsed away-time in a few coarse steps. */
  private catchUp(seconds: number): void {
    const steps = Math.min(800, Math.round(seconds / 0.5));
    for (let i = 0; i < steps; i++) this.eco.step(0.5);
    this.caughtUp = `the world moved on (~${Math.round(seconds)}s while away)`;
  }

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
      // Keep ambient birds in place relative to the world after the shift.
      this.birds?.shift(sx * CHUNK_SIZE, sz * CHUNK_SIZE);
      // Keep the movement baseline in the same frame as the camera.
      this.prevX -= sx * CHUNK_SIZE;
      this.prevZ -= sz * CHUNK_SIZE;
    }

    this.chunks.update(this.originCX, this.originCZ, this.originCX, this.originCZ);
    this.flora.update(this.originCX, this.originCZ, this.originCX, this.originCZ);
    this.birds?.update(dt, this.camera.position);
    this.sky.follow(this.camera.position);
    if (this.water) this.water.update(dt, this.camera.position, this.sampler.seaLevel);

    // Keep persistent markers positioned in local space over the floating origin.
    for (const m of this.markers) {
      const [cxw, czw] = cellCenter(m.gx, m.gz);
      const lx = cxw - this.originCX * CHUNK_SIZE;
      const lz = czw - this.originCZ * CHUNK_SIZE;
      m.mesh.position.set(lx, this.sampler.heightAt(cxw, czw), lz);
    }

    // Ecosystem field sim on a fixed timestep, scaled by the time control.
    if (!this.paused) {
      this.simAccum += dt * this.timeScale;
      let steps = 0;
      while (this.simAccum >= SIM_DT && steps < MAX_STEPS_PER_FRAME) {
        this.eco.step(SIM_DT);
        this.simAccum -= SIM_DT;
        steps++;
      }
    }
    // Render the population + vegetation fields as visible samples.
    this.herds.update(dt, this.eco, this.originCX, this.originCZ);
    this.dynamicFlora.update(dt, this.eco, this.originCX, this.originCZ);

    // Survival: tick needs from local context; instructive failure on death.
    const pc = this.playerGridCell();
    const localVeg = pc ? this.eco.vegetation[pc.k]! : 0;
    const moved = Math.hypot(this.camera.position.x - this.prevX, this.camera.position.z - this.prevZ) > dt * 1.5;
    this.prevX = this.camera.position.x;
    this.prevZ = this.camera.position.z;
    if (this.survival.update(dt, { moving: moved, localVegetation: localVeg })) {
      this.respawn();
    }
    // Debug overlay (player cell relative to the sim grid origin).
    const absX = this.originCX * CHUNK_SIZE + this.camera.position.x;
    const absZ = this.originCZ * CHUNK_SIZE + this.camera.position.z;
    const pi = Math.floor(absX / SIM_CELL) - this.eco.originGX;
    const pj = Math.floor(absZ / SIM_CELL) - this.eco.originGZ;
    this.overlay.render(this.eco, pi, pj);
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    this.persist(); // save the diff when leaving the planet
    this.dynamicFlora.dispose();
    this.overlay.dispose();
    this.markerGeo.dispose();
    this.markerMat.dispose();
    window.removeEventListener('keydown', this.onKeyDown);
    this.controller.dispose();
    this.chunks.dispose();
    this.flora.dispose();
    this.birds?.dispose();
    this.herds.dispose();
    this.sky.dispose();
    this.water?.dispose();
  }

  hudLines(): string[] {
    const p = this.planet;
    const s = this.star;
    const n = this.survival.needs;
    const haz = this.survival.hazardLabel;
    const bar = (v: number): string => {
      const f = Math.round(Math.max(0, Math.min(1, v)) * 5);
      return '█'.repeat(f) + '░'.repeat(5 - f);
    };
    const lines = [
      `scene: surface — ${p.biome}${p.inHabitableZone ? ' (habitable zone)' : ''}`,
      `star ${s.spectralClass} ${s.temperature.toFixed(0)}K · orbit ${p.orbitalRadius.toFixed(2)} AU`,
      `T_surf ${p.surfaceTemp.toFixed(0)}K · gravity ${p.gravity.toFixed(2)}g · water ${p.waterFraction.toFixed(2)} · atmo ${p.atmosphere.toFixed(2)}`,
      `mode: ${this.controller.mode}  (G to toggle walk/fly)`,
      `markers: ${this.markers.length}  ([M] mark this spot — persists across visits)`,
      `sim: ${this.paused ? 'paused' : `▶ ${this.timeScale}×`}  veg ${this.eco.totalVegetation().toFixed(0)} · herb ${this.eco.totalHerbivores().toFixed(0)} · pred ${this.eco.totalPredators().toFixed(0)}`,
      `[K] pause [L] speed [J] skip · overlay: ${this.overlay.visible ? this.overlay.field : 'off'} ([O] toggle [I] field)`,
      `seeds ${this.seeds} · samples ${this.samples} — [X] gather [F] plant [C] clear [V] water [H] herbivores [Y] predators`,
      `energy ${bar(n.energy)} warmth ${bar(n.warmth)} food ${bar(n.food)} vitality ${bar(n.vitality)} — [E] eat${haz ? `  ⚠ ${haz}` : ''}`,
      `[B] region tools: ${this.regionUnlocked() ? (this.regionMode ? 'ON (broad)' : 'off') : 'locked'}`,
      ...(this.caughtUp ? [`⟳ ${this.caughtUp}`] : []),
      ...(this.lastAction ? [`» ${this.lastAction}`] : []),
    ];
    if (!this.controller.isLocked) {
      lines.push('click to capture mouse · WASD move · Space jump/up · Shift sprint/boost');
    }
    lines.push('[T] take off to system');
    return lines;
  }
}
