import { clamp01 } from './math.ts';
import type { RGB } from '../universe/types.ts';

// Pure color helpers. Palettes are built in HSL (controlled hue/lightness spread
// keeps them harmonious) then converted to linear-ish RGB for the render layer.

export function hslToRgb(h: number, s: number, l: number): RGB {
  h = ((h % 1) + 1) % 1;
  s = clamp01(s);
  l = clamp01(l);
  if (s === 0) return { r: l, g: l, b: l };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: hue2rgb(p, q, h + 1 / 3),
    g: hue2rgb(p, q, h),
    b: hue2rgb(p, q, h - 1 / 3),
  };
}

function hue2rgb(p: number, q: number, t: number): number {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

export const mixRGB = (a: RGB, b: RGB, t: number): RGB => ({
  r: a.r + (b.r - a.r) * t,
  g: a.g + (b.g - a.g) * t,
  b: a.b + (b.b - a.b) * t,
});

export const scaleRGB = (c: RGB, k: number): RGB => ({
  r: clamp01(c.r * k),
  g: clamp01(c.g * k),
  b: clamp01(c.b * k),
});

/** Pack an RGB (0..1) into a 0xRRGGBB integer for THREE.Color. */
export const rgbToHex = (c: RGB): number =>
  (Math.round(clamp01(c.r) * 255) << 16) |
  (Math.round(clamp01(c.g) * 255) << 8) |
  Math.round(clamp01(c.b) * 255);
