import * as THREE from 'three';
import type { AppScene } from './AppScene.ts';
import type { BloomSettings } from '../render/composer.ts';
import { FlyController } from './controls/FlyController.ts';
import { Spaceship } from '../render/spaceship.ts';
import { Missiles } from '../render/missiles.ts';
import { Meteors } from '../render/meteors.ts';
import { Hostiles } from '../render/hostiles.ts';
import { Effects } from '../render/effects.ts';
import { progression, saveProgression } from '../sim/progression.ts';
import { deriveStarAt, deriveSystem } from '../universe/index.ts';
import { planetResources, planetDanger } from '../universe/resources.ts';
import { planetHazards } from '../sim/hazards.ts';
import { audio } from '../audio/audio.ts';
import { biomePalette } from '../palette/index.ts';
import { rgbToHex, scaleRGB } from '../core/color.ts';
import { clamp, TAU } from '../core/math.ts';
import { makeRNG } from '../core/rng.ts';
import { deriveSeed } from '../core/hash.ts';
import type { PlanetProfile, StarProfile } from '../universe/types.ts';
import { touch, type TouchAction } from '../ui/touchControls.ts';

const ORBIT_SCALE = 16; // world units per AU
const ORBIT_BASE = 14;

interface PlanetBody {
  mesh: THREE.Mesh;
  profile: PlanetProfile;
  orbitWorld: number;
  angularSpeed: number;
  phase: number;
  worldRadius: number;
  selectDist: number;
}

/** A single star system: emissive star, seeded planets orbiting in real time.
 *  Fly to a planet and press Enter to descend; Backspace returns to the galaxy. */
export class SystemScene implements AppScene {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly bloom: BloomSettings = { strength: 1.0, radius: 0.8, threshold: 0.5 };

  onSelectPlanet: ((planetIndex: number) => void) | null = null;
  onBack: (() => void) | null = null;

  private readonly star: StarProfile;
  private readonly bodies: PlanetBody[] = [];
  private readonly controller: FlyController;
  private readonly highlight: THREE.Mesh;
  private readonly ship = new Spaceship();
  private missiles!: Missiles;
  private enemyShots!: Missiles;
  private readonly effects = new Effects();
  private meteors!: Meteors;
  private hostiles!: Hostiles;
  private playRadius = 200;
  private hull = 100;
  private readonly hullMax = 100;
  private combatMsg = '';
  private combatMsgT = 0;
  private readonly shake = new THREE.Vector2();
  private readonly camOffset = new THREE.Vector3();
  private readonly muzzle = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3();
  private readonly dom: HTMLElement;
  private missileSpeed = 360;
  private starWorldR = 5;
  private engineOn = false;
  private time = 0;
  private candidate: PlanetBody | null = null;
  private readonly disposables: { dispose(): void }[] = [];

