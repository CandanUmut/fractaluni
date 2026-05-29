import * as THREE from 'three';
import { settings } from '../../ui/settings.ts';

// Quaternion-based 6DOF free-fly controller. Pointer-lock mouse look (yaw+pitch
// in the camera's local frame, so there's no gimbal lock), Q/E roll, WASD +
// R/F translate, Shift = warp boost. Velocity is damped for a smooth, driftless
// feel. The controller only touches a local-space position vector — the
// FloatingOrigin rebases it; the controller is unaware of absolute coordinates.

const KEYS = {
  forward: new Set(['w', 'W']),
  back: new Set(['s', 'S']),
  left: new Set(['a', 'A']),
  right: new Set(['d', 'D']),
  up: new Set(['r', 'R', ' ']),
  down: new Set(['f', 'F']),
  rollL: new Set(['q', 'Q']),
  rollR: new Set(['e', 'E']),
};

export class FlyController {
  enabled = true;
  baseSpeed = 220; // world units / second
  warpMultiplier = 6;
  lookSensitivity = 0.0022;
  rollSpeed = 1.4; // rad / second
  damping = 6; // higher = snappier stop

  private readonly target: THREE.Object3D;
  private readonly dom: HTMLElement;
  private readonly pressed = new Set<string>();
  private readonly velocity = new THREE.Vector3();
  private warp = false;
  private locked = false;
  /** Recent horizontal look input, decayed each frame — drives ship banking. */
  private yawInput = 0;

  // scratch
  private readonly qYaw = new THREE.Quaternion();
  private readonly qPitch = new THREE.Quaternion();
  private readonly qRoll = new THREE.Quaternion();
  private readonly right = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3();
  private readonly move = new THREE.Vector3();

  constructor(target: THREE.Object3D, dom: HTMLElement) {
    this.target = target;
    this.dom = dom;
    dom.addEventListener('click', this.onClick);
    document.addEventListener('pointerlockchange', this.onLockChange);
    document.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
  }

  private onClick = (): void => {
    if (this.enabled && !this.locked) this.dom.requestPointerLock();
  };

  private onLockChange = (): void => {
    this.locked = document.pointerLockElement === this.dom;
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (!this.locked || !this.enabled) return;
    // Yaw about local up, pitch about local right — applied to camera quaternion.
    this.target.getWorldDirection(this.fwd);
    this.up.set(0, 1, 0).applyQuaternion(this.target.quaternion);
    this.right.set(1, 0, 0).applyQuaternion(this.target.quaternion);

    const sens = this.lookSensitivity * settings.sensitivity;
    this.qYaw.setFromAxisAngle(this.up, -e.movementX * sens);
    this.qPitch.setFromAxisAngle(this.right, -e.movementY * sens);
    this.target.quaternion.premultiply(this.qYaw).premultiply(this.qPitch);
    this.target.quaternion.normalize();
    this.yawInput += e.movementX;
  };

  /** Smoothed recent turn input, for visual banking of a ship. */
  get turnRate(): number {
    return this.yawInput;
  }

  get speedFraction(): number {
    return this.velocity.length() / (this.baseSpeed * (this.warp ? this.warpMultiplier : 1) + 1e-3);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    this.pressed.add(e.key);
    if (e.key === 'Shift') this.warp = true;
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.pressed.delete(e.key);
    if (e.key === 'Shift') this.warp = false;
  };

  private any(set: Set<string>): boolean {
    for (const k of set) if (this.pressed.has(k)) return true;
    return false;
  }

  get isLocked(): boolean {
    return this.locked;
  }

  get isWarping(): boolean {
    return this.warp && this.velocity.lengthSq() > 1;
  }

  update(dt: number): void {
    if (!this.enabled) return;

    // Roll (always available; doesn't need pointer lock).
    let roll = 0;
    if (this.any(KEYS.rollL)) roll += 1;
    if (this.any(KEYS.rollR)) roll -= 1;
    if (roll !== 0) {
      this.fwd.set(0, 0, -1).applyQuaternion(this.target.quaternion);
      this.qRoll.setFromAxisAngle(this.fwd, roll * this.rollSpeed * dt);
      this.target.quaternion.premultiply(this.qRoll).normalize();
    }

    // Desired move direction in local frame.
    this.move.set(0, 0, 0);
    if (this.any(KEYS.forward)) this.move.z -= 1;
    if (this.any(KEYS.back)) this.move.z += 1;
    if (this.any(KEYS.left)) this.move.x -= 1;
    if (this.any(KEYS.right)) this.move.x += 1;
    if (this.any(KEYS.up)) this.move.y += 1;
    if (this.any(KEYS.down)) this.move.y -= 1;

    const speed = this.baseSpeed * (this.warp ? this.warpMultiplier : 1);
    if (this.move.lengthSq() > 0) {
      this.move.normalize().applyQuaternion(this.target.quaternion).multiplyScalar(speed);
    }

    // Critically-damped approach of velocity toward the target.
    const k = 1 - Math.exp(-this.damping * dt);
    this.velocity.lerp(this.move, k);
    this.target.position.addScaledVector(this.velocity, dt);

    // Decay banking input.
    this.yawInput *= Math.exp(-dt * 7);
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
