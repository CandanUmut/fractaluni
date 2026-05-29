import { describe, expect, test } from 'vitest';
import { makeRNG } from '../core/rng.ts';
import { buildPlant, type LSystemConfig } from './lsystem.ts';

const cfg: LSystemConfig = {
  axiom: 'FX',
  rules: { X: 'F[+FL][-FL][&FL]FX' },
  depth: 3,
  angle: 26,
  angleJitter: 0.3,
  segLen: 1,
  segLenFalloff: 0.8,
  baseRadius: 0.18,
  radiusFalloff: 0.74,
  radialSegments: 4,
  leafSize: 0.6,
  hasLeaves: true,
  trunkColor: { r: 0.34, g: 0.23, b: 0.13 },
  leafColor: { r: 0.2, g: 0.5, b: 0.2 },
};

describe('L-system plant geometry', () => {
  test('build is deterministic for a given seed', () => {
    const a = buildPlant(cfg, makeRNG(42));
    const b = buildPlant(cfg, makeRNG(42));
    const pa = a.getAttribute('position').array as Float32Array;
    const pb = b.getAttribute('position').array as Float32Array;
    expect(pa.length).toBe(pb.length);
    expect(pa.length).toBeGreaterThan(0);
    for (let i = 0; i < pa.length; i++) expect(pa[i]).toBe(pb[i]);
  });

  test('different seeds produce different geometry (jitter)', () => {
    const a = buildPlant(cfg, makeRNG(1));
    const b = buildPlant(cfg, makeRNG(2));
    const pa = a.getAttribute('position').array as Float32Array;
    const pb = b.getAttribute('position').array as Float32Array;
    let differs = pa.length !== pb.length;
    if (!differs) {
      for (let i = 0; i < pa.length; i++) {
        if (pa[i] !== pb[i]) {
          differs = true;
          break;
        }
      }
    }
    expect(differs).toBe(true);
  });

  test('geometry carries a vertex color attribute', () => {
    const g = buildPlant(cfg, makeRNG(7));
    expect(g.getAttribute('color')).toBeTruthy();
    expect(g.getAttribute('color').count).toBe(g.getAttribute('position').count);
  });
});
