import * as THREE from 'three';
import { makeRNG, rangeFloat, type RNG } from '../core/rng.ts';
import { deriveSeed } from '../core/hash.ts';
import { TAU } from '../core/math.ts';
import type { Effects } from './effects.ts';

// Enemy raider ships that patrol a star system: they approach the player, hold a
// standoff distance while strafing, and periodically fire. Destroy one with a
// missile for a credit bounty; it respawns later so the system keeps some teeth.

export interface Enemy {
  group: THREE.Group;
  vel: THREE.Vector3;
  hp: number;
  maxHp: number;
  fireCd: number;
  radius: number;
  respawnT: number; // >0 while dead
}

const STANDOFF = 70; // preferred distance to the player
const RANGE = 150; // will open fire within this distance
const SPEED = 38;

export class Hostiles {
  readonly group = new THREE.Group();
  /** Fired when an enemy shoots — the scene spawns an enemy projectile. */
  onFire: (origin: THREE.Vector3, dir: THREE.Vector3) => void = () => {};

  private readonly enemies: Enemy[] = [];
  private readonly rng: RNG;
  private readonly area: number;
  private readonly bodyMat: THREE.MeshStandardMaterial;
  private readonly glowMat: THREE.MeshBasicMaterial;
  private readonly toPlayer = new THREE.Vector3();
  private readonly tangent = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();
  private readonly muzzle = new THREE.Vector3();
  private readonly fireDir = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);

  constructor(seed: number, count: number, area: number) {
    this.rng = makeRNG(deriveSeed(seed, 0x4a1de5));
    this.area = area;
    this.bodyMat = new THREE.MeshStandardMaterial({ color: 0x7a2630, flatShading: true, roughness: 0.6, metalness: 0.3 });
    this.glowMat = new THREE.MeshBasicMaterial({ color: 0xff5a4a });
    for (let i = 0; i < count; i++) {
      const g = this.buildShip();
      this.group.add(g);
      const e: Enemy = { group: g, vel: new THREE.Vector3(), hp: 40, maxHp: 40, fireCd: rangeFloat(this.rng, 0.5, 2.5), radius: 4, respawnT: 0 };
      this.place(e);
      this.enemies.push(e);
    }
  }

  /** A compact angular raider: dart body, swept wings, glowing eye. */
  private buildShip(): THREE.Group {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.ConeGeometry(1.4, 5, 6), this.bodyMat);
    body.rotation.x = Math.PI / 2; // point down -Z (forward)
    g.add(body);
    const wing = new THREE.Mesh(new THREE.BoxGeometry(6, 0.4, 1.8), this.bodyMat);
    wing.position.z = 0.8;
    g.add(wing);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 8), this.glowMat);
    eye.position.z = -2.4;
    g.add(eye);
    return g;
  }

  private place(e: Enemy): void {
    const u = this.rng() * 2 - 1;
    const t = this.rng() * TAU;
    const r = Math.sqrt(1 - u * u);
    const R = this.area * rangeFloat(this.rng, 0.8, 1.2);
    e.group.position.set(Math.cos(t) * r * R, u * R * 0.3, Math.sin(t) * r * R);
    e.group.visible = true;
    e.hp = e.maxHp;
    e.fireCd = rangeFloat(this.rng, 0.5, 2.5);
    e.respawnT = 0;
  }

  update(dt: number, playerPos: THREE.Vector3): void {
    for (const e of this.enemies) {
      if (e.respawnT > 0) {
        e.respawnT -= dt;
        if (e.respawnT <= 0) this.place(e);
        continue;
      }

      this.toPlayer.copy(playerPos).sub(e.group.position);
      const dist = this.toPlayer.length() || 1;
      this.toPlayer.multiplyScalar(1 / dist);
      // Strafe tangent (perpendicular in the horizontal-ish plane).
      this.tangent.crossVectors(this.toPlayer, this.up).normalize();

      // Approach to the standoff ring, then orbit it.
      const closing = dist > STANDOFF ? 1 : dist < STANDOFF * 0.7 ? -0.6 : 0;
      this.desired.copy(this.toPlayer).multiplyScalar(closing).addScaledVector(this.tangent, 0.6);
      if (this.desired.lengthSq() > 0) this.desired.normalize();
      e.vel.lerp(this.desired.multiplyScalar(SPEED), 1 - Math.exp(-dt * 1.5));
      e.group.position.addScaledVector(e.vel, dt);

      // Face the player.
      e.group.lookAt(playerPos);

      // Fire when roughly facing the player and in range.
      e.fireCd -= dt;
      if (dist < RANGE && e.fireCd <= 0) {
        e.fireCd = rangeFloat(this.rng, 1.6, 3.2);
        this.muzzle.copy(e.group.position).addScaledVector(this.toPlayer, 3);
        this.fireDir.copy(this.toPlayer);
        this.onFire(this.muzzle, this.fireDir);
      }
    }
  }

  /** The (live) enemy whose hull contains `pos`, or null. */
  intersect(pos: THREE.Vector3, pad = 2): Enemy | null {
    for (const e of this.enemies) {
      if (e.respawnT > 0) continue;
      if (pos.distanceTo(e.group.position) <= e.radius + pad) return e;
    }
    return null;
  }

  /** Damage an enemy. Returns whether it died + the bounty + the blast position. */
  damage(e: Enemy, dmg: number, effects: Effects): { killed: boolean; currency: number; pos: THREE.Vector3 } {
    const pos = e.group.position.clone();
    e.hp -= dmg;
    effects.burst(pos, new THREE.Color(0xff8a5a), 8, 6, 0.4, 0, 6);
    if (e.hp <= 0) {
      effects.explosion(pos, 9, new THREE.Color(0xff7a4a));
      e.group.visible = false;
      e.respawnT = rangeFloat(this.rng, 12, 22);
      return { killed: true, currency: Math.round(rangeFloat(this.rng, 40, 90)), pos };
    }
    return { killed: false, currency: 0, pos };
  }

  dispose(): void {
    for (const e of this.enemies) {
      e.group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.geometry.dispose();
      });
    }
    this.bodyMat.dispose();
    this.glowMat.dispose();
  }
}
