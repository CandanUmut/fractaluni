import * as THREE from 'three';

// Hyperspace streaks: short line segments in a tube around the camera that fly
// past the viewer and stretch with speed. Parented to the camera, so they live
// in view space (-Z forward) and need no world bookkeeping. Fades in with speed.

const N = 260;
const RADIUS = 140;
const DEPTH = 600;

export class WarpStreaks {
  readonly lines: THREE.LineSegments;
  private readonly mat: THREE.LineBasicMaterial;
  private readonly pos: Float32Array;
  private readonly base: Float32Array; // x,y,z0 per streak
  private opacity = 0;

  constructor() {
    this.pos = new Float32Array(N * 2 * 3);
    this.base = new Float32Array(N * 3);
    // Deterministic-enough layout (visual only; uses a tiny LCG, not world gen).
    let s = 0x12345;
    const rnd = (): number => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let i = 0; i < N; i++) {
      const ang = rnd() * Math.PI * 2;
      const r = RADIUS * (0.15 + rnd() * 0.85);
      const x = Math.cos(ang) * r;
      const y = Math.sin(ang) * r;
      const z = -DEPTH + rnd() * (DEPTH * 2);
      this.base[i * 3] = x;
      this.base[i * 3 + 1] = y;
      this.base[i * 3 + 2] = z;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.mat = new THREE.LineBasicMaterial({
      color: 0xbfe4ff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.lines = new THREE.LineSegments(geo, this.mat);
    this.lines.frustumCulled = false;
  }

  /** speed01 in [0,1]; higher = brighter, longer, faster streaks. */
  update(dt: number, speed01: number): void {
    this.opacity += (Math.max(0, speed01 - 0.25) - this.opacity) * Math.min(1, dt * 4);
    this.mat.opacity = this.opacity * 0.9;
    if (this.opacity < 0.01) return;

    const len = 20 + speed01 * 220;
    const fly = (300 + speed01 * 1600) * dt;
    for (let i = 0; i < N; i++) {
      let z = this.base[i * 3 + 2]! + fly;
      if (z > DEPTH) z -= DEPTH * 2;
      this.base[i * 3 + 2] = z;
      const x = this.base[i * 3]!;
      const y = this.base[i * 3 + 1]!;
      this.pos[i * 6] = x;
      this.pos[i * 6 + 1] = y;
      this.pos[i * 6 + 2] = z;
      this.pos[i * 6 + 3] = x;
      this.pos[i * 6 + 4] = y;
      this.pos[i * 6 + 5] = z - len; // trail forward (into -Z)
    }
    (this.lines.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.lines.geometry.dispose();
    this.mat.dispose();
  }
}
