// Transient toast notifications (top-center) plus a persistent objective tracker
// (top-right). Pure DOM in the pointer-events:none HUD layer. Used for
// discoveries, mission updates, level-ups, loot, and combat callouts.

interface Toast {
  el: HTMLDivElement;
  t: number;
  life: number;
}

export class Notifications {
  private readonly stack: HTMLDivElement;
  private readonly tracker: HTMLDivElement;
  private readonly toasts: Toast[] = [];
  private readonly maxToasts = 5;

  constructor(root: HTMLElement) {
    this.stack = document.createElement('div');
    this.stack.style.cssText = [
      'position:absolute', 'top:96px', 'left:50%', 'transform:translateX(-50%)',
      'display:flex', 'flex-direction:column', 'align-items:center', 'gap:6px',
      'pointer-events:none', 'width:max-content', 'max-width:80vw', 'z-index:5',
    ].join(';');
    root.appendChild(this.stack);

    this.tracker = document.createElement('div');
    this.tracker.style.cssText = [
      'position:absolute', 'top:14px', 'right:14px', 'pointer-events:none',
      'font:12px ui-monospace,monospace', 'color:#cfe3ff', 'text-align:right',
      'text-shadow:0 1px 3px #000', 'max-width:46vw',
    ].join(';');
    root.appendChild(this.tracker);
  }

  /** Pop a toast. `kind` tints the accent bar. */
  push(text: string, kind: 'info' | 'good' | 'warn' | 'reward' = 'info'): void {
    const color = kind === 'good' ? '#9affd0' : kind === 'warn' ? '#ff8a6a' : kind === 'reward' ? '#ffd27a' : '#bfe0ff';
    const el = document.createElement('div');
    el.style.cssText = [
      'background:rgba(8,12,22,0.78)', `border-left:3px solid ${color}`, 'border-radius:6px',
      'padding:7px 14px', 'font:13px ui-monospace,monospace', 'color:#eaf2ff',
      'box-shadow:0 4px 16px rgba(0,0,0,0.4)', 'opacity:0', 'transform:translateY(-8px)',
      'transition:opacity 0.18s,transform 0.18s', 'white-space:nowrap', 'max-width:80vw', 'overflow:hidden', 'text-overflow:ellipsis',
    ].join(';');
    el.innerHTML = text;
    this.stack.appendChild(el);
    // Force a reflow so the entry transition runs.
    void el.offsetWidth;
    el.style.opacity = '1';
    el.style.transform = 'translateY(0)';
    this.toasts.push({ el, t: 0, life: 3.6 });
    while (this.toasts.length > this.maxToasts) {
      const old = this.toasts.shift()!;
      old.el.remove();
    }
  }

  /** Persistent objective list (accepted missions). */
  setObjectives(items: { text: string; color?: string }[]): void {
    if (items.length === 0) {
      this.tracker.innerHTML = '';
      return;
    }
    const rows = items
      .map((i) => `<div style="margin-bottom:3px;color:${i.color ?? '#cfe3ff'}">${i.text}</div>`)
      .join('');
    this.tracker.innerHTML = `<div style="opacity:0.6;margin-bottom:4px">◎ OBJECTIVES</div>${rows}`;
  }

  update(dt: number): void {
    for (let i = this.toasts.length - 1; i >= 0; i--) {
      const t = this.toasts[i]!;
      t.t += dt;
      if (t.t >= t.life) {
        t.el.style.opacity = '0';
        t.el.style.transform = 'translateY(-8px)';
        if (t.t >= t.life + 0.25) {
          t.el.remove();
          this.toasts.splice(i, 1);
        }
      }
    }
  }

  setVisible(v: boolean): void {
    this.stack.style.display = v ? 'flex' : 'none';
    this.tracker.style.display = v ? 'block' : 'none';
  }

  dispose(): void {
    this.stack.remove();
    this.tracker.remove();
  }
}
