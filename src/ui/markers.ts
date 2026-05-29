// World-space HUD overlays: target markers projected over deposits/guardians,
// floating damage numbers, and a center banner for kills/sales. Pure DOM in the
// (pointer-events:none) HUD layer; the scene feeds it screen-projected points.

export interface MarkerSpec {
  sx: number; // screen px
  sy: number;
  label: string;
  color: string;
  kind: 'deposit' | 'guardian';
}

interface FloatNum {
  el: HTMLDivElement;
  t: number;
  life: number;
  x: number;
  y: number;
}

export class Markers {
  private readonly root: HTMLElement;
  private readonly pool: HTMLDivElement[] = [];
  private readonly floats: FloatNum[] = [];
  private readonly banner: HTMLDivElement;
  private bannerT = 0;

  constructor(root: HTMLElement) {
    this.root = root;
    this.banner = document.createElement('div');
    this.banner.style.cssText = [
      'position:absolute', 'top:22%', 'left:50%', 'transform:translateX(-50%)',
      'font:600 18px ui-monospace,monospace', 'color:#ffe6a0', 'text-shadow:0 2px 6px #000',
      'pointer-events:none', 'opacity:0', 'transition:opacity 0.2s', 'text-align:center',
    ].join(';');
    root.appendChild(this.banner);
  }

  private marker(i: number): HTMLDivElement {
    while (this.pool.length <= i) {
      const el = document.createElement('div');
      el.style.cssText = 'position:absolute;pointer-events:none;transform:translate(-50%,-50%);white-space:nowrap;font:11px ui-monospace,monospace;text-shadow:0 1px 3px #000;display:none';
      this.root.appendChild(el);
      this.pool.push(el);
    }
    return this.pool[i]!;
  }

  setMarkers(specs: MarkerSpec[]): void {
    for (let i = 0; i < specs.length; i++) {
      const s = specs[i]!;
      const el = this.marker(i);
      el.style.display = 'block';
      el.style.left = `${s.sx}px`;
      el.style.top = `${s.sy}px`;
      el.style.color = s.color;
      const glyph = s.kind === 'guardian' ? '◆' : '◇';
      el.innerHTML = `<span style="font-size:13px">${glyph}</span> ${s.label}`;
    }
    for (let i = specs.length; i < this.pool.length; i++) this.pool[i]!.style.display = 'none';
  }

  /** Spawn a rising, fading number at a screen position. */
  damageNumber(sx: number, sy: number, text: string, color: string): void {
    let f = this.floats.find((x) => x.t >= x.life);
    if (!f) {
      const el = document.createElement('div');
      el.style.cssText = 'position:absolute;pointer-events:none;transform:translate(-50%,-50%);font:700 15px ui-monospace,monospace;text-shadow:0 2px 4px #000';
      this.root.appendChild(el);
      f = { el, t: 0, life: 0.85, x: sx, y: sy };
      this.floats.push(f);
    }
    f.t = 0;
    f.life = 0.85;
    f.x = sx;
    f.y = sy;
    f.el.textContent = text;
    f.el.style.color = color;
    f.el.style.display = 'block';
  }

  showBanner(text: string): void {
    this.banner.textContent = text;
    this.banner.style.opacity = '1';
    this.bannerT = 2.2;
  }

  update(dt: number): void {
    for (const f of this.floats) {
      if (f.t >= f.life) {
        f.el.style.display = 'none';
        continue;
      }
      f.t += dt;
      const k = f.t / f.life;
      f.el.style.left = `${f.x}px`;
      f.el.style.top = `${f.y - k * 40}px`;
      f.el.style.opacity = String(1 - k);
    }
    if (this.bannerT > 0) {
      this.bannerT -= dt;
      if (this.bannerT <= 0) this.banner.style.opacity = '0';
    }
  }

  dispose(): void {
    for (const el of this.pool) el.remove();
    for (const f of this.floats) f.el.remove();
    this.banner.remove();
  }
}
