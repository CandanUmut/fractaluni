import { RECIPES, canCraft, type Recipe } from '../sim/crafting.ts';
import { RESOURCES } from '../universe/resources.ts';

// Crafting bench: a docked-only panel (opened with C near the ship) that turns
// hauled-back resources into hazard protection and consumables. Pure DOM/CSS
// overlay; the scene wires onCraft and feeds it the current cargo inventory.

export class CraftBench {
  private readonly root: HTMLDivElement;
  private visible = false;
  private inv: Map<string, number> = new Map();
  onCraft: (id: string) => void = () => {};

  constructor(root: HTMLElement) {
    const el = document.createElement('div');
    this.root = el;
    el.style.cssText =
      'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);min-width:420px;max-width:92vw;max-height:84vh;overflow:auto;padding:20px 22px;background:rgba(8,12,22,0.96);border:1px solid rgba(120,160,220,0.45);border-radius:12px;font:13px ui-monospace,monospace;color:#cfe3ff;pointer-events:auto;z-index:50';
    el.style.display = 'none';
    root.appendChild(el);
  }

  get isOpen(): boolean {
    return this.visible;
  }

  toggle(inv: Map<string, number>): void {
    this.visible = !this.visible;
    this.inv = inv;
    this.root.style.display = this.visible ? 'block' : 'none';
    if (this.visible) this.render();
  }

  close(): void {
    this.visible = false;
    this.root.style.display = 'none';
  }

  /** Re-render with the latest inventory (after a craft). */
  refresh(inv: Map<string, number>): void {
    this.inv = inv;
    if (this.visible) this.render();
  }

  private render(): void {
    const rows = RECIPES.map((r) => this.recipeRow(r)).join('');
    this.root.innerHTML =
      `<div style="font-size:16px;font-weight:700;margin-bottom:6px">⚒ CRAFTING BENCH</div>` +
      `<div style="opacity:0.65;margin-bottom:12px">Suits resist cold · filters resist toxic air — protection is what unlocks the hostile worlds.</div>` +
      rows +
      `<div style="opacity:0.55;margin-top:12px;text-align:center">[C] close · crafts consume cargo — haul materials back to the ship</div>`;
    for (const r of RECIPES) {
      const btn = this.root.querySelector(`[data-craft="${r.id}"]`) as HTMLButtonElement | null;
      if (btn) btn.onclick = () => this.onCraft(r.id);
    }
  }

  private recipeRow(r: Recipe): string {
    const maxed = !r.available();
    const ok = canCraft(r, this.inv);
    const needs = Object.keys(r.inputs)
      .map((id) => {
        const q = r.inputs[id]!;
        const have = Math.floor(this.inv.get(id) ?? 0);
        const col = have >= q ? '#9affd0' : '#ff8a6a';
        return `<span style="color:${col}">${RESOURCES[id]?.name ?? id} ${have}/${q}</span>`;
      })
      .join('  ·  ');
    const btn = maxed
      ? `<span style="opacity:0.6">✓ maxed</span>`
      : `<button data-craft="${r.id}"${ok ? '' : ' disabled'} style="${this.btnCss(ok)}">${ok ? 'CRAFT' : 'need materials'}</button>`;
    return (
      `<div style="display:flex;justify-content:space-between;gap:14px;align-items:center;margin:8px 0;padding-bottom:8px;border-bottom:1px solid rgba(120,160,220,0.12)">` +
      `<div><b>${r.name}</b> <span style="opacity:0.6">· ${r.status()}</span><br>` +
      `<span style="opacity:0.7">${r.desc}</span><br>${needs}</div>` +
      `<div style="text-align:right;min-width:110px">${btn}</div></div>`
    );
  }

  private btnCss(enabled: boolean): string {
    return `padding:8px 14px;border-radius:8px;border:1px solid rgba(120,160,220,0.45);background:${enabled ? '#1d6a4a' : '#2a3340'};color:${enabled ? '#dfffe9' : '#8aa0c0'};font:12px ui-monospace,monospace;cursor:${enabled ? 'pointer' : 'default'};pointer-events:auto`;
  }

  dispose(): void {
    this.root.remove();
  }
}
