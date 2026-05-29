import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

export interface BloomSettings {
  strength: number;
  radius: number;
  threshold: number;
}

/** Wraps an EffectComposer so it can be retargeted at a different scene+camera
 *  when the SceneManager swaps scenes. Bloom makes stars/suns/emissive glow;
 *  per-system color grading layers in later. */
export class PostFX {
  readonly composer: EffectComposer;
  private readonly renderPass: RenderPass;
  readonly bloom: UnrealBloomPass;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    this.composer = new EffectComposer(renderer);

    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.9, 0.6, 0.0);
    this.composer.addPass(this.bloom);

    this.composer.addPass(new OutputPass());
  }

  setTarget(scene: THREE.Scene, camera: THREE.Camera): void {
    this.renderPass.scene = scene;
    this.renderPass.camera = camera;
  }

  setBloom(s: BloomSettings): void {
    this.bloom.strength = s.strength;
    this.bloom.radius = s.radius;
    this.bloom.threshold = s.threshold;
  }

  setSize(width: number, height: number, pixelRatio: number): void {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(width, height);
  }

  render(): void {
    this.composer.render();
  }
}
