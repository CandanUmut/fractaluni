import * as THREE from 'three';
import { audio } from '../audio/audio.ts';

// Ship-launched missiles for the flight scenes: a small glowing projectile with
// a fading additive trail that streaks forward and detonates on a lifetime
// timeout or when a proximity test reports a hit (a star/planet). Self-contained
// (its own trails + blasts), operating in the scene's local space so the caller
// only has to feed it the floating-origin shift.

const TRAIL_LEN = 16;
const FORWARD = new THREE.Vector3(0, 0, 1);

interface Missile {
  group: THREE.Group;
  vel: THREE.Vector3;
  life: number;
  trail: THREE.Line;
  pts: THREE.Vector3[];
}

interface Blast {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  light: THREE.PointLight;
  t: number;
  dur: number;
  radius: number;
}

export class Missiles {
  private readonly group = new THREE.Group();
  private readonly scene: THREE.Scene;
  private readonly missiles: Missile[] = [];
  private readonly blasts: Blast[] = [];
  private cooldown = 0;

  // Shared materials.
  private readonly bodyMat = new THREE.MeshStandardMaterial({ color: 0xd8dde6, flatShading: true, roughness: 0.4, metalness: 0.6 });
  private readonly flameMat = new THREE.MeshBasicMaterial({ color: 0xffb24a, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
  private readonly trailMat = new THREE.LineBasicMaterial({ color: 0xff8a3a, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false });
  private readonly bodyGeo = (() => {
    const g = new THREE.ConeGeometry(0.22, 1.1, 10);
    g.rotateX(Math.PI / 2); // point +Z
    return g;
  })();
  private readonly flameGeo = new THREE.SphereGeometry(0.26, 8, 6);

  // scratch
  private readonly tmp = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    scene.add(this.group);
  }

  get ready(): boolean {
    return this.cooldown <= 0;
  }

  /** Launch a missile from `origin` along `dir` (normalized) at `speed` u/s. */
  fire(origin: THREE.Vector3, dir: THREE.Vector3, speed: number): void {
    if (this.cooldown > 0) return;
    this.cooldown = 0.32;

    const group = new THREE.Group();
    group.add(new THREE.Mesh(this.bodyGeo, this.bodyMat));
    const flame = new THREE.Mesh(this.flameGeo, this.flameMat);
    flame.position.z = -0.7;
    group.add(flame);
    group.position.copy(origin);
    this.group.add(group);

    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < TRAIL_LEN; i++) pts.push(origin.clone());
    const tgeo = new THREE.BufferGeometry();
    tgeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL_LEN * 3), 3));
    const trail = new THREE.Line(tgeo, this.trailMat);
    trail.frustumCulled = false;
    this.group.add(trail);

    this.missiles.push({ group, vel: dir.clone().normalize().multiplyScalar(speed), life: 3.2, trail, pts });
    audio.play('throw', 0.7);
  }

  /** `proximity` returns a detonation point if the missile struck something. */
  update(dt: number, proximity?: (pos: THREE.Vector3) => THREE.Vector3 | null): void {
    if (this.cooldown > 0) this.cooldown -= dt;

    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const m = this.missiles[i]!;
      m.life -= dt;
      m.group.position.addScaledVector(m.vel, dt);

      // Orient body to velocity.
      this.tmp.copy(m.vel).normalize();
      this.q.setFromUnitVectors(FORWARD, this.tmp);
      m.group.quaternion.copy(this.q);

      // Advance the trail: recycle the oldest point as the new head.
      const head = m.pts.pop()!;
      head.copy(m.group.position);
      m.pts.unshift(head);
      const attr = m.trail.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let k = 0; k < m.pts.length; k++) attr.setXYZ(k, m.pts[k]!.x, m.pts[k]!.y, m.pts[k]!.z);
      attr.needsUpdate = true;

      const hit = proximity?.(m.group.position) ?? null;
      if (hit || m.life <= 0) {
        this.detonate(hit ?? m.group.position);
        this.removeMissile(i);
      }
    }

    for (let i = this.blasts.length - 1; i >= 0; i--) {
      const b = this.blasts[i]!;
      b.t += dt;
      const k = Math.min(1, b.t / b.dur);
      b.mesh.scale.setScalar(b.radius * (0.3 + k * 1.4));
      b.mat.opacity = (1 - k) * 0.9;
      b.light.intensity = (1 - k) * 8;
      if (b.t >= b.dur) {
        this.group.remove(b.mesh, b.light);
        b.mat.dispose();
        this.blasts.splice(i, 1);
      }
    }
  }

  private detonate(at: THREE.Vector3): void {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffb060, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    const mesh = new THREE.Mesh(this.flameGeo, mat);
    mesh.position.copy(at);
    const light = new THREE.PointLight(0xff9a4a, 8, 220, 1.4);
    light.position.copy(at);
    this.group.add(mesh, light);
    this.blasts.push({ mesh, mat, light, t: 0, dur: 0.6, radius: 14 });
    audio.play('explosion', 0.7);
  }

  private removeMissile(i: number): void {
    const m = this.missiles[i]!;
    this.group.remove(m.group, m.trail);
    m.trail.geometry.dispose();
    this.missiles.splice(i, 1);
  }

  /** Apply the floating-origin shift (mirrors the camera's recenter). */
  shift(dx: number, dy: number, dz: number): void {
    for (const m of this.missiles) {
      m.group.position.set(m.group.position.x - dx, m.group.position.y - dy, m.group.position.z - dz);
      for (const p of m.pts) p.set(p.x - dx, p.y - dy, p.z - dz);
    }
    for (const b of this.blasts) {
      b.mesh.position.set(b.mesh.position.x - dx, b.mesh.position.y - dy, b.mesh.position.z - dz);
      b.light.position.copy(b.mesh.position);
    }
  }

  dispose(): void {
    for (let i = this.missiles.length - 1; i >= 0; i--) this.removeMissile(i);
    for (const b of this.blasts) {
      this.group.remove(b.mesh, b.light);
      b.mat.dispose();
    }
    this.blasts.length = 0;
    this.scene.remove(this.group);
    this.bodyGeo.dispose();
    this.flameGeo.dispose();
    this.bodyMat.dispose();
    this.flameMat.dispose();
    this.trailMat.dispose();
  }
}
