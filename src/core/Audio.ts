// Web Audio 播放:SFX 统一过 GainNode 限音量,BGM 循环,M 全局静音
import { Assets } from "./Assets";

class AudioMgr {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private bgmSource: AudioBufferSourceNode | null = null;
  private bgmGain: GainNode | null = null;
  private muted = false;

  /** 必须在用户手势后调用 */
  ensure(): void {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 1;
    this.master.connect(this.ctx.destination);
    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = 0.55; // 原版 MP3 音量偏大,统一压低
    this.sfxGain.connect(this.master);
    this.bgmGain = this.ctx.createGain();
    this.bgmGain.gain.value = 0.35;
    this.bgmGain.connect(this.master);
  }

  play(name: string, opts: { vol?: number; rate?: number; maxDur?: number } = {}): void {
    if (!this.ctx || !this.sfxGain || this.muted) return;
    const buf = Assets.sound(name);
    if (!buf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = opts.vol ?? 1;
    src.playbackRate.value = opts.rate ?? 1;
    src.connect(g);
    g.connect(this.sfxGain);
    src.start();
    if (opts.maxDur) src.stop(this.ctx.currentTime + opts.maxDur);
  }

  startBgm(): void {
    this.ensure();
    if (!this.ctx || !this.bgmGain || this.bgmSource) return;
    const buf = Assets.sound("bgm");
    if (!buf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(this.bgmGain);
    src.start();
    this.bgmSource = src;
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 1;
    return this.muted;
  }

  get isMuted(): boolean {
    return this.muted;
  }
}

export const Audio = new AudioMgr();
