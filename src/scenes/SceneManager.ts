import * as THREE from 'three';
import type { AppScene } from './AppScene.ts';
import { PostFX, type BloomSettings } from '../render/composer.ts';

const DEFAULT_BLOOM: BloomSettings = { strength: 0.6, radius: 0.6, threshold: 0.85 };

/** Owns the renderer + post-processing and the currently-active scene, and
 *  handles transitions between scenes. In Phase 0 the "transition" is an instant
 *  swap; richer fade+camera transitions arrive in later phases. */
export class SceneManager {
  readonly renderer: THREE.WebGLRenderer;
  private readonly postfx: PostFX;
  private current: AppScene | null = null;
  private width = 1;
  private height = 1;
  private pixelRatio: number;

  constructor(canvas?: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.pixelRatio = Math.min(window.devicePixelRatio, 2);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setClearColor(0x05060a, 1);

    // Composer is retargeted whenever the active scene changes.
    const bootScene = new THREE.Scene();
    const bootCam = new THREE.PerspectiveCamera();
    this.postfx = new PostFX(this.renderer, bootScene, bootCam);
  }

  get domElement(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  get activeScene(): AppScene | null {
    return this.current;
  }

  setScene(next: AppScene): void {
    if (this.current && this.current !== next) {
      this.current.dispose();
    }
    this.current = next;
    this.postfx.setTarget(next.scene, next.camera);
    this.postfx.setBloom(next.bloom ?? DEFAULT_BLOOM);
    next.resize(this.width, this.height);
  }

  update(dt: number): void {
    this.current?.update(dt);
  }

  render(): void {
    if (this.current) {
      this.postfx.render();
    }
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.renderer.setSize(width, height, false);
    this.postfx.setSize(width, height, this.pixelRatio);
    this.current?.resize(width, height);
  }

  hudLines(): string[] {
    return this.current?.hudLines?.() ?? [];
  }
}
