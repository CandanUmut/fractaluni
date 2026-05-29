// Lightweight DOM/text HUD overlay. Plain DOM (no React) per the brief.
// Renders an FPS counter plus arbitrary key/value lines pushed each frame.

export class Hud {
  private readonly root: HTMLElement;
  private readonly fpsEl: HTMLElement;
  private readonly bodyEl: HTMLElement;
  private readonly profileEl: HTMLElement;
  private readonly copyBtn: HTMLButtonElement;
  private shareUrl = '';

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

    // Bottom-left debug profile panel (toggled with 'p').
    this.profileEl = document.createElement('div');
    this.profileEl.style.position = 'absolute';
    this.profileEl.style.bottom = '8px';
    this.profileEl.style.left = '8px';
    this.profileEl.style.padding = '6px 9px';
    this.profileEl.style.background = 'rgba(8,12,22,0.55)';
    this.profileEl.style.border = '1px solid rgba(120,160,220,0.18)';
    this.profileEl.style.borderRadius = '6px';
    this.profileEl.style.whiteSpace = 'pre';
    this.profileEl.style.display = 'none';
    this.root.appendChild(this.profileEl);

    // Bottom-right "copy shareable URL" button (interactive → pointer-events on).
    this.copyBtn = document.createElement('button');
    this.copyBtn.textContent = '⧉ copy share URL';
    const bs = this.copyBtn.style;
    bs.position = 'absolute';
    bs.bottom = '8px';
    bs.right = '8px';
    bs.pointerEvents = 'auto';
    bs.cursor = 'pointer';
    bs.font = 'inherit';
    bs.color = '#cfe3ff';
    bs.background = 'rgba(8,12,22,0.55)';
    bs.border = '1px solid rgba(120,160,220,0.3)';
    bs.borderRadius = '6px';
    bs.padding = '6px 10px';
    this.copyBtn.addEventListener('click', () => {
      void navigator.clipboard?.writeText(this.shareUrl).then(() => {
        this.copyBtn.textContent = '✓ copied';
        setTimeout(() => (this.copyBtn.textContent = '⧉ copy share URL'), 1200);
      });
    });
    this.root.appendChild(this.copyBtn);
  }

  setShareUrl(url: string): void {
    this.shareUrl = url;
  }

  /** Show/hide the derived-profile debug panel. Pass null to hide. */
  setProfile(lines: string[] | null): void {
    if (!lines) {
      this.profileEl.style.display = 'none';
      return;
    }
    this.profileEl.style.display = 'block';
    this.profileEl.textContent = lines.join('\n');
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
