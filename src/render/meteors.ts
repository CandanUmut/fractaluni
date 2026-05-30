import * as THREE from 'three';
import { makeRNG, rangeFloat, type RNG } from '../core/rng.ts';
import { deriveSeed } from '../core/hash.ts';
import { TAU } from '../core/math.ts';
import type { Effects } from './effects.ts';

// Drifting meteors that float through a star system. Shoot one with a missile
// and it bursts into rock + dust and pays out a little salvage (currency). Each
// destroyed meteor respawns elsewhere after a delay, so the field stays alive.

export interface Meteor {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  radius: number;
  respawnT: number; // >0 while destroyed, counts down to respawn
}

export class Meteors {
  readonly group = new THREE.Group();
  private readonly meteors: Meteor[] = [];
  private readonly rng: RNG;
  private readonly area: number;
  private readonly mat: THREE.MeshStandardMaterial;

  constructor(seed: number, count: number, area: number) {
    this.rng = makeRNG(deriveSeed(seed, 0x3e7e0));
    this.area = area;
    this.mat = new THREE.MeshStandardMaterial({
      color: 0x6b6055,
      flatShading: true,
      roughness: 1,
      metalness: 0.1,
      emissive: 0x140d08,
      emissiveIntensity: 0.5,
    });
    for (let i = 0; i < count; i++) {
      const radius = rangeFloat(this.rng, 3, 8);
      const geo = new THREE.IcosahedronGeometry(radius, 0);
      // Jitter the vertices for an irregular rocky silhouette.
      const pos = geo.getAttribute('position') as THREE.BufferAttribute;
      for (let v = 0; v < pos.count; v++) {
        const f = 0.8 + this.rng() * 0.45;
        pos.setXYZ(v, pos.getX(v) * f, pos.getY(v) * f, pos.getZ(v) * f);
      }
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, this.mat);
      mesh.castShadow = false;
      this.group.add(mesh);
      const m: Meteor = { mesh, vel: new THREE.Vector3(), spin: new THREE.Vector3(), radius, respawnT: 0 };
      this.place(m);
      this.meteors.push(m);
    }
  }

  private place(m: Meteor): void {
    // A random point on a shell, given a slow cross-system drift.
    const u = this.rng() * 2 - 1;
    const t = this.rng() * TAU;
    const r = Math.sqrt(1 - u * u);
    const R = this.area * rangeFloat(this.rng, 0.55, 1.0);
    m.mesh.position.set(Math.cos(t) * r * R, u * R * 0.4, Math.sin(t) * r * R);
    m.mesh.visible = true;
    const sp = rangeFloat(this.rng, 4, 12);
    m.vel.set(rangeFloat(this.rng, -1, 1), rangeFloat(this.rng, -0.3, 0.3), rangeFloat(this.rng, -1, 1)).normalize().multiplyScalar(sp);
    m.spin.set(rangeFloat(this.rng, -1, 1), rangeFloat(this.rng, -1, 1), rangeFloat(this.rng, -1, 1)).multiplyScalar(0.6);
    m.respawnT = 0;
  }

  update(dt: number): void {
    for (const m of this.meteors) {
      if (m.respawnT > 0) {
        m.respawnT -= dt;
        if (m.respawnT <= 0) this.place(m);
        continue;
      }
      m.mesh.position.addScaledVector(m.vel, dt);
      m.mesh.rotation.x += m.spin.x * dt;
      m.mesh.rotation.y += m.spin.y * dt;
      m.mesh.rotation.z += m.spin.z * dt;
      if (m.mesh.position.length() > this.area * 1.5) this.place(m);
    }
  }

  /** The (live) meteor whose body contains `pos`, or null. */
  intersect(pos: THREE.Vector3, pad = 1.5): Meteor | null {
    for (const m of this.meteors) {
      if (m.respawnT > 0) continue;
      if (pos.distanceTo(m.mesh.position) <= m.radius + pad) return m;
    }
    return null;
  }

  /** Blow up a meteor: explosion FX, schedule a respawn, return the salvage. */
  destroy(m: Meteor, effects: Effects): { currency: number; pos: THREE.Vector3 } {
    const pos = m.mesh.position.clone();
    effects.explosion(pos, m.radius * 1.5, new THREE.Color(0xffa24a));
    effects.burst(pos, new THREE.Color(0x6b6055), 24, m.radius * 2, 1.2, 0, m.radius * 3); // rock debris
    m.mesh.visible = false;
    m.respawnT = rangeFloat(this.rng, 8, 16);
    return { currency: Math.round(m.radius * rangeFloat(this.rng, 6, 12)), pos };
  }

  dispose(): void {
    for (const m of this.meteors) m.mesh.geometry.dispose();
    this.mat.dispose();
  }
}
