import * as THREE from 'three';
import type { AppScene } from './AppScene.ts';
import type { BloomSettings } from '../render/composer.ts';
import type { ColorGradeSettings } from '../render/colorGrade.ts';
import { deriveStarAt, derivePlanet } from '../universe/index.ts';
import { biomePalette } from '../palette/index.ts';
import { makeTerrain, ChunkManager, CHUNK_SIZE } from '../gen/terrain.ts';
import { FloraManager } from '../gen/flora.ts';
import { NodeManager } from '../gen/nodes.ts';
import { GuardianManager } from '../agents/guardians.ts';
import { RESOURCES, type ResourceType } from '../universe/resources.ts';
import { Compass, type CompassPing } from '../ui/compass.ts';
import { planetPath, loadDiff, saveDiff } from '../sim/persistence.ts';
import { emptyDiff, type PlanetDiff } from '../sim/planetDiff.ts';
import { BirdFlock, birdColor } from '../agents/boids.ts';
import { AnimalHerds } from '../agents/animals.ts';
import { FishSchool, fishColor } from '../agents/fish.ts';
import { SkyDome } from '../render/sky.ts';
import { NightSky } from '../render/nightSky.ts';
import { Moons } from '../render/moons.ts';
import { Weather } from '../render/weather.ts';
import { Water } from '../render/water.ts';
import { Viewmodel } from '../render/viewmodel.ts';
import { Spaceship } from '../render/spaceship.ts';
import { Effects } from '../render/effects.ts';
import { ShipTerminal } from '../ui/shipTerminal.ts';
import { CraftBench } from '../ui/craftBench.ts';
import { RECIPES, canCraft, doCraft, coldProtectionFor, airProtectionFor } from '../sim/crafting.ts';
import { planetHazards, type PlanetHazards } from '../sim/hazards.ts';
import { Reticle } from '../ui/reticle.ts';
import { Markers, type MarkerSpec } from '../ui/markers.ts';
import { SurfaceHud } from '../ui/surfaceHud.ts';
import { Objectives } from '../ui/objectives.ts';
import {
  progression, energyMaxFor, cargoCapFor, scanRangeFor, gunDamageFor, drillTierFor,
  healthMaxFor, shieldMaxFor, saveProgression, ensureMissions, acceptedMissions,
  completeMission, discover, grantXp, playerLevel, type Mission,
} from '../sim/progression.ts';
import { Notifications } from '../ui/notifications.ts';
import { CodexPanel } from '../ui/codexPanel.ts';
import { settings } from '../ui/settings.ts';
import { makeWeapons, type HeldItem, type WeaponCtx, type RayHit } from '../weapons/items.ts';
import { audio } from '../audio/audio.ts';
import { SurfaceController } from './controls/SurfaceController.ts';
import { touch, touchUI, type TouchAction } from '../ui/touchControls.ts';
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
  private readonly fish: FishSchool | null;
  private readonly herds: AnimalHerds;
  private readonly sky: SkyDome;
  private readonly nightSky: NightSky;
  private readonly moons: Moons;
  private readonly weather: Weather;
  private readonly water: Water | null;
  private readonly controller: SurfaceController;
  private readonly viewmodel = new Viewmodel();
  private readonly sampler: ReturnType<typeof makeTerrain>;

  // v3 weapons + effects.
  private readonly dom: HTMLElement;
  private readonly effects = new Effects();
  private readonly weaponWorld = new THREE.Group();
  private readonly weapons: HeldItem[];
  private weaponIndex = 0;
  private readonly raycaster = new THREE.Raycaster();
  private readonly aimDir = new THREE.Vector3();
  private readonly shake2 = new THREE.Vector2();

  // v3 Phase C: deposits, extraction, compass, inventory, persistence.
  private readonly diffKey: string;
  private readonly diff: PlanetDiff = emptyDiff();
  private readonly nodes: NodeManager;
  private readonly compass: Compass;
  private readonly inventory = new Map<string, number>();
  private cargoUsed = 0;
  private cargoCap = cargoCapFor();
  private drillTier = drillTierFor();
  private scanRange = scanRangeFor();
  private readonly drillReach = 9;
  private readonly groundColor: THREE.Color;
  private digMsgT = 0;

  // v3 Phase F: landed ship hub (trade + upgrade + recharge).
  private readonly ship = new Spaceship();
  private readonly terminal: ShipTerminal;
  private readonly bench: CraftBench;
  private readonly reticle: Reticle;
  private readonly markers: Markers;
  private readonly shud: SurfaceHud;
  private readonly objectives: Objectives;
  private readonly proj = new THREE.Vector3();
  private nearShip = false;
  private lastMsg = '';
  private pickupT = 0;
  // Movement-feel timers + scratch.
  private stepT = 0;
  private jetT = 0;
  private readonly rightV = new THREE.Vector3();
  private readonly feet = new THREE.Vector3();

  // v3 Phase D/E: guardians + non-lethal energy.
  private readonly guardians: GuardianManager;
  private energy = 100;
  private energyMax = 100;
  private readonly solarRegen: number; // from the star's luminosity
  private regenDelay = 0; // pause regen briefly after spending
  private hitFlash = 0;

  // Depth pass: real stakes (health + shield + downed/respawn), meta HUD, codex.
  private health = 100;
  private healthMax = 100;
  private shield = 40;
  private shieldMax = 40;
  private shieldRegenDelay = 0;
  private downed = 0; // >0 while respawning back at the ship
  private invuln = 0; // brief grace after respawn
  private readonly notify: Notifications;
  private readonly codex: CodexPanel;

  // Floating origin on XZ (Y stays near the ground).
  private originCX = 0;
  private originCZ = 0;

  // Sun + day/night cycle.
  private readonly sun: THREE.DirectionalLight;
  private readonly sunDir = new THREE.Vector3();
  private ambient!: THREE.AmbientLight;
  private readonly flashlight: THREE.SpotLight;
  private flashOn = false;
  private timeOfDay = 0; // 0..1 around the day
  private readonly dayLength = 210; // seconds per full day
  private sunAz = 0;
  private readonly dayHorizon = new THREE.Color();
  private readonly dayZenith = new THREE.Color();
  private readonly sunBase = new THREE.Color();
  private readonly nightHorizon = new THREE.Color(0x0a1430);
  private readonly nightZenith = new THREE.Color(0x04060f);
  private readonly nightAmbient = new THREE.Color(0x1a2440);
  private readonly warmSun = new THREE.Color(0xff8a4a);
  private readonly cTmpA = new THREE.Color();
  private readonly cTmpB = new THREE.Color();
  private readonly cTmpC = new THREE.Color();

  // Phase 2 hazards (warmth / air) — derived per planet; non-lethal, route into
  // the health/downed system. Phase 3 crafted protection fills the *Protection.
  private hazards!: PlanetHazards;
  private warmth = 100;
  private air = 100;
  private readonly warmthMax = 100;
  private readonly airMax = 100;
  private coldProtection = 0;
  private airProtection = 0;
  private hazardDmgT = 0;
  // Moonlight + dawn/dusk + weather-driven fog.
  private moonLight!: THREE.DirectionalLight;
  private fogBase = 0.002;
  private readonly duskColor = new THREE.Color(0xff7a38);

  constructor(
    universeSeed: number,
    cell: readonly [number, number, number],
    starIndex: number,
    planetIndex: number,
    dom: HTMLElement,
  ) {
    this.dom = dom;
    this.star = deriveStarAt(universeSeed, cell, starIndex);
    this.planet = derivePlanet(this.star, planetIndex);
    // Solar recharge scales with the star's luminosity — a derivation-pipeline payoff.
    this.solarRegen = clamp(2 + Math.pow(this.star.luminosity, 0.25) * 4, 2, 13);
    this.hazards = planetHazards(this.planet);
    this.coldProtection = coldProtectionFor();
    this.airProtection = airProtectionFor();
    const pal = biomePalette(this.planet, this.star);
    this.sampler = makeTerrain(this.planet, this.planet.seed, pal);
    this.groundColor = new THREE.Color(rgbToHex(pal.terrainLow));

    this.colorGrade = {
      tint: { r: lerp(1, pal.sun.r, 0.2), g: lerp(1, pal.sun.g, 0.2), b: lerp(1, pal.sun.b, 0.2) },
      exposure: 1.04,
      contrast: 1.08,
      saturation: 1.12,
    };

    // Sky / fog / background.
    this.scene.background = new THREE.Color(rgbToHex(pal.skyHorizon));
    this.fogBase = lerp(0.0016, 0.006, this.planet.atmosphere);
    this.scene.fog = new THREE.FogExp2(rgbToHex(pal.fog), this.fogBase);

    // Sun (seeded direction) + ambient.
    const rng = makeRNG(deriveSeed(this.planet.seed, 0x5a));
    const az = rng() * TAU;
    const el = lerp(20, 60, rng()) * DEG2RAD;
    const sunDir = new THREE.Vector3(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az));
    this.sunDir.copy(sunDir);
    const sun = new THREE.DirectionalLight(rgbToHex(pal.sun), 2.4);
    sun.position.copy(sunDir).multiplyScalar(200);
    // Shadows: a tight ortho frustum that follows the player.
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 600;
    const sc = sun.shadow.camera as THREE.OrthographicCamera;
    sc.left = -140;
    sc.right = 140;
    sc.top = 140;
    sc.bottom = -140;
    sc.updateProjectionMatrix();
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.6;
    this.sun = sun;
    this.scene.add(sun);
    this.scene.add(sun.target);
    this.ambient = new THREE.AmbientLight(rgbToHex(pal.skyZenith), 0.7);
    this.scene.add(this.ambient);

    // Day/night base colors + seeded starting time-of-day.
    this.dayHorizon.set(rgbToHex(pal.skyHorizon));
    this.dayZenith.set(rgbToHex(pal.skyZenith));
    this.sunBase.set(rgbToHex(pal.sun));
    this.sunAz = az;
    this.timeOfDay = 0.05 + rng() * 0.5; // start somewhere in daylight

    this.sky = new SkyDome(pal.skyHorizon, pal.skyZenith, pal.sun, sunDir);
    this.scene.add(this.sky.mesh);

    // Night sky (real galaxy starfield from this planet), derived moons + soft
    // moonlight, and light weather (rain/snow) that shifts fog + sun.
    this.nightSky = new NightSky(universeSeed, cell, starIndex, this.planet.axialTilt);
    this.scene.add(this.nightSky.group);
    this.moons = new Moons(this.planet.seed);
    this.scene.add(this.moons.group);
    this.moonLight = new THREE.DirectionalLight(0x9fb4e8, 0);
    this.moonLight.castShadow = false;
    this.scene.add(this.moonLight);
    this.scene.add(this.moonLight.target);
    this.weather = new Weather(this.planet);
    this.scene.add(this.weather.group);

    // Flashlight / headlamp (toggle with F) — for night and dark worlds.
    this.flashlight = new THREE.SpotLight(0xfff2d6, 0, 90, 0.55, 0.45, 1.0);
    this.flashlight.visible = false;
    this.scene.add(this.flashlight);
    this.scene.add(this.flashlight.target);

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
      // Per-planet flyer size: some worlds host small birds, others big pterosaurs.
      const flyRng = makeRNG(deriveSeed(this.planet.seed, 0xf17e));
      const flyerScale = lerp(1.2, 3.4, flyRng());
      const flyerCount = Math.round(lerp(110, 50, (flyerScale - 1.2) / 2.2)); // fewer, bigger
      this.birds = new BirdFlock(deriveSeed(this.planet.seed, 0xb1d5), flyerCount, birdColor(pal.foliage), heightAtLocal, flyerScale);
      this.scene.add(this.birds.mesh);
    } else {
      this.birds = null;
    }
    this.herds = new AnimalHerds(this.planet, this.planet.seed, pal, this.sampler, heightAtLocal);
    this.scene.add(this.herds.group);

    // Fish school on watery worlds.
    if (this.sampler.hasWater && !lifeless) {
      this.fish = new FishSchool(deriveSeed(this.planet.seed, 0xf15), 44, fishColor(pal.water), this.sampler.seaLevel, heightAtLocal);
      this.scene.add(this.fish.mesh);
    } else {
      this.fish = null;
    }

    // Effects + weapons.
    this.scene.add(this.effects.group);
    this.scene.add(this.weaponWorld);
    this.weapons = makeWeapons(this.weaponWorld);
    this.viewmodel.setItem(this.weapons[0]!.object);
    this.weapons[0]!.equip();

    // Deposits + compass + persisted depletion diff.
    this.diffKey = planetPath(universeSeed, cell, starIndex, planetIndex);
    this.nodes = new NodeManager(this.planet, this.planet.seed, this.star, this.sampler, this.diff);
    this.scene.add(this.nodes.group);
    const hudRoot = document.getElementById('hud') ?? document.body;
    this.compass = new Compass(hudRoot);

    // Landed ship hub at the descent point (abs origin 0,0).
    this.scene.add(this.ship.group);
    this.ship.group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
    this.terminal = new ShipTerminal(hudRoot);
    this.bench = new CraftBench(hudRoot);
    this.bench.onCraft = (id) => this.craftItem(id);
    this.reticle = new Reticle(hudRoot);
    this.markers = new Markers(hudRoot);
    this.shud = new SurfaceHud(hudRoot);
    this.objectives = new Objectives(hudRoot);
    this.notify = new Notifications(hudRoot);
    this.codex = new CodexPanel(hudRoot);
    this.terminal.onSell = () => this.sellCargo();
    this.terminal.onChange = () => this.applyProgression();
    this.terminal.inventoryOf = (id) => this.inventory.get(id) ?? 0;
    this.terminal.onTurnIn = (m) => this.turnInMission(m);
    ensureMissions();
    this.energyMax = energyMaxFor();
    this.energy = this.energyMax;
    this.healthMax = healthMaxFor();
    this.health = this.healthMax;
    this.shieldMax = shieldMaxFor();
    this.shield = this.shieldMax;

    // Discovery: catalogue this world on arrival (XP + toasts for firsts).
    progression.codex.planetsVisited += 1;
    this.discoverNotify('biomes', this.planet.biome, `biome: ${this.planet.biome}`);
    this.discoverNotify('starClasses', this.star.spectralClass.charAt(0), `star class ${this.star.spectralClass.charAt(0)}`);
    for (const a of this.herds.archetypes()) this.discoverNotify('creatures', a, `creature: ${a}`);

    // Guardians defend valuable deposits.
    this.guardians = new GuardianManager(this.planet.seed, this.sampler, this.diff, this.nodes.resourcePalette, pal);
    this.scene.add(this.guardians.group);
    this.guardians.onAttack = (dmg, at) => this.takeDamage(dmg, at);
    this.guardians.onKill = (type, amount, x, z) => {
      this.collect(type, amount, false);
      this.markers.showBanner(`GUARDIAN DOWN  ·  +${amount} ${type.name}`);
      audio.play('death', 0.8, this.panFor(this.feet.set(x, 0, z)));
      if (grantXp(30)) this.notify.push('LEVEL UP', 'reward');
      this.onGuardianKill();
    };

    void loadDiff(this.diffKey).then((d) => {
      if (d) {
        for (const [k, e] of d.cells) this.diff.cells.set(k, e);
        this.nodes.invalidate(); // re-stream so already-depleted nodes stay gone
        this.guardians.invalidate(); // ...and killed guardians stay dead
      }
    });

    // Prime the full view radius so the surface is present on the first frame.
    let guard = 0;
    while (!this.chunks.fullyLoaded && guard++ < 500) this.chunks.update(0, 0, 0, 0);

    window.addEventListener('keydown', this.onKeyDown);
    dom.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointerup', this.onPointerUp);
    dom.addEventListener('wheel', this.onWheel, { passive: true });
    window.addEventListener('pagehide', this.onPageHide);
  }

  private get current(): HeldItem {
    return this.weapons[this.weaponIndex]!;
  }

  private readonly raycast = (origin: THREE.Vector3, dir: THREE.Vector3, far: number): RayHit | null => {
    this.raycaster.set(origin, dir);
    this.raycaster.far = far;
    this.raycaster.near = 0;
    // Nodes + guardians first (few), then living things, then terrain behind them.
    const targets = this.nodes.meshes();
    for (const g of this.guardians.meshes()) targets.push(g);
    for (const m of this.herds.meshList()) targets.push(m);
    if (this.birds) targets.push(this.birds.mesh);
    if (this.fish) targets.push(this.fish.mesh);
    for (const m of this.flora.meshList()) targets.push(m);
    for (const c of this.chunks.group.children) targets.push(c);
    const hits = this.raycaster.intersectObjects(targets, false);
    if (hits.length === 0) return null;
    const h = hits[0]!;
    const normal = new THREE.Vector3(0, 1, 0);
    if (h.face) normal.copy(h.face.normal).transformDirection(h.object.matrixWorld);
    return { point: h.point.clone(), normal, distance: h.distance, object: h.object, instanceId: h.instanceId };
  };

  /** React to shooting the living/scenery world (birds, fish, herds, trees).
   *  Returns true if the hit object was one of these (so the caller stops). */
  private hitWildlife(hit: RayHit, kind: 'gun' | 'bomb' | 'drill'): boolean {
    if (!hit.object || hit.instanceId === undefined) return false;
    const power = kind === 'gun' ? gunDamageFor() : kind === 'bomb' ? 60 : 18;

    // Birds — knock the struck one out of the sky; flock scatters.
    if (this.birds && hit.object === this.birds.mesh) {
      const at = this.birds.hit(hit.instanceId);
      if (at) {
        this.effects.burst(at, new THREE.Color(0xffe0a0), 14, 6, 0.5, -10, 6);
        audio.play('impact', 0.7, this.panFor(at));
        this.harvest(RESOURCES.biomass!, 3, 6);
      }
      return true;
    }
    // Fish — float it belly-up to the surface.
    if (this.fish && hit.object === this.fish.mesh) {
      const at = this.fish.hit(hit.instanceId);
      if (at) {
        this.effects.burst(at, new THREE.Color(0xbfe6ff), 12, 5, 0.4, -2, 5);
        audio.play('impact', 0.6, this.panFor(at));
        this.harvest(RESOURCES.biomass!, 4, 6);
      }
      return true;
    }
    // Roaming creatures — wound or fell them.
    const creature = this.herds.hit(hit.object, hit.instanceId, power);
    if (creature) {
      this.effects.burst(creature.pos, new THREE.Color(0xff7a5a), creature.killed ? 22 : 10, 7, 0.6, -8, 7);
      audio.play(creature.killed ? 'death' : 'hurt', 0.7, this.panFor(creature.pos));
      const p = this.worldToScreen(creature.pos.clone().setY(creature.pos.y + 1.5));
      if (p.visible) this.markers.damageNumber(p.sx, p.sy, creature.killed ? '✕' : `${Math.round(power)}`, '#ff9a6a');
      if (creature.killed) this.harvest(RESOURCES.biomass!, 12, 12);
      return true;
    }
    // Trees / flora — fell them in a topple of leaves.
    const felled = this.flora.hit(hit.object, hit.instanceId);
    if (felled) {
      this.effects.burst(felled, new THREE.Color(0x9bd17a), 18, 6, 0.7, -5, 6);
      audio.play('impact', 0.5, this.panFor(felled));
      this.harvest(RESOURCES.wood!, 6, 6);
      return true;
    }
    return false;
  }

  /** Grant loot from a felled/harvested thing: collect the resource + a little XP. */
  private harvest(type: ResourceType, amount: number, xp: number): void {
    this.collect(type, amount, false);
    if (grantXp(xp)) this.notify.push('LEVEL UP', 'reward');
  }

  private readonly onHit = (hit: RayHit, kind: 'gun' | 'bomb' | 'drill', dt: number): void => {
    // Living world & scenery react to weapons fire. A direct gun hit on
    // wildlife is fully resolved here; a bomb still detonates (splash below).
    if (kind !== 'drill') {
      const wild = this.hitWildlife(hit, kind);
      if (wild && kind === 'gun') return;
    }

    // Guardians take damage from any tool; bombs also splash nearby ones.
    const guardian = GuardianManager.guardianOf(hit.object);
    if (kind === 'bomb') {
      this.guardians.damageNear(hit.point.x, hit.point.z, this.originCX, this.originCZ, 10, 38, this.effects);
    } else if (guardian) {
      const dmg = kind === 'gun' ? gunDamageFor() : 34 * dt;
      this.guardians.damage(guardian, dmg, this.effects);
      if (kind === 'gun') {
        this.reticle.markHit();
        const p = this.worldToScreen(guardian.mesh.position.clone().setY(guardian.mesh.position.y + 2));
        if (p.visible) this.markers.damageNumber(p.sx, p.sy, `${Math.round(dmg)}`, '#ff9a6a');
      }
      return;
    }

    const node = NodeManager.nodeOf(hit.object);
    if (node) {
      if (kind === 'drill') {
        if (this.drillTier >= node.type.hardness) {
          const r = this.nodes.extract(node, 26 * dt);
          this.collect(node.type, r.gained, r.depleted);
        } else {
          this.lastMsg = `${node.type.name}: too hard — needs drill tier ${node.type.hardness} (or crack it with a bomb)`;
        }
      } else if (kind === 'bomb') {
        const r = this.nodes.extract(node, node.maxRichness * 0.4); // explosive cracking
        this.collect(node.type, r.gained, r.depleted);
      }
      return;
    }

    // No ore node here — let the drill bite into the planet's crust itself.
    if (kind === 'drill' && this.isTerrain(hit.object)) this.drillGround(hit, dt);
  };

  private isTerrain(object: THREE.Object3D | null): boolean {
    return object !== null && this.chunks.group.children.includes(object);
  }

  /** Drill bare ground: kick up dirt, carve the surface, and collect regolith. */
  private drillGround(hit: RayHit, dt: number): void {
    this.effects.burst(hit.point, this.groundColor, 6, 5, 0.5, -12, 5);
    const r = RESOURCES.regolith!;
    const room = this.cargoCap - this.cargoUsed;
    if (room <= 0) {
      if (this.digMsgT <= 0) {
        this.digMsgT = 0.4;
        this.lastMsg = 'cargo full — return to ship to sell';
      }
      return;
    }
    this.collect(r, 7 * dt, false);
  }

  private collect(type: ResourceType, amount: number, depleted: boolean): void {
    if (amount <= 0) return;
    const room = this.cargoCap - this.cargoUsed;
    if (room <= 0) {
      this.lastMsg = 'cargo full — return to ship to sell';
      return;
    }
    const got = Math.min(amount, room);
    this.inventory.set(type.id, (this.inventory.get(type.id) ?? 0) + got);
    this.cargoUsed += got;
    this.objectives.complete('mine');
    this.discoverNotify('resources', type.id, `resource: ${type.name}`);
    if (this.pickupT <= 0) {
      this.pickupT = 0.25;
      audio.play(depleted ? 'extract' : 'pickup', 0.6);
    }
    this.lastMsg = `+${got.toFixed(0)} ${type.name} (cargo ${this.cargoUsed.toFixed(0)}/${this.cargoCap})`;
    if (depleted) saveDiff(this.diffKey, this.diff);
  }

  private buildCtx(): WeaponCtx {
    this.camera.getWorldDirection(this.aimDir);
    return {
      pos: this.camera.position,
      dir: this.aimDir,
      raycast: this.raycast,
      effects: this.effects,
      kick: (b, u, r) => this.viewmodel.addKick(b, u, r),
      onHit: this.onHit,
      spendEnergy: (amount) => {
        if (this.energy >= amount) {
          this.energy -= amount;
          if (amount > 0) this.regenDelay = 1.2;
          return true;
        }
        return false;
      },
    };
  }

  private switchWeapon(i: number): void {
    if (i === this.weaponIndex || i < 0 || i >= this.weapons.length) return;
    this.current.holster();
    this.weaponIndex = i;
    this.viewmodel.setItem(this.current.object);
    this.current.equip();
    this.viewmodel.addKick(0.12, -0.08, 0.25); // equip dip
    audio.play('equip');
  }

  private onPointerDown = (e: PointerEvent): void => {
    audio.init(); // unlock + load audio on first user gesture
    if (document.pointerLockElement !== this.dom || e.button !== 0) return;
    this.current.primaryDown(this.buildCtx());
  };

  /** Stereo pan [-1,1] for a sound at a local position, from camera-relative angle. */
  private panFor(localPos: THREE.Vector3): number {
    this.camera.getWorldDirection(this.aimDir);
    this.rightV.crossVectors(this.aimDir, this.camera.up).normalize();
    const dx = localPos.x - this.camera.position.x;
    const dz = localPos.z - this.camera.position.z;
    const len = Math.hypot(dx, dz) || 1;
    return clamp((this.rightV.x * dx + this.rightV.z * dz) / len, -1, 1);
  }
  private onPointerUp = (e: PointerEvent): void => {
    if (e.button === 0) this.current.primaryUp(this.buildCtx());
  };
  private onWheel = (e: WheelEvent): void => {
    if (document.pointerLockElement !== this.dom) return;
    const n = this.weapons.length;
    this.switchWeapon((this.weaponIndex + (e.deltaY > 0 ? 1 : n - 1)) % n);
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if ((e.key === 'Backspace' || e.key === 't' || e.key === 'T') && this.onTakeOff) {
      e.preventDefault();
      this.onTakeOff();
    } else if (e.key === '1') {
      this.switchWeapon(0);
    } else if (e.key === '2') {
      this.switchWeapon(1);
    } else if (e.key === '3') {
      this.switchWeapon(2);
    } else if (e.key === 'f' || e.key === 'F') {
      this.flashOn = !this.flashOn;
      this.flashlight.intensity = this.flashOn ? 120 : 0;
      this.flashlight.visible = this.flashOn;
      this.lastMsg = `flashlight ${this.flashOn ? 'on' : 'off'}`;
    } else if (e.key === 'r' || e.key === 'R') {
      this.doScan();
    } else if (e.key === 'b' || e.key === 'B') {
      this.toggleShipTerminal();
    } else if (e.key === 'c' || e.key === 'C') {
      this.codex.toggle();
    } else if (e.key === 'v' || e.key === 'V') {
      this.toggleBench();
    } else if (e.key === 'q' || e.key === 'Q') {
      this.useEnergyCell();
    }
  };

  private doScan(): void {
    const n = this.nodes.nearby(this.originCX, this.originCZ, this.camera.position.x, this.camera.position.z, this.scanRange).length;
    this.lastMsg = `scan: ${n} deposit${n === 1 ? '' : 's'} within scanner range`;
    audio.play('pickup', 0.5);
    this.objectives.complete('scan');
  }

  private toggleShipTerminal(): void {
    if (this.terminal.visible || this.nearShip) {
      this.terminal.toggle();
    } else {
      this.lastMsg = 'return to your ship to trade & upgrade';
    }
  }

  private toggleBench(): void {
    if (this.bench.isOpen || this.nearShip) {
      if (this.terminal.visible) this.terminal.toggle();
      this.bench.toggle(this.inventory);
    } else {
      this.lastMsg = 'return to your ship to craft gear';
    }
  }

  /** Craft a recipe from current cargo (meaningful at the ship). */
  private craftItem(id: string): void {
    const r = RECIPES.find((x) => x.id === id);
    if (!r) return;
    if (!canCraft(r, this.inventory)) {
      this.lastMsg = `can't craft ${r.name} — missing materials`;
      return;
    }
    const consumed = doCraft(r, this.inventory);
    this.cargoUsed = Math.max(0, this.cargoUsed - consumed);
    this.applyProgression();
    this.bench.refresh(this.inventory);
    this.markers.showBanner(`CRAFTED  ·  ${r.name}`);
    this.lastMsg = `crafted ${r.name}`;
    audio.play('equip', 0.8);
  }

  /** Spend a held energy cell to restore energy in the field. */
  private useEnergyCell(): void {
    if (progression.cells <= 0) {
      this.lastMsg = 'no energy cells — craft some at the ship';
      return;
    }
    progression.cells -= 1;
    this.energy = Math.min(this.energyMax, this.energy + 60);
    this.regenDelay = 0;
    saveProgression();
    this.markers.showBanner('ENERGY CELL  ·  +60 energy');
    audio.play('pickup', 0.7);
  }

  /** Hazard tick damage: straight to health (suits, not shields, stop this),
   *  and can trigger the downed/recover loop. */
  private hazardDamage(amount: number): void {
    if (this.invuln > 0 || this.downed > 0) return;
    this.health -= amount;
    this.hitFlash = Math.max(this.hitFlash, 0.3);
    if (this.health <= 0) {
      this.health = 0;
      this.beginDowned();
    }
  }

  /** Mobile console buttons for the surface. */
  touchActions(): TouchAction[] {
    return [
      {
        id: 'fire', label: 'FIRE', primary: true, color: 'rgba(230,90,90,0.5)',
        onDown: () => {
          audio.init();
          this.current.primaryDown(this.buildCtx());
        },
        onUp: () => this.current.primaryUp(this.buildCtx()),
      },
      {
        id: 'jump', label: 'JUMP', primary: true, color: 'rgba(90,150,230,0.5)',
        onDown: () => (touch.jump = true),
        onUp: () => (touch.jump = false),
      },
      { id: 'wpn', label: 'WPN', onDown: () => this.switchWeapon((this.weaponIndex + 1) % this.weapons.length) },
      { id: 'scan', label: 'SCAN', onDown: () => this.doScan() },
      { id: 'fly', label: 'FLY', onDown: () => this.controller.toggleMode() },
      { id: 'ship', label: 'SHIP', onDown: () => this.toggleShipTerminal() },
      { id: 'codex', label: 'CODEX', onDown: () => this.codex.toggle() },
      { id: 'craft', label: 'CRAFT', onDown: () => this.toggleBench() },
      { id: 'cell', label: 'CELL', onDown: () => this.useEnergyCell() },
      { id: 'lift', label: 'LIFT', onDown: () => this.onTakeOff?.() },
    ];
  }

  private readonly onPageHide = (): void => {
    saveDiff(this.diffKey, this.diff);
    saveProgression();
  };

  private cargoValue(): number {
    let v = 0;
    for (const [id, amt] of this.inventory) v += amt * (RESOURCES[id]?.value ?? 0);
    return v;
  }

  private sellCargo(): number {
    const v = this.cargoValue();
    progression.currency += Math.round(v);
    this.inventory.clear();
    this.cargoUsed = 0;
    saveProgression();
    this.markers.showBanner(`SOLD CARGO  ·  +${Math.round(v)}¢`);
    this.lastMsg = `sold cargo for ${Math.round(v)}¢`;
    this.objectives.complete('sell');
    return v;
  }

  /** Short label + progress for an accepted mission (objective tracker). */
  private missionLabel(m: Mission): string {
    if (m.kind === 'bounty') return `Hunt guardians ${m.progress}/${m.required} → ${m.reward}¢`;
    const name = RESOURCES[m.resource ?? '']?.name ?? m.resource;
    const have = Math.floor(this.inventory.get(m.resource ?? '') ?? 0);
    const verb = m.kind === 'harvest' ? 'Harvest' : 'Deliver';
    return `${verb} ${name} ${Math.min(have, m.required)}/${m.required} → ${m.reward}¢`;
  }

  /** Hand in a delivery/harvest mission from cargo (called by the terminal). */
  private turnInMission(m: Mission): boolean {
    if (m.kind === 'bounty' || !m.resource) return false;
    const have = this.inventory.get(m.resource) ?? 0;
    if (have < m.required) return false;
    this.inventory.set(m.resource, have - m.required);
    this.cargoUsed = Math.max(0, this.cargoUsed - m.required);
    completeMission(m);
    this.applyProgression();
    this.notify.push(`Mission complete · +${m.reward}¢ · +${m.rep} rep`, 'reward');
    this.markers.showBanner(`MISSION COMPLETE  ·  +${m.reward}¢`);
    return true;
  }

  /** Credit accepted bounty missions when a guardian falls. */
  private onGuardianKill(): void {
    for (const m of acceptedMissions()) {
      if (m.kind !== 'bounty') continue;
      m.progress += 1;
      if (m.progress >= m.required) {
        completeMission(m);
        this.applyProgression();
        this.notify.push(`Bounty complete · +${m.reward}¢ · +${m.rep} rep`, 'reward');
        this.markers.showBanner(`BOUNTY COMPLETE  ·  +${m.reward}¢`);
      }
    }
    saveProgression();
  }

  /** Record a discovery and toast it the first time it's seen. */
  private discoverNotify(category: 'biomes' | 'creatures' | 'resources' | 'starClasses', key: string, label: string): void {
    if (discover(category, key)) this.notify.push(`Discovered ${label} · +25 XP`, 'good');
  }

  /** Re-apply derived stats after an upgrade purchase. */
  private applyProgression(): void {
    this.energyMax = energyMaxFor();
    this.cargoCap = cargoCapFor();
    this.scanRange = scanRangeFor();
    this.drillTier = drillTierFor();
    this.coldProtection = coldProtectionFor();
    this.airProtection = airProtectionFor();
    const hm = healthMaxFor();
    if (hm > this.healthMax) this.health += hm - this.healthMax; // upgrade tops up
    this.healthMax = hm;
    const sm = shieldMaxFor();
    if (sm > this.shieldMax) this.shield += sm - this.shieldMax;
    this.shieldMax = sm;
  }

  /** Apply incoming damage to shield then health; trigger downed at zero. */
  private takeDamage(dmg: number, at: THREE.Vector3): void {
    if (this.invuln > 0 || this.downed > 0) return;
    this.hitFlash = 0.5;
    this.shieldRegenDelay = 3;
    audio.play('hurt', 0.8);
    audio.play('attack', 0.7, this.panFor(at));
    const absorbed = Math.min(this.shield, dmg);
    this.shield -= absorbed;
    const rest = dmg - absorbed;
    if (rest > 0) {
      this.health -= rest;
      if (this.health <= 0) {
        this.health = 0;
        this.beginDowned();
      }
    }
    this.lastMsg = this.shield > 0 ? `⚠ hit! shield −${Math.round(absorbed)}` : `⚠ hit! health −${Math.round(rest)}`;
  }

  private beginDowned(): void {
    this.downed = 1.8;
    this.controller.enabled = false;
    this.notify.push('You were downed — recovering at your ship…', 'warn');
    this.markers.showBanner('⚠ DOWNED');
    audio.play('death', 0.7);
  }

  /** Teleport back to the ship, restore vitals, drop a quarter of the cargo. */
  private respawn(): void {
    let lost = 0;
    for (const [id, amt] of this.inventory) {
      const keep = amt * 0.75;
      lost += amt - keep;
      this.inventory.set(id, keep);
    }
    this.cargoUsed = Math.max(0, this.cargoUsed - lost);
    const shipLX = -this.originCX * CHUNK_SIZE;
    const shipLZ = -this.originCZ * CHUNK_SIZE;
    this.camera.position.set(shipLX, this.sampler.heightAt(0, 0) + this.controller.eyeHeight, shipLZ);
    this.controller.placeOnGround();
    this.health = this.healthMax;
    this.shield = this.shieldMax;
    this.energy = this.energyMax;
    this.invuln = 2.5;
    this.controller.enabled = !this.terminal.visible && !this.codex.visible;
    if (lost > 0) this.notify.push(`Recovered at ship · lost ${Math.round(lost)} cargo`, 'warn');
  }

  /** Advance the day/night cycle: arc the sun, recolor sky/light/fog, gate solar. */
  private dayNightDaylight = 1;
  private updateDayNight(dt: number): void {
    this.timeOfDay = (this.timeOfDay + dt / this.dayLength) % 1;
    const theta = this.timeOfDay * TAU;
    const height = Math.sin(theta); // -1 (midnight) .. +1 (noon)
    const horiz = Math.cos(theta);
    this.sunDir.set(Math.cos(this.sunAz) * horiz, height, Math.sin(this.sunAz) * horiz).normalize();

    const daylight = clamp(height * 1.3 + 0.18, 0, 1);
    this.dayNightDaylight = daylight;
    // Warm the sun near the horizon (sunrise/sunset), white-ish at noon.
    const warmth = 1 - clamp(height * 2.2, 0, 1);
    this.cTmpC.copy(this.sunBase).lerp(this.warmSun, warmth * 0.8);

    // Directional sun.
    this.sun.color.copy(this.cTmpC);
    this.sun.intensity = Math.max(0.04, daylight * 2.6);
    this.sun.target.position.copy(this.camera.position);
    this.sun.position.copy(this.camera.position).addScaledVector(this.sunDir, 200);
    this.sun.castShadow = daylight > 0.08;

    // Ambient.
    this.ambient.color.copy(this.nightAmbient).lerp(this.dayZenith, daylight);
    this.ambient.intensity = lerp(0.22, 0.7, daylight);

    // Sky + fog + background.
    this.cTmpA.copy(this.nightHorizon).lerp(this.dayHorizon, daylight);
    this.cTmpB.copy(this.nightZenith).lerp(this.dayZenith, daylight);
    // Dawn/dusk: warm the horizon band while the sun rides low.
    const twilight = clamp(1 - Math.abs(height) * 3.0, 0, 1);
    this.cTmpA.lerp(this.duskColor, twilight * 0.5);
    this.sky.setColors(this.cTmpA, this.cTmpB, this.cTmpC);
    this.sky.setSunDir(this.sunDir);
    (this.scene.fog as THREE.FogExp2).color.copy(this.cTmpA);
    (this.scene.background as THREE.Color).copy(this.cTmpA);
  }

  private worldToScreen(v: THREE.Vector3): { sx: number; sy: number; visible: boolean } {
    this.proj.copy(v).project(this.camera);
    const W = window.innerWidth;
    const H = window.innerHeight;
    const visible = this.proj.z < 1 && Math.abs(this.proj.x) <= 1 && Math.abs(this.proj.y) <= 1;
    return { sx: (this.proj.x * 0.5 + 0.5) * W, sy: (-this.proj.y * 0.5 + 0.5) * H, visible };
  }

  update(dt: number): void {
    // Hit-stop slows gameplay briefly on solid hits (effects time itself on real dt).
    const sdt = dt * this.effects.timeFactor;

    this.controller.energyOK = this.energy > 1; // gates sprint/jetpack/throttle
    this.controller.update(sdt);

    // Floating-origin recenter on XZ (whole chunks).
    const sx = Math.round(this.camera.position.x / CHUNK_SIZE);
    const sz = Math.round(this.camera.position.z / CHUNK_SIZE);
    if (sx !== 0 || sz !== 0) {
      this.camera.position.x -= sx * CHUNK_SIZE;
      this.camera.position.z -= sz * CHUNK_SIZE;
      this.originCX += sx;
      this.originCZ += sz;
      this.birds?.shift(sx * CHUNK_SIZE, sz * CHUNK_SIZE);
      this.fish?.shift(sx * CHUNK_SIZE, sz * CHUNK_SIZE);
      this.herds.shift(sx * CHUNK_SIZE, sz * CHUNK_SIZE);
    }

    this.chunks.update(this.originCX, this.originCZ, this.originCX, this.originCZ);
    this.flora.update(this.originCX, this.originCZ, this.originCX, this.originCZ);
    this.flora.tick(sdt); // advance any felled-tree topples
    this.birds?.update(sdt, this.camera.position);
    this.fish?.update(sdt, this.camera.position);
    this.herds.update(sdt, this.camera.position);
    this.sky.follow(this.camera.position);
    this.updateDayNight(dt);

    // Celestial + weather: wheel/fade the real starfield, orbit + light the
    // moons, roll precipitation in/out (which thickens fog + dims the sun).
    this.weather.update(dt, this.camera.position);
    const wI = this.weather.intensity;
    this.nightSky.follow(this.camera.position);
    this.nightSky.setTime(this.timeOfDay, clamp(1 - this.dayNightDaylight * 1.5, 0, 1) * (1 - 0.7 * wI));
    this.moons.update(dt, this.sunDir, this.dayNightDaylight, this.camera.position);
    this.moonLight.intensity = this.moons.lightIntensity;
    this.moonLight.target.position.copy(this.camera.position);
    this.moonLight.position.copy(this.camera.position).addScaledVector(this.moons.lightDir, -200);
    this.ambient.intensity += this.moons.ambientBump;
    if (this.weather.kind !== 'none') {
      (this.scene.fog as THREE.FogExp2).density = this.fogBase * (1 + 1.6 * wI);
      this.sun.intensity *= 1 - 0.45 * wI;
    }
    // Flashlight tracks the camera, aimed forward.
    if (this.flashOn) {
      this.camera.getWorldDirection(this.aimDir);
      this.flashlight.position.copy(this.camera.position);
      this.flashlight.target.position.copy(this.camera.position).addScaledVector(this.aimDir, 12);
    }
    if (this.water) this.water.update(sdt, this.camera.position, this.sampler.seaLevel);

    // Deposits + guardians stream around the player.
    this.nodes.update(this.originCX, this.originCZ, this.originCX, this.originCZ);
    const playerAbsX = this.originCX * CHUNK_SIZE + this.camera.position.x;
    const playerAbsZ = this.originCZ * CHUNK_SIZE + this.camera.position.z;
    this.guardians.update(sdt, playerAbsX, playerAbsZ, this.originCX, this.originCZ);

    // Energy: spent by sprint/jetpack (tools spend via spendEnergy; hits drain
    // it). Regenerates after a short pause (passive + solar). Never lethal —
    // at zero, sprint/jetpack/tools are disabled and walking is throttled.
    if (this.controller.isSprinting) {
      this.energy -= 7 * sdt;
      this.regenDelay = 1.2;
    }
    if (this.controller.isJetpacking) {
      this.energy -= 15 * sdt;
      this.regenDelay = 1.2;
    }
    this.regenDelay -= sdt;
    if (this.regenDelay <= 0) this.energy += (4 + this.solarRegen * this.dayNightDaylight) * sdt;
    this.energy = clamp(this.energy, 0, this.energyMax);
    if (this.hitFlash > 0) this.hitFlash -= dt;

    // Health/shield: shield recharges after a few seconds out of combat; health
    // trickles back slowly (approachable). Downed → recover back at the ship.
    if (this.invuln > 0) this.invuln -= dt;
    this.shieldRegenDelay -= dt;
    if (this.downed <= 0) {
      if (this.shieldRegenDelay <= 0) this.shield = Math.min(this.shieldMax, this.shield + 14 * dt);
      this.health = Math.min(this.healthMax, this.health + 1.5 * dt);
    } else {
      this.downed -= dt;
      if (this.downed <= 0) this.respawn();
    }

    // Ship hub: it sits at the descent point (abs 0,0). Near it you recharge fast
    // and can open the trade/upgrade terminal — so cargo has to be hauled back.
    const shipLX = -this.originCX * CHUNK_SIZE;
    const shipLZ = -this.originCZ * CHUNK_SIZE;
    this.ship.group.position.set(shipLX, this.sampler.heightAt(0, 0) + 1.4, shipLZ);
    this.ship.setControls(0, 0.12);
    this.ship.update(sdt);
    this.nearShip = Math.hypot(this.camera.position.x - shipLX, this.camera.position.z - shipLZ) < 16;
    if (this.nearShip) {
      this.energy = Math.min(this.energyMax, this.energy + 70 * dt);
      this.health = Math.min(this.healthMax, this.health + 45 * dt);
      this.shield = Math.min(this.shieldMax, this.shield + 45 * dt);
      this.regenDelay = 0;
    }

    // Environmental hazards: cold drains Warmth, toxic drains Air. Off-hazard or
    // near the ship they recover. A bottomed-out meter bites health directly
    // (bypassing shields — suits, not armor, stop this) and can down you, feeding
    // the existing recover-at-ship loop. Crafted gear negates the drain.
    const coldDrain = this.hazards.cold * (1 - this.coldProtection) * 5.0;
    const toxDrain = this.hazards.toxic * (1 - this.airProtection) * 4.2;
    if (this.nearShip) {
      this.warmth = Math.min(this.warmthMax, this.warmth + 60 * dt);
      this.air = Math.min(this.airMax, this.air + 60 * dt);
    } else {
      this.warmth = clamp(this.warmth + (coldDrain > 0 ? -coldDrain : 18) * dt, 0, this.warmthMax);
      this.air = clamp(this.air + (toxDrain > 0 ? -toxDrain : 18) * dt, 0, this.airMax);
    }
    let hazPenalty = 0;
    if (coldDrain > 0 && this.warmth <= 0) hazPenalty += 7;
    if (toxDrain > 0 && this.air <= 0) hazPenalty += 8;
    this.hazardDmgT -= dt;
    if (hazPenalty > 0 && this.hazardDmgT <= 0) {
      this.hazardDmgT = 0.5;
      this.hazardDamage(hazPenalty * 0.5);
      this.lastMsg =
        this.warmth <= 0 && this.air <= 0 ? '⚠ freezing & suffocating — retreat to the ship!'
          : this.warmth <= 0 ? '⚠ freezing — get to the ship!'
            : '⚠ no breathable air — retreat!';
    }

    if (this.terminal.visible) this.terminal.setSellValue(this.cargoValue());

    // --- Movement feel ---
    // FOV kick on sprint/jetpack.
    const targetFov = settings.fov + (this.controller.isSprinting ? 6 : 0) + (this.controller.isJetpacking ? 4 : 0);
    this.camera.fov += (targetFov - this.camera.fov) * (1 - Math.exp(-dt * 8));
    this.camera.updateProjectionMatrix();
    // Footsteps.
    this.stepT -= dt;
    if (this.controller.isMoving && !this.controller.airborne) {
      if (this.stepT <= 0) {
        this.stepT = this.controller.isSprinting ? 0.3 : 0.46;
        audio.play('step', 0.35);
      }
    } else {
      this.stepT = Math.min(this.stepT, 0.12);
    }
    // Jetpack exhaust + sound.
    if (this.controller.isJetpacking) {
      this.feet.copy(this.camera.position).y -= 1.4;
      this.effects.burst(this.feet, new THREE.Color(0x8fd6ff), 4, 5, 0.3, -3, 4);
      this.jetT -= dt;
      if (this.jetT <= 0) {
        this.jetT = 0.16;
        audio.play('jet', 0.22);
      }
    }
    // Landing thud.
    const impact = this.controller.consumeLanding();
    if (impact > 6) {
      audio.play('land', clamp(impact / 16, 0.3, 1));
      this.effects.addShake(clamp(impact * 0.004, 0, 0.08));
    }

    // World-space markers over deposits + guardians (hidden in the menu).
    const specs: MarkerSpec[] = [];
    if (!this.terminal.visible) {
      const near = this.nodes.nearby(this.originCX, this.originCZ, this.camera.position.x, this.camera.position.z, this.scanRange);
      for (let i = 0; i < Math.min(16, near.length); i++) {
        const { node, dist } = near[i]!;
        const p = this.worldToScreen(node.mesh.position);
        if (p.visible) specs.push({ sx: p.sx, sy: p.sy, label: `${node.type.name} ${Math.round(dist)}m`, color: `#${node.type.color.toString(16).padStart(6, '0')}`, kind: 'deposit' });
      }
      for (const gm of this.guardians.meshes()) {
        const d = this.camera.position.distanceTo(gm.position);
        if (d > 80) continue;
        const p = this.worldToScreen(gm.position.clone().setY(gm.position.y + 2.5));
        if (p.visible) specs.push({ sx: p.sx, sy: p.sy, label: `${Math.round(d)}m`, color: '#ff5a4a', kind: 'guardian' });
      }
    }
    this.markers.setMarkers(specs);
    this.markers.update(dt);

    // Onboarding objective advancement.
    if (this.nodes.nearby(this.originCX, this.originCZ, this.camera.position.x, this.camera.position.z, this.drillReach).length > 0) {
      this.objectives.complete('approach');
    }
    if (this.nearShip && this.cargoUsed > 0) this.objectives.complete('ship');
    this.objectives.update(dt);

    // Styled HUD.
    const menuOpen = this.terminal.visible || this.codex.visible || this.bench.isOpen;
    const hint = this.downed > 0
      ? 'downed — recovering at your ship…'
      : !this.controller.isLocked && !touch.enabled
        ? 'click to capture mouse'
        : this.nearShip
          ? '◈ at ship — recharging · trade & upgrade'
          : this.lastMsg;
    this.shud.set({
      energy: this.energy,
      energyMax: this.energyMax,
      health: this.health,
      healthMax: this.healthMax,
      shield: this.shield,
      shieldMax: this.shieldMax,
      cargo: this.cargoUsed,
      cargoCap: this.cargoCap,
      currency: progression.currency,
      level: playerLevel(),
      reputation: progression.reputation,
      weapon: this.current.name,
      drillTier: this.drillTier,
      scanRange: this.scanRange,
      nearShip: this.nearShip,
      hint,
      warmth: this.warmth,
      warmthMax: this.warmthMax,
      air: this.air,
      airMax: this.airMax,
      showWarmth: this.hazards.cold > 0.04,
      showAir: this.hazards.toxic > 0.04,
      cells: progression.cells,
    });
    this.shud.setVisible(!menuOpen);
    // Objective tracker: accepted missions with live progress.
    this.notify.setObjectives(acceptedMissions().map((m) => ({ text: this.missionLabel(m) })));
    this.notify.setVisible(!menuOpen);
    this.notify.update(dt);
    touchUI.current?.block('terminal', this.terminal.visible);
    touchUI.current?.block('codex', this.codex.visible);
    touchUI.current?.block('bench', this.bench.isOpen);
    // Keep movement frozen while a menu is open or while downed (covers closing
    // via the in-menu button, which bypasses the key handler).
    this.controller.enabled = !menuOpen && this.downed <= 0;

    // HUD reticle: damage vignette from recent hits + low health; hide crosshair in menu.
    const dmg = Math.max(this.hitFlash / 0.5, this.health < this.healthMax * 0.3 ? 0.45 : 0);
    this.reticle.update(dt, dmg);
    this.reticle.setVisible(!menuOpen);

    // Weapons (aim from the clean camera orientation before shake).
    this.current.update(sdt, this.buildCtx());
    this.effects.update(dt); // real dt so hit-stop can elapse
    if (this.pickupT > 0) this.pickupT -= dt;
    if (this.digMsgT > 0) this.digMsgT -= dt;

    // Compass: nearby deposits by relative bearing.
    const fx = this.aimDir.x;
    const fz = this.aimDir.z;
    const pings: CompassPing[] = this.nodes
      .nearby(this.originCX, this.originCZ, this.camera.position.x, this.camera.position.z, this.scanRange)
      .map(({ node, dx, dz, dist }) => ({
        angle: Math.atan2(fx * dz - fz * dx, fx * dx + fz * dz),
        dist,
        color: node.type.color,
        near: dist < this.drillReach,
      }));
    this.compass.render(pings);

    // First-person viewmodel sway/bob.
    const sway = this.controller.sway;
    this.viewmodel.update(sdt, {
      moving: this.controller.isMoving,
      swayX: sway.x,
      swayY: sway.y,
      speed01: this.controller.speed01,
    });

    // Screen shake (rotation jitter; overwritten next frame by the controller).
    const sh = this.effects.getShake(this.shake2);
    if (sh.x !== 0 || sh.y !== 0) {
      this.camera.rotateX(sh.x);
      this.camera.rotateY(sh.y);
    }
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
    this.dom.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointerup', this.onPointerUp);
    this.dom.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('pagehide', this.onPageHide);
    saveDiff(this.diffKey, this.diff); // persist depletion on leave
    audio.stopLoop();
    audio.stopAmbient();
    for (const w of this.weapons) w.dispose();
    this.effects.dispose();
    saveProgression();
    this.nodes.dispose();
    this.guardians.dispose();
    this.compass.dispose();
    this.ship.dispose();
    this.terminal.dispose();
    this.bench.dispose();
    this.reticle.dispose();
    this.markers.dispose();
    this.shud.dispose();
    this.objectives.dispose();
    this.notify.dispose();
    this.codex.dispose();
    this.controller.dispose();
    this.chunks.dispose();
    this.flora.dispose();
    this.birds?.dispose();
    this.fish?.dispose();
    this.herds.dispose();
    this.sky.dispose();
    this.nightSky.dispose();
    this.moons.dispose();
    this.weather.dispose();
    this.water?.dispose();
    this.viewmodel.dispose();
  }

  hudLines(): string[] {
    // Game stats live in the styled SurfaceHud; this is just minimal context.
    const p = this.planet;
    const s = this.star;
    return [`${p.biome}${p.inHabitableZone ? ' (HZ)' : ''} · star ${s.spectralClass} · gravity ${p.gravity.toFixed(2)}g`];
  }
}
