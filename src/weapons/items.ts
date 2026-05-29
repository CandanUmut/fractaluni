import * as THREE from 'three';
import type { Effects } from '../render/effects.ts';
import { sfx } from '../audio/sfx.ts';

// Equippable items: gun (hitscan), bomb (thrown arc + explosion), drill (beam).
// Viewmodels are built procedurally; per-state animation (recoil, spin, throw)
// is transform math. Phase C hooks extraction/damage into onHit.

export interface RayHit {
  point: THREE.Vector3;
  normal: THREE.Vector3;
  distance: number;
  object: THREE.Object3D | null;
}

export interface WeaponCtx {
  /** Muzzle origin (camera position) in scene-local space. */
  pos: THREE.Vector3;
  /** Normalized aim direction. */
  dir: THREE.Vector3;
  raycast: (origin: THREE.Vector3, dir: THREE.Vector3, far: number) => RayHit | null;
  effects: Effects;
  /** Viewmodel recoil impulse. */
  kick: (back: number, up: number, rot: number) => void;
  /** Called when something is struck (Phase C/D: extraction / damage). */
  onHit?: (hit: RayHit, kind: 'gun' | 'bomb' | 'drill', dt: number) => void;
}

export type ItemKind = 'gun' | 'bomb' | 'drill';

export interface HeldItem {
  readonly name: string;
  readonly kind: ItemKind;
  readonly object: THREE.Object3D; // viewmodel geometry
  equip(): void;
  holster(): void;
  primaryDown(ctx: WeaponCtx): void;
  primaryUp(ctx: WeaponCtx): void;
  update(dt: number, ctx: WeaponCtx): void;
  dispose(): void;
}

const HIT = new THREE.Color(0xcfe6ff);

// ---- Gun -------------------------------------------------------------------

export class Gun implements HeldItem {
  readonly name = 'Pulse Rifle';
  readonly kind = 'gun' as const;
  readonly object = new THREE.Group();
  damage = 12;
  private readonly fireInterval = 0.11;
  private readonly range = 240;
  private cooldown = 0;
  private firing = false;
  private readonly flash: THREE.Mesh;
  private readonly muzzle = new THREE.Vector3(0, 0.03, -0.5);

