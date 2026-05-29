import * as THREE from 'three';
import { makeRNG } from '../core/rng.ts';
import { rgbToHex } from '../core/color.ts';
import { lerp } from '../core/math.ts';
import type { RGB } from '../universe/types.ts';

// Classic boids: separation + alignment + cohesion + bounds + a gentle wandering
// goal. Rendered as one InstancedMesh of a low-poly bird whose wings flap in the
// vertex shader (per-instance phase). Operates in the surface scene's local
// space; positions are shifted on floating-origin recenter.

const FLAP_SPEED = 9;
const MAX_FLAP = 0.9;

interface Boid {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
}

/** Build a small bird: two wing triangles + a body sliver, with per-vertex
 *  side/wing attributes so the shader can flap the wingtips. */
function birdGeometry(): THREE.BufferGeometry {
  // [x,y,z, side, wing] per vertex; forward = +Z.
  const front = [0, 0, 0.5];
  const back = [0, 0, -0.45];
  const lTip = [-0.75, 0, -0.05];
  const rTip = [0.75, 0, -0.05];

  const verts: number[][] = [
    // left wing
    [...front, 0, 0], [...lTip, -1, 1], [...back, 0, 0],
    // right wing
    [...front, 0, 0], [...back, 0, 0], [...rTip, 1, 1],
  ];

  const pos = new Float32Array(verts.length * 3);
  const side = new Float32Array(verts.length);
  const wing = new Float32Array(verts.length);
  for (let i = 0; i < verts.length; i++) {
    pos[i * 3] = verts[i]![0]!;
    pos[i * 3 + 1] = verts[i]![1]!;
    pos[i * 3 + 2] = verts[i]![2]!;
    side[i] = verts[i]![3]!;
    wing[i] = verts[i]![4]!;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
  geo.setAttribute('aWing', new THREE.BufferAttribute(wing, 1));
  return geo;
}

function birdMaterial(color: RGB): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(rgbToHex(color)) },
    },
    vertexShader: /* glsl */ `
      attribute float aSide;
      attribute float aWing;
      attribute float aPhase;
      uniform float uTime;
      varying float vShade;
      void main() {
        vec3 p = position;
        float ang = sin(uTime * ${FLAP_SPEED.toFixed(1)} + aPhase) * ${MAX_FLAP.toFixed(2)} * aWing;
        float a = ang * aSide;
        float s = sin(a), c = cos(a);
        vec3 q = vec3(c * p.x - s * p.y, s * p.x + c * p.y, p.z);
        vShade = 0.7 + 0.3 * abs(q.y) + 0.15 * aWing;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(q, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying float vShade;
      void main() {
        gl_FragColor = vec4(uColor * clamp(vShade, 0.0, 1.2), 1.0);
      }
    `,
  });
}

export class BirdFlock {
  readonly mesh: THREE.InstancedMesh;
  private readonly mat: THREE.ShaderMaterial;
  private readonly boids: Boid[] = [];
  private readonly heightAtLocal: (x: number, z: number) => number;
  private readonly center = new THREE.Vector3();
  private readonly goal = new THREE.Vector3(0, 60, 0);
  private goalTimer = 0;

  // scratch
  private readonly sep = new THREE.Vector3();
  private readonly ali = new THREE.Vector3();
  private readonly coh = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly dummy = new THREE.Object3D();
  private readonly q = new THREE.Quaternion();
  private readonly fwd = new THREE.Vector3(0, 0, 1);

  // tuning
  private readonly perception = 14;
  private readonly sepDist = 6;
  private readonly maxSpeed = 26;
  private readonly maxForce = 40;
  private readonly bounds = 120;
  private readonly bandY = 38; // flight height above player

  private readonly bodyScale: number;

