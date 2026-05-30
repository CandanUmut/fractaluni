import { progression, saveProgression } from './progression.ts';

// Crafting: raw resources → hazard protection, gear, and consumables. This is
// the spine of the loop — protection is what unlocks the hostile, richer worlds.
// Recipes consume from the cargo you hauled back to the ship; effects persist in
// progression (cross-planet). Tiers are gated so you craft up gradually: the
// resources for a better suit live on the colder worlds the basic suit unlocks.

export interface Recipe {
  id: string;
  name: string;
  desc: string;
  inputs: Record<string, number>; // resourceId → quantity
  /** Can this be crafted right now (tier not maxed / prerequisite met)? */
  available: () => boolean;
  /** Apply the effect (bump a tier, add a consumable). */
  apply: () => void;
  /** Short status line, e.g. "owned: Tier 1". */
  status: () => string;
}

// Protection tiers → fraction of hazard drain negated (0 = none, 1 = immune).
const PROTECTION = [0, 0.55, 0.9];

export function coldProtectionFor(): number {
  return PROTECTION[Math.min(progression.craft.coldSuit, PROTECTION.length - 1)]!;
}
export function airProtectionFor(): number {
  return PROTECTION[Math.min(progression.craft.airFilter, PROTECTION.length - 1)]!;
}

export const RECIPES: Recipe[] = [
  {
    id: 'coldSuit1',
    name: 'Insulated Suit',
    desc: 'Basic cold protection — survive chilly worlds long enough to work.',
    inputs: { ferrite: 12, biogel: 8, ice: 6 },
    available: () => progression.craft.coldSuit === 0,
    apply: () => {
      progression.craft.coldSuit = 1;
    },
    status: () => tierStatus(progression.craft.coldSuit),
  },
  {
    id: 'coldSuit2',
    name: 'Thermal Suit',
    desc: 'Heavy cold protection for frozen worlds — needs cryostone from the cold.',
    inputs: { titanite: 10, cryostone: 6, biogel: 6 },
    available: () => progression.craft.coldSuit === 1,
    apply: () => {
      progression.craft.coldSuit = 2;
    },
    status: () => tierStatus(progression.craft.coldSuit),
  },
  {
    id: 'airFilter1',
    name: 'Air Filter',
    desc: 'Basic breathing protection for thin or tainted air.',
    inputs: { silica: 10, carbon: 8, sulfur: 6 },
    available: () => progression.craft.airFilter === 0,
    apply: () => {
      progression.craft.airFilter = 1;
    },
    status: () => tierStatus(progression.craft.airFilter),
  },
  {
    id: 'airFilter2',
    name: 'Rebreather',
    desc: 'Sealed rebreather for toxic, near-vacuum, and molten worlds.',
    inputs: { titanite: 10, helium3: 6, biogel: 6 },
    available: () => progression.craft.airFilter === 1,
    apply: () => {
      progression.craft.airFilter = 2;
    },
    status: () => tierStatus(progression.craft.airFilter),
  },
  {
    id: 'energyCell',
    name: 'Energy Cell',
    desc: 'Field consumable — restores energy instantly. Use with [Q].',
    inputs: { helium3: 4, cuprite: 2 },
    available: () => progression.cells < 9,
    apply: () => {
      progression.cells += 1;
    },
    status: () => `held: ${progression.cells}`,
  },
];

function tierStatus(tier: number): string {
  return tier <= 0 ? 'not crafted' : `owned: Tier ${tier}`;
}

/** Have enough materials in `inv`, and the recipe isn't maxed? */
export function canCraft(r: Recipe, inv: Map<string, number>): boolean {
  if (!r.available()) return false;
  for (const id in r.inputs) {
    if ((inv.get(id) ?? 0) < r.inputs[id]!) return false;
  }
  return true;
}

/** Consume the inputs from `inv`, apply the effect, persist. Returns the total
 *  unit count removed (so the scene can decrement cargo). */
export function doCraft(r: Recipe, inv: Map<string, number>): number {
  let consumed = 0;
  for (const id in r.inputs) {
    const q = r.inputs[id]!;
    inv.set(id, (inv.get(id) ?? 0) - q);
    consumed += q;
  }
  r.apply();
  saveProgression();
  return consumed;
}
