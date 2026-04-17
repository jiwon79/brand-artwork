export class AudioPlayer {
  private ctx: AudioContext;
  private buffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;
  private gain: GainNode;
  private _playing = false;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    this.gain = ctx.createGain();
    this.gain.connect(ctx.destination);
  }

  async load(url: string) {
    const res = await fetch(url);
    const buf = await res.arrayBuffer();
    this.buffer = await this.ctx.decodeAudioData(buf);
  }

  play(offset: number, rate: number) {
    this.stop();
    if (!this.buffer) return;

    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.loop = true;
    src.playbackRate.value = rate;
    src.connect(this.gain);
    src.start(0, offset % this.buffer.duration);

    this.source = src;
    this._playing = true;
  }

  stop() {
    if (this.source) {
      try { this.source.stop(); } catch {}
      this.source.disconnect();
      this.source = null;
    }
    this._playing = false;
  }

  setRate(rate: number) {
    if (this.source) {
      this.source.playbackRate.value = rate;
    }
  }

  setVolume(vol: number) {
    this.gain.gain.value = vol;
  }

  get playing() { return this._playing; }
}
