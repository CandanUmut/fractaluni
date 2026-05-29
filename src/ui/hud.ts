// Lightweight DOM/text HUD overlay. Plain DOM (no React) per the brief.
// Renders an FPS counter plus arbitrary key/value lines pushed each frame.

export class Hud {
  private readonly root: HTMLElement;
  private readonly fpsEl: HTMLElement;
  private readonly bodyEl: HTMLElement;

  // FPS smoothing
  private frames = 0;
  private accum = 0;
  private fps = 0;

  constructor(root: HTMLElement) {
    this.root = root;
    this.root.innerHTML = '';

    const panel = document.createElement('div');
    panel.style.position = 'absolute';
    panel.style.top = '8px';
    panel.style.left = '8px';
    panel.style.padding = '6px 9px';
    panel.style.background = 'rgba(8,12,22,0.45)';
    panel.style.border = '1px solid rgba(120,160,220,0.18)';
    panel.style.borderRadius = '6px';
    panel.style.maxWidth = '46ch';
    panel.style.whiteSpace = 'pre';

    this.fpsEl = document.createElement('div');
    this.fpsEl.style.fontWeight = '600';
    this.fpsEl.textContent = '— fps';

    this.bodyEl = document.createElement('div');
    this.bodyEl.style.marginTop = '4px';
    this.bodyEl.style.opacity = '0.85';

    panel.appendChild(this.fpsEl);
    panel.appendChild(this.bodyEl);
    this.root.appendChild(panel);
  }

  /** Call once per frame with the frame delta in seconds. */
  tickFps(dt: number): void {
    this.frames++;
    this.accum += dt;
    if (this.accum >= 0.5) {
      this.fps = this.frames / this.accum;
      this.frames = 0;
      this.accum = 0;
      this.fpsEl.textContent = `${this.fps.toFixed(0)} fps`;
    }
  }

  /** Replace the body lines (an array of "key: value" strings). */
  setLines(lines: string[]): void {
    this.bodyEl.textContent = lines.join('\n');
  }
}
