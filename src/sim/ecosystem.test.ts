import { describe, expect, test } from 'vitest';
import { Ecosystem, type EcosystemConfig } from './ecosystem.ts';

// The ecosystem is pure/headless, so its dynamics are testable: vegetation
// should grow toward water and recede where the climate is hostile.

function makeEco(over: Partial<EcosystemConfig> = {}): Ecosystem {
  // Left half (worldX < 0) is ocean; right half is flat land at +2.
  return new Ecosystem({
    width: 40,
    height: 8,
    originGX: -20,
    originGZ: -4,
    elevationAt: (x) => (x < 0 ? -5 : 2),
    seaLevel: 0,
    hasWater: true,
    surfaceTemp: 289,
    atmosphere: 0.1,
    waterFraction: 0.5,
    ...over,
  });
}

function avgVegColumns(eco: Ecosystem, iLo: number, iHi: number): number {
  let s = 0;
  let n = 0;
  for (let j = 0; j < eco.height; j++) {
    for (let i = iLo; i <= iHi; i++) {
      s += eco.vegetation[j * eco.width + i]!;
      n++;
    }
  }
  return s / n;
}

describe('ecosystem fields', () => {
  test('vegetation grows denser near water than far inland', () => {
    // Isolate the climate→vegetation coupling by removing grazers (the food web
    // is exercised separately); otherwise herbivores crop the lush near-water
    // cells and confound this specific relationship.
    const eco = makeEco();
    for (let t = 0; t < 400; t++) {
      eco.herbivore.fill(0);
      eco.predator.fill(0);
      eco.step(0.2);
    }
    const nearWater = avgVegColumns(eco, 20, 24); // just onto land
    const farInland = avgVegColumns(eco, 35, 39); // dry far edge
    expect(nearWater).toBeGreaterThan(farInland);
    expect(nearWater).toBeGreaterThan(0.1);
  });

  test('a frozen climate keeps vegetation near zero', () => {
    const cold = makeEco({ surfaceTemp: 230 });
    for (let t = 0; t < 200; t++) cold.step(0.2);
    expect(cold.totalVegetation() / (cold.width * cold.height)).toBeLessThan(0.05);
  });

  test('a food web establishes: herbivores and predators persist', () => {
    const eco = makeEco();
    for (let t = 0; t < 700; t++) eco.step(0.2);
    expect(eco.totalHerbivores()).toBeGreaterThan(0);
    expect(eco.totalPredators()).toBeGreaterThan(0);
  });

  test('overgrazing suppresses vegetation (visible cascade)', () => {
    const grazed = makeEco();
    for (let t = 0; t < 300; t++) grazed.step(0.2);
    const ungrazed = makeEco();
    for (let t = 0; t < 300; t++) {
      ungrazed.herbivore.fill(0); // remove the grazers each tick
      ungrazed.predator.fill(0);
      ungrazed.step(0.2);
    }
    expect(ungrazed.totalVegetation()).toBeGreaterThan(grazed.totalVegetation());
  });

  test('player edits perturb the fields (water / plant / introduce)', () => {
    const eco = makeEco({ surfaceTemp: 272, atmosphere: 0.1, waterFraction: 0.1 });
    const i = 30; // inland land column
    const j = 4;
    const k = j * eco.width + i;

    eco.applyEdit(i, j, { water: true });
    expect(eco.isWater[k]).toBe(1);
    expect(eco.moisture[k]).toBe(1);

    const pk = j * eco.width + (i + 2);
    eco.applyEdit(i + 2, j, { planted: true });
    expect(eco.vegetation[pk]).toBeGreaterThan(0.5);

    const hk = j * eco.width + (i + 3);
    eco.applyEdit(i + 3, j, { herb: 4 });
    expect(eco.herbivore[hk]).toBeGreaterThanOrEqual(4);
  });

  test('digging water lifts nearby vegetation over time', () => {
    const dry = makeEco({ surfaceTemp: 290, atmosphere: 0.05, waterFraction: 0.05 });
    const i = 32;
    const j = 4;
    const ring = (eco: Ecosystem): number => {
      let s = 0;
      for (let dj = -2; dj <= 2; dj++) {
        for (let di = -2; di <= 2; di++) {
          if (di === 0 && dj === 0) continue;
          s += eco.vegetation[(j + dj) * eco.width + (i + di)]!;
        }
      }
      return s;
    };
    for (let t = 0; t < 200; t++) dry.step(0.2);
    const before = ring(dry);
    dry.applyEdit(i, j, { water: true });
    for (let t = 0; t < 300; t++) dry.step(0.2);
    expect(ring(dry)).toBeGreaterThan(before);
  });

  test('coarse catch-up steps stay bounded (no blow-up)', () => {
    const eco = makeEco();
    for (let t = 0; t < 800; t++) eco.step(0.5); // the catch-up step size
    const finite = (f: Float32Array): boolean => f.every((v) => Number.isFinite(v) && v >= 0);
    expect(finite(eco.vegetation)).toBe(true);
    expect(finite(eco.herbivore)).toBe(true);
    expect(finite(eco.predator)).toBe(true);
    expect(Math.max(...eco.herbivore)).toBeLessThanOrEqual(8.001);
    expect(Math.max(...eco.predator)).toBeLessThanOrEqual(4.001);
  });

  test('simulation is deterministic', () => {
    const a = makeEco();
    const b = makeEco();
    for (let t = 0; t < 120; t++) {
      a.step(0.15);
      b.step(0.15);
    }
    for (let k = 0; k < a.vegetation.length; k++) {
      expect(a.vegetation[k]).toBe(b.vegetation[k]);
    }
  });
});
