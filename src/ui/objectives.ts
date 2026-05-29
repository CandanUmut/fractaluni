// First-run onboarding: a short ordered objective chain that teaches the core
// loop (scan → approach → mine → haul → sell/upgrade). Advances on game events;
// once finished it's marked done in localStorage and never shown again.

interface Step {
  key: string;
  text: string;
}

const STEPS: Step[] = [
  { key: 'scan', text: 'Press [R] to scan for resource deposits' },
  { key: 'approach', text: 'Follow a marker to a deposit' },
  { key: 'mine', text: 'Press [3] for the drill, hold LMB to mine ore' },
  { key: 'ship', text: 'Haul your cargo back to your ship (◈)' },
  { key: 'sell', text: 'Press [B] at the ship to sell, then buy an upgrade' },
];

const DONE_KEY = 'fractaluni.tutorialDone';

export class Objectives {
  private readonly el: HTMLDivElement;
  private idx = 0;
  private done = false;
  private fadeT = 0;

  constructor(root: HTMLElement) {
    this.el = document.createElement('div');
    this.el.style.cssText = [
      'position:absolute', 'top:62px', 'left:50%', 'transform:translateX(-50%)',
      'pointer-events:none', 'font:13px ui-monospace,monospace', 'color:#cfe3ff',
      'background:rgba(8,12,22,0.55)', 'border:1px solid rgba(120,160,220,0.25)',
      'border-radius:8px', 'padding:8px 14px', 'text-align:center', 'text-shadow:0 1px 3px #000',
    ].join(';');
    root.appendChild(this.el);
    try {
      this.done = localStorage.getItem(DONE_KEY) === '1';
    } catch {
      /* ignore */
    }
    if (this.done) this.el.style.display = 'none';
    else this.render();
  }

  complete(key: string): void {
    if (this.done || STEPS[this.idx]?.key !== key) return;
    this.idx++;
    if (this.idx >= STEPS.length) {
      this.el.innerHTML = '<b style="color:#9affd0">✓ You\'re set — happy scavenging.</b>';
      this.fadeT = 4;
      try {
        localStorage.setItem(DONE_KEY, '1');
      } catch {
        /* ignore */
      }
    } else {
      this.render();
    }
  }

  update(dt: number): void {
    if (this.fadeT > 0) {
      this.fadeT -= dt;
      if (this.fadeT <= 0) {
        this.done = true;
        this.el.style.display = 'none';
      }
    }
  }

  private render(): void {
    const cur = STEPS[this.idx]!;
    this.el.innerHTML = `<span style="opacity:0.6">OBJECTIVE ${this.idx + 1}/${STEPS.length}</span><br><b>${cur.text}</b>`;
  }

  dispose(): void {
    this.el.remove();
  }
}
