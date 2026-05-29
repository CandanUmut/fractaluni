import type * as THREE from 'three';
import type { BloomSettings } from '../render/composer.ts';
import type { ColorGradeSettings } from '../render/colorGrade.ts';
import type { TouchAction } from '../ui/touchControls.ts';

/** A swappable scene owned by the SceneManager. Each scene provides its own
 *  Three.js scene graph + camera, and manages its own lifecycle. The renderer
 *  and post-processing composer are owned by the SceneManager / render layer. */
export interface AppScene {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;

  /** Optional per-scene bloom; falls back to a default when absent. */
  readonly bloom?: BloomSettings;

  /** Optional per-scene color grade; falls back to neutral when absent. */
  readonly colorGrade?: ColorGradeSettings;

  /** Advance simulation by dt seconds. */
  update(dt: number): void;

  /** React to a viewport resize. */
  resize(width: number, height: number): void;

  /** Free GPU/CPU resources. Called when the scene is swapped out for good. */
  dispose(): void;

  /** Optional per-frame HUD lines for debugging. */
  hudLines?(): string[];

  /** Optional pass rendered AFTER post-processing — e.g. a first-person
   *  viewmodel that must never be clipped by world geometry. */
  renderOverlay?(renderer: THREE.WebGLRenderer): void;

  /** Optional on-screen action buttons for the mobile touch console. */
  touchActions?(): TouchAction[];
}
