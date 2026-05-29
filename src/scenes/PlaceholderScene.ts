import * as THREE from 'three';
import type { AppScene } from './AppScene.ts';

/** Phase-0 placeholder: a spinning flat-shaded shape on a labelled background.
 *  Stands in for galaxy/system/surface scenes so the SceneManager + URL state
 *  can be exercised before the real scenes exist. */
export class PlaceholderScene implements AppScene {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private readonly mesh: THREE.Mesh;
  private readonly label: string;
  private spin = 0;

  constructor(label: string, color: number, background: number) {
    this.label = label;
    this.scene.background = new THREE.Color(background);

    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
    this.camera.position.set(0, 1.2, 4);
    this.camera.lookAt(0, 0, 0);

    const geo = new THREE.IcosahedronGeometry(1, 0);
    const mat = new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.7 });
    this.mesh = new THREE.Mesh(geo, mat);
    this.scene.add(this.mesh);

    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(3, 4, 2);
    this.scene.add(key);
    this.scene.add(new THREE.AmbientLight(0x4060a0, 0.6));
  }

  update(dt: number): void {
    this.spin += dt;
    this.mesh.rotation.x = this.spin * 0.6;
    this.mesh.rotation.y = this.spin * 0.9;
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }

  hudLines(): string[] {
    return [`scene: ${this.label} (placeholder)`];
  }
}
