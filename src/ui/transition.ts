// Quick, legible scene transitions: a full-screen fade that covers the (often
// heavy) scene construction, then reveals. Not a literal seamless descent — that
// was explicitly out of scope.

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export class Transition {
  private readonly el: HTMLDivElement;
  private readonly durationMs = 240;

  constructor() {
    this.el = document.createElement('div');
    const s = this.el.style;
    s.position = 'fixed';
    s.inset = '0';
    s.background = '#03040a';
    s.opacity = '0';
    s.pointerEvents = 'none';
    s.zIndex = '50';
    s.transition = `opacity ${this.durationMs}ms ease`;
    document.body.appendChild(this.el);
  }

  async cover(): Promise<void> {
    this.el.style.pointerEvents = 'auto';
    this.el.style.opacity = '1';
    await wait(this.durationMs);
  }

  async reveal(): Promise<void> {
    this.el.style.opacity = '0';
    await wait(this.durationMs);
    this.el.style.pointerEvents = 'none';
  }
}
