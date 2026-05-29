// On-screen mobile console: a left analog stick (move), a right-hand drag area
// (look), and a configurable set of action buttons (fire, jump, scan, …). It
// writes into the shared `touch` input bridge that the camera controllers read
// each frame, and forwards button presses to the active scene via TouchActions.
//
// PC builds never construct this; the `touch` bridge stays `enabled:false` so
// the controllers behave exactly as before.

/** Shared virtual-input bridge, read by FlyController / SurfaceController. */
export const touch = {
  /** True only when the player picked the mobile platform. */
  enabled: false,
  /** Left-stick vector, components in [-1,1]; y>0 means forward. */
  move: { x: 0, y: 0 },
  /** Accumulated look drag (pixels) — controllers consume and zero this. */
  lookDX: 0,
  lookDY: 0,
  /** Held "up / jump / jetpack" button (Space equivalent). */
  jump: false,
  /** Held "down" button (fly descend). */
  descend: false,
  /** Held warp/boost button (Shift equivalent). */
  warp: false,
};

export function resetTouchHolds(): void {
  touch.move.x = 0;
  touch.move.y = 0;
  touch.jump = false;
  touch.descend = false;
  touch.warp = false;
}

export interface TouchAction {
  id: string;
  label: string;
  /** Larger button drawn in the main right-hand cluster (e.g. FIRE, JUMP). */
  primary?: boolean;
  /** Accent color for the button face. */
  color?: string;
  /** Fired on press. */
  onDown: () => void;
  /** Fired on release (for hold-style buttons). */
  onUp?: () => void;
}

const JOY_R = 56; // joystick base radius (px)

export class TouchControls {
  private readonly root: HTMLDivElement;
  private readonly lookLayer: HTMLDivElement;
  private readonly joyBase: HTMLDivElement;
  private readonly joyKnob: HTMLDivElement;
  private readonly actionBar: HTMLDivElement;
  private readonly menuBtn: HTMLDivElement;

  private joyId: number | null = null;
  private joyCX = 0;
  private joyCY = 0;
  private lookId: number | null = null;
  private lookX = 0;
  private lookY = 0;

  onMenu: () => void = () => {};

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.style.cssText = 'position:absolute;inset:0;pointer-events:none;touch-action:none;z-index:20';
    parent.appendChild(this.root);

    // Look surface — lowest layer; any drag not on a control rotates the camera.
    this.lookLayer = document.createElement('div');
    this.lookLayer.style.cssText = 'position:absolute;inset:0;pointer-events:auto;touch-action:none';
    this.lookLayer.addEventListener('pointerdown', this.onLookDown);
    this.lookLayer.addEventListener('pointermove', this.onLookMove);
    this.lookLayer.addEventListener('pointerup', this.onLookUp);
    this.lookLayer.addEventListener('pointercancel', this.onLookUp);
    this.root.appendChild(this.lookLayer);

    // Analog stick (bottom-left).
    this.joyBase = document.createElement('div');
    this.joyBase.style.cssText = [
      'position:absolute', `left:26px`, `bottom:26px`, `width:${JOY_R * 2}px`, `height:${JOY_R * 2}px`,
      'border-radius:50%', 'background:rgba(20,30,48,0.35)', 'border:1px solid rgba(120,160,220,0.4)',
      'pointer-events:auto', 'touch-action:none', 'box-shadow:0 2px 12px rgba(0,0,0,0.4)',
    ].join(';');
    this.joyKnob = document.createElement('div');
    this.joyKnob.style.cssText = [
      'position:absolute', 'left:50%', 'top:50%', 'width:52px', 'height:52px', 'margin:-26px 0 0 -26px',
      'border-radius:50%', 'background:rgba(90,150,230,0.55)', 'border:1px solid rgba(190,220,255,0.7)',
      'transition:transform 0.04s linear',
    ].join(';');
    this.joyBase.appendChild(this.joyKnob);
    this.joyBase.addEventListener('pointerdown', this.onJoyDown);
    this.joyBase.addEventListener('pointermove', this.onJoyMove);
    this.joyBase.addEventListener('pointerup', this.onJoyUp);
    this.joyBase.addEventListener('pointercancel', this.onJoyUp);
    this.root.appendChild(this.joyBase);

    // Action buttons (bottom-right), populated per scene via setActions().
    this.actionBar = document.createElement('div');
    this.actionBar.style.cssText = [
      'position:absolute', 'right:22px', 'bottom:22px', 'display:flex', 'flex-wrap:wrap-reverse',
      'flex-direction:row', 'justify-content:flex-end', 'align-items:flex-end', 'gap:12px',
      'max-width:46vw', 'pointer-events:none',
    ].join(';');
    this.root.appendChild(this.actionBar);

