import { describe, expect, test } from 'vitest';
import * as THREE from 'three';
import { FloatingOrigin } from './floatingOrigin.ts';

describe('floating origin keeps local coords bounded and positions invariant', () => {
  test('rebase snaps origin by whole cells and bounds local position', () => {
    const fo = new FloatingOrigin(1000);
    const local = new THREE.Vector3(2500, -1700, 40);

    // Absolute world position before rebase = originCell*cell + local.
    const absBefore = new THREE.Vector3(
      fo.originCell.x * 1000 + local.x,
      fo.originCell.y * 1000 + local.y,
      fo.originCell.z * 1000 + local.z,
    );

    fo.rebase(local);

    // Origin snapped to the nearest cell.
    expect(fo.originCell.x).toBe(3); // round(2.5)
    expect(fo.originCell.y).toBe(-2); // round(-1.7)
    expect(fo.originCell.z).toBe(0);

    // Local position is now bounded within half a cell.
    expect(Math.abs(local.x)).toBeLessThanOrEqual(500);
    expect(Math.abs(local.y)).toBeLessThanOrEqual(500);
    expect(Math.abs(local.z)).toBeLessThanOrEqual(500);

    // Absolute world position is unchanged — the world only shifted under us.
    const absAfter = new THREE.Vector3(
      fo.originCell.x * 1000 + local.x,
      fo.originCell.y * 1000 + local.y,
      fo.originCell.z * 1000 + local.z,
    );
    expect(absAfter.x).toBeCloseTo(absBefore.x, 6);
    expect(absAfter.y).toBeCloseTo(absBefore.y, 6);
    expect(absAfter.z).toBeCloseTo(absBefore.z, 6);
  });

  test('no rebase when within half a cell', () => {
    const fo = new FloatingOrigin(1000);
    const local = new THREE.Vector3(400, -499, 100);
    const shift = fo.rebase(local);
    // Use Math.abs to fold -0 (from Math.round of small negatives) into 0.
    expect(Math.abs(shift.x)).toBe(0);
    expect(Math.abs(shift.y)).toBe(0);
    expect(Math.abs(shift.z)).toBe(0);
    expect(fo.originCell.x).toBe(0);
  });

  test('drifting far accumulates without precision loss', () => {
    const fo = new FloatingOrigin(1000);
    const local = new THREE.Vector3();
    // Simulate flying +x for a very long way in many steps.
    for (let i = 0; i < 100000; i++) {
      local.x += 123.4;
      fo.rebase(local);
    }
    // Local stays tiny; the integer cell holds the distance.
    expect(Math.abs(local.x)).toBeLessThanOrEqual(500);
    const absX = fo.originCell.x * 1000 + local.x;
    expect(absX).toBeCloseTo(100000 * 123.4, 1);
  });
});