  constructor(
    universeSeed: number,
    cell: readonly [number, number, number],
    starIndex: number,
    dom: HTMLElement,
  ) {
    this.dom = dom;
    this.star = deriveStarAt(universeSeed, cell, starIndex);
    const planets = deriveSystem(this.star);

    this.scene.background = new THREE.Color(0x03040a);

    // Backdrop of fixed faraway stars (deterministic, cheap ambiance).
    this.scene.add(this.makeBackdrop());

    // Central star.
    const starWorldR = clamp(2.5 + this.star.radius * 0.6, 2.5, 10);
    this.starWorldR = starWorldR;
    const starColor = rgbToHex(scaleRGB(this.star.color, 1.7));
    const starMat = new THREE.MeshBasicMaterial({ color: starColor });
    const starGeo = new THREE.IcosahedronGeometry(starWorldR, 3);
    const starMesh = new THREE.Mesh(starGeo, starMat);
    this.scene.add(starMesh);
    this.disposables.push(starGeo, starMat);

    // Lighting: point light at the star (no distance decay for even, stylized
    // lighting across the system) + faint ambient.
    const light = new THREE.PointLight(rgbToHex(this.star.color), 2.4, 0, 0);
    starMesh.add(light);
    this.scene.add(new THREE.AmbientLight(0x223044, 0.5));

    // Planets + orbit rings.
    for (const p of planets) {
      this.addPlanet(p);
    }

    // Camera framing the whole system.
    const outer = this.bodies.length
      ? this.bodies[this.bodies.length - 1]!.orbitWorld
      : 80;
    this.camera = new THREE.PerspectiveCamera(65, 1, 0.1, outer * 4 + 3000);
    this.camera.position.set(0, outer * 0.55, outer * 1.15);
    this.camera.lookAt(0, 0, 0);

    // Ship spawns out near the system edge, facing inward toward the star.
    this.ship.group.position.set(0, outer * 0.32, outer * 1.05);
    this.ship.group.lookAt(0, 0, 0);
    this.scene.add(this.ship.group);

    // Selection ring.
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xbfe0ff,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.highlight = new THREE.Mesh(new THREE.RingGeometry(1, 1.18, 32), ringMat);
    this.highlight.visible = false;
    this.scene.add(this.highlight);
    this.disposables.push(this.highlight.geometry, ringMat);

    this.controller = new FlyController(this.ship.group, dom);
    this.controller.baseSpeed = clamp(outer * 0.25, 30, 400);
    this.missileSpeed = this.controller.baseSpeed * 1.8 + 120;

    // Combat: drifting meteors + enemy raiders to shoot for salvage, an effects
    // pool for explosions, and a red enemy-projectile pool that fires back.
    this.playRadius = clamp(outer * 1.15, 140, 900);
    this.scene.add(this.effects.group);
    this.missiles = new Missiles(this.scene);
    this.enemyShots = new Missiles(this.scene, { bodyColor: 0xff5a4a, flameColor: 0xff6a4a, blastColor: 0xff6a4a, silent: true, cooldown: 0.1 });
    this.meteors = new Meteors(this.star.seed, 9, this.playRadius);
    this.scene.add(this.meteors.group);
    this.hostiles = new Hostiles(this.star.seed, 3, this.playRadius);
    this.scene.add(this.hostiles.group);
    this.hostiles.onFire = (o, d) => this.enemyShots.fire(o, d, this.missileSpeed * 0.5);

    window.addEventListener('keydown', this.onKeyDown);
    dom.addEventListener('pointerdown', this.onPointerDown);
  }

  // Left mouse (once the pointer is captured) fires the ship's missiles.
  private onPointerDown = (e: PointerEvent): void => {
    if (e.button === 0 && document.pointerLockElement === this.dom) this.fireMissiles();
  };

  private fireMissiles(): void {
    if (!this.missiles.ready) return;
    this.ship.group.getWorldDirection(this.fwd);
    for (const side of [-1, 1]) {
      this.ship.muzzleWorld(side, this.muzzle);
      this.missiles.fire(this.muzzle, this.fwd, this.missileSpeed);
    }
  }

  /** Credit salvage from a destroyed meteor/raider and flash a status line. */
  private awardSalvage(amount: number, msg: string): void {
    progression.currency += amount;
    saveProgression();
    this.combatMsg = `${msg} · +${amount}¢`;
    this.combatMsgT = 3;
  }

  /** Enemy fire chips the ship's hull; depletion falls back to the system edge. */
  private takeHit(dmg: number): void {
    this.hull -= dmg;
    this.effects.addShake(0.05);
    this.combatMsg = `⚠ hull hit · ${Math.max(0, Math.round(this.hull))}/${this.hullMax}`;
    this.combatMsgT = 2;
    if (this.hull <= 0) this.respawnShip();
  }

  private respawnShip(): void {
    this.hull = this.hullMax;
    const penalty = Math.min(progression.currency, 30);
    progression.currency -= penalty;
    saveProgression();
    const r = this.playRadius * 1.2;
    this.ship.group.position.set(0, r * 0.3, r);
    this.ship.group.lookAt(0, 0, 0);
    this.combatMsg = `hull breached — fell back to system edge · −${penalty}¢`;
    this.combatMsgT = 4;
  }

