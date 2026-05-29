// Self-contained sound manager (single WebAudio context): plays the player's
// own files from public/sounds/ if present, else synthesizes the sound. Supports
// stereo panning (caller passes a [-1,1] pan from the source's screen-relative
// angle), a looping drill sound, and a subtle ambient bed. Created lazily on the
// first user gesture.
//
// Optional files in public/sounds/ (first of .mp3/.ogg/.wav wins):
//   gunshot impact explosion throw equip drill(LOOP) extract pickup
//   step land jet attack hurt death ambient(LOOP)

export type SoundName =
  | 'gunshot' | 'impact' | 'explosion' | 'throw' | 'equip' | 'drill' | 'extract'
  | 'pickup' | 'step' | 'land' | 'jet' | 'attack' | 'hurt' | 'death' | 'ambient';

const EXTS = ['mp3', 'ogg', 'wav'];
const NAMES: SoundName[] = ['gunshot', 'impact', 'explosion', 'throw', 'equip', 'drill', 'extract', 'pickup', 'step', 'land', 'jet', 'attack', 'hurt', 'death', 'ambient'];

export class AudioManager {
  enabled = true;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private masterVol = 0.6;
  private readonly buffers = new Map<SoundName, AudioBuffer>();
  private loop: { src: AudioBufferSourceNode | OscillatorNode; nodes: AudioNode[] } | null = null;
  private ambient: AudioNode[] | null = null;
  private loadStarted = false;

  init(): void {
    if (!this.enabled || this.ctx) return;
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.masterVol;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } catch {
      this.enabled = false;
      return;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    if (!this.loadStarted) {
      this.loadStarted = true;
      void this.loadAll();
    }
  }

  setVolume(v: number): void {
    this.masterVol = v;
    if (this.master) this.master.gain.value = v;
  }

  private base(): string {
    return (import.meta as unknown as { env: { BASE_URL: string } }).env.BASE_URL;
  }

  private async loadAll(): Promise<void> {
    await Promise.all(NAMES.map((n) => this.tryLoad(n)));
  }

  private async tryLoad(name: SoundName): Promise<void> {
    if (!this.ctx) return;
    for (const ext of EXTS) {
      try {
        const res = await fetch(`${this.base()}sounds/${name}.${ext}`);
        if (!res.ok) continue;
        this.buffers.set(name, await this.ctx.decodeAudioData(await res.arrayBuffer()));
        return;
      } catch {
        /* next */
      }
    }
  }

  /** Output node honoring an optional stereo pan. */
  private out(pan: number): AudioNode {
    if (!this.ctx || !this.master) return this.master as unknown as AudioNode;
    if (Math.abs(pan) < 0.02 || !this.ctx.createStereoPanner) return this.master;
    const p = this.ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    p.connect(this.master);
    return p;
  }

