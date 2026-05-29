// v2 — the sparse diff. This is the ONLY stateful thing in the project: the
// universe stays pure math; a planet is `baseline (from seed) + this diff`. The
// diff stores only what differs from baseline, keyed sparsely by sim-cell.
//
// Designed to be trivially serializable (arrays, plain objects — no Map on the
// wire) so it can persist to IndexedDB now and to a share backend later.

/** Sim grid resolution in world units (low-res, per the v2 "fields" rule). */
export const SIM_CELL = 16;

/** Per-cell edits relative to baseline. Phase A only needs a marker; later
 *  phases add vegetation/moisture/population overrides here. */
export interface CellEdit {
  /** A player-placed marker (Phase A plumbing proof). */
  marker?: boolean;
}

export interface PlanetDiff {
  version: number;
  /** In-world timestamp (seconds) at last save — drives coarse catch-up later. */
  lastVisited: number;
  /** Sparse cell edits, keyed "gx,gz" (absolute sim-cell coords). */
  cells: Map<string, CellEdit>;
}

/** JSON/structured-clone-friendly form (no Map). */
export interface SerializedDiff {
  version: number;
  lastVisited: number;
  cells: [string, CellEdit][];
}

export const DIFF_VERSION = 1;

export function emptyDiff(): PlanetDiff {
  return { version: DIFF_VERSION, lastVisited: 0, cells: new Map() };
}

export function isEmpty(d: PlanetDiff): boolean {
  return d.cells.size === 0;
}

/** Absolute world coords → sim-cell key. */
export function cellKeyOf(worldX: number, worldZ: number): string {
  const gx = Math.floor(worldX / SIM_CELL);
  const gz = Math.floor(worldZ / SIM_CELL);
  return `${gx},${gz}`;
}

/** Parse a cell key back to its sim-cell integer coords. */
export function parseCellKey(key: string): [number, number] {
  const i = key.indexOf(',');
  return [Number(key.slice(0, i)), Number(key.slice(i + 1))];
}

/** World-space center of a sim cell. */
export function cellCenter(gx: number, gz: number): [number, number] {
  return [gx * SIM_CELL + SIM_CELL / 2, gz * SIM_CELL + SIM_CELL / 2];
}

export function serialize(d: PlanetDiff): SerializedDiff {
  return { version: d.version, lastVisited: d.lastVisited, cells: [...d.cells.entries()] };
}

export function deserialize(s: SerializedDiff): PlanetDiff {
  return {
    version: s.version ?? DIFF_VERSION,
    lastVisited: s.lastVisited ?? 0,
    cells: new Map(s.cells ?? []),
  };
}
