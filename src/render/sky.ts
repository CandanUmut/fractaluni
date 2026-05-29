import * as THREE from 'three';
import { rgbToHex } from '../core/color.ts';
import type { RGB } from '../universe/types.ts';

// Gradient sky dome (horizon→zenith from the biome palette) with a soft sun
// glow toward the sun direction. A big back-faced sphere that follows the
// camera, so it reads as an infinite sky.

export class SkyDome {
  readonly mesh: THREE.Mesh;
  private readonly mat: THREE.ShaderMaterial;

  constructor(horizon: RGB, zenith: RGB, sun: RGB, sunDir: THREE.Vector3) {
    this.mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uHorizon: { value: new THREE.Color(rgbToHex(horizon)) },
        uZenith: { value: new THREE.Color(rgbToHex(zenith)) },
        uSun: { value: new THREE.Color(rgbToHex(sun)) },
        uSunDir: { value: sunDir.clone().normalize() },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vDir;
        uniform vec3 uHorizon;
        uniform vec3 uZenith;
        uniform vec3 uSun;
        uniform vec3 uSunDir;
        void main() {
          vec3 dir = normalize(vDir);
          float h = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
          vec3 col = mix(uHorizon, uZenith, pow(h, 0.7));
          // Atmospheric haze brightening toward the horizon line.
          col = mix(col, uHorizon * 1.15, smoothstep(0.5, 0.0, h) * 0.5);
          // Sun: tight bright disc + broad halo + low-horizon scatter tint.
          float d = max(dot(dir, normalize(uSunDir)), 0.0);
          col += uSun * pow(d, 350.0) * 4.0;
          col += uSun * pow(d, 6.0) * 0.4;
          col += uSun * pow(d, 2.0) * 0.08 * smoothstep(0.6, 0.0, abs(dir.y));
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(6000, 32, 16), this.mat);
    this.mesh.frustumCulled = false;
  }

  setSunDir(dir: THREE.Vector3): void {
    this.mat.uniforms.uSunDir!.value.copy(dir).normalize();
  }

  /** Recolor the dome (day/night cycle). */
  setColors(horizon: THREE.Color, zenith: THREE.Color, sun: THREE.Color): void {
    this.mat.uniforms.uHorizon!.value.copy(horizon);
    this.mat.uniforms.uZenith!.value.copy(zenith);
    this.mat.uniforms.uSun!.value.copy(sun);
  }

  /** Keep the dome centered on the camera. */
  follow(pos: THREE.Vector3): void {
    this.mesh.position.copy(pos);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}
