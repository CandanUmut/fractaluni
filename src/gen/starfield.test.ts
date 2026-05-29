import { describe, expect, test } from 'vitest';
import { FloatingOrigin } from '../core/floatingOrigin.ts';
import { Starfield, CELL_SIZE } from './starfield.ts';

// Starfield streaming must be deterministic: same universe seed + same origin
// cell ⇒ identical stars, so a shared galaxy URL renders the same field for
// everyone. (Constructs Three.js buffers without a GL context — fine in node.)

function snapshot(seed: number, cellX: number): string {
  const field = new Starfield(seed, 2);
  const origin = new FloatingOrigin(CELL_SIZE);
  origin.originCell.set(cellX, 0, 0);
  field.update(origin, true);
  const recs = [...field.active]
    .sort(
      (a, b) =>
        a.cell[0] - b.cell[0] ||
        a.cell[1] - b.cell[1] ||
        a.cell[2] - b.cell[2] ||
        a.index - b.index,
    )
    .map((r) => `${r.cell.join('/')}#${r.index}:${r.profile.spectralClass}:${r.size.toFixed(3)}`);
  field.dispose();
  return recs.join('|');
}

describe('starfield is deterministic and streams by cell', () => {
  test('same seed + origin ⇒ identical field', () => {
    expect(snapshot(0x1234abcd, 0)).toBe(snapshot(0x1234abcd, 0));
  });

  test('different seeds diverge', () => {
    expect(snapshot(0x1234abcd, 0)).not.toBe(snapshot(0x9999ffff, 0));
  });

  test('overlapping origins share their common cells', () => {
    // Fields centered at x=0 and x=1 both contain cells x∈[-1..1]; those stars
    // must be byte-identical between the two streams.
    const field0 = new Starfield(0x55, 2);
    const o0 = new FloatingOrigin(CELL_SIZE);
    o0.originCell.set(0, 0, 0);
    field0.update(o0, true);

    const field1 = new Starfield(0x55, 2);
    const o1 = new FloatingOrigin(CELL_SIZE);
    o1.originCell.set(1, 0, 0);
    field1.update(o1, true);

    const cellKey = (r: { cell: [number, number, number]; index: number }) =>
      `${r.cell.join('/')}#${r.index}`;
    const m0 = new Map(field0.active.map((r) => [cellKey(r), r.profile.spectralClass]));

    let shared = 0;
    for (const r of field1.active) {
      const k = cellKey(r);
      if (m0.has(k)) {
        expect(m0.get(k)).toBe(r.profile.spectralClass);
        shared++;
      }
    }
    expect(shared).toBeGreaterThan(0);

    field0.dispose();
    field1.dispose();
  });
});
