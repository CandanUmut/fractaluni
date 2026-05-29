import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { DEG2RAD } from '../core/math.ts';
import type { RNG } from '../core/rng.ts';
import type { RGB } from '../universe/types.ts';

// L-system plants. A recursive grammar is expanded to a turtle string, then
// interpreted in 3D into tapered trunk segments + leaf blobs, merged into ONE
// low-poly geometry per species so the species can be instanced across the
// terrain. Parameters (angle, depth, taper, leaf form) come from the biome.

export interface LSystemConfig {
  axiom: string;
  rules: Record<string, string>;
  depth: number;
  angle: number; // degrees
  angleJitter: number; // 0..1 random spread
  segLen: number;
  segLenFalloff: number;
  baseRadius: number;
  radiusFalloff: number;
  radialSegments: number; // 3–5 for low-poly
  leafSize: number;
  hasLeaves: boolean;
  trunkColor: RGB;
  leafColor: RGB;
}

function expand(cfg: LSystemConfig): string {
  let s = cfg.axiom;
  for (let i = 0; i < cfg.depth; i++) {
    let out = '';
    for (const ch of s) out += cfg.rules[ch] ?? ch;
    s = out;
    if (out.length > 20000) break; // safety against grammar explosion
  }
  return s;
}

function colorAttr(geo: THREE.BufferGeometry, c: RGB): void {
  const n = geo.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
}

/** Build a single merged plant geometry from an L-system config. */
export function buildPlant(cfg: LSystemConfig, rng: RNG): THREE.BufferGeometry {
  const seq = expand(cfg);
  const parts: THREE.BufferGeometry[] = [];

  const m = new THREE.Matrix4(); // turtle transform; starts upright (+Y).
  const stack: { m: THREE.Matrix4; len: number; rad: number }[] = [];
  let len = cfg.segLen;
  let rad = cfg.baseRadius;
  const base = cfg.angle * DEG2RAD;

  const rotX = new THREE.Matrix4();
  const rotY = new THREE.Matrix4();
  const rotZ = new THREE.Matrix4();
  const trans = new THREE.Matrix4();

  const ang = (): number => base * (1 + (rng() - 0.5) * 2 * cfg.angleJitter);

  // mergeGeometries requires uniform topology; force everything non-indexed and
  // give each part a color attribute so all parts share {position,normal,uv,color}.
  const push = (geo: THREE.BufferGeometry, c: RGB): void => {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (g !== geo) geo.dispose();
    colorAttr(g, c);
    parts.push(g);
  };

  for (const ch of seq) {
    switch (ch) {
      case 'F': {
        const seg = new THREE.CylinderGeometry(
          Math.max(0.02, rad * cfg.radiusFalloff),
          Math.max(0.03, rad),
          len,
          cfg.radialSegments,
          1,
        );
        seg.translate(0, len / 2, 0); // base at turtle origin
        seg.applyMatrix4(m);
        push(seg, cfg.trunkColor);
        m.multiply(trans.makeTranslation(0, len, 0));
        len *= cfg.segLenFalloff;
        rad *= cfg.radiusFalloff;
        break;
      }
      case '+': m.multiply(rotZ.makeRotationZ(ang())); break;
      case '-': m.multiply(rotZ.makeRotationZ(-ang())); break;
      case '&': m.multiply(rotX.makeRotationX(ang())); break;
      case '^': m.multiply(rotX.makeRotationX(-ang())); break;
      case '/': m.multiply(rotY.makeRotationY(ang())); break;
      case '\\': m.multiply(rotY.makeRotationY(-ang())); break;
      case '[': stack.push({ m: m.clone(), len, rad }); break;
      case ']': {
        const st = stack.pop();
        if (st) {
          m.copy(st.m);
          len = st.len;
          rad = st.rad;
        }
        break;
      }
      case 'L': {
        if (cfg.hasLeaves) {
          const leaf = new THREE.IcosahedronGeometry(cfg.leafSize, 0);
          leaf.applyMatrix4(m);
          push(leaf, cfg.leafColor);
        }
        break;
      }
      default:
        break;
    }
  }

  if (parts.length === 0) {
    // Degenerate fallback so callers always get a valid geometry.
    const g = new THREE.IcosahedronGeometry(cfg.leafSize, 0);
    colorAttr(g, cfg.leafColor);
    return g;
  }

  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  merged.computeVertexNormals();
  return merged;
}
