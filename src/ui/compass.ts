// Compass strip: a top-center bar showing nearby deposits by relative bearing,
// colored by resource, with distance. The scanner's range gates what shows up.

export interface CompassPing {
  /** Signed angle from the player's forward (radians); + = to the right. */
  angle: number;
  dist: number;
  color: number;
  /** 0 within drill reach, else 1 — drives a "reachable" highlight. */
  near: boolean;
}

const HALF_FOV = 1.4; // radians shown to each side of center

export class Compass {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly w = 520;
  private readonly h = 40;

  constructor(root: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.w;
    this.canvas.height = this.h;
    const s = this.canvas.style;
    s.position = 'absolute';
    s.top = '10px';
    s.left = '50%';
    s.transform = 'translateX(-50%)';
    s.width = `${this.w}px`;
    s.height = `${this.h}px`;
    s.opacity = '0.92';
    root.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
  }

  render(pings: CompassPing[]): void {
    const c = this.ctx;
    c.clearRect(0, 0, this.w, this.h);
    // baseline
    c.strokeStyle = 'rgba(150,180,220,0.35)';
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(0, this.h - 6);
    c.lineTo(this.w, this.h - 6);
    c.stroke();
    // center tick (forward)
    c.strokeStyle = 'rgba(220,235,255,0.9)';
    c.beginPath();
    c.moveTo(this.w / 2, this.h - 14);
    c.lineTo(this.w / 2, this.h - 1);
    c.stroke();

    for (const p of pings) {
      if (Math.abs(p.angle) > HALF_FOV) continue;
      const x = this.w / 2 + (p.angle / HALF_FOV) * (this.w / 2 - 12);
      const col = `#${p.color.toString(16).padStart(6, '0')}`;
      const r = p.near ? 6 : 4;
      c.fillStyle = col;
      c.beginPath();
      c.arc(x, this.h - 20, r, 0, Math.PI * 2);
      c.fill();
      if (p.near) {
        c.strokeStyle = 'rgba(255,255,255,0.9)';
        c.lineWidth = 2;
        c.stroke();
      }
      c.fillStyle = 'rgba(207,227,255,0.85)';
      c.font = '10px ui-monospace, monospace';
      c.textAlign = 'center';
      c.fillText(`${Math.round(p.dist)}m`, x, this.h - 26);
    }
  }

  dispose(): void {
    this.canvas.remove();
  }
}
