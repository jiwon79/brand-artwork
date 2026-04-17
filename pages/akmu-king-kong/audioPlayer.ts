export class AudioPlayer {
  private el: HTMLAudioElement;
  private lastRateUpdate = 0;
  private _playing = false;

  constructor(src: string) {
    this.el = new Audio();
    this.el.src = src;
    this.el.loop = true;
    this.el.preload = 'auto';
    (this.el as any).preservesPitch = false;
  }

  play(offset: number, rate: number) {
    this.el.currentTime = offset;
    this.el.playbackRate = rate;
    this.el.play().catch(() => {});
    this._playing = true;
    this.lastRateUpdate = performance.now();
  }

  stop() {
    if (this._playing) {
      this.el.pause();
      this._playing = false;
    }
  }

  setRate(rate: number) {
    const now = performance.now();
    if (now - this.lastRateUpdate < 200) return;
    this.lastRateUpdate = now;
    this.el.playbackRate = rate;
  }

  setVolume(vol: number) {
    this.el.volume = vol;
  }

  sync(videoTime: number) {
    const drift = Math.abs(this.el.currentTime - videoTime);
    if (drift > 0.3) {
      this.el.currentTime = videoTime;
    }
  }

  get playing() { return this._playing; }
  get loaded() { return true; }
}
