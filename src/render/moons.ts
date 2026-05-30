import * as THREE from 'three';
import { makeRNG, rangeFloat, type RNG } from '../core/rng.ts';
import { deriveSeed } from '../core/hash.ts';
import { clamp, lerp, TAU } from '../core/math.ts';

// Moons derived from the planet profile: count, size, color, and orbit all fall
// out of the planet seed. Each is a flat-shaded sphere lit by the real sun
// direction, so it shows true phases (crescent → full) as it orbits relative to
// the sun. Placed far out on the celestial sphere, parented to a group that
// follows the camera (so they read as infinitely distant). The brightest moon
// above the horizon casts soft moonlight at night — read by SurfaceScene.

const MOON_DIST = 3400; // celestial distance (inside the 6000 sky dome / 5200 stars)

interface Moon {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  worldR: number;
  orbitSpeed: number;
  phase: number;
  // Orbit-plane basis (two orthonormal vectors the moon circles within).
  ua: THREE.Vector3;
  ub: THREE.Vector3;
  dir: THREE.Vector3; // current sky direction from the planet, updated per frame
  brightness: number; // intrinsic albedo-ish weight for moonlight
}

/** Moon count: most worlds get 1, a good number get 2, a few get 3, rarely 0. */
function moonCount(rng: RNG): number {
  const r = rng();
  if (r < 0.08) return 0;
  if (r < 0.6) return 1;
  if (r < 0.9) return 2;
  return 3;
}

export class Moons {
  readonly group = new THREE.Group();
  private readonly moons: Moon[] = [];

  // Moonlight output, read by SurfaceScene after update().
  readonly lightDir = new THREE.Vector3(0, -1, 0); // direction the light travels
  lightIntensity = 0;
  ambientBump = 0;

  private time = 0;

  constructor(planetSeed: number) {
    const rng = makeRNG(deriveSeed(planetSeed, 0x117a));
    const count = moonCount(rng);
    for (let i = 0; i < count; i++) {
      const mrng = makeRNG(deriveSeed(planetSeed, 0x117a, i + 1));
      // Apparent size in the sky (world radius at MOON_DIST). Big and readable —
      // the first moon is the showpiece, extras are a touch smaller.
      const worldR = rangeFloat(mrng, 220, 520) * (i === 0 ? 1.0 : 0.75);
      // Rocky greys lightly tinted; icy moons skew blue-white.
      const icy = mrng() < 0.4;
      const hue = icy ? lerp(0.55, 0.62, mrng()) : lerp(0.06, 0.12, mrng());
      const sat = icy ? 0.14 : lerp(0.06, 0.24, mrng());
      const lightness = lerp(0.68, 0.9, mrng());
      const color = new THREE.Color().setHSL(hue, sat, lightness);

      const mat = new THREE.ShaderMaterial({
        depthWrite: false, // sits beyond everything; never occludes terrain
        uniforms: {
          uSunDir: { value: new THREE.Vector3(0, 1, 0) },
          uColor: { value: color },
          uAmbient: { value: 0.1 }, // faint earthshine on the dark limb so the disc reads
        },
        vertexShader: /* glsl */ `
          varying vec3 vN;
          void main() {
            vN = normalize(mat3(modelMatrix) * normal);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          varying vec3 vN;
          uniform vec3 uSunDir;
          uniform vec3 uColor;
          uniform float uAmbient;
          void main() {
            float l = clamp(dot(normalize(vN), normalize(uSunDir)), 0.0, 1.0);
            // Soft terminator so the phase edge is a gentle curve, not a hard line.
            l = smoothstep(0.0, 0.22, l) * (0.4 + 0.6 * l);
            gl_FragColor = vec4(uColor * (uAmbient + 1.15 * l), 1.0);
          }
        `,
      });

      const geo = new THREE.IcosahedronGeometry(worldR, 4);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = -1; // draw before opaque scene content
      this.group.add(mesh);

      // Orbit plane: tilt a base XZ circle by a seeded inclination so moons rise
      // and set rather than circling the zenith.
      const incl = rangeFloat(mrng, -0.6, 0.6);
      const node = mrng() * TAU;
      const ua = new THREE.Vector3(Math.cos(node), 0, Math.sin(node));
      const ub = new THREE.Vector3(
        -Math.sin(node) * Math.sin(incl),
        Math.cos(incl),
        Math.cos(node) * Math.sin(incl),
      ).normalize();

      this.moons.push({
        mesh,
        mat,
        worldR,
        // Slow orbits (a few minutes per cycle) so phases visibly change.
        orbitSpeed: rangeFloat(mrng, 0.004, 0.012) * (mrng() < 0.5 ? -1 : 1),
        phase: mrng() * TAU,
        ua,
        ub,
        dir: new THREE.Vector3(0, 1, 0),
        brightness: clamp(worldR / 360, 0.55, 1.3) * (icy ? 1.15 : 0.9),
      });
    }
  }

  get count(): number {
    return this.moons.length;
  }

  /** Advance orbits, light moons by the sun (phases), and compute moonlight. */
  update(dt: number, sunDir: THREE.Vector3, daylight: number, camPos: THREE.Vector3): void {
    this.time += dt;
    this.group.position.copy(camPos); // celestial sphere follows the camera

    let bestLit = 0;
    this.ambientBump = 0;

    for (const m of this.moons) {
      const a = m.phase + this.time * m.orbitSpeed;
      // Direction from the planet to the moon (on its orbit plane).
      m.dir.copy(m.ua).multiplyScalar(Math.cos(a)).addScaledVector(m.ub, Math.sin(a)).normalize();
      // Mesh is a child of the group (already at camPos) — position is the local
      // celestial offset only. (Earlier bug double-added camPos here.)
      m.mesh.position.copy(m.dir).multiplyScalar(MOON_DIST);
      m.mat.uniforms.uSunDir!.value.copy(sunDir);

      // How full the moon looks from here: full when it sits opposite the sun.
      const illum = clamp(0.5 - 0.5 * m.dir.dot(sunDir), 0, 1);
      const altitude = clamp(m.dir.y + 0.05, 0, 1); // above the horizon?
      const lit = m.brightness * illum * altitude;
      if (lit > bestLit) {
        bestLit = lit;
        this.lightDir.copy(m.dir).multiplyScalar(-1); // light travels down from the moon
      }
      this.ambientBump += lit * 0.05;
    }

    // Moonlight matters once the sun is down; fades up through dusk.
    const night = clamp(1 - daylight * 1.4, 0, 1);
    this.lightIntensity = bestLit * night * 1.7;
    this.ambientBump = Math.min(0.18, this.ambientBump * night);
  }

  dispose(): void {
    for (const m of this.moons) {
      m.mesh.geometry.dispose();
      m.mat.dispose();
    }
  }
}
