import * as THREE from 'three';
import type { AppScene } from './AppScene.ts';
import type { BloomSettings } from '../render/composer.ts';
import { FloatingOrigin } from '../core/floatingOrigin.ts';
import { Starfield, CELL_SIZE, type StarRecord } from '../gen/starfield.ts';
import { FlyController } from './controls/FlyController.ts';
import { Cockpit } from '../render/cockpit.ts';
import { makeRNG } from '../core/rng.ts';
import { deriveSeed } from '../core/hash.ts';

export interface StarSelection {
  cell: [number, number, number];
  index: number;
  record: StarRecord;
}

const SELECT_RADIUS = 260; // local units within which a star can be entered

/** Infinite chunked starfield with 6DOF flight and floating-origin recentering.
 *  Approaching a star highlights it; Enter (or the supplied callback) enters its
 *  system. */
export class GalaxyScene implements AppScene {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;

  /** Set by the host to handle "enter this system". */
  onSelectStar: ((sel: StarSelection) => void) | null = null;

  readonly bloom: BloomSettings = { strength: 1.1, radius: 0.7, threshold: 0.0 };

  private readonly origin = new FloatingOrigin(CELL_SIZE);
  private readonly starfield: Starfield;
  private readonly controller: FlyController;
  private readonly highlight: THREE.Mesh;
  private readonly cockpit = new Cockpit();
  private readonly nebula: THREE.Mesh;
  private candidate: StarRecord | null = null;

  constructor(universeSeed: number, dom: HTMLElement) {
    this.scene.background = new THREE.Color(0x04050a);

    this.camera = new THREE.PerspectiveCamera(70, 1, 0.5, 14000);
    this.camera.position.set(0, 0, 0);

    // Dim nebula backdrop so space isn't flat black (stars still pop on top).
    this.nebula = makeNebula(universeSeed);
    this.scene.add(this.nebula);

    this.starfield = new Starfield(universeSeed, 3);
    this.scene.add(this.starfield.points);
    this.starfield.update(this.origin, true);

    // Cockpit frame fixed to the camera (camera must be in the graph to render it).
    this.camera.add(this.cockpit.group);
    this.scene.add(this.camera);

    // Billboarded selection ring.
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xbfe0ff,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.highlight = new THREE.Mesh(new THREE.RingGeometry(24, 30, 32), ringMat);
    this.highlight.visible = false;
    this.scene.add(this.highlight);

    this.controller = new FlyController(this.camera, dom);
    window.addEventListener('keydown', this.onKeyDown);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Enter' && this.candidate && this.onSelectStar) {
      this.onSelectStar({
        cell: [...this.candidate.cell],
        index: this.candidate.index,
        record: this.candidate,
      });
    }
  };

  update(dt: number): void {
    this.controller.update(dt);

    // Floating-origin recenter: keeps camera.position bounded; restream on shift.
    this.origin.rebase(this.camera.position);
    this.starfield.update(this.origin);

    // Keep the nebula centered on the camera so it reads as infinitely distant.
    this.nebula.position.copy(this.camera.position);

    // Nearest-star selection.
    this.candidate = this.starfield.nearestStar(
      this.camera.position.x,
      this.camera.position.y,
      this.camera.position.z,
      SELECT_RADIUS,
    );
    if (this.candidate) {
      this.highlight.visible = true;
      this.highlight.position.set(this.candidate.lx, this.candidate.ly, this.candidate.lz);
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
    this.starfield.dispose();
    this.cockpit.dispose();
    this.nebula.geometry.dispose();
    (this.nebula.material as THREE.Material).dispose();
    this.highlight.geometry.dispose();
    (this.highlight.material as THREE.Material).dispose();
  }

  hudLines(): string[] {
    const c = this.origin.originCell;
    const p = this.camera.position;
    const lines = [
      'scene: galaxy',
      `cell [${c.x}, ${c.y}, ${c.z}]   local (${p.x.toFixed(0)}, ${p.y.toFixed(0)}, ${p.z.toFixed(0)})`,
      `stars loaded: ${this.starfield.active.length}${this.controller.isWarping ? '   ⚡ WARP' : ''}`,
    ];
    if (!this.controller.isLocked) lines.push('click to capture mouse · WASD+RF fly · Q/E roll · Shift warp');
    if (this.candidate) {
      const s = this.candidate.profile;
      lines.push(`▶ star ${s.spectralClass}  ${s.temperature.toFixed(0)}K  — press Enter to enter system`);
    }
    return lines;
  }
}

/** Big, dim, inside-out nebula sphere. Cheap layered-sine "clouds" tinted by two
 *  seed-derived colors, so each universe has its own deep-space backdrop. */
function makeNebula(seed: number): THREE.Mesh {
  const rng = makeRNG(deriveSeed(seed, 0x4eb01a));
  const a = new THREE.Color().setHSL(rng(), 0.6, 0.06);
  const b = new THREE.Color().setHSL(rng(), 0.55, 0.05);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: { uColA: { value: a }, uColB: { value: b } },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vDir;
      uniform vec3 uColA;
      uniform vec3 uColB;
      void main() {
        float c1 = sin(vDir.x * 3.0 + 1.0) * sin(vDir.y * 2.0) * sin(vDir.z * 2.5);
        float c2 = sin(vDir.x * 5.0) * cos(vDir.z * 4.0 + 2.0);
        float t = clamp(0.5 + 0.5 * (c1 * 0.6 + c2 * 0.4), 0.0, 1.0);
        vec3 col = mix(uColA, uColB, t) * (0.6 + 0.4 * t);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(12000, 24, 16), mat);
  mesh.frustumCulled = false;
  return mesh;
}