  constructor() {
    const steel = new THREE.MeshStandardMaterial({ color: 0x3b4250, flatShading: true, roughness: 0.5, metalness: 0.5 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x23272f, flatShading: true });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.13, 0.46), steel);
    body.position.set(0, 0, 0.05);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.5, 10), steel);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.03, -0.26);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.16, 0.1), dark);
    grip.position.set(0, -0.14, 0.16);
    grip.rotation.x = 0.3;
    this.flash = new THREE.Mesh(
      new THREE.PlaneGeometry(0.3, 0.3),
      new THREE.MeshBasicMaterial({ color: 0xfff0c0, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.flash.position.copy(this.muzzle).add(new THREE.Vector3(0, 0, -0.05));
    this.object.add(body, barrel, grip, this.flash);
  }

  equip(): void {}
  holster(): void {
    this.firing = false;
  }
  primaryDown(): void {
    this.firing = true;
  }
  primaryUp(): void {
    this.firing = false;
  }

  update(dt: number, ctx: WeaponCtx): void {
    this.cooldown -= dt;
    const fmat = this.flash.material as THREE.MeshBasicMaterial;
    fmat.opacity *= Math.exp(-dt * 26);
    if (this.firing && this.cooldown <= 0) {
      this.cooldown = this.fireInterval;
      this.fire(ctx);
    }
  }

  private fire(ctx: WeaponCtx): void {
    const hit = ctx.raycast(ctx.pos, ctx.dir, this.range);
    (this.flash.material as THREE.MeshBasicMaterial).opacity = 1;
    ctx.kick(0.05, 0.02, -0.06);
    ctx.effects.addShake(0.05);
    sfx.gun();
    if (hit) {
      ctx.effects.burst(hit.point, HIT, 10, 6, 0.35, -6, 5);
      ctx.onHit?.(hit, 'gun', 0);
    }
  }

  dispose(): void {
    this.object.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
  }
}

// ---- Bomb ------------------------------------------------------------------

interface Projectile {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  prev: THREE.Vector3;
  life: number;
}

export class Bomb implements HeldItem {
  readonly name = 'Frag Charge';
  readonly kind = 'bomb' as const;
  readonly object = new THREE.Group();
  radius = 9;
  private readonly throwSpeed = 42;
  private readonly cooldownTime = 0.7;
  private cooldown = 0;
  private readonly world: THREE.Group;
  private readonly projectiles: Projectile[] = [];
  private readonly preview: THREE.Line;
  private equipped = false;

  // scratch
  private readonly seg = new THREE.Vector3();

  constructor(world: THREE.Group) {
    this.world = world;
    const mat = new THREE.MeshStandardMaterial({ color: 0x2b3340, flatShading: true, roughness: 0.6, metalness: 0.3 });
    const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(0.13, 1), mat);
    const stripe = new THREE.Mesh(
      new THREE.TorusGeometry(0.13, 0.02, 8, 16),
      new THREE.MeshStandardMaterial({ color: 0xff5a3a, emissive: 0xff3a1a, emissiveIntensity: 0.6, flatShading: true }),
    );
    this.object.add(shell, stripe);

    // Arc preview line (in world space).
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(28 * 3), 3));
    this.preview = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xff7a3a, transparent: true, opacity: 0.5 }));
    this.preview.frustumCulled = false;
    this.preview.visible = false;
    this.world.add(this.preview);
  }

  equip(): void {
    this.equipped = true;
    this.preview.visible = true;
  }
  holster(): void {
    this.equipped = false;
    this.preview.visible = false;
  }
  primaryDown(ctx: WeaponCtx): void {
    if (this.cooldown > 0) return;
    this.cooldown = this.cooldownTime;
    const mat = new THREE.MeshStandardMaterial({ color: 0x2b3340, flatShading: true });
    const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.35, 1), mat);
    const start = ctx.pos.clone().addScaledVector(ctx.dir, 1.2);
    mesh.position.copy(start);
    this.world.add(mesh);
    const vel = ctx.dir.clone().multiplyScalar(this.throwSpeed).add(new THREE.Vector3(0, 6, 0));
    this.projectiles.push({ mesh, vel, prev: start.clone(), life: 6 });
    ctx.kick(0.04, 0.06, 0.05);
    sfx.blip(300);
  }
  primaryUp(): void {}

  update(dt: number, ctx: WeaponCtx): void {
    if (this.cooldown > 0) this.cooldown -= dt;
    if (this.equipped) this.updatePreview(ctx);

    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i]!;
      p.life -= dt;
      p.prev.copy(p.mesh.position);
      p.vel.y -= 22 * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      p.mesh.rotation.x += dt * 6;
      this.seg.copy(p.mesh.position).sub(p.prev);
      const dist = this.seg.length();
      const hit = dist > 1e-4 ? ctx.raycast(p.prev, this.seg.normalize(), dist + 0.4) : null;
      if (hit || p.life <= 0) {
        const at = hit ? hit.point : p.mesh.position;
        ctx.effects.explosion(at, this.radius, new THREE.Color(0xff8a3a));
        sfx.explosion();
        if (hit) ctx.onHit?.({ ...hit, point: at }, 'bomb', 0);
        this.world.remove(p.mesh);
        p.mesh.geometry.dispose();
        (p.mesh.material as THREE.Material).dispose();
        this.projectiles.splice(i, 1);
      }
    }
  }

  private updatePreview(ctx: WeaponCtx): void {
    const arr = this.preview.geometry.getAttribute('position') as THREE.BufferAttribute;
    const p = ctx.pos.clone().addScaledVector(ctx.dir, 1.2);
    const v = ctx.dir.clone().multiplyScalar(this.throwSpeed).add(new THREE.Vector3(0, 6, 0));
    const step = 0.08;
    for (let i = 0; i < 28; i++) {
      arr.setXYZ(i, p.x, p.y, p.z);
      v.y -= 22 * step;
      p.addScaledVector(v, step);
    }
    arr.needsUpdate = true;
  }

  dispose(): void {
    for (const p of this.projectiles) {
      this.world.remove(p.mesh);
      p.mesh.geometry.dispose();
    }
    this.world.remove(this.preview);
    this.preview.geometry.dispose();
    (this.preview.material as THREE.Material).dispose();
    this.object.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
  }
}

