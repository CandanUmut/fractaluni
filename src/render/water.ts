import * as THREE from 'three';
import { rgbToHex, scaleRGB } from '../core/color.ts';
import type { RGB } from '../universe/types.ts';

// Stylized water plane: a large flat plane at sea level with a cheap animated
// vertex wobble and a two-tone color from wave height + a soft fresnel rim.
// No reflections (deliberately, per the brief). Follows the player on XZ.

export class Water {
  readonly mesh: THREE.Mesh;
  private readonly mat: THREE.ShaderMaterial;

  constructor(color: RGB, size = 4000) {
    const deep = scaleRGB(color, 0.55);
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      uniforms: {
        uTime: { value: 0 },
        uShallow: { value: new THREE.Color(rgbToHex(color)) },
        uDeep: { value: new THREE.Color(rgbToHex(deep)) },
      },
      vertexShader: /* glsl */ `
        uniform float uTime;
        varying float vWave;
        varying vec3 vView;
        void main() {
          vec3 p = position;
          // Two crossing low-frequency waves.
          float w =
            sin(p.x * 0.05 + uTime * 1.1) * 0.6 +
            sin(p.y * 0.06 - uTime * 0.8) * 0.5 +
            sin((p.x + p.y) * 0.03 + uTime * 0.5) * 0.7;
          vWave = w;
          p.z += w * 0.9;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          vView = -mv.xyz;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uShallow;
        uniform vec3 uDeep;
        varying float vWave;
        varying vec3 vView;
        void main() {
          float t = clamp(vWave * 0.5 + 0.5, 0.0, 1.0);
          vec3 col = mix(uDeep, uShallow, t);
          // Fresnel-ish brighten at grazing angles.
          float f = pow(1.0 - clamp(normalize(vView).z, 0.0, 1.0), 3.0);
          col += f * 0.25;
          gl_FragColor = vec4(col, 0.82);
        }
      `,
    });
    // Plane is built in XY then rotated flat to XZ.
    const geo = new THREE.PlaneGeometry(size, size, 64, 64);
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.frustumCulled = false;
  }

  update(dt: number, cameraPos: THREE.Vector3, seaLevel: number): void {
    this.mat.uniforms.uTime!.value += dt;
    // Follow the camera on XZ, fixed at sea level.
    this.mesh.position.set(cameraPos.x, seaLevel, cameraPos.z);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}
