import { ASSET_BASE, ASSET_V } from "../core/Config";
import { SFX, MUSIC } from "./manifest";

class SoundManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buffers = new Map<string, AudioBuffer>();

  private manifest: Record<string, string> = { ...SFX, ...MUSIC };

  private ensureCtx(): AudioContext | null {
    if (typeof AudioContext === "undefined") return null;
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  resume(): void {
    this.ensureCtx();
  }

  async loadAll(onProgress?: (done: number, total: number) => void): Promise<void> {
    if (this.loadedAll) return;
    const ctx = this.ensureCtx();
    if (!ctx) return;
    const keys = Object.keys(this.manifest);
    let done = 0;
    await Promise.all(
      keys.map(async (key) => {
        try {
          const res = await fetch(
            `${ASSET_BASE}/sounds/${this.manifest[key]}?v=${ASSET_V}`,
          );
          this.buffers.set(key, await ctx.decodeAudioData(await res.arrayBuffer()));
        } catch {
        } finally {
          onProgress?.(++done, keys.length);
        }
      }),
    );
    this.loadedAll = true;
  }

  get context(): AudioContext | null {
    return this.ensureCtx();
  }

  get masterBus(): GainNode | null {
    this.ensureCtx();
    return this.master;
  }

  bufferFor(key: string): AudioBuffer | undefined {
    return this.buffers.get(key);
  }

  get loaded(): boolean {
    return this.loadedAll;
  }

  private loadedAll = false;

  play(key: string, volume = 1, pan = 0): void {
    if (!this.ctx || !this.master) return;
    const buf = this.buffers.get(key);
    if (!buf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const gain = this.ctx.createGain();
    gain.gain.value = volume;
    const panner = this.ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    src.connect(panner).connect(gain).connect(this.master);
    src.start();
  }
}

export const Sound = new SoundManager();