  private addPlanet(p: PlanetProfile): void {
    const pal = biomePalette(p, this.star);
    const worldRadius = clamp(0.5 + p.radius * 0.22, 0.5, 3.2);
    const orbitWorld = ORBIT_BASE + p.orbitalRadius * ORBIT_SCALE;

    const geo = new THREE.IcosahedronGeometry(worldRadius, 1);
    const mat = new THREE.MeshStandardMaterial({
      color: rgbToHex(pal.surface),
      flatShading: true,
      roughness: 0.9,
      metalness: 0.0,
    });
    if (p.biome === 'molten') {
      mat.emissive = new THREE.Color(rgbToHex(pal.terrainLow));
      mat.emissiveIntensity = 0.7;
    }
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = false;
    this.scene.add(mesh);
    this.disposables.push(geo, mat);

    // Orbit ring in the XZ plane.
    const ring = this.makeOrbitRing(orbitWorld);
    this.scene.add(ring);

    // Angular speed: Kepler-ish (inner faster), clamped to a watchable range.
    const angularSpeed = clamp(0.5 / p.orbitalPeriod, 0.03, 1.0);

    this.bodies.push({
      mesh,
      profile: p,
      orbitWorld,
      angularSpeed,
      phase: p.orbitalPhase,
      worldRadius,
      selectDist: worldRadius * 4 + 14,
    });
  }

  private makeOrbitRing(radius: number): THREE.Line {
    const segs = 128;
    const pts = new Float32Array((segs + 1) * 3);
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * TAU;
      pts[i * 3] = Math.cos(a) * radius;
      pts[i * 3 + 1] = 0;
      pts[i * 3 + 2] = Math.sin(a) * radius;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
    const mat = new THREE.LineBasicMaterial({ color: 0x2a3a5a, transparent: true, opacity: 0.5 });
    this.disposables.push(geo, mat);
    return new THREE.Line(geo, mat);
  }

