import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makeRNG } from '../core/rng.ts';
import { clamp, lerp, TAU } from '../core/math.ts';
import type { RGB } from '../universe/types.ts';

// Ambient swimming fish: a loose school that wanders the water volume (between
// the seabed and the surface) on watery planets. Rendered as one instanced
// mesh; fish over dry ground are hidden, so they only appear where there's water.

interface Fish {
  x: number;
  z: number;
  y: number;
  heading: number;
  turn: number;
  speed: number;
  depth: number; // preferred fraction of the water column
}

function fishGeometry(body: RGB): THREE.BufferGeometry {
  const dark: RGB = { r: body.r * 0.6, g: body.g * 0.6, b: body.b * 0.7 };
  const eye: RGB = { r: 0.05, g: 0.05, b: 0.06 };
  const parts: THREE.BufferGeometry[] = [];
  const colorize = (g: THREE.BufferGeometry, c: RGB): THREE.BufferGeometry => {
    const n = g.getAttribute('position').count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      arr[i * 3] = c.r;
      arr[i * 3 + 1] = c.g;
      arr[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    return g;
  };
  // Body (elongated along +Z = forward).
  const bodyGeo = new THREE.IcosahedronGeometry(1, 1).toNonIndexed();
  bodyGeo.scale(0.22, 0.28, 0.6);
  parts.push(colorize(bodyGeo, body));
  // Tail fin.
  const tail = new THREE.ConeGeometry(0.22, 0.34, 4).toNonIndexed();
  tail.rotateX(-Math.PI / 2);
  tail.scale(1, 0.4, 1);
  tail.translate(0, 0, -0.6);
  parts.push(colorize(tail, dark));
  // Dorsal fin.
  const dorsal = new THREE.ConeGeometry(0.12, 0.22, 4).toNonIndexed();
  dorsal.translate(0, 0.22, 0.02);
  parts.push(colorize(dorsal, dark));
  // Eyes.
  for (const sx of [-1, 1]) {
    const e = new THREE.IcosahedronGeometry(0.06, 0).toNonIndexed();
    e.translate(sx * 0.12, 0.05, 0.32);
    parts.push(colorize(e, eye));
  }
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  merged.computeVertexNormals();
  return merged;
}

export class FishSchool {
  readonly mesh: THREE.InstancedMesh;
  private readonly mat: THREE.MeshStandardMaterial;
  private readonly fish: Fish[] = [];
  private readonly heightAt: (x: number, z: number) => number;
  private readonly seaLevel: number;
  private readonly range = 130;
  private readonly dummy = new THREE.Object3D();
  private readonly q = new THREE.Quaternion();
  private readonly fwd = new THREE.Vector3();

  constructor(seed: number, count: number, color: RGB, seaLevel: number, heightAtLocal: (x: number, z: number) => number) {
    this.seaLevel = seaLevel;
    this.heightAt = heightAtLocal;
    this.mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.5, metalness: 0.2 });
    this.mesh = new THREE.InstancedMesh(fishGeometry(color), this.mat, count);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const rng = makeRNG(seed);
    for (let i = 0; i < count; i++) {
      this.fish.push({
        x: (rng() - 0.5) * this.range,
        z: (rng() - 0.5) * this.range,
        y: seaLevel - 2,
        heading: rng() * TAU,
        turn: 0,
        speed: 3 + rng() * 4,
        depth: 0.3 + rng() * 0.5,
      });
    }
  }

  shift(dx: number, dz: number): void {
    for (const f of this.fish) {
      f.x -= dx;
      f.z -= dz;
    }
  }

  update(dt: number, playerLocal: THREE.Vector3): void {
    let count = 0;
    for (const f of this.fish) {
      f.turn += (Math.random() - 0.5) * dt * 3;
      f.turn *= 0.9;
      f.heading += f.turn * dt;

      const dxp = playerLocal.x - f.x;
      const dzp = playerLocal.z - f.z;
      if (Math.hypot(dxp, dzp) > this.range) f.heading = lerp(f.heading, Math.atan2(dxp, dzp), 0.05);

      const nx = f.x + Math.sin(f.heading) * f.speed * dt;
      const nz = f.z + Math.cos(f.heading) * f.speed * dt;
      const ground = this.heightAt(nx, nz);
      if (ground < this.seaLevel - 0.8) {
        f.x = nx;
        f.z = nz;
      } else {
        f.heading += 2.5 * dt + 0.3; // veer back to deeper water
      }

      // Hold a depth within the local water column.
      const g = this.heightAt(f.x, f.z);
      if (g >= this.seaLevel - 0.5) continue; // dry/shallow here → this fish is hidden
      const targetY = lerp(this.seaLevel - 0.5, g + 0.4, f.depth);
      f.y += (targetY - f.y) * Math.min(1, dt * 2);

      this.fwd.set(Math.sin(f.heading), 0, Math.cos(f.heading));
      this.q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), this.fwd);
      this.dummy.position.set(f.x, f.y, f.z);
      this.dummy.quaternion.copy(this.q);
      this.dummy.scale.setScalar(1);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(count++, this.dummy.matrix);
    }
    this.mesh.count = count;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}

/** A silvery, water-tinted fish color from the planet's water palette. */
export function fishColor(water: RGB): RGB {
  return { r: clamp(0.5 + water.r * 0.4, 0, 1), g: clamp(0.6 + water.g * 0.3, 0, 1), b: clamp(0.7 + water.b * 0.3, 0, 1) };
}
