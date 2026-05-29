import * as THREE from 'three';

// First-person viewmodel: the held item lives in its own scene + camera and is
// rendered AFTER the world with the depth buffer cleared, so it can never be
// clipped by terrain. Sway (from look) and bob (from movement) are procedural —
// pure transform math, no authored clips. Phase B swaps in real weapons/tools.

export interface ViewmodelInput {
  moving: boolean;
  /** Smoothed recent look delta (px), drives sway. */
  swayX: number;
  swayY: number;
  /** Forward speed fraction [0,1], drives bob amplitude/rate. */
  speed01: number;
}

export class Viewmodel {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  /** The slot the held item is parented to; procedural offsets apply here. */
  readonly hand = new THREE.Group();

  private readonly rest = new THREE.Vector3(0.34, -0.32, -0.75);
  private item: THREE.Object3D | null = null;
  private bobPhase = 0;
  // transient additive offsets (e.g. recoil), decayed each frame
  private kick = new THREE.Vector3();
  private kickRot = 0;

  constructor() {
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.01, 10);
    this.camera.position.set(0, 0, 0);

    this.hand.position.copy(this.rest);
    this.scene.add(this.hand);

    // Lighting for the viewmodel (independent of the world).
    const key = new THREE.DirectionalLight(0xffffff, 2.6);
    key.position.set(0.5, 1, 0.8);
    this.scene.add(key);
    this.scene.add(new THREE.AmbientLight(0x8090b0, 0.9));

    this.setItem(makePlaceholderTool());
  }

  setItem(obj: THREE.Object3D): void {
    if (this.item) this.hand.remove(this.item);
    this.item = obj;
    this.hand.add(obj);
  }

  /** Apply an impulse to the held item (recoil), decayed over the next frames. */
  addKick(back: number, up: number, rot: number): void {
    this.kick.z += back;
    this.kick.y += up;
    this.kickRot += rot;
  }

  update(dt: number, input: ViewmodelInput): void {
    // Bob while moving.
    if (input.moving) this.bobPhase += dt * (6 + input.speed01 * 6);
    const bobAmt = input.speed01 * 0.03 + (input.moving ? 0.012 : 0);
    const bobX = Math.cos(this.bobPhase) * bobAmt;
    const bobY = Math.abs(Math.sin(this.bobPhase)) * bobAmt;

    // Sway opposite to look motion (clamped).
    const swayX = clampAbs(input.swayX * 0.00045, 0.07);
    const swayY = clampAbs(input.swayY * 0.00045, 0.07);

    // Decay kick (recoil recovery).
    this.kick.multiplyScalar(Math.exp(-dt * 12));
    this.kickRot *= Math.exp(-dt * 12);

    this.hand.position.set(
      this.rest.x + bobX - swayX,
      this.rest.y + bobY + swayY + this.kick.y,
      this.rest.z + this.kick.z,
    );
    this.hand.rotation.set(-swayY * 1.5 + this.kickRot, -swayX * 1.5, 0);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  render(renderer: THREE.WebGLRenderer): void {
    // Preserve the post-processed color buffer; clear only depth so the
    // viewmodel draws on top of the world without being clipped.
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.autoClear = prevAutoClear;
  }

  dispose(): void {
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
  }
}

function clampAbs(v: number, max: number): number {
  return v > max ? max : v < -max ? -max : v;
}

/** A neutral low-poly held "tool" placeholder for Phase A. */
function makePlaceholderTool(): THREE.Object3D {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.16, 0.4),
    new THREE.MeshStandardMaterial({ color: 0x3b4250, flatShading: true, roughness: 0.5, metalness: 0.4 }),
  );
  body.position.set(0, 0, 0.05);
  const barrel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.03, 0.03, 0.5, 10),
    new THREE.MeshStandardMaterial({ color: 0x6a7486, flatShading: true, roughness: 0.4, metalness: 0.6 }),
  );
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.03, -0.25);
  const grip = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.16, 0.1),
    new THREE.MeshStandardMaterial({ color: 0x2a2f3a, flatShading: true }),
  );
  grip.position.set(0, -0.14, 0.16);
  grip.rotation.x = 0.3;
  g.add(body, barrel, grip);
  return g;
}