  private makeBackdrop(): THREE.Points {
    const rng = makeRNG(deriveSeed(this.star.seed, 0xbac));
    const n = 700;
    const pos = new Float32Array(n * 3);
    const R = 9000;
    for (let i = 0; i < n; i++) {
      // Uniform-ish on a sphere shell.
      const u = rng() * 2 - 1;
      const t = rng() * TAU;
      const r = Math.sqrt(1 - u * u);
      pos[i * 3] = Math.cos(t) * r * R;
      pos[i * 3 + 1] = u * R;
      pos[i * 3 + 2] = Math.sin(t) * r * R;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color: 0x8aa0c0, size: 18, sizeAttenuation: true });
    this.disposables.push(geo, mat);
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    return pts;
  }

  private chartEl: HTMLDivElement | null = null;

  private onKeyDown = (e: KeyboardEvent): void => {
    if ((e.key === 'Backspace' || e.key === 'b' || e.key === 'B') && this.onBack) {
      e.preventDefault();
      this.onBack();
    } else if (e.key === 'Enter') {
      this.descendCandidate();
    } else if (e.key === 'm' || e.key === 'M') {
      this.toggleChart();
    }
  };

  private descendCandidate(): void {
    if (this.candidate && this.onSelectPlanet) this.onSelectPlanet(this.candidate.profile.index);
  }

  /** Mobile console buttons for system flight. */
  touchActions(): TouchAction[] {
    return [
      { id: 'fire', label: 'FIRE', primary: true, color: 'rgba(230,90,90,0.5)', onDown: () => this.fireMissiles() },
      { id: 'land', label: 'LAND', primary: true, color: 'rgba(120,200,120,0.5)', onDown: () => this.descendCandidate() },
      { id: 'back', label: 'BACK', color: 'rgba(200,120,120,0.5)', onDown: () => this.onBack?.() },
      { id: 'chart', label: 'CHART', onDown: () => this.toggleChart() },
      { id: 'up', label: 'UP', onDown: () => (touch.jump = true), onUp: () => (touch.jump = false) },
      { id: 'down', label: 'DOWN', onDown: () => (touch.descend = true), onUp: () => (touch.descend = false) },
      { id: 'warp', label: 'WARP', color: 'rgba(200,160,90,0.5)', onDown: () => (touch.warp = true), onUp: () => (touch.warp = false) },
    ];
  }

  /** System chart: an orbital survey of every planet (resources + danger). */
  private toggleChart(): void {
    if (this.chartEl) {
      this.chartEl.remove();
      this.chartEl = null;
      return;
    }
    const root = document.getElementById('hud') ?? document.body;
    const el = document.createElement('div');
    el.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:520px;max-width:94vw;max-height:80vh;overflow:auto;padding:18px 20px;background:rgba(10,16,28,0.95);border:1px solid rgba(120,160,220,0.4);border-radius:10px;font:12px ui-monospace,monospace;color:#cfe3ff;pointer-events:auto';
    const rows = this.bodies
      .map((b) => {
        const p = b.profile;
        const danger = planetDanger(p);
        const stars = '★'.repeat(1 + Math.round(danger * 4));
        const res = planetResources(p, this.star).sort((a, c) => c.weight - a.weight).slice(0, 4).map((r) => r.type.name).join(', ');
        const h = planetHazards(p);
        const haz = [h.cold > 0.04 ? '❄ cold' : '', h.toxic > 0.04 ? '☣ toxic' : ''].filter(Boolean).join(' ');
        return `<div style="display:flex;justify-content:space-between;gap:12px;margin:6px 0;padding-bottom:6px;border-bottom:1px solid rgba(120,160,220,0.12)">
          <div><b>#${p.index} ${p.biome}</b>${p.inHabitableZone ? ' <span style="color:#9affd0">HZ</span>' : ''}<br>
          <span style="opacity:0.7">${p.orbitalRadius.toFixed(2)} AU · ${p.surfaceTemp.toFixed(0)}K · ${p.gravity.toFixed(2)}g</span></div>
          <div style="text-align:right"><span style="color:#ff8a5a">${stars}</span><br><span style="opacity:0.8">${res || 'barren'}</span>${haz ? `<br><span style="opacity:0.85;color:#ffb38a">${haz}</span>` : ''}</div>
        </div>`;
      })
      .join('');
    el.innerHTML = `<div style="font-size:16px;font-weight:700;margin-bottom:8px">⛭ SYSTEM CHART — star ${this.star.spectralClass}</div>${rows}<div style="opacity:0.6;margin-top:10px;text-align:center">M to close · fly to a planet and Enter to descend</div>`;
    root.appendChild(el);
    this.chartEl = el;
    if (document.pointerLockElement) document.exitPointerLock();
  }

  update(dt: number): void {
    this.time += dt;
    this.controller.update(dt);

    // Ship banking + engine; third-person chase camera with lag.
    const ship = this.ship.group;
    const speed = clamp(this.controller.speedFraction, 0, 1);
    this.ship.setControls(clamp(-this.controller.turnRate * 0.02, -0.6, 0.6), speed);
    this.ship.update(dt);
    if (this.controller.isLocked && !this.engineOn) {
      audio.startEngine();
      this.engineOn = true;
    }
    if (this.engineOn) audio.setEngineLevel(speed);
    this.camOffset.set(0, 1.8, 8.5).applyQuaternion(ship.quaternion).add(ship.position);
    this.camera.position.lerp(this.camOffset, 1 - Math.exp(-dt * 6));
    this.camera.quaternion.slerp(ship.quaternion, 1 - Math.exp(-dt * 5));

    for (const b of this.bodies) {
      const a = b.phase + this.time * b.angularSpeed;
      b.mesh.position.set(Math.cos(a) * b.orbitWorld, 0, Math.sin(a) * b.orbitWorld);
      b.mesh.rotation.y += dt * 0.2;
    }

    // Effects + combat actors.
    this.effects.update(dt);
    this.meteors.update(dt);
    this.hostiles.update(dt, ship.position);

    // Player missiles: meteors (salvage), raiders (bounty), then planets/star.
    this.missiles.update(dt, (pos) => {
      const rock = this.meteors.intersect(pos);
      if (rock) {
        const r = this.meteors.destroy(rock, this.effects);
        this.awardSalvage(r.currency, 'meteor cracked');
        return r.pos;
      }
      const foe = this.hostiles.intersect(pos);
      if (foe) {
        const r = this.hostiles.damage(foe, 20, this.effects);
        if (r.killed) this.awardSalvage(r.currency, 'raider destroyed');
        return r.pos;
      }
      if (pos.length() < this.starWorldR + 2) return new THREE.Vector3(0, 0, 0);
      for (const b of this.bodies) {
        if (pos.distanceToSquared(b.mesh.position) < (b.worldRadius + 1.5) * (b.worldRadius + 1.5)) {
          this.effects.burst(b.mesh.position.clone(), new THREE.Color(0xffd089), 10, 8, 0.5, 0, 7);
          return b.mesh.position.clone();
        }
      }
      return null;
    });

    // Enemy fire: a near miss on the ship chips the hull (downs → edge respawn).
    this.enemyShots.update(dt, (pos) => {
      if (pos.distanceTo(ship.position) < 4) {
        this.takeHit(8);
        return pos.clone();
      }
      return null;
    });

    // Hull self-repairs slowly out of fire.
    this.hull = Math.min(this.hullMax, this.hull + 2.5 * dt);
    if (this.combatMsgT > 0) this.combatMsgT -= dt;

    // Nearest planet to the ship within its selection distance.
    this.candidate = null;
    let bestD2 = Infinity;
    for (const b of this.bodies) {
      const d2 = ship.position.distanceToSquared(b.mesh.position);
      if (d2 < b.selectDist * b.selectDist && d2 < bestD2) {
        bestD2 = d2;
        this.candidate = b;
      }
    }
    if (this.candidate) {
      const r = this.candidate.worldRadius * 1.6;
      this.highlight.visible = true;
      this.highlight.scale.setScalar(r);
      this.highlight.position.copy(this.candidate.mesh.position);
      this.highlight.lookAt(this.camera.position);
    } else {
      this.highlight.visible = false;
    }

    // Combat camera shake (applied after the chase-cam set; reset next frame).
    const sh = this.effects.getShake(this.shake);
    if (sh.x !== 0 || sh.y !== 0) {
      this.camera.rotateX(sh.x);
      this.camera.rotateY(sh.y);
    }
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    this.dom.removeEventListener('pointerdown', this.onPointerDown);
    audio.stopEngine();
    this.controller.dispose();
    this.missiles.dispose();
    this.enemyShots.dispose();
    this.meteors.dispose();
    this.hostiles.dispose();
    this.effects.dispose();
    this.ship.dispose();
    this.chartEl?.remove();
    for (const d of this.disposables) d.dispose();
  }

  hudLines(): string[] {
    const s = this.star;
    const lines = [
      `scene: system — star ${s.spectralClass}  ${s.temperature.toFixed(0)}K  ${s.luminosity.toFixed(2)} L⊙`,
      `planets: ${this.bodies.length}`,
    ];
    if (!this.controller.isLocked) lines.push('click to capture mouse · WASD+RF fly · Q/E roll · Shift warp');
    lines.push('[Backspace] back to galaxy');
    lines.push('[M] system chart (orbital survey)');
    lines.push(`hull ${Math.max(0, Math.round(this.hull))}/${this.hullMax} · LMB fire — destroy meteors & raiders for credits`);
    if (this.combatMsgT > 0) lines.push(`▸ ${this.combatMsg}`);
    if (this.candidate) {
      const p = this.candidate.profile;
      lines.push(
        `▶ planet #${p.index} ${p.biome}  ${p.surfaceTemp.toFixed(0)}K${p.inHabitableZone ? ' (HZ)' : ''} — Enter to descend`,
      );
      lines.push(`   survey: ${this.surveyText(p)}`);
    }
    return lines;
  }

  /** Orbital survey of a planet: danger + likely resources (derived). */
  private surveyText(p: PlanetProfile): string {
    const danger = planetDanger(p);
    const stars = '★'.repeat(1 + Math.round(danger * 4)) + '☆'.repeat(4 - Math.round(danger * 4));
    const res = planetResources(p, this.star)
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 3)
      .map((r) => r.type.name)
      .join(', ');
    const h = planetHazards(p);
    const haz = [h.cold > 0.04 ? '❄ cold' : '', h.toxic > 0.04 ? '☣ toxic' : ''].filter(Boolean).join(' ');
    return `danger ${stars} · ${res || 'barren'}${haz ? ` · ${haz}` : ''}`;
  }
}
