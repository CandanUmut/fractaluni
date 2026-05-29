import * as THREE from 'three';

// Floating origin. Single-precision floats jitter badly far from (0,0,0), which
// would shatter infinite flight. We keep the player near local (0,0,0) at all
// times and instead track WHICH absolute galactic cell local-space maps to.
//
// Each frame: if the camera's local position has drifted past half a cell, snap
// the origin by whole cells and subtract the same shift from the camera. Local
// coordinates therefore stay bounded in [-cellSize/2, +cellSize/2], so precision
// never degrades no matter how far the player travels. Rendered objects are
// positioned relative to `originCell`, so a rebase = a re-stream.

export class FloatingOrigin {
  /** Integer cell indices that local-space (0,0,0) currently corresponds to. */
  readonly originCell = new THREE.Vector3(0, 0, 0);
  readonly cellSize: number;

  private readonly _shift = new THREE.Vector3();

  constructor(cellSize: number) {
    this.cellSize = cellSize;
  }

  /** Re-center if `local` drifted more than half a cell. Mutates `local` and
   *  `originCell`. Returns the integer cell shift applied (zero if none). */
  rebase(local: THREE.Vector3): THREE.Vector3 {
    const s = this._shift.set(
      Math.round(local.x / this.cellSize),
      Math.round(local.y / this.cellSize),
      Math.round(local.z / this.cellSize),
    );
    if (s.x !== 0 || s.y !== 0 || s.z !== 0) {
      local.x -= s.x * this.cellSize;
      local.y -= s.y * this.cellSize;
      local.z -= s.z * this.cellSize;
      this.originCell.add(s);
    }
    return s;
  }

  /** Local-space position of the origin corner of an absolute cell. */
  cellToLocal(ix: number, iy: number, iz: number, out: THREE.Vector3): THREE.Vector3 {
    return out.set(
      (ix - this.originCell.x) * this.cellSize,
      (iy - this.originCell.y) * this.cellSize,
      (iz - this.originCell.z) * this.cellSize,
    );
  }
}
