import * as THREE from 'three';
import type { AppScene } from './AppScene.ts';
import type { BloomSettings } from '../render/composer.ts';
import { FloatingOrigin } from '../core/floatingOrigin.ts';
import { Starfield, CELL_SIZE, type StarRecord } from '../gen/starfield.ts';
import { FlyController } from './controls/FlyController.ts';

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
  private candidate: StarRecord | null = null;

  constructor(universeSeed: number, dom: HTMLElement) {
    this.scene.background = new THREE.Color(0x04050a);

    this.camera = new THREE.PerspectiveCamera(70, 1, 0.5, 14000);
    this.camera.position.set(0, 0, 0);

    this.starfield = new Starfield(universeSeed, 3);
    this.scene.add(this.starfield.points);
    this.starfield.update(this.origin, true);

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
