import type * as THREE from 'three';

/** A swappable scene owned by the SceneManager. Each scene provides its own
 *  Three.js scene graph + camera, and manages its own lifecycle. The renderer
 *  and post-processing composer are owned by the SceneManager / render layer. */
export interface AppScene {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;

  /** Advance simulation by dt seconds. */
  update(dt: number): void;

  /** React to a viewport resize. */
  resize(width: number, height: number): void;

  /** Free GPU/CPU resources. Called when the scene is swapped out for good. */
  dispose(): void;

  /** Optional per-frame HUD lines for debugging. */
  hudLines?(): string[];
}
