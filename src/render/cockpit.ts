import * as THREE from 'three';

// A low-poly ship cockpit framing the view: dashboard, A-pillars, canopy bar,
// and a few glowing console panels (which bloom). Parented to the camera so it
// stays fixed on screen, giving the galaxy/system flight a "piloting a ship"
// feel. Unlit (MeshBasic) so it reads the same in any scene.

export class Cockpit {
  readonly group = new THREE.Group();
  private readonly disposables: { dispose(): void }[] = [];

  constructor() {
    const frame = new THREE.MeshBasicMaterial({ color: 0x161b26 });
    const trim = new THREE.MeshBasicMaterial({ color: 0x2c3550 });
    const panel = new THREE.MeshBasicMaterial({ color: 0x2aa6ff }); // glows under bloom
    const panelWarm = new THREE.MeshBasicMaterial({ color: 0xff7a3a });
    this.disposables.push(frame, trim, panel, panelWarm);

    const add = (
      geo: THREE.BufferGeometry,
      mat: THREE.Material,
      x: number,
      y: number,
      z: number,
      rx = 0,
      rz = 0,
    ): void => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.set(rx, 0, rz);
      this.group.add(m);
      this.disposables.push(geo);
    };

    // Everything sits ~1.1 units in front of the camera (inside the near plane).
    const Z = -1.1;

    // Dashboard slab across the bottom, tilted up toward the pilot.
    add(new THREE.BoxGeometry(1.9, 0.5, 0.12), frame, 0, -0.62, Z + 0.1, 0.5);
    // Console panels on the dashboard.
    add(new THREE.BoxGeometry(0.34, 0.12, 0.02), panel, -0.45, -0.52, Z + 0.02, 0.5);
    add(new THREE.BoxGeometry(0.34, 0.12, 0.02), panelWarm, 0.0, -0.52, Z + 0.02, 0.5);
    add(new THREE.BoxGeometry(0.34, 0.12, 0.02), panel, 0.45, -0.52, Z + 0.02, 0.5);

    // A-pillars (angled side struts).
    add(new THREE.BoxGeometry(0.1, 1.5, 0.1), frame, -0.92, 0.05, Z, 0, 0.22);
    add(new THREE.BoxGeometry(0.1, 1.5, 0.1), frame, 0.92, 0.05, Z, 0, -0.22);
    // Canopy top bar.
    add(new THREE.BoxGeometry(1.9, 0.1, 0.1), trim, 0, 0.72, Z);

    this.group.renderOrder = 10;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
