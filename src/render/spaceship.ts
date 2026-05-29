import * as THREE from 'three';

// Low-poly flying saucer (Rick-and-Morty-flavored): flattened hull, glass dome,
// dark rim, and a glowing engine that flares with thrust. The `group` is the
// heading frame (faces -Z); an inner `hull` group banks on turns. Lit by the
// scene's lights (MeshStandard), so the galaxy/system scenes add a key light.

export class Spaceship {
  readonly group = new THREE.Group();
  private readonly hull = new THREE.Group();
  private readonly engine: THREE.Mesh;
  private readonly engineMat: THREE.MeshBasicMaterial;
  private readonly disposables: { dispose(): void }[] = [];
  private bank = 0;
  private thrust = 0;

  constructor() {
    const body = new THREE.MeshStandardMaterial({ color: 0xb8c0cf, flatShading: true, roughness: 0.5, metalness: 0.3 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x39414f, flatShading: true, roughness: 0.6, metalness: 0.4 });
    const glass = new THREE.MeshStandardMaterial({
      color: 0x8fe6ff,
      flatShading: true,
      transparent: true,
      opacity: 0.55,
      emissive: new THREE.Color(0x2aa6ff),
      emissiveIntensity: 0.5,
      roughness: 0.2,
    });
    this.engineMat = new THREE.MeshBasicMaterial({ color: 0x49e8ff });
    this.disposables.push(body, dark, glass, this.engineMat);

    // Saucer hull: flattened sphere.
    const saucer = new THREE.SphereGeometry(2, 18, 12);
    saucer.scale(1, 0.32, 1.18);
    this.add(saucer, body);

    // Lower belly (darker, smaller).
    const belly = new THREE.SphereGeometry(1.5, 16, 10);
    belly.scale(1, 0.3, 1.05);
    belly.translate(0, -0.28, 0);
    this.add(belly, dark);

    // Rim ring.
    const rim = new THREE.TorusGeometry(1.95, 0.16, 8, 28);
    rim.rotateX(Math.PI / 2);
    this.add(rim, dark);

    // Glass dome on top.
    const dome = new THREE.SphereGeometry(0.95, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2);
    dome.translate(0, 0.32, 0.1);
    this.add(dome, glass);

    // Forward missile pods (one per side), so the ship reads as armed.
    for (const sx of [-1, 1]) {
      const pod = new THREE.CylinderGeometry(0.16, 0.2, 0.7, 8);
      pod.rotateX(Math.PI / 2);
      pod.translate(sx * 1.15, -0.12, -0.95);
      this.add(pod, dark);
      const tip = new THREE.ConeGeometry(0.1, 0.26, 8);
      tip.rotateX(-Math.PI / 2);
      tip.translate(sx * 1.15, -0.12, -1.4);
      this.add(tip, body);
    }

    // Engine pod + glow at the back (+Z).
    const pod = new THREE.CylinderGeometry(0.45, 0.55, 0.5, 12);
    pod.rotateX(Math.PI / 2);
    pod.translate(0, -0.05, 1.5);
    this.add(pod, dark);

    this.engine = new THREE.Mesh(new THREE.SphereGeometry(0.4, 12, 10), this.engineMat);
    this.engine.position.set(0, -0.05, 1.85);
    this.hull.add(this.engine);
    this.disposables.push(this.engine.geometry);

    this.group.add(this.hull);
  }

  private add(geo: THREE.BufferGeometry, mat: THREE.Material): void {
    this.hull.add(new THREE.Mesh(geo, mat));
    this.disposables.push(geo);
  }

  /** World-space position of a forward missile pod muzzle (side = -1 | +1). */
  muzzleWorld(side: number, out: THREE.Vector3): THREE.Vector3 {
    this.group.updateMatrixWorld();
    return out.set(side * 1.15, -0.12, -1.6).applyMatrix4(this.group.matrixWorld);
  }

  /** targetBank in radians (e.g. from turn rate); thrust in [0,1]. */
  setControls(targetBank: number, thrust: number): void {
    this.bank = targetBank;
    this.thrust = thrust;
  }

  update(dt: number): void {
    // Smoothly roll the hull toward the target bank.
    this.hull.rotation.z += (this.bank - this.hull.rotation.z) * Math.min(1, dt * 6);
    // Engine flare scales with thrust.
    const s = 0.7 + this.thrust * 1.6;
    this.engine.scale.set(s, s, s + this.thrust * 1.5);
    this.engineMat.color.setRGB(0.28 + this.thrust * 0.5, 0.9, 1.0);
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
