// Launch flow: a platform picker (Desktop vs Mobile) shown every load, followed
// by a one-time onboarding card for first-time players that explains what
// Fractaluni is and how to play (controls tailored to the chosen platform).
// Resolves once the player taps "Begin", at which point the game takes over.

import { type Platform, guessPlatform, storedPlatform, setPlatform } from './platform.ts';

const INTRO_KEY = 'fractaluni.introSeen';

function introSeen(): boolean {
  try {
    return localStorage.getItem(INTRO_KEY) === '1';
  } catch {
    return false;
  }
}
function markIntroSeen(): void {
  try {
    localStorage.setItem(INTRO_KEY, '1');
  } catch {
    /* ignore */
  }
}

const PC_CONTROLS: [string, string][] = [
  ['Move', 'W A S D'],
  ['Look', 'Mouse (click to capture)'],
  ['Jump / Jetpack', 'Space'],
  ['Sprint', 'Shift'],
  ['Fire / Mine', 'Left Mouse'],
  ['Weapons', '1 gun · 2 frag · 3 drill'],
  ['Scan deposits', 'R'],
  ['Trade at ship', 'B'],
  ['Walk / Fly', 'G'],
  ['Take off', 'T'],
  ['Menu', 'Esc'],
];

const MOBILE_CONTROLS: [string, string][] = [
  ['Move', 'Left stick'],
  ['Look', 'Drag anywhere'],
  ['Fire / Mine', 'FIRE button'],
  ['Jump / Jetpack', 'JUMP button'],
  ['Weapons', 'WPN button cycles'],
  ['Scan deposits', 'SCAN button'],
  ['Trade at ship', 'SHIP button'],
  ['Take off', 'LIFT button'],
  ['Menu', '☰ (top-left)'],
];

export class StartScreen {
  private readonly overlay: HTMLDivElement;
  private readonly card: HTMLDivElement;
  private platform: Platform;
  private resolve: (() => void) | null = null;

  constructor(parent: HTMLElement) {
    this.platform = storedPlatform() ?? guessPlatform();

    this.overlay = document.createElement('div');
    this.overlay.style.cssText = [
      'position:absolute', 'inset:0', 'z-index:60', 'pointer-events:auto',
      'display:flex', 'align-items:center', 'justify-content:center', 'padding:18px',
      'background:radial-gradient(120% 120% at 50% 0%,rgba(20,30,60,0.86),rgba(4,6,12,0.96))',
      'backdrop-filter:blur(3px)', 'overflow:auto',
      'font:14px/1.5 ui-monospace,"SF Mono",Menlo,Consolas,monospace', 'color:#dce8ff',
    ].join(';');

    this.card = document.createElement('div');
    this.card.style.cssText = [
      'max-width:560px', 'width:100%', 'background:rgba(10,16,30,0.72)',
      'border:1px solid rgba(120,160,220,0.3)', 'border-radius:16px', 'padding:28px',
      'box-shadow:0 20px 60px rgba(0,0,0,0.6)', 'text-align:center',
    ].join(';');
    this.overlay.appendChild(this.card);
    parent.appendChild(this.overlay);
  }

  /** Show the flow; resolves when the player chooses to begin. */
  start(): Promise<void> {
    return new Promise((resolve) => {
      this.resolve = resolve;
      this.renderPicker();
    });
  }

  private button(label: string, sub: string, accent: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.style.cssText = [
      'flex:1', 'min-width:150px', 'cursor:pointer', 'pointer-events:auto',
      'background:rgba(18,28,48,0.8)', `border:1px solid ${accent}`, 'border-radius:12px',
      'padding:18px 14px', 'color:#eaf2ff', 'font:inherit', 'text-align:center',
      'transition:transform 0.08s,background 0.12s',
    ].join(';');
    b.innerHTML = `<div style="font-size:18px;font-weight:700;color:${accent}">${label}</div><div style="opacity:0.7;margin-top:6px;font-size:12px">${sub}</div>`;
    b.addEventListener('pointerenter', () => (b.style.background = 'rgba(30,44,72,0.95)'));
    b.addEventListener('pointerleave', () => (b.style.background = 'rgba(18,28,48,0.8)'));
    b.addEventListener('click', onClick);
    return b;
  }

