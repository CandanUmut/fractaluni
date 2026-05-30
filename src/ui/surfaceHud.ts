// Styled first-person HUD for the surface: health + shield + energy + cargo bars
// (bottom-left), currency/level/weapon/scanner (bottom-right), and a context
// hint. Clean panels rather than monospace stat dumps.

export interface SurfaceHudData {
  energy: number;
  energyMax: number;
  health: number;
  healthMax: number;
  shield: number;
  shieldMax: number;
  cargo: number;
  cargoCap: number;
  currency: number;
  level: number;
  reputation: number;
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
  private readonly healthFill: HTMLDivElement;
  private readonly healthLabel: HTMLDivElement;
  private readonly shieldFill: HTMLDivElement;
  private readonly shieldLabel: HTMLDivElement;
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

    this.healthLabel = this.mkLabel();
    const hTrack = this.bar();
    this.healthFill = hTrack.firstChild as HTMLDivElement;
    this.shieldLabel = this.mkLabel();
    const sTrack = this.bar();
    this.shieldFill = sTrack.firstChild as HTMLDivElement;
    this.energyLabel = this.mkLabel();
    const eTrack = this.bar();
    this.energyFill = eTrack.firstChild as HTMLDivElement;
    this.cargoLabel = this.mkLabel();
    const cTrack = this.bar();
    this.cargoFill = cTrack.firstChild as HTMLDivElement;
    this.left.append(this.healthLabel, hTrack, this.shieldLabel, sTrack, this.energyLabel, eTrack, this.cargoLabel, cTrack);

    this.hint = document.createElement('div');
    this.hint.style.cssText = 'position:absolute;bottom:64px;left:50%;transform:translateX(-50%);pointer-events:none;font:12px ui-monospace,monospace;color:#bfe0ff;text-shadow:0 1px 3px #000;opacity:0.9;text-align:center';
    root.appendChild(this.hint);
  }

  private mkLabel(): HTMLDivElement {
    const el = document.createElement('div');
    el.style.cssText = 'margin:6px 0 3px;opacity:0.9';
    return el;
  }

  private bar(): HTMLDivElement {
    const t = document.createElement('div');
    t.style.cssText = 'width:220px;height:11px;background:#1a2230;border:1px solid rgba(120,160,220,0.3);border-radius:7px;overflow:hidden';
    const f = document.createElement('div');
    f.style.cssText = 'height:100%;width:50%;transition:width 0.12s linear';
    t.appendChild(f);
    return t;
  }

  set(d: SurfaceHudData): void {
    const h = Math.max(0, Math.min(1, d.health / d.healthMax));
    this.healthFill.style.width = `${h * 100}%`;
    this.healthFill.style.background = h < 0.25 ? '#ff5a4a' : h < 0.5 ? '#ffc24a' : '#5ce08a';
    this.healthLabel.textContent = `HEALTH ${Math.round(d.health)}/${d.healthMax}`;

    const s = Math.max(0, Math.min(1, d.shield / Math.max(1, d.shieldMax)));
    this.shieldFill.style.width = `${s * 100}%`;
    this.shieldFill.style.background = '#7ab8ff';
    this.shieldLabel.textContent = `SHIELD ${Math.round(d.shield)}/${d.shieldMax}`;

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
      `<div style="opacity:0.85;margin-top:2px">Lv ${d.level} · rep ${d.reputation}</div>` +
      `<div style="margin-top:6px">${d.weapon}</div>` +
      `<div style="opacity:0.7;margin-top:2px">drill T${d.drillTier} · scan ${d.scanRange}m</div>` +
      `<div style="opacity:0.55;margin-top:6px">[1]gun [2]bomb [3]drill · [R]scan · [B]ship · [C]codex</div>`;

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
