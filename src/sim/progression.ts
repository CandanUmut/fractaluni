import { loadProgress, saveProgress } from './persistence.ts';
import { RESOURCES } from '../universe/resources.ts';

// Global player progression — persisted in IndexedDB (not per-planet). Holds the
// scarcity/gate that pulls the player toward richer, more dangerous worlds, plus
// the meta layers added in the depth pass: reputation, XP/level, a discovery
// codex, and a rotating mission board.

export type MissionKind = 'delivery' | 'bounty' | 'harvest';

export interface Mission {
  id: string;
  kind: MissionKind;
  resource?: string; // delivery / harvest
  required: number;
  reward: number; // currency
  rep: number; // reputation granted
  xp: number; // xp granted
  progress: number; // bounty kills so far (delivery/harvest checked against cargo)
  accepted: boolean;
}

export interface Codex {
  biomes: string[];
  creatures: string[];
  resources: string[];
  starClasses: string[];
  planetsVisited: number;
}

export interface Progression {
  currency: number;
  drill: number; // 1..3 — extracts ore of hardness <= drill
  scanner: number; // 0.. — scan range + detection
  energy: number; // 0.. — energy capacity
  cargo: number; // 0.. — cargo capacity
  gun: number; // 0.. — weapon damage
  hull: number; // 0.. — health capacity
  shield: number; // 0.. — shield capacity
  reputation: number;
  xp: number;
  missions: Mission[];
  codex: Codex;
}

function freshCodex(): Codex {
  return { biomes: [], creatures: [], resources: [], starClasses: [], planetsVisited: 0 };
}

export const progression: Progression = {
  currency: 0,
  drill: 1,
  scanner: 0,
  energy: 0,
  cargo: 0,
  gun: 0,
  hull: 0,
  shield: 0,
  reputation: 0,
  xp: 0,
  missions: [],
  codex: freshCodex(),
};

// ---- XP & level ------------------------------------------------------------

/** Cumulative XP required to reach a given level (level 1 = 0). */
export function xpForLevel(level: number): number {
  return level <= 1 ? 0 : 75 * (level - 1) * level; // gentle ramp
}
export function levelFromXp(xp: number): number {
  let lvl = 1;
  while (xpForLevel(lvl + 1) <= xp) lvl++;
  return lvl;
}
export const playerLevel = (): number => levelFromXp(progression.xp);
/** Progress toward the next level as { have, need } within the current band. */
export function levelProgress(): { level: number; have: number; need: number } {
  const level = playerLevel();
  const base = xpForLevel(level);
  const next = xpForLevel(level + 1);
  return { level, have: progression.xp - base, need: next - base };
}

/** Reputation tier (0..) — unlocks tougher, richer missions. */
export const repTier = (): number => Math.floor(progression.reputation / 120);

// ---- Discovery codex -------------------------------------------------------

/** Record a discovery; returns true (and grants XP) only if it's new. */
export function discover(category: keyof Omit<Codex, 'planetsVisited'>, key: string, xp = 25): boolean {
  const list = progression.codex[category];
  if (list.includes(key)) return false;
  list.push(key);
  grantXp(xp);
  saveProgression();
  return true;
}

export function grantXp(amount: number): boolean {
  const before = playerLevel();
  progression.xp += amount;
  return playerLevel() > before; // true if this push leveled the player up
}

// ---- Mission board ---------------------------------------------------------

const DELIVERY_COMMON = ['ferrite', 'silica', 'ice', 'carbon'];
const DELIVERY_RARE = ['cuprite', 'sulfur', 'titanite', 'biogel', 'helium3'];
const HARVEST_POOL = ['biomass', 'wood'];
let missionSeq = 0;

