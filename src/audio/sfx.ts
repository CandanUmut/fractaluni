// Procedural sound effects via WebAudio — synthesized, no asset files. Created
// lazily on first use (after a user gesture, e.g. the pointer-lock click).

export class Sfx {
  private ctx: AudioContext | null = null;
  private noise: AudioBuffer | null = null;
  private master: GainNode | null = null;
  private drill: { osc: OscillatorNode; gain: GainNode; src: AudioBufferSourceNode } | null = null;
  enabled = true;

  private ensure(): AudioContext | null {
    if (!this.enabled) return null;
    if (!this.ctx) {
      try {
        const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        this.ctx = new Ctx();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.35;
        this.master.connect(this.ctx.destination);
        // 1s of white noise for percussive/impact sounds.
        const len = this.ctx.sampleRate;
        this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      } catch {
        this.enabled = false;
        return null;
      }
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  private env(node: AudioNode, ctx: AudioContext, attack: number, decay: number, peak: number): GainNode {
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    node.connect(g);
    g.connect(this.master!);
    return g;
  }

  private noiseSource(ctx: AudioContext): AudioBufferSourceNode {
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    return s;
  }

  gun(): void {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime;
    const n = this.noiseSource(ctx);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 700;
    n.connect(hp);
    this.env(hp, ctx, 0.001, 0.09, 0.9);
    n.start(t);
    n.stop(t + 0.12);
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(420, t);
    osc.frequency.exponentialRampToValueAtTime(90, t + 0.08);
    this.env(osc, ctx, 0.001, 0.08, 0.4);
    osc.start(t);
    osc.stop(t + 0.1);
  }

  impact(): void {
    const ctx = this.ensure();
    if (!ctx) return;
    const n = this.noiseSource(ctx);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1800;
    n.connect(bp);
    this.env(bp, ctx, 0.001, 0.05, 0.5);
    n.start();
    n.stop(ctx.currentTime + 0.07);
  }

  explosion(): void {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime;
    const n = this.noiseSource(ctx);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1200, t);
    lp.frequency.exponentialRampToValueAtTime(120, t + 0.5);
    n.connect(lp);
    this.env(lp, ctx, 0.005, 0.6, 1.0);
    n.start(t);
    n.stop(t + 0.7);
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(110, t);
    sub.frequency.exponentialRampToValueAtTime(35, t + 0.4);
    this.env(sub, ctx, 0.005, 0.5, 0.8);
    sub.start(t);
    sub.stop(t + 0.5);
  }

  blip(freq = 660): void {
    const ctx = this.ensure();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    this.env(osc, ctx, 0.002, 0.08, 0.4);
    osc.start();
    osc.stop(ctx.currentTime + 0.1);
  }

  startDrill(): void {
    const ctx = this.ensure();
    if (!ctx || this.drill) return;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 70;
    const src = this.noiseSource(ctx);
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.5, ctx.currentTime + 0.12);
    osc.connect(gain);
    src.connect(bp);
    bp.connect(gain);
    gain.connect(this.master!);
    osc.start();
    src.start();
    this.drill = { osc, gain, src };
  }

  stopDrill(): void {
    if (!this.ctx || !this.drill) return;
    const { osc, gain, src } = this.drill;
    const t = this.ctx.currentTime;
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(gain.gain.value, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    osc.stop(t + 0.12);
    src.stop(t + 0.12);
    this.drill = null;
  }
}

export const sfx = new Sfx();
