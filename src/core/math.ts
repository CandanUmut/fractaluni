// Small pure math utilities used across generation and rendering.

export const clamp = (x: number, lo: number, hi: number): number =>
  x < lo ? lo : x > hi ? hi : x;

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const inverseLerp = (a: number, b: number, x: number): number =>
  a === b ? 0 : (x - a) / (b - a);

export const clamp01 = (x: number): number => clamp(x, 0, 1);

export const smoothstep = (edge0: number, edge1: number, x: number): number => {
  const t = clamp01(inverseLerp(edge0, edge1, x));
  return t * t * (3 - 2 * t);
};

export const remap = (
  x: number,
  inLo: number,
  inHi: number,
  outLo: number,
  outHi: number,
): number => lerp(outLo, outHi, inverseLerp(inLo, inHi, x));

export const TAU = Math.PI * 2;
export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;
