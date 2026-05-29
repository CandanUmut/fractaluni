import { describe, expect, test, beforeEach } from 'vitest';
import { progression, UPGRADES, priceOf, buy, isMaxed, energyMaxFor, drillTierFor } from './progression.ts';

const energyDef = UPGRADES.find((u) => u.id === 'energy')!;
const drillDef = UPGRADES.find((u) => u.id === 'drill')!;

beforeEach(() => {
  Object.assign(progression, { currency: 0, drill: 1, scanner: 0, energy: 0, cargo: 0, gun: 0 });
});

describe('progression economy', () => {
  test('cannot buy without currency', () => {
    expect(buy(energyDef)).toBe(false);
    expect(progression.energy).toBe(0);
  });

  test('buying spends currency, raises the tier and derived stat, and gets pricier', () => {
    progression.currency = 1000;
    const p1 = priceOf(energyDef);
    const before = energyMaxFor();
    expect(buy(energyDef)).toBe(true);
    expect(progression.energy).toBe(1);
    expect(progression.currency).toBe(1000 - p1);
    expect(energyMaxFor()).toBeGreaterThan(before);
    expect(priceOf(energyDef)).toBeGreaterThan(p1); // escalating cost
  });

  test('drill tier gates extraction and maxes out', () => {
    progression.currency = 100000;
    expect(drillTierFor()).toBe(1);
    buy(drillDef);
    expect(drillTierFor()).toBe(2);
    buy(drillDef);
    expect(drillTierFor()).toBe(3);
    expect(isMaxed(drillDef)).toBe(true);
    expect(buy(drillDef)).toBe(false); // can't exceed max
  });
});
