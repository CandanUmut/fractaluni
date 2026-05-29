import { progression, UPGRADES, priceOf, isMaxed, buy } from '../sim/progression.ts';

// The ship's trade + upgrade terminal (DOM overlay). Sell cargo for currency and
// buy higher-tier gear, which gates access to richer/more-dangerous resources.

export class ShipTerminal {
  private readonly el: HTMLDivElement;
  visible = false;

  /** Returns the sell value of current cargo, and clears it (scene-owned). */
  onSell: () => number = () => 0;
  /** Called after any change so the scene can re-apply derived stats. */
  onChange: () => void = () => {};

  constructor(root: HTMLElement) {
    this.el = document.createElement('div');
    const s = this.el.style;
    s.position = 'absolute';
    s.top = '50%';
    s.left = '50%';
    s.transform = 'translate(-50%, -50%)';
    s.width = '460px';
    s.maxWidth = '92vw';
    s.padding = '18px 20px';
    s.background = 'rgba(10,16,28,0.94)';
    s.border = '1px solid rgba(120,160,220,0.4)';
    s.borderRadius = '10px';
    s.pointerEvents = 'auto';
    s.display = 'none';
    s.font = '13px/1.5 ui-monospace, Menlo, Consolas, monospace';
    s.color = '#cfe3ff';
    s.boxShadow = '0 12px 48px rgba(0,0,0,0.6)';
    root.appendChild(this.el);
  }

  toggle(): void {
    this.visible ? this.close() : this.open();
  }

  open(): void {
    this.visible = true;
    this.el.style.display = 'block';
    if (document.pointerLockElement) document.exitPointerLock();
    this.render();
  }

  close(): void {
    this.visible = false;
    this.el.style.display = 'none';
  }

  private render(): void {
    const cargoValue = this.onSell === undefined ? 0 : 0;
    void cargoValue;
    const rows = UPGRADES.map((def) => {
      const maxed = isMaxed(def);
      const price = priceOf(def);
      const afford = progression.currency >= price;
      const btn = maxed
        ? '<span style="opacity:0.6">MAX</span>'
        : `<button data-up="${def.id}" style="${this.btnStyle(afford)}">Buy ${price}¢</button>`;
      return `<div style="display:flex;justify-content:space-between;align-items:center;margin:6px 0;gap:10px">
        <div><b>${def.name}</b><br><span style="opacity:0.7">${def.detail()}</span></div>
        <div>${btn}</div></div>`;
    }).join('');

    this.el.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px">
        <div style="font-size:16px;font-weight:700">⛭ SHIP TERMINAL</div>
        <div>currency: <b style="color:#ffd27a">${progression.currency}¢</b></div>
      </div>
      <button data-sell="1" style="${this.btnStyle(true)};width:100%;margin-bottom:12px">
        Sell all cargo (<span id="sellv">…</span>¢)
      </button>
      <div style="border-top:1px solid rgba(120,160,220,0.2);padding-top:8px">${rows}</div>
      <div style="opacity:0.6;margin-top:12px;text-align:center">press B to close</div>
    `;

    // Wire buttons.
    this.el.querySelectorAll('button[data-up]').forEach((b) => {
      b.addEventListener('click', () => {
        const def = UPGRADES.find((u) => u.id === (b as HTMLElement).dataset.up);
        if (def && buy(def)) {
          this.onChange();
          this.render();
        }
      });
    });
    const sellBtn = this.el.querySelector('button[data-sell]');
    sellBtn?.addEventListener('click', () => {
      this.onSell();
      this.onChange();
      this.render();
    });
  }

  /** Update the live "sell value" figure (cargo changes outside the terminal). */
  setSellValue(v: number): void {
    const span = this.el.querySelector('#sellv');
    if (span) span.textContent = String(Math.round(v));
  }

  private btnStyle(enabled: boolean): string {
    return `font:inherit;cursor:${enabled ? 'pointer' : 'default'};color:${enabled ? '#0a1018' : '#7a8aa0'};` +
      `background:${enabled ? '#2aa6ff' : 'rgba(120,140,170,0.2)'};border:none;border-radius:6px;padding:6px 12px`;
  }

  dispose(): void {
    this.el.remove();
  }
}
