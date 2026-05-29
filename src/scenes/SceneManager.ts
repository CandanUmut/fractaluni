import * as THREE from 'three';
import type { AppScene } from './AppScene.ts';

/** Owns the renderer and the currently-active scene, and handles transitions
 *  between scenes. In Phase 0 the "transition" is an instant swap with a quick
 *  CSS fade; richer fade+camera transitions arrive in later phases. */
export class SceneManager {
  readonly renderer: THREE.WebGLRenderer;
  private current: AppScene | null = null;
  private width = 1;
  private height = 1;

  constructor(canvas?: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x05060a, 1);
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
    next.resize(this.width, this.height);
  }

  update(dt: number): void {
    this.current?.update(dt);
  }

  render(): void {
    if (this.current) {
      this.renderer.render(this.current.scene, this.current.camera);
    }
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.renderer.setSize(width, height, false);
    this.current?.resize(width, height);
  }

  hudLines(): string[] {
    return this.current?.hudLines?.() ?? [];
  }
}
