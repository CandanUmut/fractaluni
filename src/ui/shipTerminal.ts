import {
  progression, UPGRADES, priceOf, isMaxed, buy, ensureMissions, acceptMission,
  repTier, playerLevel, type Mission,
} from '../sim/progression.ts';
import { RESOURCES } from '../universe/resources.ts';

// The ship's trade + upgrade + mission terminal (DOM overlay). Sell cargo, take
// jobs from the rotating mission board, hand in deliveries/harvests, and buy
// higher-tier gear that gates richer/more-dangerous resources.

export class ShipTerminal {
  private readonly el: HTMLDivElement;
  visible = false;

  /** Returns the sell value of current cargo, and clears it (scene-owned). */
  onSell: () => number = () => 0;
  /** Called after any change so the scene can re-apply derived stats. */
  onChange: () => void = () => {};
  /** How much of a resource the player is carrying (scene-owned inventory). */
  inventoryOf: (id: string) => number = () => 0;
  /** Hand in a delivery/harvest mission from cargo; returns true on success. */
  onTurnIn: (m: Mission) => boolean = () => false;

  constructor(root: HTMLElement) {
    this.el = document.createElement('div');
    const s = this.el.style;
    s.position = 'absolute';
    s.top = '50%';
    s.left = '50%';
    s.transform = 'translate(-50%, -50%)';
    s.width = '480px';
    s.maxWidth = '94vw';
    s.maxHeight = '88vh';
    s.overflow = 'auto';
    s.padding = '18px 20px';
    s.background = 'rgba(10,16,28,0.95)';
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
    ensureMissions();
    this.render();
  }

  close(): void {
    this.visible = false;
    this.el.style.display = 'none';
  }

  private missionRow(m: Mission): string {
    const reward = `<b style="color:#ffd27a">${m.reward}¢</b> · +${m.rep} rep`;
    if (m.kind === 'bounty') {
      const body = m.accepted
        ? `<span style="opacity:0.7">progress ${m.progress}/${m.required} · completes in the field</span>`
        : `<span style="opacity:0.8">hunt ${m.required} guardians — ${reward}</span>`;
      return this.missionShell('🎯 Bounty', body, m, false, false);
    }
    const name = RESOURCES[m.resource ?? '']?.name ?? m.resource;
    const have = Math.floor(this.inventoryOf(m.resource ?? ''));
    const canTurnIn = m.accepted && have >= m.required;
    const verb = m.kind === 'harvest' ? '🌿 Harvest' : '📦 Delivery';
    const body = `<span style="opacity:0.8">${m.kind === 'harvest' ? 'bring' : 'deliver'} ${m.required} ${name} — ${reward}</span>` +
      (m.accepted ? `<br><span style="opacity:0.6">carrying ${have}/${m.required}</span>` : '');
    return this.missionShell(verb, body, m, true, canTurnIn);
  }

  private missionShell(title: string, body: string, m: Mission, turnInKind: boolean, canTurnIn: boolean): string {
    let action: string;
    if (!m.accepted) {
      action = `<button data-accept="${m.id}" style="${this.btnStyle(true)}">Accept</button>`;
    } else if (turnInKind) {
      action = `<button data-turnin="${m.id}" style="${this.btnStyle(canTurnIn)}">Turn in</button>`;
    } else {
      action = `<span style="opacity:0.6">accepted</span>`;
    }
    return `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin:6px 0;padding:8px 10px;border:1px solid rgba(120,160,220,0.2);border-radius:8px;${m.accepted ? 'background:rgba(40,70,110,0.25)' : ''}">
      <div><b>${title}</b><br>${body}</div><div>${action}</div></div>`;
  }

  private render(): void {
    const upgrades = UPGRADES.map((def) => {
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

    const missions = progression.missions.map((m) => this.missionRow(m)).join('');

    this.el.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;gap:10px">
        <div style="font-size:16px;font-weight:700">⛭ SHIP TERMINAL</div>
        <div style="display:flex;align-items:center;gap:12px">
          <span style="opacity:0.85">Lv ${playerLevel()} · rep ${progression.reputation} (T${repTier()})</span>
          <span>currency: <b style="color:#ffd27a">${progression.currency}¢</b></span>
          <button data-close="1" aria-label="Close" style="font:inherit;cursor:pointer;color:#cfe3ff;background:rgba(120,140,170,0.22);border:1px solid rgba(120,160,220,0.4);border-radius:6px;padding:4px 12px;line-height:1">✕</button>
        </div>
      </div>
      <button data-sell="1" style="${this.btnStyle(true)};width:100%;margin-bottom:8px">
        Sell all cargo (<span id="sellv">…</span>¢)
      </button>
      <div style="font-weight:700;color:#9ec5ff;margin:10px 0 2px">📋 Mission Board</div>
      ${missions}
      <div style="font-weight:700;color:#9ec5ff;margin:12px 0 2px;border-top:1px solid rgba(120,160,220,0.2);padding-top:8px">🔧 Upgrades</div>
      ${upgrades}
      <button data-close="1" style="${this.btnStyle(true)};width:100%;margin-top:12px">Close (B)</button>
    `;

    this.el.querySelectorAll('button[data-up]').forEach((b) => {
      b.addEventListener('click', () => {
        const def = UPGRADES.find((u) => u.id === (b as HTMLElement).dataset.up);
        if (def && buy(def)) {
          this.onChange();
          this.render();
        }
      });
    });
    this.el.querySelector('button[data-sell]')?.addEventListener('click', () => {
      this.onSell();
      this.onChange();
      this.render();
    });
    this.el.querySelectorAll('button[data-accept]').forEach((b) => {
      b.addEventListener('click', () => {
        acceptMission((b as HTMLElement).dataset.accept!);
        this.render();
      });
    });
    this.el.querySelectorAll('button[data-turnin]').forEach((b) => {
      b.addEventListener('click', () => {
        const m = progression.missions.find((x) => x.id === (b as HTMLElement).dataset.turnin);
        if (m && this.onTurnIn(m)) {
          this.onChange();
          this.render();
        }
      });
    });
    this.el.querySelectorAll('button[data-close]').forEach((b) => {
      b.addEventListener('click', () => this.close());
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