  private renderPicker(): void {
    this.card.replaceChildren();
    const suggested = this.platform;
    this.card.innerHTML = `
      <div style="font-size:30px;font-weight:800;letter-spacing:2px;color:#9ec5ff;text-shadow:0 2px 12px rgba(90,150,230,0.5)">FRACTALUNI</div>
      <div style="opacity:0.8;margin-top:8px">An infinite procedural universe. Fly between stars, descend to living worlds, and scavenge them.</div>
      <div style="margin-top:22px;opacity:0.9;font-weight:700">How are you playing?</div>
    `;
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:14px;margin-top:16px;flex-wrap:wrap';
    const pc = this.button('🖥  Desktop', 'Keyboard & mouse', '#7ab8ff', () => this.choose('pc'));
    const mobile = this.button('📱  Mobile', 'On-screen touch console', '#8fe0c0', () => this.choose('mobile'));
    if (suggested === 'mobile') mobile.style.boxShadow = '0 0 0 2px #8fe0c0';
    else pc.style.boxShadow = '0 0 0 2px #7ab8ff';
    row.append(pc, mobile);
    this.card.appendChild(row);

    const hint = document.createElement('div');
    hint.style.cssText = 'margin-top:16px;opacity:0.55;font-size:12px';
    hint.textContent = `Suggested for this device: ${suggested === 'mobile' ? 'Mobile' : 'Desktop'}`;
    this.card.appendChild(hint);
  }

  private choose(p: Platform): void {
    this.platform = p;
    setPlatform(p);
    if (introSeen()) this.finish();
    else this.renderOnboarding();
  }

  private renderOnboarding(): void {
    this.card.replaceChildren();
    const controls = this.platform === 'mobile' ? MOBILE_CONTROLS : PC_CONTROLS;
    const rows = controls
      .map(
        ([k, v]) =>
          `<div style="display:flex;justify-content:space-between;gap:12px;padding:4px 0;border-bottom:1px solid rgba(120,160,220,0.12)"><span style="opacity:0.75">${k}</span><span style="color:#cfe3ff;text-align:right">${v}</span></div>`,
      )
      .join('');
    this.card.innerHTML = `
      <div style="font-size:22px;font-weight:800;color:#9ec5ff">Welcome, explorer</div>
      <div style="text-align:left;margin-top:14px;opacity:0.9">
        <p style="margin:0 0 10px">Fractaluni is an <b>infinite, procedurally-generated universe</b> grown from a single seed. Soar through a galaxy of stars, drop into a star system, then land on a planet's surface.</p>
        <p style="margin:0 0 10px"><b>Your goal:</b> survive and get rich. <b>Scan</b> for ore deposits, <b>mine</b> them with your drill, <b>haul</b> the cargo back to your ship, and <b>sell</b> it to buy upgrades. Beware the guardians defending the richest veins.</p>
        <p style="margin:0 0 10px"><b>It's a living world.</b> Birds wheel overhead, herds roam the plains, fish dart through the water, and forests cover the hills — and you can <b>shoot all of it</b>. Take aim with the pulse rifle or frag charges and watch the world react.</p>
      </div>
      <div style="margin-top:16px;font-weight:700;text-align:left;color:#9affd0">Controls</div>
      <div style="text-align:left;margin-top:8px;font-size:13px">${rows}</div>
    `;
    const begin = document.createElement('button');
    begin.textContent = 'Begin exploring →';
    begin.style.cssText = [
      'margin-top:22px', 'cursor:pointer', 'pointer-events:auto', 'width:100%',
      'background:linear-gradient(90deg,#2a6cff,#37b6a0)', 'border:none', 'border-radius:12px',
      'padding:16px', 'color:#fff', 'font:700 16px ui-monospace,monospace', 'letter-spacing:1px',
    ].join(';');
    begin.addEventListener('click', () => {
      markIntroSeen();
      this.finish();
    });
    this.card.appendChild(begin);

    const back = document.createElement('div');
    back.textContent = '← change platform';
    back.style.cssText = 'margin-top:12px;opacity:0.6;font-size:12px;cursor:pointer;pointer-events:auto';
    back.addEventListener('click', () => this.renderPicker());
    this.card.appendChild(back);
  }

  private finish(): void {
    this.overlay.remove();
    const r = this.resolve;
    this.resolve = null;
    r?.();
  }
}