  constructor(seed: number, count: number, color: RGB, heightAtLocal: (x: number, z: number) => number, scale = 1.6) {
    this.heightAtLocal = heightAtLocal;
    this.bodyScale = scale;
    const rng = makeRNG(seed);
    for (let i = 0; i < count; i++) {
      this.boids.push({
        pos: new THREE.Vector3(
          (rng() - 0.5) * this.bounds,
          this.bandY + (rng() - 0.5) * 30,
          (rng() - 0.5) * this.bounds,
        ),
        vel: new THREE.Vector3((rng() - 0.5) * 10, (rng() - 0.5) * 4, (rng() - 0.5) * 10),
      });
    }

    const geo = birdGeometry();
    const phase = new Float32Array(count);
    for (let i = 0; i < count; i++) phase[i] = rng() * Math.PI * 2;
    geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));

    this.mat = birdMaterial(color);
    this.mesh = new THREE.InstancedMesh(geo, this.mat, count);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  }

  /** Shift all boids when the floating origin recenters. */
  shift(dx: number, dz: number): void {
    for (const b of this.boids) {
      b.pos.x -= dx;
      b.pos.z -= dz;
    }
    this.goal.x -= dx;
    this.goal.z -= dz;
  }

  update(dt: number, playerLocal: THREE.Vector3): void {
    this.mat.uniforms.uTime!.value += dt;
    this.center.set(playerLocal.x, 0, playerLocal.z);

    // Wandering goal drifts around the player every few seconds.
    this.goalTimer -= dt;
    if (this.goalTimer <= 0) {
      this.goalTimer = 4 + Math.random() * 4; // visual-only jitter (not world gen)
      this.goal.set(
        this.center.x + (Math.random() - 0.5) * this.bounds,
        this.bandY + (Math.random() - 0.5) * 20,
        this.center.z + (Math.random() - 0.5) * this.bounds,
      );
    }

    for (let i = 0; i < this.boids.length; i++) {
      const b = this.boids[i]!;
      this.sep.set(0, 0, 0);
      this.ali.set(0, 0, 0);
      this.coh.set(0, 0, 0);
      let n = 0;
      let nSep = 0;
      for (let j = 0; j < this.boids.length; j++) {
        if (i === j) continue;
        const o = this.boids[j]!;
        const d = b.pos.distanceTo(o.pos);
        if (d < this.perception) {
          this.ali.add(o.vel);
          this.coh.add(o.pos);
          n++;
          if (d < this.sepDist && d > 1e-4) {
            this.tmp.copy(b.pos).sub(o.pos).multiplyScalar(1 / (d * d));
            this.sep.add(this.tmp);
            nSep++;
          }
        }
      }

      const acc = new THREE.Vector3();
      if (n > 0) {
        this.ali.multiplyScalar(1 / n);
        this.steer(this.ali, b.vel, acc, 1.0);
        this.coh.multiplyScalar(1 / n).sub(b.pos);
        this.steer(this.coh, b.vel, acc, 0.9);
      }
      if (nSep > 0) {
        this.sep.multiplyScalar(1 / nSep);
        this.steer(this.sep, b.vel, acc, 1.6);
      }

      // Gentle goal + soft bounds back toward the player column.
      this.tmp.copy(this.goal).sub(b.pos);
      this.steer(this.tmp, b.vel, acc, 0.5);
      this.tmp.set(this.center.x - b.pos.x, this.bandY - b.pos.y, this.center.z - b.pos.z);
      const distXZ = Math.hypot(b.pos.x - this.center.x, b.pos.z - this.center.z);
      if (distXZ > this.bounds) this.steer(this.tmp, b.vel, acc, 1.2);

      // Terrain avoidance: stay comfortably above the ground.
      const ground = this.heightAtLocal(b.pos.x, b.pos.z);
      const minY = ground + 18;
      if (b.pos.y < minY) acc.y += (minY - b.pos.y) * 6;

      // Integrate.
      b.vel.addScaledVector(acc, dt);
      const sp = b.vel.length();
      if (sp > this.maxSpeed) b.vel.multiplyScalar(this.maxSpeed / sp);
      else if (sp < this.maxSpeed * 0.45) b.vel.multiplyScalar((this.maxSpeed * 0.45) / Math.max(sp, 1e-3));
      b.pos.addScaledVector(b.vel, dt);

      // Orient to velocity and write the instance matrix.
      this.tmp.copy(b.vel).normalize();
      this.q.setFromUnitVectors(this.fwd, this.tmp);
      this.dummy.position.copy(b.pos);
      this.dummy.quaternion.copy(this.q);
      this.dummy.scale.setScalar(this.bodyScale);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  private steer(target: THREE.Vector3, vel: THREE.Vector3, acc: THREE.Vector3, weight: number): void {
    const len = target.length();
    if (len < 1e-4) return;
    this.tmp.copy(target).multiplyScalar(this.maxSpeed / len).sub(vel);
    const f = this.tmp.length();
    if (f > this.maxForce) this.tmp.multiplyScalar(this.maxForce / f);
    acc.addScaledVector(this.tmp, weight);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}

/** Pick a bird color that contrasts a little with the foliage. */
export function birdColor(foliage: RGB): RGB {
  return { r: lerp(foliage.r, 0.1, 0.6), g: lerp(foliage.g, 0.1, 0.6), b: lerp(foliage.b, 0.12, 0.5) };
}