  play(name: SoundName, volume = 1, pan = 0): void {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx || !this.master) return;
    const dest = this.out(pan);
    const buf = this.buffers.get(name);
    if (buf) {
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const g = this.ctx.createGain();
      g.gain.value = volume;
      src.connect(g);
      g.connect(dest);
      src.start();
      return;
    }
    this.synth(name, dest, volume);
  }

  startLoop(name: SoundName, volume = 0.6): void {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx || !this.master || this.loop) return;
    const buf = this.buffers.get(name);
    if (buf) {
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const g = this.ctx.createGain();
      g.gain.value = volume;
      src.connect(g);
      g.connect(this.master);
      src.start();
      this.loop = { src, nodes: [g] };
      return;
    }
    // Synth drill loop: sawtooth + filtered noise.
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 70;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(volume, this.ctx.currentTime + 0.12);
    osc.connect(g);
    src.connect(bp);
    bp.connect(g);
    g.connect(this.master);
    osc.start();
    src.start();
    this.loop = { src: osc, nodes: [g, src, bp] };
  }

  stopLoop(): void {
    if (!this.ctx || !this.loop) return;
    const t = this.ctx.currentTime;
    const g = this.loop.nodes[0] as GainNode;
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(g.gain.value, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    try {
      (this.loop.src as OscillatorNode).stop(t + 0.12);
    } catch {
      /* ignore */
    }
    this.loop = null;
  }

  /** A subtle ambient pad (uses an `ambient` file if present, else synth). */
  startAmbient(): void {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx || !this.master || this.ambient) return;
    const buf = this.buffers.get('ambient');
    if (buf) {
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const g = this.ctx.createGain();
      g.gain.value = 0.35;
      src.connect(g);
      g.connect(this.master);
      src.start();
      this.ambient = [src, g];
      return;
    }
    const nodes: AudioNode[] = [];
    const g = this.ctx.createGain();
    g.gain.value = 0.05;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 400;
    lp.connect(g);
    g.connect(this.master);
    for (const f of [55, 82.5, 110]) {
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f * (0.99 + Math.random() * 0.02);
      o.connect(lp);
      o.start();
      nodes.push(o);
    }
    nodes.push(lp, g);
    this.ambient = nodes;
  }

  stopAmbient(): void {
    if (!this.ambient) return;
    for (const n of this.ambient) {
      try {
        (n as OscillatorNode).stop?.();
      } catch {
        /* ignore */
      }
      n.disconnect();
    }
    this.ambient = null;
  }

  // ---- Synth fallbacks -------------------------------------------------------

  private env(node: AudioNode, dest: AudioNode, attack: number, decay: number, peak: number): void {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    node.connect(g);
    g.connect(dest);
  }

  private noiseSrc(): AudioBufferSourceNode {
    const s = this.ctx!.createBufferSource();
    s.buffer = this.noise;
    return s;
  }

  private synth(name: SoundName, dest: AudioNode, vol: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    switch (name) {
      case 'gunshot': {
        const n = this.noiseSrc();
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 700;
        n.connect(hp);
        this.env(hp, dest, 0.001, 0.09, 0.9 * vol);
        n.start(t);
        n.stop(t + 0.12);
        const o = ctx.createOscillator();
        o.type = 'square';
        o.frequency.setValueAtTime(420, t);
        o.frequency.exponentialRampToValueAtTime(90, t + 0.08);
        this.env(o, dest, 0.001, 0.08, 0.4 * vol);
        o.start(t);
        o.stop(t + 0.1);
        break;
      }
      case 'explosion':
      case 'death': {
        const n = this.noiseSrc();
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(1200, t);
        lp.frequency.exponentialRampToValueAtTime(120, t + 0.5);
        n.connect(lp);
        this.env(lp, dest, 0.005, 0.6, vol);
        n.start(t);
        n.stop(t + 0.7);
        const sub = ctx.createOscillator();
        sub.type = 'sine';
        sub.frequency.setValueAtTime(110, t);
        sub.frequency.exponentialRampToValueAtTime(35, t + 0.4);
        this.env(sub, dest, 0.005, 0.5, 0.8 * vol);
        sub.start(t);
        sub.stop(t + 0.5);
        break;
      }
      case 'impact':
      case 'step':
      case 'attack': {
        const n = this.noiseSrc();
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = name === 'step' ? 500 : name === 'attack' ? 1100 : 1800;
        n.connect(bp);
        this.env(bp, dest, 0.001, name === 'attack' ? 0.12 : 0.05, (name === 'step' ? 0.35 : 0.5) * vol);
        n.start(t);
        n.stop(t + 0.14);
        break;
      }
      case 'land': {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.setValueAtTime(160, t);
        o.frequency.exponentialRampToValueAtTime(50, t + 0.16);
        this.env(o, dest, 0.002, 0.16, 0.6 * vol);
        o.start(t);
        o.stop(t + 0.2);
        break;
      }
      case 'jet': {
        const n = this.noiseSrc();
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 400;
        n.connect(hp);
        this.env(hp, dest, 0.01, 0.12, 0.3 * vol);
        n.start(t);
        n.stop(t + 0.16);
        break;
      }
      case 'hurt': {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(220, t);
        o.frequency.exponentialRampToValueAtTime(90, t + 0.18);
        this.env(o, dest, 0.002, 0.18, 0.4 * vol);
        o.start(t);
        o.stop(t + 0.22);
        break;
      }
      case 'throw':
      case 'equip':
      case 'extract':
      case 'pickup':
      default: {
        const freq = name === 'pickup' ? 760 : name === 'equip' ? 520 : name === 'extract' ? 360 : 300;
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = freq;
        this.env(o, dest, 0.002, 0.09, 0.4 * vol);
        o.start(t);
        o.stop(t + 0.12);
        break;
      }
    }
  }
}

export const audio = new AudioManager();