function makeMission(): Mission {
  const tier = repTier();
  const roll = Math.random();
  const id = `m${Date.now().toString(36)}${missionSeq++}`;
  if (roll < 0.34) {
    // Bounty: hunt guardians.
    const required = 2 + Math.floor(Math.random() * (2 + tier));
    return { id, kind: 'bounty', required, reward: required * (70 + tier * 25), rep: 10 + tier * 4, xp: required * 18, progress: 0, accepted: false };
  }
  if (roll < 0.62) {
    // Harvest: bring back biomass/wood from the living world.
    const resource = HARVEST_POOL[Math.floor(Math.random() * HARVEST_POOL.length)]!;
    const required = 20 + Math.floor(Math.random() * 4) * 10 + tier * 10;
    const reward = Math.round(required * RESOURCES[resource]!.value * 1.8) + tier * 20;
    return { id, kind: 'harvest', resource, required, reward, rep: 8 + tier * 3, xp: 40 + tier * 12, progress: 0, accepted: false };
  }
  // Delivery: ore — rarer ore unlocks with reputation.
  const pool = tier >= 1 ? [...DELIVERY_COMMON, ...DELIVERY_RARE] : DELIVERY_COMMON;
  const resource = pool[Math.floor(Math.random() * pool.length)]!;
  const required = 20 + Math.floor(Math.random() * 5) * 10;
  const reward = Math.round(required * RESOURCES[resource]!.value * 1.7) + tier * 25;
  return { id, kind: 'delivery', resource, required, reward, rep: 9 + tier * 3, xp: 45 + tier * 12, progress: 0, accepted: false };
}

const BOARD_SIZE = 3;

/** Ensure the board has open postings (keeps accepted ones, refills the rest). */
export function ensureMissions(): Mission[] {
  let changed = false;
  while (progression.missions.length < BOARD_SIZE + countAccepted()) {
    progression.missions.push(makeMission());
    changed = true;
  }
  if (changed) saveProgression();
  return progression.missions;
}

export function countAccepted(): number {
  return progression.missions.filter((m) => m.accepted).length;
}
export function acceptedMissions(): Mission[] {
  return progression.missions.filter((m) => m.accepted);
}

export function acceptMission(id: string): void {
  const m = progression.missions.find((x) => x.id === id);
  if (m && !m.accepted) {
    m.accepted = true;
    saveProgression();
  }
}

/** Reward + remove a mission, then refill the board. Returns the reward text. */
export function completeMission(m: Mission): void {
  progression.currency += m.reward;
  progression.reputation += m.rep;
  grantXp(m.xp);
  progression.missions = progression.missions.filter((x) => x.id !== m.id);
  ensureMissions();
  saveProgression();
}

// ---- Persistence -----------------------------------------------------------

export async function loadProgression(): Promise<void> {
  const p = await loadProgress<Partial<Progression>>();
  if (p) Object.assign(progression, p);
  if (!progression.codex) progression.codex = freshCodex();
  // Backfill any codex keys missing from older saves.
  const c = freshCodex();
  progression.codex = { ...c, ...progression.codex };
  if (!Array.isArray(progression.missions)) progression.missions = [];
  ensureMissions();
}

export function saveProgression(): void {
  void saveProgress({ ...progression });
}

// ---- Derived stats ---------------------------------------------------------

export const energyMaxFor = (): number => 100 + progression.energy * 60;
export const cargoCapFor = (): number => 120 + progression.cargo * 80;
export const scanRangeFor = (): number => 280 + progression.scanner * 120;
export const gunDamageFor = (): number => 12 + progression.gun * 8;
export const drillTierFor = (): number => progression.drill;
export const healthMaxFor = (): number => 100 + progression.hull * 40;
export const shieldMaxFor = (): number => 40 + progression.shield * 30;

type UpgradeField = 'drill' | 'scanner' | 'energy' | 'cargo' | 'gun' | 'hull' | 'shield';

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
  { id: 'hull', name: 'Hull Plating', field: 'hull', max: 6, basePrice: 110, detail: () => `health ${healthMaxFor()}` },
  { id: 'shield', name: 'Shield Core', field: 'shield', max: 5, basePrice: 130, detail: () => `shield ${shieldMaxFor()}` },
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
