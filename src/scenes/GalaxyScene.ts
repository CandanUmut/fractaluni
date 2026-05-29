import * as THREE from 'three';
import type { AppScene } from './AppScene.ts';
import type { BloomSettings } from '../render/composer.ts';
import { FloatingOrigin } from '../core/floatingOrigin.ts';
import { Starfield, CELL_SIZE, type StarRecord } from '../gen/starfield.ts';
import { FlyController } from './controls/FlyController.ts';
import { Spaceship } from '../render/spaceship.ts';
import { WarpStreaks } from '../render/warp.ts';
import { makeRNG } from '../core/rng.ts';
import { deriveSeed } from '../core/hash.ts';
import { clamp } from '../core/math.ts';

export interface StarSelection {
  cell: [number, number, number];
  index: number;
  record: StarRecord;
}

const SELECT_RADIUS = 300;

/** Infinite chunked starfield flown in a third-person ship, with floating-origin
 *  recentering. Approaching a star highlights it; Enter enters its system. */
export class GalaxyScene implements AppScene {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  onSelectStar: ((sel: StarSelection) => void) | null = null;

  // Calmer bloom so the field reads clearly (was washing out before).
  readonly bloom: BloomSettings = { strength: 0.7, radius: 0.6, threshold: 0.2 };

  private readonly origin = new FloatingOrigin(CELL_SIZE);
  private readonly starfield: Starfield;
  private readonly controller: FlyController;
  private readonly ship = new Spaceship();
  private readonly warp = new WarpStreaks();
  private readonly highlight: THREE.Mesh;
  private readonly nebula: THREE.Mesh;
  private candidate: StarRecord | null = null;

  // scratch
  private readonly camOffset = new THREE.Vector3();
  private readonly desiredCam = new THREE.Vector3();

  constructor(universeSeed: number, dom: HTMLElement) {
    this.scene.background = new THREE.Color(0x02030a);

    this.camera = new THREE.PerspectiveCamera(68, 1, 0.5, 16000);
    this.camera.position.set(0, 1.6, 8);

    this.nebula = makeNebula(universeSeed);
    this.scene.add(this.nebula);

    this.starfield = new Starfield(universeSeed, 3);
    this.scene.add(this.starfield.points);
    this.starfield.update(this.origin, true);

    // The ship is the player object the controller drives; the camera trails it.
    this.scene.add(this.ship.group);
    this.controller = new FlyController(this.ship.group, dom);

    // Soft lighting so the ship (a lit material) reads against dark space.
    const key = new THREE.DirectionalLight(0xcfe0ff, 2.2);
    key.position.set(2, 4, 3);
    this.scene.add(key);
    this.scene.add(new THREE.AmbientLight(0x404a66, 0.8));

    // Camera owns the warp streaks; camera must be in the graph to render them.
    this.camera.add(this.warp.lines);
    this.scene.add(this.camera);

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
    const ship = this.ship.group;

    // Floating-origin recenter on the ship; keep the trailing camera in step.
    const shift = this.origin.rebase(ship.position);
    if (shift.x !== 0 || shift.y !== 0 || shift.z !== 0) {
      this.camera.position.sub(
        this.camOffset.set(shift.x * CELL_SIZE, shift.y * CELL_SIZE, shift.z * CELL_SIZE),
      );
    }
    this.starfield.update(this.origin);
    this.nebula.position.copy(ship.position);

    // Ship visuals: bank into turns, flare engine with speed.
    const speed = clamp(this.controller.speedFraction, 0, 1);
    this.ship.setControls(clamp(-this.controller.turnRate * 0.02, -0.6, 0.6), speed);
    this.ship.update(dt);

    // Third-person chase camera (offset behind + above, with lag).
    this.camOffset.set(0, 1.8, 8.5).applyQuaternion(ship.quaternion).add(ship.position);
    this.desiredCam.copy(this.camOffset);
    this.camera.position.lerp(this.desiredCam, 1 - Math.exp(-dt * 6));
    this.camera.quaternion.slerp(ship.quaternion, 1 - Math.exp(-dt * 5));

    this.warp.update(dt, this.controller.isWarping ? Math.max(speed, 0.6) : speed);

    // Nearest-star selection (relative to the ship, the true player position).
    this.candidate = this.starfield.nearestStar(ship.position.x, ship.position.y, ship.position.z, SELECT_RADIUS);
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
    this.ship.dispose();
    this.warp.dispose();
    this.nebula.geometry.dispose();
    (this.nebula.material as THREE.Material).dispose();
    this.highlight.geometry.dispose();
    (this.highlight.material as THREE.Material).dispose();
  }

  hudLines(): string[] {
    const c = this.origin.originCell;
    const p = this.ship.group.position;
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

/** Layered, dim, multi-color nebula backdrop — deep-space mood without washing
 *  out the stars. Two seeded color zones blended by cheap layered "clouds". */
function makeNebula(seed: number): THREE.Mesh {
  const rng = makeRNG(deriveSeed(seed, 0x4eb01a));
  const a = new THREE.Color().setHSL(rng(), 0.7, 0.07);
  const b = new THREE.Color().setHSL(rng(), 0.65, 0.05);
  const c = new THREE.Color().setHSL(rng(), 0.6, 0.06);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: { uA: { value: a }, uB: { value: b }, uC: { value: c } },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vDir;
      uniform vec3 uA; uniform vec3 uB; uniform vec3 uC;
      void main() {
        float c1 = sin(vDir.x * 3.0 + 1.0) * sin(vDir.y * 2.0) * sin(vDir.z * 2.5);
        float c2 = sin(vDir.x * 6.0) * cos(vDir.z * 5.0 + 2.0);
        float c3 = sin(vDir.y * 4.0 + vDir.x * 2.0);
        float t = clamp(0.5 + 0.5 * (c1 * 0.5 + c2 * 0.3), 0.0, 1.0);
        float u = clamp(0.5 + 0.5 * c3, 0.0, 1.0);
        vec3 col = mix(mix(uA, uB, t), uC, u * 0.5);
        // Slightly darker overhead/underfoot so there's a sense of a galactic plane.
        col *= 0.55 + 0.45 * (1.0 - abs(vDir.y));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(13000, 32, 20), mat);
  mesh.frustumCulled = false;
  return mesh;
}
