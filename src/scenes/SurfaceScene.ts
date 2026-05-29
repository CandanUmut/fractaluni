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
import { SkyDome } from '../render/sky.ts';
import { Water } from '../render/water.ts';
import { Viewmodel } from '../render/viewmodel.ts';
import { Spaceship } from '../render/spaceship.ts';
import { Effects } from '../render/effects.ts';
import { ShipTerminal } from '../ui/shipTerminal.ts';
import { Reticle } from '../ui/reticle.ts';
import { progression, energyMaxFor, cargoCapFor, scanRangeFor, gunDamageFor, drillTierFor, saveProgression } from '../sim/progression.ts';
import { makeWeapons, type HeldItem, type WeaponCtx, type RayHit } from '../weapons/items.ts';
import { audio } from '../audio/audio.ts';
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

  // v3 Phase F: landed ship hub (trade + upgrade + recharge).
  private readonly ship = new Spaceship();
  private readonly terminal: ShipTerminal;
  private readonly reticle: Reticle;
  private nearShip = false;
  private lastMsg = '';
  private pickupT = 0;

  // v3 Phase D/E: guardians + non-lethal energy.
  private readonly guardians: GuardianManager;
  private energy = 100;
  private energyMax = 100;
  private readonly solarRegen: number; // from the star's luminosity
  private regenDelay = 0; // pause regen briefly after spending
  private hitFlash = 0;

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
    this.dom = dom;
    this.star = deriveStarAt(universeSeed, cell, starIndex);
    this.planet = derivePlanet(this.star, planetIndex);
    // Solar recharge scales with the star's luminosity — a derivation-pipeline payoff.
    this.solarRegen = clamp(2 + Math.pow(this.star.luminosity, 0.25) * 4, 2, 13);
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
    this.terminal = new ShipTerminal(hudRoot);
    this.reticle = new Reticle(hudRoot);
    this.terminal.onSell = () => this.sellCargo();
    this.terminal.onChange = () => this.applyProgression();
    this.energyMax = energyMaxFor();
    this.energy = this.energyMax;
    // Guardians defend valuable deposits.
    this.guardians = new GuardianManager(this.planet.seed, this.sampler, this.diff, this.nodes.resourcePalette, pal);
    this.scene.add(this.guardians.group);
    this.guardians.onAttack = (dmg) => {
      this.energy = Math.max(0, this.energy - dmg);
      this.hitFlash = 0.4;
      this.lastMsg = `⚠ hit! energy −${dmg}`;
    };
    this.guardians.onKill = (type, amount, x, z) => {
      this.collect(type, amount, false);
      this.lastMsg = `guardian down — looted ${amount} ${type.name}`;
      void x;
      void z;
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
    // Nodes + guardians first (few), then terrain behind them.
    const targets = this.nodes.meshes();
    for (const g of this.guardians.meshes()) targets.push(g);
    for (const c of this.chunks.group.children) targets.push(c);
    const hits = this.raycaster.intersectObjects(targets, false);
    if (hits.length === 0) return null;
    const h = hits[0]!;
    const normal = new THREE.Vector3(0, 1, 0);
    if (h.face) normal.copy(h.face.normal).transformDirection(h.object.matrixWorld);
    return { point: h.point.clone(), normal, distance: h.distance, object: h.object };
  };

  private readonly onHit = (hit: RayHit, kind: 'gun' | 'bomb' | 'drill', dt: number): void => {
    // Guardians take damage from any tool; bombs also splash nearby ones.
    const guardian = GuardianManager.guardianOf(hit.object);
    if (kind === 'bomb') {
      this.guardians.damageNear(hit.point.x, hit.point.z, this.originCX, this.originCZ, 10, 38, this.effects);
    } else if (guardian) {
      this.guardians.damage(guardian, kind === 'gun' ? gunDamageFor() : 34 * dt, this.effects);
      if (kind === 'gun') this.reticle.markHit();
      return;
    }

    const node = NodeManager.nodeOf(hit.object);
    if (!node) return;
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
  };

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
    } else if (e.key === 'r' || e.key === 'R') {
      const n = this.nodes.nearby(this.originCX, this.originCZ, this.camera.position.x, this.camera.position.z, this.scanRange).length;
      this.lastMsg = `scan: ${n} deposit${n === 1 ? '' : 's'} within scanner range`;
      audio.play('pickup', 0.5);
    } else if (e.key === 'b' || e.key === 'B') {
      if (this.terminal.visible || this.nearShip) {
        this.terminal.toggle();
        this.controller.enabled = !this.terminal.visible; // freeze movement in the menu
      } else {
        this.lastMsg = 'return to your ship to trade & upgrade';
      }
    }
  };

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
    this.lastMsg = `sold cargo for ${Math.round(v)}¢`;
    return v;
  }

  /** Re-apply derived stats after an upgrade purchase. */
  private applyProgression(): void {
    this.energyMax = energyMaxFor();
    this.cargoCap = cargoCapFor();
    this.scanRange = scanRangeFor();
    this.drillTier = drillTierFor();
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
      this.herds.shift(sx * CHUNK_SIZE, sz * CHUNK_SIZE);
    }

    this.chunks.update(this.originCX, this.originCZ, this.originCX, this.originCZ);
    this.flora.update(this.originCX, this.originCZ, this.originCX, this.originCZ);
    this.birds?.update(sdt, this.camera.position);
    this.herds.update(sdt, this.camera.position);
    this.sky.follow(this.camera.position);
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
    if (this.regenDelay <= 0) this.energy += (4 + this.solarRegen) * sdt;
    this.energy = clamp(this.energy, 0, this.energyMax);
    if (this.hitFlash > 0) this.hitFlash -= dt;

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
      this.regenDelay = 0;
    }
    if (this.terminal.visible) this.terminal.setSellValue(this.cargoValue());

    // HUD reticle: damage vignette from recent hits + low energy; hide crosshair in menu.
    const dmg = Math.max(this.hitFlash / 0.4, this.energy <= 1 ? 0.4 : 0);
    this.reticle.update(dt, dmg);
    this.reticle.setVisible(!this.terminal.visible);

    // Weapons (aim from the clean camera orientation before shake).
    this.current.update(sdt, this.buildCtx());
    this.effects.update(dt); // real dt so hit-stop can elapse
    if (this.pickupT > 0) this.pickupT -= dt;

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
    for (const w of this.weapons) w.dispose();
    this.effects.dispose();
    saveProgression();
    this.nodes.dispose();
    this.guardians.dispose();
    this.compass.dispose();
    this.ship.dispose();
    this.terminal.dispose();
    this.reticle.dispose();
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
      lines.push('click to capture mouse · WASD move · Shift sprint · Space jump/jetpack');
    }
    lines.push(`weapon: ${this.current.name}  ·  [1] gun  [2] bomb  [3] drill  · LMB use · [R] scan`);
    const ebars = Math.round((this.energy / this.energyMax) * 10);
    const eState = this.energy <= 1 ? '  DEPLETED — retreat / recharge' : this.hitFlash > 0 ? '  ⚠' : '';
    lines.push(`energy ${'█'.repeat(ebars)}${'░'.repeat(10 - ebars)} ${this.energy.toFixed(0)}${eState}`);
    lines.push(`cargo ${this.cargoUsed.toFixed(0)}/${this.cargoCap}  ·  ${progression.currency}¢  ·  drill T${this.drillTier}${this.inventoryText()}`);
    lines.push(this.nearShip ? '◈ at ship — recharging · [B] trade & upgrade' : '[B] ship terminal (return to ship)');
    if (this.lastMsg) lines.push(`» ${this.lastMsg}`);
    lines.push('[T] take off to system');
    return lines;
  }

  private inventoryText(): string {
    const parts: string[] = [];
    for (const [id, amt] of this.inventory) {
      if (amt > 0) parts.push(`${RESOURCES[id]?.name ?? id} ${amt.toFixed(0)}`);
    }
    return parts.length ? `  ·  ${parts.join(' · ')}` : '';
  }
}
