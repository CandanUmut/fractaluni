import * as THREE from 'three';
import type { AppScene } from './AppScene.ts';
import type { BloomSettings } from '../render/composer.ts';
import { FlyController } from './controls/FlyController.ts';
import { Cockpit } from '../render/cockpit.ts';
import { deriveStarAt, deriveSystem } from '../universe/index.ts';
import { biomePalette } from '../palette/index.ts';
import { rgbToHex, scaleRGB } from '../core/color.ts';
import { clamp, TAU } from '../core/math.ts';
import { makeRNG } from '../core/rng.ts';
import { deriveSeed } from '../core/hash.ts';
import type { PlanetProfile, StarProfile } from '../universe/types.ts';

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
  private readonly cockpit = new Cockpit();
  private time = 0;
  private candidate: PlanetBody | null = null;
  private readonly disposables: { dispose(): void }[] = [];

  constructor(
    universeSeed: number,
    cell: readonly [number, number, number],
    starIndex: number,
    dom: HTMLElement,
  ) {
    this.star = deriveStarAt(universeSeed, cell, starIndex);
    const planets = deriveSystem(this.star);

    this.scene.background = new THREE.Color(0x03040a);

    // Backdrop of fixed faraway stars (deterministic, cheap ambiance).
    this.scene.add(this.makeBackdrop());

    // Central star.
    const starWorldR = clamp(2.5 + this.star.radius * 0.6, 2.5, 10);
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

    this.controller = new FlyController(this.camera, dom);
    this.controller.baseSpeed = clamp(outer * 0.25, 30, 400);

    // Cockpit frame fixed to the camera.
    this.camera.add(this.cockpit.group);
    this.scene.add(this.camera);

    window.addEventListener('keydown', this.onKeyDown);
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
      selectDist: worldRadius * 3 + 6,
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

  private onKeyDown = (e: KeyboardEvent): void => {
    if ((e.key === 'Backspace' || e.key === 'b' || e.key === 'B') && this.onBack) {
      e.preventDefault();
      this.onBack();
    } else if (e.key === 'Enter' && this.candidate && this.onSelectPlanet) {
      this.onSelectPlanet(this.candidate.profile.index);
    }
  };

  update(dt: number): void {
    this.time += dt;
    this.controller.update(dt);

    for (const b of this.bodies) {
      const a = b.phase + this.time * b.angularSpeed;
      b.mesh.position.set(Math.cos(a) * b.orbitWorld, 0, Math.sin(a) * b.orbitWorld);
      b.mesh.rotation.y += dt * 0.2;
    }

    // Nearest planet within its selection distance.
    this.candidate = null;
    let bestD2 = Infinity;
    for (const b of this.bodies) {
      const d2 = this.camera.position.distanceToSquared(b.mesh.position);
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
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    this.controller.dispose();
    this.cockpit.dispose();
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
    if (this.candidate) {
      const p = this.candidate.profile;
      lines.push(
        `▶ planet #${p.index} ${p.biome}  ${p.surfaceTemp.toFixed(0)}K${p.inHabitableZone ? ' (HZ)' : ''} — Enter to descend`,
      );
    }
    return lines;
  }
}
