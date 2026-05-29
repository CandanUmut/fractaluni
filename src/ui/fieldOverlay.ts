import type { Ecosystem, FieldName } from '../sim/ecosystem.ts';

// Debug overlay: a heatmap minimap of an ecosystem field, so you can watch
// vegetation spread toward water and recede from cold/heat. Toggleable; cycles
// between vegetation / moisture / temperature.

export class FieldOverlay {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly img: ImageData;
  private readonly w: number;
  private readonly h: number;
  visible = false;
  field: FieldName = 'vegetation';

  constructor(root: HTMLElement, width: number, height: number) {
    this.w = width;
    this.h = height;
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    const s = this.canvas.style;
    s.position = 'absolute';
    s.top = '8px';
    s.right = '8px';
    s.width = '224px';
    s.height = '224px';
    s.imageRendering = 'pixelated';
    s.border = '1px solid rgba(120,160,220,0.3)';
    s.borderRadius = '6px';
    s.background = 'rgba(8,12,22,0.6)';
    s.display = 'none';
    root.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    this.img = this.ctx.createImageData(width, height);
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.canvas.style.display = v ? 'block' : 'none';
  }

  cycle(): void {
    const order: FieldName[] = ['vegetation', 'moisture', 'temperature', 'herbivore', 'predator'];
    this.field = order[(order.indexOf(this.field) + 1) % order.length]!;
  }

  render(eco: Ecosystem, playerI: number, playerJ: number): void {
    if (!this.visible) return;
    const f = eco.field(this.field);
    const data = this.img.data;
    const showWater = this.field === 'vegetation' || this.field === 'moisture';
    for (let k = 0; k < f.length; k++) {
      const v = f[k]!;
      let r: number;
      let g: number;
      let b: number;
      if (showWater && eco.isWater[k]) {
        r = 30; g = 90; b = 200;
      } else if (this.field === 'vegetation') {
        r = 20 + v * 40; g = 40 + v * 200; b = 30 + v * 40;
      } else if (this.field === 'moisture') {
        r = 30; g = 60 + v * 120; b = 80 + v * 175;
      } else if (this.field === 'herbivore') {
        const n = Math.min(1, v / 6);
        r = 30 + n * 220; g = 30 + n * 170; b = 20; // amber
      } else if (this.field === 'predator') {
        const n = Math.min(1, v / 3);
        r = 40 + n * 215; g = 20; b = 40 + n * 90; // crimson
      } else {
        // temperature suitability: blue (cold/unfit) → green (ideal) → red (hot/unfit)
        r = 40 + (1 - v) * 200; g = 40 + v * 200; b = 60;
      }
      data[k * 4] = r;
      data[k * 4 + 1] = g;
      data[k * 4 + 2] = b;
      data[k * 4 + 3] = 235;
    }
    // Player marker.
    if (playerI >= 0 && playerI < this.w && playerJ >= 0 && playerJ < this.h) {
      const pk = (playerJ * this.w + playerI) * 4;
      data[pk] = 255; data[pk + 1] = 255; data[pk + 2] = 255; data[pk + 3] = 255;
    }
    this.ctx.putImageData(this.img, 0, 0);
  }

  dispose(): void {
    this.canvas.remove();
  }
}
