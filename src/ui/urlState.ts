// URL state: the universe seed + current location live in the query string so
// any view is shareable and reloadable. This module is the single source of
// truth for (de)serializing that state. It does NOT generate worlds — it only
// parses/stringifies the address bar.
//
// Format:
//   ?u=<seed>&loc=galaxy
//   ?u=<seed>&loc=system:cx,cy,cz:starIndex
//   ?u=<seed>&loc=surface:cx,cy,cz:starIndex:planetIndex

export type Cell = readonly [number, number, number];

export type Location =
  | { kind: 'galaxy' }
  | { kind: 'system'; cell: Cell; star: number }
  | { kind: 'surface'; cell: Cell; star: number; planet: number };

export interface UniverseState {
  /** Raw seed string as typed in the URL; hashed to a uint32 by the universe layer. */
  seed: string;
  location: Location;
}

const DEFAULT_LOCATION: Location = { kind: 'galaxy' };

function parseCell(s: string): Cell {
  const parts = s.split(',').map((n) => Number.parseInt(n, 10));
  const x = Number.isFinite(parts[0]!) ? parts[0]! : 0;
  const y = Number.isFinite(parts[1]!) ? parts[1]! : 0;
  const z = Number.isFinite(parts[2]!) ? parts[2]! : 0;
  return [x, y, z];
}

function stringifyCell(c: Cell): string {
  return `${c[0]},${c[1]},${c[2]}`;
}

function parseLocation(raw: string | null): Location {
  if (!raw) return DEFAULT_LOCATION;
  const segs = raw.split(':');
  switch (segs[0]) {
    case 'system':
      if (segs.length >= 3) {
        return { kind: 'system', cell: parseCell(segs[1]!), star: Number.parseInt(segs[2]!, 10) || 0 };
      }
      return DEFAULT_LOCATION;
    case 'surface':
      if (segs.length >= 4) {
        return {
          kind: 'surface',
          cell: parseCell(segs[1]!),
          star: Number.parseInt(segs[2]!, 10) || 0,
          planet: Number.parseInt(segs[3]!, 10) || 0,
        };
      }
      return DEFAULT_LOCATION;
    case 'galaxy':
    default:
      return DEFAULT_LOCATION;
  }
}

export function stringifyLocation(loc: Location): string {
  switch (loc.kind) {
    case 'galaxy':
      return 'galaxy';
    case 'system':
      return `system:${stringifyCell(loc.cell)}:${loc.star}`;
    case 'surface':
      return `surface:${stringifyCell(loc.cell)}:${loc.star}:${loc.planet}`;
  }
}

/** Pick a fresh root universe seed. This is the ROOT INPUT, not world generation,
 *  so non-deterministic entropy is fine here (worlds are deterministic *given* a seed). */
function freshSeed(): string {
  const buf = new Uint32Array(2);
  crypto.getRandomValues(buf);
  return `${buf[0]!.toString(36)}${buf[1]!.toString(36)}`;
}

export function readState(): UniverseState {
  const params = new URLSearchParams(window.location.search);
  const seed = params.get('u') ?? freshSeed();
  const location = parseLocation(params.get('loc'));
  return { seed, location };
}

/** Write state into the address bar without reloading. Uses replaceState so the
 *  back button isn't flooded by continuous movement updates. */
export function writeState(state: UniverseState, pushHistory = false): void {
  const params = new URLSearchParams();
  params.set('u', state.seed);
  params.set('loc', stringifyLocation(state.location));
  const url = `${window.location.pathname}?${params.toString()}`;
  if (pushHistory) window.history.pushState(null, '', url);
  else window.history.replaceState(null, '', url);
}
