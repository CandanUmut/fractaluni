import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import * as THREE from 'three';
import type { RGB } from '../universe/types.ts';

// Per-system color grade: a cheap tone/contrast/saturation/tint pass. The
// atmospheric identity of each system comes largely from here + bloom + fog.

export interface ColorGradeSettings {
  tint: RGB;
  exposure: number;
  contrast: number;
  saturation: number;
}

export const NEUTRAL_GRADE: ColorGradeSettings = {
  tint: { r: 1, g: 1, b: 1 },
  exposure: 1,
  contrast: 1,
  saturation: 1,
};

export function makeColorGradePass(): ShaderPass {
  return new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      uTint: { value: new THREE.Color(1, 1, 1) },
      uExposure: { value: 1 },
      uContrast: { value: 1 },
      uSaturation: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse;
      uniform vec3 uTint;
      uniform float uExposure;
      uniform float uContrast;
      uniform float uSaturation;
      varying vec2 vUv;
      void main() {
        vec3 c = texture2D(tDiffuse, vUv).rgb;
        c *= uExposure;
        c = (c - 0.5) * uContrast + 0.5;
        float l = dot(c, vec3(0.299, 0.587, 0.114));
        c = mix(vec3(l), c, uSaturation);
        c *= uTint;
        gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
      }
    `,
  });
}
