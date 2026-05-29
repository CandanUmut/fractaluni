import { settings, saveSettings } from './settings.ts';

// Pause / settings overlay (Esc). Sliders for look sensitivity, master volume,
// and FOV; changes persist and apply live via callbacks.

export class PauseMenu {
  private readonly el: HTMLDivElement;
  visible = false;
  onResume: () => void = () => {};
  onVolume: (v: number) => void = () => {};
  onFov: (v: number) => void = () => {};

  constructor(root: HTMLElement) {
    this.el = document.createElement('div');
    this.el.style.cssText = [
      'position:absolute', 'inset:0', 'display:none', 'pointer-events:auto',
      'background:rgba(4,6,12,0.72)', 'backdrop-filter:blur(2px)',
      'font:13px ui-monospace,Menlo,Consolas,monospace', 'color:#cfe3ff',
      'align-items:center', 'justify-content:center',
    ].join(';');
    this.el.style.display = 'none';
    root.appendChild(this.el);
  }

  private slider(label: string, min: number, max: number, step: number, value: number, onInput: (v: number) => void): HTMLElement {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'margin:14px 0';
    const lab = document.createElement('div');
    lab.style.cssText = 'display:flex;justify-content:space-between;margin-bottom:4px';
    const name = document.createElement('span');
    name.textContent = label;
    const val = document.createElement('span');
    val.style.color = '#9affd0';
    val.textContent = value.toFixed(2);
    lab.append(name, val);
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    input.style.cssText = 'width:100%';
    input.addEventListener('input', () => {
      const v = Number(input.value);
      val.textContent = v.toFixed(2);
      onInput(v);
      saveSettings();
    });
    wrap.append(lab, input);
    return wrap;
  }

  private build(): void {
    const panel = document.createElement('div');
    panel.style.cssText = 'width:380px;max-width:92vw;padding:22px 24px;background:rgba(10,16,28,0.96);border:1px solid rgba(120,160,220,0.4);border-radius:12px;box-shadow:0 16px 60px rgba(0,0,0,0.6)';
    panel.innerHTML = `<div style="font-size:18px;font-weight:700;margin-bottom:6px">PAUSED</div>
      <div style="opacity:0.6;margin-bottom:8px">Esc or Resume to return</div>`;

    panel.appendChild(this.slider('Look sensitivity', 0.2, 3, 0.05, settings.sensitivity, (v) => (settings.sensitivity = v)));
    panel.appendChild(this.slider('Master volume', 0, 1, 0.05, settings.volume, (v) => {
      settings.volume = v;
      this.onVolume(v);
    }));
    panel.appendChild(this.slider('Field of view', 60, 100, 1, settings.fov, (v) => {
      settings.fov = v;
      this.onFov(v);
    }));

    const resume = document.createElement('button');
    resume.textContent = 'Resume';
    resume.style.cssText = 'margin-top:12px;width:100%;font:inherit;cursor:pointer;color:#0a1018;background:#2aa6ff;border:none;border-radius:8px;padding:10px';
    resume.addEventListener('click', () => this.close());
    panel.appendChild(resume);

    const help = document.createElement('div');
    help.style.cssText = 'margin-top:14px;opacity:0.6;line-height:1.6;font-size:12px';
    help.innerHTML = 'WASD move · mouse look · Shift sprint · Space jump/jetpack<br>1/2/3 weapon · LMB use · R scan · B ship · T take off';
    panel.appendChild(help);

    this.el.innerHTML = '';
    this.el.appendChild(panel);
  }

  toggle(): void {
    this.visible ? this.close() : this.open();
  }

  open(): void {
    this.visible = true;
    this.build();
    this.el.style.display = 'flex';
    if (document.pointerLockElement) document.exitPointerLock();
  }

  close(): void {
    this.visible = false;
    this.el.style.display = 'none';
    this.onResume();
  }
}