// ---- Drill -----------------------------------------------------------------

export class Drill implements HeldItem {
  readonly name = 'Mining Drill';
  readonly kind = 'drill' as const;
  readonly object = new THREE.Group();
  tier = 1;
  range = 6;
  private drilling = false;
  private spin = 0;
  private readonly bit: THREE.Mesh;
  private readonly beam: THREE.Mesh;
  private readonly world: THREE.Group;
  private sparkT = 0;

  constructor(world: THREE.Group) {
    this.world = world;
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.13, 0.15, 0.34),
      new THREE.MeshStandardMaterial({ color: 0x5a4a2a, flatShading: true, roughness: 0.5, metalness: 0.5 }),
    );
    body.position.set(0, 0, 0.08);
    this.bit = new THREE.Mesh(
      new THREE.ConeGeometry(0.07, 0.4, 6),
      new THREE.MeshStandardMaterial({ color: 0xc8a050, flatShading: true, metalness: 0.7, roughness: 0.3 }),
    );
    this.bit.rotation.x = -Math.PI / 2;
    this.bit.position.set(0, 0.02, -0.32);
    const grip = new THREE.Mesh(
      new THREE.BoxGeometry(0.07, 0.16, 0.1),
      new THREE.MeshStandardMaterial({ color: 0x2a2f3a, flatShading: true }),
    );
    grip.position.set(0, -0.15, 0.16);
    grip.rotation.x = 0.3;
    this.object.add(body, this.bit, grip);

    // World-space mining beam (hidden until drilling).
    this.beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, 1, 8),
      new THREE.MeshBasicMaterial({ color: 0xffc24a, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.beam.visible = false;
    this.world.add(this.beam);
  }

  equip(): void {}
  holster(): void {
    this.stop();
  }
  primaryDown(): void {
    this.drilling = true;
    sfx.startDrill();
  }
  primaryUp(): void {
    this.stop();
  }
  private stop(): void {
    if (this.drilling) sfx.stopDrill();
    this.drilling = false;
    this.beam.visible = false;
  }

  update(dt: number, ctx: WeaponCtx): void {
    if (this.drilling) {
      this.spin += dt * 22;
      this.bit.rotation.z = this.spin;
      const hit = ctx.raycast(ctx.pos, ctx.dir, this.range);
      if (hit) {
        // Position beam from muzzle to hit point.
        const start = ctx.pos.clone().addScaledVector(ctx.dir, 0.6);
        this.placeBeam(start, hit.point);
        this.beam.visible = true;
        this.sparkT -= dt;
        if (this.sparkT <= 0) {
          this.sparkT = 0.04;
          ctx.effects.burst(hit.point, new THREE.Color(0xffd27a), 4, 4, 0.3, -8, 4);
        }
        ctx.effects.addShake(0.012);
        ctx.onHit?.(hit, 'drill', dt);
      } else {
        this.beam.visible = false;
      }
    } else {
      this.spin += dt * 2;
      this.bit.rotation.z = this.spin;
    }
  }

  private placeBeam(a: THREE.Vector3, b: THREE.Vector3): void {
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const len = a.distanceTo(b);
    this.beam.position.copy(mid);
    this.beam.scale.set(1, len, 1);
    this.beam.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      b.clone().sub(a).normalize(),
    );
  }

  dispose(): void {
    this.stop();
    this.world.remove(this.beam);
    this.beam.geometry.dispose();
    (this.beam.material as THREE.Material).dispose();
    this.object.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
  }
}

export function makeWeapons(world: THREE.Group): HeldItem[] {
  return [new Gun(), new Bomb(world), new Drill(world)];
}
