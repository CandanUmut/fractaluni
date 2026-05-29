import { describe, expect, test } from 'vitest';
import {
  emptyDiff,
  isEmpty,
  serialize,
  deserialize,
  cellKeyOf,
  parseCellKey,
  cellCenter,
  SIM_CELL,
} from './planetDiff.ts';
import { planetPath } from './persistence.ts';

describe('planet diff', () => {
  test('empty diff is empty and serializes round-trip', () => {
    const d = emptyDiff();
    expect(isEmpty(d)).toBe(true);
    d.cells.set('1,2,0', { depleted: true });
    d.lastVisited = 42;
    const round = deserialize(serialize(d));
    expect(round.lastVisited).toBe(42);
    expect(round.cells.get('1,2,0')?.depleted).toBe(true);
    expect(isEmpty(round)).toBe(false);
  });

  test('cell key / center / parse are consistent', () => {
    const key = cellKeyOf(40, -3);
    expect(key).toBe(`${Math.floor(40 / SIM_CELL)},${Math.floor(-3 / SIM_CELL)}`);
    const [gx, gz] = parseCellKey(key);
    const [cx, cz] = cellCenter(gx, gz);
    // The center maps back into the same cell.
    expect(cellKeyOf(cx, cz)).toBe(key);
  });
});

describe('planet path keys', () => {
  test('distinct planets get distinct keys; same planet is stable', () => {
    const a = planetPath(123, [1, 2, 3], 0, 0);
    const b = planetPath(123, [1, 2, 3], 0, 1);
    const c = planetPath(123, [1, 2, 3], 0, 0);
    const d = planetPath(124, [1, 2, 3], 0, 0);
    expect(a).toBe(c);
    expect(a).not.toBe(b);
    expect(a).not.toBe(d);
  });
});
