import * as THREE from 'three';

// Custom Points material for stars: per-vertex size + color, drawn as soft round
// glowing sprites. Cheap (one draw call for the whole field) and bloom-friendly.

export function makeStarPointsMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      // World-space size scale; multiplied by perspective falloff in the shader.
      uSizeScale: { value: 1.0 },
    },
    vertexShader: /* glsl */ `
      attribute float size;
      attribute vec3 color;
      varying vec3 vColor;
      uniform float uSizeScale;
      void main() {
        vColor = color;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        // Perspective size attenuation; clamp so distant stars stay visible.
        float s = size * uSizeScale * (300.0 / max(1.0, -mv.z));
        gl_PointSize = clamp(s, 1.0, 64.0);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      void main() {
        // Radial falloff: bright core, soft halo.
        vec2 d = gl_PointCoord - vec2(0.5);
        float r = length(d) * 2.0;
        float core = smoothstep(1.0, 0.0, r);
        float halo = pow(core, 3.0);
        float a = halo;
        if (a < 0.01) discard;
        gl_FragColor = vec4(vColor * (0.6 + 0.8 * halo), a);
      }
    `,
  });
}
