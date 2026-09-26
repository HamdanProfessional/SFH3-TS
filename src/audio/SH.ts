import { SD } from "../state/SD";
import { MatchSettings } from "../game/MatchSettings";
import { Sound } from "./Sounds";
import { SONG_LIST, SONG_NAMES } from "./manifest";

const MAX_VOICES = 24;

class SoundHandler {
  private readonly soundVolLow = 0.15;
  private readonly soundVol = 0.4;
  private readonly soundVolLoud = 0.9;
  private readonly maxVolume = 0.8;

  useLowVol = false;

  private musicVol = 0;
  private fadeVol = 0;

  private musicKey: string | null = null;
  private musicSrc: AudioBufferSourceNode | null = null;
  private fadeSrc: AudioBufferSourceNode | null = null;
  private musicGain: GainNode | null = null;
  private fadeGain: GainNode | null = null;

  private voices = 0;

  inMatch = false;
  msgTimer = false;

  readonly songList = SONG_LIST;
  readonly songNames = SONG_NAMES;

  get musicVolume(): number { return this.musicVol; }
  get fadeVolume(): number { return this.fadeVol; }
  get currentKey(): string | null { return this.musicKey; }

  private ensureGains(): boolean {
    const ctx = Sound.context;
    const master = Sound.masterBus;
    if (!ctx || !master) return false;
    if (!this.musicGain) {
      this.musicGain = ctx.createGain();
      this.musicGain.gain.value = 0;
      this.musicGain.connect(master);
      this.fadeGain = ctx.createGain();
      this.fadeGain.gain.value = 0;
      this.fadeGain.connect(master);
    }
    return true;
  }

  playSound(key: string, louder = false): void {
    if (!SD.options.sound) return;
    const ctx = Sound.context;
    const master = Sound.masterBus;
    const buf = Sound.bufferFor(key);
    if (!ctx || !master || !buf || this.voices >= MAX_VOICES) return;

    const volume = this.useLowVol
      ? (louder ? this.soundVol : this.soundVolLow)
      : (louder ? this.soundVolLoud : this.soundVol);

    const src = ctx.createBufferSource();
    src.buffer = buf;
    const gain = ctx.createGain();
    gain.gain.value = volume;
    src.connect(gain).connect(master);
    this.voices++;
    src.onended = () => { this.voices--; };
    src.start();
  }

  playVoice(_key: string): number {
    return 0;
  }

  playMusic(key: string, instant = false, time = 0): void {
    if (this.musicKey === key && this.musicSrc) return;
    if (!this.ensureGains()) return;

    const buf = Sound.bufferFor(key);
    if (!buf) {
      this.musicKey = key;
      this.musicSrc = null;
      return;
    }

    if (this.musicKey && this.musicSrc) {
      if (this.fadeSrc) { try { this.fadeSrc.stop(); } catch {} }
      this.fadeVol = (!SD.options.music || instant) ? 0 : this.maxVolume;
      this.musicSrc.disconnect();
      this.musicSrc.connect(this.fadeGain!);
      this.fadeSrc = this.musicSrc;
      this.fadeGain!.gain.value = this.fadeVol;
    } else {
      instant = true;
    }

    this.musicVol = (instant && SD.options.music) ? this.maxVolume : 0;
    this.musicKey = key;
    this.beginSource(key, time);
  }

  private beginSource(key: string, time: number): void {
    const ctx = Sound.context;
    const buf = Sound.bufferFor(key);
    if (!ctx || !buf || !this.musicGain) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(this.musicGain);
    src.start(0, Math.max(0, time) / 1000);
    this.musicSrc = src;
    this.musicGain.gain.value = this.musicVol;
  }

  stopMusic(): void {
    if (this.musicSrc) { try { this.musicSrc.stop(); } catch {} }
    if (this.fadeSrc) { try { this.fadeSrc.stop(); } catch {} }
    this.musicSrc = this.fadeSrc = null;
    this.musicKey = null;
    this.musicVol = this.fadeVol = 0;
  }

  updateMusicVolume(): void {
    if (SD.options.music) {
      this.fadeVol = 0;
      this.musicVol = 0;
    } else {
      this.fadeVol = 0;
      this.musicVol = this.maxVolume;
    }
  }

  enterFrame(): void {
    this.ensureGains();
    this.useLowVol = false;

    if (this.musicKey && !this.musicSrc) {
      if (Sound.bufferFor(this.musicKey)) {
        this.musicVol = SD.options.music ? this.maxVolume : 0;
        this.beginSource(this.musicKey, 0);
      }
    }

    if (this.fadeSrc) {
      if (this.fadeVol > 0) {
        this.fadeVol -= 0.025;
        if (this.fadeGain) this.fadeGain.gain.value = this.fadeVol;
      } else {
        try { this.fadeSrc.stop(); } catch {}
        this.fadeSrc = null;
      }
    }

    if (this.musicKey) {
      if (SD.options.music) {
        let mMax = this.maxVolume;
        if (this.inMatch && MatchSettings.matchType === 0 && this.msgTimer && SD.options.voices) {
          this.useLowVol = true;
        }
        if (this.useLowVol) mMax = 0.4;
        if (this.musicVol < mMax + 0.05) this.musicVol += 0.05;
        if (this.musicVol > mMax - 0.025) this.musicVol -= 0.025;
      } else if (this.musicVol > 0) {
        this.musicVol -= 0.025;
      }
    }
    if (this.musicGain) this.musicGain.gain.value = this.musicVol;
  }

  currentSongName(): string {
    const i = this.songList.indexOf(this.musicKey ?? "");
    return i >= 0 ? this.songNames[i] : "";
  }

  cycleSong(dir: number): void {
    const list = this.songList;
    let i = list.indexOf(this.musicKey ?? "");
    if (i < 0) i = 0;
    i = (i + dir + list.length) % list.length;
    this.playMusic(list[i], true);
  }
}

export const SH = new SoundHandler();