    // Menu / pause button (top-left).
    this.menuBtn = this.makeButton({ id: 'menu', label: '☰', onDown: () => this.onMenu() }, false);
    this.menuBtn.style.position = 'absolute';
    this.menuBtn.style.left = '14px';
    this.menuBtn.style.top = '14px';
    this.menuBtn.style.width = '44px';
    this.menuBtn.style.height = '44px';
    this.root.appendChild(this.menuBtn);
  }

  // ---- joystick ----
  private onJoyDown = (e: PointerEvent): void => {
    e.preventDefault();
    if (this.joyId !== null) return;
    this.joyId = e.pointerId;
    const r = this.joyBase.getBoundingClientRect();
    this.joyCX = r.left + r.width / 2;
    this.joyCY = r.top + r.height / 2;
    this.joyBase.setPointerCapture(e.pointerId);
    this.updateJoy(e.clientX, e.clientY);
  };
  private onJoyMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.joyId) return;
    this.updateJoy(e.clientX, e.clientY);
  };
  private onJoyUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.joyId) return;
    this.joyId = null;
    touch.move.x = 0;
    touch.move.y = 0;
    this.joyKnob.style.transform = 'translate(0,0)';
  };
  private updateJoy(x: number, y: number): void {
    let dx = x - this.joyCX;
    let dy = y - this.joyCY;
    const len = Math.hypot(dx, dy) || 1;
    if (len > JOY_R) {
      dx = (dx / len) * JOY_R;
      dy = (dy / len) * JOY_R;
    }
    this.joyKnob.style.transform = `translate(${dx}px,${dy}px)`;
    touch.move.x = dx / JOY_R;
    touch.move.y = -dy / JOY_R; // up on screen = forward
  }

  // ---- look ----
  private onLookDown = (e: PointerEvent): void => {
    if (this.lookId !== null) return;
    this.lookId = e.pointerId;
    this.lookX = e.clientX;
    this.lookY = e.clientY;
    this.lookLayer.setPointerCapture(e.pointerId);
  };
  private onLookMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.lookId) return;
    touch.lookDX += e.clientX - this.lookX;
    touch.lookDY += e.clientY - this.lookY;
    this.lookX = e.clientX;
    this.lookY = e.clientY;
  };
  private onLookUp = (e: PointerEvent): void => {
    if (e.pointerId === this.lookId) this.lookId = null;
  };

  // ---- action buttons ----
  private makeButton(a: TouchAction, primary: boolean): HTMLDivElement {
    const b = document.createElement('div');
    const size = primary ? 76 : 52;
    const face = a.color ?? (primary ? 'rgba(90,150,230,0.5)' : 'rgba(30,42,64,0.55)');
    b.style.cssText = [
      `width:${size}px`, `height:${size}px`, 'border-radius:50%',
      `background:${face}`, 'border:1px solid rgba(160,200,255,0.6)',
      'display:flex', 'align-items:center', 'justify-content:center',
      `font:${primary ? 13 : 11}px ui-monospace,monospace`, 'font-weight:700', 'color:#eaf2ff',
      'text-align:center', 'pointer-events:auto', 'touch-action:none', 'user-select:none',
      '-webkit-user-select:none', 'text-shadow:0 1px 2px #000', 'line-height:1.05',
    ].join(';');
    b.textContent = a.label;
    const press = (down: boolean) => {
      b.style.filter = down ? 'brightness(1.5)' : 'none';
    };
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      press(true);
      a.onDown();
    });
    const release = (e: PointerEvent): void => {
      e.stopPropagation();
      press(false);
      a.onUp?.();
    };
    b.addEventListener('pointerup', release);
    b.addEventListener('pointercancel', release);
    b.addEventListener('pointerleave', (e) => {
      if (e.buttons) release(e);
    });
    return b;
  }

  /** Replace the action buttons for the current scene. */
  setActions(actions: TouchAction[]): void {
    this.actionBar.replaceChildren();
    // Smaller buttons first (laid out above/left), primaries last (bottom-right).
    const ordered = [...actions].sort((a, b) => Number(!!a.primary) - Number(!!b.primary));
    for (const a of ordered) this.actionBar.appendChild(this.makeButton(a, !!a.primary));
  }

  private readonly blockers = new Set<string>();
  /** Hide the console while a named UI is open (terminal, pause menu, …). */
  block(id: string, hidden: boolean): void {
    if (hidden) this.blockers.add(id);
    else this.blockers.delete(id);
    const blocked = this.blockers.size > 0;
    this.root.style.display = blocked ? 'none' : 'block';
    if (blocked) resetTouchHolds();
  }

  dispose(): void {
    this.root.remove();
    resetTouchHolds();
  }
}

/** Shared handle to the live console, so scenes/menus can hide it on demand. */
export const touchUI: { current: TouchControls | null } = { current: null };
