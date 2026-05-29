// Styled first-person HUD for the surface: energy + cargo bars (bottom-left),
// currency + weapon + scanner (bottom-right), and a context hint. Replaces the
// monospace stat lines with clean panels.

export interface SurfaceHudData {
  energy: number;
  energyMax: number;
  cargo: number;
  cargoCap: number;
  currency: number;
  weapon: string;
  drillTier: number;
  scanRange: number;
  nearShip: boolean;
  hint: string;
}

export class SurfaceHud {
  private readonly left: HTMLDivElement;
  private readonly right: HTMLDivElement;
  private readonly hint: HTMLDivElement;
  private readonly energyFill: HTMLDivElement;
  private readonly energyLabel: HTMLDivElement;
  private readonly cargoFill: HTMLDivElement;
  private readonly cargoLabel: HTMLDivElement;

  constructor(root: HTMLElement) {
    const panel = (corner: 'left' | 'right'): HTMLDivElement => {
      const el = document.createElement('div');
      el.style.cssText = `position:absolute;bottom:14px;${corner}:14px;pointer-events:none;font:12px ui-monospace,monospace;color:#cfe3ff;text-align:${corner === 'right' ? 'right' : 'left'}`;
      root.appendChild(el);
      return el;
    };
    this.left = panel('left');
    this.right = panel('right');

    this.energyLabel = document.createElement('div');
    this.energyLabel.style.cssText = 'margin-bottom:3px;opacity:0.9';
    const eTrack = this.bar('#1a2230');
    this.energyFill = eTrack.firstChild as HTMLDivElement;
    this.cargoLabel = document.createElement('div');
    this.cargoLabel.style.cssText = 'margin:8px 0 3px;opacity:0.9';
    const cTrack = this.bar('#1a2230');
    this.cargoFill = cTrack.firstChild as HTMLDivElement;
    this.left.append(this.energyLabel, eTrack, this.cargoLabel, cTrack);

    this.hint = document.createElement('div');
    this.hint.style.cssText = 'position:absolute;bottom:64px;left:50%;transform:translateX(-50%);pointer-events:none;font:12px ui-monospace,monospace;color:#bfe0ff;text-shadow:0 1px 3px #000;opacity:0.9;text-align:center';
    root.appendChild(this.hint);
  }

  private bar(track: string): HTMLDivElement {
    const t = document.createElement('div');
    t.style.cssText = `width:220px;height:12px;background:${track};border:1px solid rgba(120,160,220,0.3);border-radius:7px;overflow:hidden`;
    const f = document.createElement('div');
    f.style.cssText = 'height:100%;width:50%;transition:width 0.12s linear';
    t.appendChild(f);
    return t;
  }

  set(d: SurfaceHudData): void {
    const e = Math.max(0, Math.min(1, d.energy / d.energyMax));
    this.energyFill.style.width = `${e * 100}%`;
    this.energyFill.style.background = e < 0.2 ? '#ff5a4a' : e < 0.45 ? '#ffc24a' : '#49e8ff';
    this.energyLabel.textContent = `ENERGY ${Math.round(d.energy)}/${d.energyMax}${d.energy <= 1 ? '  ⚠ DEPLETED' : ''}`;

    const c = Math.max(0, Math.min(1, d.cargo / d.cargoCap));
    this.cargoFill.style.width = `${c * 100}%`;
    this.cargoFill.style.background = c > 0.95 ? '#ff5a4a' : '#d0a24a';
    this.cargoLabel.textContent = `CARGO ${Math.round(d.cargo)}/${d.cargoCap}`;

    this.right.innerHTML =
      `<div style="font-size:15px;color:#ffd27a;font-weight:700">${d.currency}¢</div>` +
      `<div style="margin-top:6px">${d.weapon}</div>` +
      `<div style="opacity:0.7;margin-top:2px">drill T${d.drillTier} · scan ${d.scanRange}m</div>` +
      `<div style="opacity:0.55;margin-top:6px">[1]gun [2]bomb [3]drill · [R]scan · [B]ship</div>`;

    this.hint.textContent = d.hint;
    this.hint.style.color = d.nearShip ? '#9affd0' : '#bfe0ff';
  }

  setVisible(v: boolean): void {
    const disp = v ? 'block' : 'none';
    this.left.style.display = disp;
    this.right.style.display = disp;
    this.hint.style.display = disp;
  }

  dispose(): void {
    this.left.remove();
    this.right.remove();
    this.hint.remove();
  }
}
