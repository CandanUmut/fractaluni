import { sfx } from './sfx.ts';

// Sound manager: plays the player's own audio files if present in
// `public/sounds/`, otherwise falls back to the procedural synth (sfx.ts).
// Files are optional — the game is fully playable without them.
//
// Drop files here (served at <base>/sounds/<name>.<ext>); first existing
// extension wins (.mp3, .ogg, .wav):
//   gunshot     — rifle fire (short)
//   impact      — bullet hitting terrain (short tick)
//   explosion   — bomb detonation (boom)
//   throw       — lobbing a bomb (whoosh)
//   equip       — switching weapon (click/clack)
//   drill       — mining drill LOOP (seamless ~1s loop)
//   extract     — a resource node depleting (Phase C)
//   pickup      — collecting resource into cargo (Phase C)

export type SoundName = 'gunshot' | 'impact' | 'explosion' | 'throw' | 'equip' | 'drill' | 'extract' | 'pickup';

const EXTS = ['mp3', 'ogg', 'wav'];

export class AudioManager {
  enabled = true;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private readonly buffers = new Map<SoundName, AudioBuffer>();
  private readonly missing = new Set<SoundName>();
  private loop: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private loadStarted = false;

  /** Call on a user gesture (e.g. pointer-lock click) to unlock audio + load. */
  init(): void {
    if (!this.enabled || this.ctx) return;
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.6;
      this.master.connect(this.ctx.destination);
    } catch {
      this.enabled = false;
      return;
    }
    if (!this.loadStarted) {
      this.loadStarted = true;
      void this.loadAll();
    }
  }

  private base(): string {
    // Vite injects the deploy base (e.g. "/fractaluni/").
    return (import.meta as unknown as { env: { BASE_URL: string } }).env.BASE_URL;
  }

  private async loadAll(): Promise<void> {
    const names: SoundName[] = ['gunshot', 'impact', 'explosion', 'throw', 'equip', 'drill', 'extract', 'pickup'];
    await Promise.all(names.map((n) => this.tryLoad(n)));
  }

  private async tryLoad(name: SoundName): Promise<void> {
    if (!this.ctx) return;
    for (const ext of EXTS) {
      try {
        const res = await fetch(`${this.base()}sounds/${name}.${ext}`);
        if (!res.ok) continue;
        const buf = await this.ctx.decodeAudioData(await res.arrayBuffer());
        this.buffers.set(name, buf);
        return;
      } catch {
        /* try next extension */
      }
    }
    this.missing.add(name); // no file → use synth fallback
  }

  play(name: SoundName, volume = 1): void {
    if (!this.enabled) return;
    this.init();
    const buf = this.buffers.get(name);
    if (buf && this.ctx && this.master) {
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const g = this.ctx.createGain();
      g.gain.value = volume;
      src.connect(g);
      g.connect(this.master);
      src.start();
      return;
    }
    this.fallback(name);
  }

  startLoop(name: SoundName, volume = 0.6): void {
    if (!this.enabled) return;
    this.init();
    const buf = this.buffers.get(name);
    if (buf && this.ctx && this.master && !this.loop) {
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const g = this.ctx.createGain();
      g.gain.value = volume;
      src.connect(g);
      g.connect(this.master);
      src.start();
      this.loop = { src, gain: g };
      return;
    }
    if (!buf) sfx.startDrill(); // synth fallback loop
  }

  stopLoop(): void {
    if (this.loop) {
      try {
        this.loop.src.stop();
      } catch {
        /* already stopped */
      }
      this.loop = null;
    }
    sfx.stopDrill();
  }

  private fallback(name: SoundName): void {
    switch (name) {
      case 'gunshot': sfx.gun(); break;
      case 'impact': sfx.impact(); break;
      case 'explosion': sfx.explosion(); break;
      case 'throw': sfx.blip(280); break;
      case 'equip': sfx.blip(520); break;
      case 'extract': sfx.impact(); break;
      case 'pickup': sfx.blip(760); break;
      case 'drill': break; // handled by startLoop fallback
    }
  }
}

export const audio = new AudioManager();
