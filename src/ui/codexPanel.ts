import { progression, levelProgress, repTier } from '../sim/progression.ts';
import { RESOURCES } from '../universe/resources.ts';

// Discovery codex overlay: a collection screen cataloguing the biomes, creatures,
// resources, and star classes the player has encountered. The collection meta is
// a pull toward exploring more of the universe. Toggled with C (or a mobile
// button); freezes movement while open (scene-driven).

const ALL_BIOMES = ['tropical', 'temperate', 'oceanic', 'tundra', 'arid', 'desert', 'frozen', 'molten', 'barren-rock'];
const ALL_STARS = ['O', 'B', 'A', 'F', 'G', 'K', 'M'];
const ALL_CREATURES = ['grazer', 'sauropod', 'raptor', 'beetle'];

export class CodexPanel {
  private readonly el: HTMLDivElement;
  visible = false;
  onClose: () => void = () => {};

  constructor(root: HTMLElement) {
    this.el = document.createElement('div');
    this.el.style.cssText = [
      'position:absolute', 'top:50%', 'left:50%', 'transform:translate(-50%,-50%)',
      'width:520px', 'max-width:94vw', 'max-height:88vh', 'overflow:auto',
      'padding:18px 20px', 'background:rgba(10,16,28,0.95)', 'border:1px solid rgba(120,160,220,0.4)',
      'border-radius:10px', 'pointer-events:auto', 'display:none',
      'font:13px/1.5 ui-monospace,Menlo,Consolas,monospace', 'color:#cfe3ff',
      'box-shadow:0 12px 48px rgba(0,0,0,0.6)',
    ].join(';');
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
    this.onClose();
  }

  private section(title: string, all: string[], have: string[], label?: (k: string) => string): string {
    const items = all
      .map((k) => {
        const owned = have.includes(k);
        const text = owned ? (label ? label(k) : k) : '???';
        return `<span style="display:inline-block;margin:2px;padding:3px 9px;border-radius:6px;border:1px solid ${owned ? 'rgba(120,200,160,0.5)' : 'rgba(120,140,170,0.25)'};color:${owned ? '#cfe3ff' : '#5c6b82'};background:${owned ? 'rgba(40,80,60,0.25)' : 'transparent'}">${text}</span>`;
      })
      .join('');
    const n = all.filter((k) => have.includes(k)).length;
    return `<div style="margin:12px 0 4px;font-weight:700;color:#9ec5ff">${title} <span style="opacity:0.6;font-weight:400">${n}/${all.length}</span></div><div>${items}</div>`;
  }

  private render(): void {
    const cx = progression.codex;
    const lp = levelProgress();
    const resourceIds = Object.keys(RESOURCES);
    const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
    this.el.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <div style="font-size:16px;font-weight:700">📖 DISCOVERY CODEX</div>
        <button data-close="1" style="font:inherit;cursor:pointer;color:#cfe3ff;background:rgba(120,140,170,0.22);border:1px solid rgba(120,160,220,0.4);border-radius:6px;padding:4px 12px">✕</button>
      </div>
      <div style="display:flex;gap:16px;flex-wrap:wrap;opacity:0.9;margin-bottom:4px">
        <span>Level <b style="color:#ffd27a">${lp.level}</b> <span style="opacity:0.6">(${lp.have}/${lp.need} XP)</span></span>
        <span>Reputation <b style="color:#9affd0">${progression.reputation}</b> <span style="opacity:0.6">(tier ${repTier()})</span></span>
        <span>Planets visited <b>${cx.planetsVisited}</b></span>
      </div>
      ${this.section('Biomes', ALL_BIOMES, cx.biomes, cap)}
      ${this.section('Creatures', ALL_CREATURES, cx.creatures, cap)}
      ${this.section('Star Classes', ALL_STARS, cx.starClasses, (k) => `Class ${k}`)}
      ${this.section('Resources', resourceIds, cx.resources, (k) => RESOURCES[k]?.name ?? k)}
      <div style="opacity:0.55;margin-top:14px;text-align:center">press C or ✕ to close</div>
    `;
    this.el.querySelectorAll('button[data-close]').forEach((b) => b.addEventListener('click', () => this.close()));
  }

  /** Re-render if open (e.g. after a new discovery while the panel is up). */
  refresh(): void {
    if (this.visible) this.render();
  }

  dispose(): void {
    this.el.remove();
  }
}
