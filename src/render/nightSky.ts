import * as THREE from 'three';
import { deriveCellSeed, deriveStarSeed, starCountForCell, deriveStar } from '../universe/index.ts';
import { deriveSeed } from '../core/hash.ts';
import { makeRNG } from '../core/rng.ts';
import { clamp, DEG2RAD, TAU } from '../core/math.ts';

// The real galaxy starfield, seen from a planet surface. Not a fake skybox:
// every star here is one of the actual stars derived for the galaxy cells around
// the home star — the same data the GalaxyScene streams and you fly through.
// Each star is projected onto a large celestial sphere by its true direction
// from the home star, sized by apparent brightness (luminosity / distance²), and
// the whole field wheels slowly overhead and fades in as night falls.

// Must match starfield.ts so projected directions line up with the galaxy.
const CELL_SIZE = 1200;
const MARGIN = 80;
const SKY_R = 5200; // celestial sphere radius (inside the 6000 sky dome)
const MAX_STARS = 4500;

/** Absolute galaxy-space position + profile of one star (mirrors starfield.ts). */
function starWorld(
  universeSeed: number,
  cx: number,
  cy: number,
  cz: number,
  i: number,
): { x: number; y: number; z: number; lum: number; color: THREE.Color } {
  const cellSeed = deriveCellSeed(universeSeed, cx, cy, cz);
  const starSeed = deriveStarSeed(cellSeed, i);
  const profile = deriveStar(starSeed);
  const pr = makeRNG(deriveSeed(starSeed, 0x05));
  const half = CELL_SIZE / 2 - MARGIN;
  return {
    x: cx * CELL_SIZE + (pr() - 0.5) * 2 * half,
    y: cy * CELL_SIZE + (pr() - 0.5) * 2 * half,
    z: cz * CELL_SIZE + (pr() - 0.5) * 2 * half,
    lum: profile.luminosity,
    color: new THREE.Color(profile.color.r, profile.color.g, profile.color.b),
  };
}

export class NightSky {
  readonly group = new THREE.Group();
  private readonly mat: THREE.ShaderMaterial;
  private readonly axis: THREE.Vector3;

  constructor(
    universeSeed: number,
    cell: readonly [number, number, number],
    starIndex: number,
    axialTilt: number,
    radius = 4,
  ) {
    // Home star's absolute galaxy position — the vantage point for projection.
    const home = starWorld(universeSeed, cell[0], cell[1], cell[2], starIndex);

    // Collect every real star within `radius` cells, as a direction + brightness.
    const cand: { dir: THREE.Vector3; lb: number; color: THREE.Color }[] = [];
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dz = -radius; dz <= radius; dz++) {
          const cx = cell[0] + dx;
          const cy = cell[1] + dy;
          const cz = cell[2] + dz;
          const cellSeed = deriveCellSeed(universeSeed, cx, cy, cz);
          const n = starCountForCell(cellSeed);
          for (let i = 0; i < n; i++) {
            if (dx === 0 && dy === 0 && dz === 0 && i === starIndex) continue;
            const s = starWorld(universeSeed, cx, cy, cz, i);
            const ox = s.x - home.x;
            const oy = s.y - home.y;
            const oz = s.z - home.z;
            const dist2 = ox * ox + oy * oy + oz * oz;
            if (dist2 < 1) continue;
            // Apparent brightness ~ luminosity / distance²; store its log.
            const lb = Math.log10(s.lum / dist2 + 1e-12);
            cand.push({
              dir: new THREE.Vector3(ox, oy, oz).normalize(),
              lb,
              color: s.color,
            });
          }
        }
      }
    }

    // Keep the brightest MAX_STARS so the important (close/luminous) stars — the
    // ones you'd actually fly to — always make the cut.
    cand.sort((a, b) => b.lb - a.lb);
    if (cand.length > MAX_STARS) cand.length = MAX_STARS;

    // Normalize brightness across what we kept → point size + color intensity.
    let lo = Infinity;
    let hi = -Infinity;
    for (const c of cand) {
      if (c.lb < lo) lo = c.lb;
      if (c.lb > hi) hi = c.lb;
    }
    const span = Math.max(1e-6, hi - lo);

    const n = cand.length;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const size = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const c = cand[i]!;
      pos[i * 3] = c.dir.x * SKY_R;
      pos[i * 3 + 1] = c.dir.y * SKY_R;
      pos[i * 3 + 2] = c.dir.z * SKY_R;
      const norm = clamp((c.lb - lo) / span, 0, 1);
      const bright = 0.25 + 1.15 * norm * norm; // faint floor, bright stars pop
      col[i * 3] = clamp(c.color.r * bright, 0, 1);
      col[i * 3 + 1] = clamp(c.color.g * bright, 0, 1);
      col[i * 3 + 2] = clamp(c.color.b * bright, 0, 1);
      size[i] = 1.2 + 5.2 * norm * norm;
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geom.setAttribute('size', new THREE.BufferAttribute(size, 1));

    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uOpacity: { value: 0 } },
      vertexShader: /* glsl */ `
        attribute float size;
        attribute vec3 color;
        varying vec3 vColor;
        void main() {
          vColor = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = clamp(size * (520.0 / max(1.0, -mv.z)), 1.0, 24.0);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        uniform float uOpacity;
        void main() {
          float r = length(gl_PointCoord - vec2(0.5)) * 2.0;
          float core = smoothstep(1.0, 0.0, r);
          float a = pow(core, 3.0) * uOpacity;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vColor * (0.6 + 0.8 * core), a);
        }
      `,
    });

    const points = new THREE.Points(geom, this.mat);
    points.frustumCulled = false;
    this.group.add(points);

    // Stars wheel about an axis tilted from vertical by the planet's axial tilt.
    const t = axialTilt * DEG2RAD;
    this.axis = new THREE.Vector3(Math.sin(t), Math.cos(t), 0).normalize();
  }

  /** Keep the field centered on the camera (stars stay at infinity). */
  follow(pos: THREE.Vector3): void {
    this.group.position.copy(pos);
  }

  /** Wheel the sky for the time of day (0..1) and set night fade. */
  setTime(timeOfDay: number, opacity: number): void {
    this.group.quaternion.setFromAxisAngle(this.axis, timeOfDay * TAU);
    this.mat.uniforms.uOpacity!.value = opacity;
  }

  dispose(): void {
    this.group.traverse((o) => {
      const p = o as THREE.Points;
      if (p.isPoints) p.geometry.dispose();
    });
    this.mat.dispose();
  }
}
