import { clamp01 } from '../core/math.ts';
import type { RGB } from './types.ts';

// Approximate blackbody color from temperature (Kelvin), based on Tanner
// Helland's piecewise fit, normalized to linear-ish [0,1] RGB. Pure function.
// Good from ~1000K (deep red) through ~40000K (blue-white). Tuned for looks,
// not colorimetric accuracy — the brief asks for "blackbody-ish".

export function blackbodyRGB(kelvin: number): RGB {
  const t = clamp01v(kelvin, 1000, 40000) / 100;
  let r: number;
  let g: number;
  let b: number;

  // Red
  if (t <= 66) r = 255;
  else r = 329.698727446 * Math.pow(t - 60, -0.1332047592);

  // Green
  if (t <= 66) g = 99.4708025861 * Math.log(t) - 161.1195681661;
  else g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);

  // Blue
  if (t >= 66) b = 255;
  else if (t <= 19) b = 0;
  else b = 138.5177312231 * Math.log(t - 10) - 305.0447927307;

  return {
    r: clamp01(r / 255),
    g: clamp01(g / 255),
    b: clamp01(b / 255),
  };
}

function clamp01v(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}
