// First-person HUD layer: a crosshair, a hit-marker that flashes when you land a
// hit, and a red damage vignette. Pure DOM over the canvas.

export class Reticle {
  private readonly crosshair: HTMLDivElement;
  private readonly hitmark: HTMLDivElement;
  private readonly vignette: HTMLDivElement;
  private hit = 0;

  constructor(root: HTMLElement) {
    this.crosshair = document.createElement('div');
    this.crosshair.style.cssText = [
      'position:absolute', 'top:50%', 'left:50%', 'width:18px', 'height:18px',
      'transform:translate(-50%,-50%)', 'pointer-events:none',
    ].join(';');
    this.crosshair.innerHTML = `
      <div style="position:absolute;left:8px;top:0;width:2px;height:6px;background:rgba(220,235,255,0.85)"></div>
      <div style="position:absolute;left:8px;bottom:0;width:2px;height:6px;background:rgba(220,235,255,0.85)"></div>
      <div style="position:absolute;top:8px;left:0;height:2px;width:6px;background:rgba(220,235,255,0.85)"></div>
      <div style="position:absolute;top:8px;right:0;height:2px;width:6px;background:rgba(220,235,255,0.85)"></div>
      <div style="position:absolute;top:7px;left:7px;width:4px;height:4px;border-radius:50%;background:rgba(220,235,255,0.5)"></div>`;
    root.appendChild(this.crosshair);

    this.hitmark = document.createElement('div');
    this.hitmark.textContent = '✕';
    this.hitmark.style.cssText = [
      'position:absolute', 'top:50%', 'left:50%', 'transform:translate(-50%,-50%)',
      'color:#ff5a4a', 'font:700 22px ui-monospace,monospace', 'pointer-events:none', 'opacity:0',
    ].join(';');
    root.appendChild(this.hitmark);

    this.vignette = document.createElement('div');
    this.vignette.style.cssText = [
      'position:absolute', 'inset:0', 'pointer-events:none', 'opacity:0',
      'background:radial-gradient(ellipse at center, transparent 45%, rgba(220,40,30,0.55) 100%)',
    ].join(';');
    root.appendChild(this.vignette);
  }

  markHit(): void {
    this.hit = 0.18;
  }

  /** damage01 drives the red vignette [0,1]. */
  update(dt: number, damage01: number): void {
    if (this.hit > 0) this.hit -= dt;
    this.hitmark.style.opacity = this.hit > 0 ? '1' : '0';
    this.vignette.style.opacity = String(Math.max(0, Math.min(1, damage01)) * 0.9);
  }

  setVisible(v: boolean): void {
    this.crosshair.style.display = v ? 'block' : 'none';
  }

  dispose(): void {
    this.crosshair.remove();
    this.hitmark.remove();
    this.vignette.remove();
  }
}
