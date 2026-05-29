import { loadProgress, saveProgress } from './persistence.ts';
import { RESOURCES } from '../universe/resources.ts';

// Global player progression — currency + equipment tiers — persisted in
// IndexedDB (not per-planet). This is the scarcity/gate that pulls the player
// toward richer, more dangerous worlds: better tools unlock higher-hardness ore
// and tougher guardians.

export interface Contract {
  resource: string;
  required: number;
  reward: number;
}

export interface Progression {
  currency: number;
  drill: number; // 1..3 — extracts ore of hardness <= drill
  scanner: number; // 0.. — scan range + detection
  energy: number; // 0.. — energy capacity
  cargo: number; // 0.. — cargo capacity
  gun: number; // 0.. — weapon damage
  contract: Contract | null;
}

export const progression: Progression = { currency: 0, drill: 1, scanner: 0, energy: 0, cargo: 0, gun: 0, contract: null };

const CONTRACT_POOL = ['ferrite', 'silica', 'ice', 'carbon', 'cuprite', 'sulfur', 'titanite'];

/** Generate a fresh delivery contract (gameplay meta — non-deterministic is fine). */
export function newContract(): Contract {
  const resource = CONTRACT_POOL[Math.floor(Math.random() * CONTRACT_POOL.length)]!;
  const required = 20 + Math.floor(Math.random() * 5) * 10; // 20..60
  const reward = Math.round(required * RESOURCES[resource]!.value * 1.7);
  return { resource, required, reward };
}

export function ensureContract(): Contract {
  if (!progression.contract) {
    progression.contract = newContract();
    saveProgression();
  }
  return progression.contract;
}

export async function loadProgression(): Promise<void> {
  const p = await loadProgress<Partial<Progression>>();
  if (p) Object.assign(progression, p);
}

export function saveProgression(): void {
  void saveProgress({ ...progression });
}

// Derived stats.
export const energyMaxFor = (): number => 100 + progression.energy * 60;
export const cargoCapFor = (): number => 120 + progression.cargo * 80;
export const scanRangeFor = (): number => 280 + progression.scanner * 120;
export const gunDamageFor = (): number => 12 + progression.gun * 8;
export const drillTierFor = (): number => progression.drill;

type UpgradeField = 'drill' | 'scanner' | 'energy' | 'cargo' | 'gun';

export interface UpgradeDef {
  id: string;
  name: string;
  field: UpgradeField;
  max: number;
  basePrice: number;
  detail: () => string;
}

export const UPGRADES: UpgradeDef[] = [
  { id: 'drill', name: 'Mining Drill', field: 'drill', max: 3, basePrice: 180, detail: () => `tier ${progression.drill} → mines hardness ≤ ${progression.drill}` },
  { id: 'scanner', name: 'Scanner', field: 'scanner', max: 4, basePrice: 90, detail: () => `range ${scanRangeFor()}m` },
  { id: 'energy', name: 'Energy Cell', field: 'energy', max: 6, basePrice: 70, detail: () => `capacity ${energyMaxFor()}` },
  { id: 'cargo', name: 'Cargo Hold', field: 'cargo', max: 6, basePrice: 80, detail: () => `capacity ${cargoCapFor()}` },
  { id: 'gun', name: 'Pulse Rifle', field: 'gun', max: 5, basePrice: 100, detail: () => `damage ${gunDamageFor()}` },
];

/** Levels already bought for an upgrade (drill starts at tier 1). */
export function levelOf(def: UpgradeDef): number {
  return def.field === 'drill' ? progression.drill - 1 : progression[def.field];
}

export function isMaxed(def: UpgradeDef): boolean {
  return progression[def.field] >= def.max;
}

export function priceOf(def: UpgradeDef): number {
  return Math.round(def.basePrice * (levelOf(def) + 1));
}

export function buy(def: UpgradeDef): boolean {
  if (isMaxed(def)) return false;
  const price = priceOf(def);
  if (progression.currency < price) return false;
  progression.currency -= price;
  progression[def.field] += 1;
  saveProgression();
  return true;
}
