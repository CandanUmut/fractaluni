import * as THREE from 'three';
import { clamp } from '../../core/math.ts';

// Walk + fly character controller for the surface. Euler yaw/pitch mouse look
// (pitch clamped, no roll). Walk mode applies gravity and follows the terrain
// via a height callback; fly mode is free 3D. Operates purely in local space —
// the SurfaceScene's floating origin handles long distances.

export type MoveMode = 'walk' | 'fly';

export class SurfaceController {
  enabled = true;
  mode: MoveMode = 'walk';
  eyeHeight = 2.6;
  walkSpeed = 22;
  flySpeed = 70;
  gravity = -32;
  jumpSpeed = 14;
  lookSensitivity = 0.0022;

  private readonly camera: THREE.PerspectiveCamera;
  private readonly dom: HTMLElement;
  private readonly heightAtLocal: (x: number, z: number) => number;
  private readonly pressed = new Set<string>();

  private yaw = 0;
  private pitch = 0;
  private locked = false;
  private vy = 0;
  private onGround = false;

  private readonly euler = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly fwd = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly move = new THREE.Vector3();

  constructor(
    camera: THREE.PerspectiveCamera,
    dom: HTMLElement,
    heightAtLocal: (x: number, z: number) => number,
  ) {
    this.camera = camera;
    this.dom = dom;
    this.heightAtLocal = heightAtLocal;
    dom.addEventListener('click', this.onClick);
    document.addEventListener('pointerlockchange', this.onLockChange);
    document.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
  }

  /** Drop the camera onto the terrain at its current XZ. */
  placeOnGround(): void {
    const h = this.heightAtLocal(this.camera.position.x, this.camera.position.z);
    this.camera.position.y = h + this.eyeHeight;
    this.vy = 0;
  }

  private onClick = (): void => {
    if (this.enabled && !this.locked) this.dom.requestPointerLock();
  };

  private onLockChange = (): void => {
    this.locked = document.pointerLockElement === this.dom;
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (!this.locked || !this.enabled) return;
    this.yaw -= e.movementX * this.lookSensitivity;
    this.pitch -= e.movementY * this.lookSensitivity;
    this.pitch = clamp(this.pitch, -1.5, 1.5);
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    this.pressed.add(e.key.toLowerCase());
    if (e.key === 'g' || e.key === 'G') {
      this.mode = this.mode === 'walk' ? 'fly' : 'walk';
      this.vy = 0;
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.pressed.delete(e.key.toLowerCase());
  };

  private k(key: string): boolean {
    return this.pressed.has(key);
  }

  get isLocked(): boolean {
    return this.locked;
  }

  update(dt: number): void {
    if (!this.enabled) return;

    // Orientation.
    this.euler.set(this.pitch, this.yaw, 0, 'YXZ');
    this.camera.quaternion.setFromEuler(this.euler);

    const sprint = this.k('shift');
    if (this.mode === 'fly') {
      this.updateFly(dt, sprint);
    } else {
      this.updateWalk(dt, sprint);
    }
  }

  private updateFly(dt: number, boost: boolean): void {
    this.camera.getWorldDirection(this.fwd);
    this.right.crossVectors(this.fwd, this.camera.up).normalize();
    this.move.set(0, 0, 0);
    if (this.k('w')) this.move.add(this.fwd);
    if (this.k('s')) this.move.addScaledVector(this.fwd, -1);
    if (this.k('d')) this.move.add(this.right);
    if (this.k('a')) this.move.addScaledVector(this.right, -1);
    if (this.k(' ')) this.move.y += 1;
    if (this.k('control')) this.move.y -= 1;
    const speed = this.flySpeed * (boost ? 4 : 1);
    if (this.move.lengthSq() > 0) this.move.normalize().multiplyScalar(speed * dt);
    this.camera.position.add(this.move);
  }

  private updateWalk(dt: number, sprint: boolean): void {
    // Horizontal basis from yaw only (no vertical component while walking).
    this.fwd.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this.right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    this.move.set(0, 0, 0);
    if (this.k('w')) this.move.add(this.fwd);
    if (this.k('s')) this.move.addScaledVector(this.fwd, -1);
    if (this.k('d')) this.move.add(this.right);
    if (this.k('a')) this.move.addScaledVector(this.right, -1);
    const speed = this.walkSpeed * (sprint ? 2 : 1);
    if (this.move.lengthSq() > 0) this.move.normalize().multiplyScalar(speed * dt);
    this.camera.position.x += this.move.x;
    this.camera.position.z += this.move.z;

    // Gravity + ground collision.
    this.vy += this.gravity * dt;
    this.camera.position.y += this.vy * dt;
    const groundY = this.heightAtLocal(this.camera.position.x, this.camera.position.z) + this.eyeHeight;
    if (this.camera.position.y <= groundY) {
      this.camera.position.y = groundY;
      this.vy = 0;
      this.onGround = true;
    } else {
      this.onGround = false;
    }
    if (this.onGround && this.k(' ')) this.vy = this.jumpSpeed;
  }

  dispose(): void {
    this.dom.removeEventListener('click', this.onClick);
    document.removeEventListener('pointerlockchange', this.onLockChange);
    document.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    if (this.locked) document.exitPointerLock();
  }
}
