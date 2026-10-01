/** Time is kept in seconds, including while a gesture scrubs across the loop seam. */
export class Timeline {
  time = 0;
  playing = true;
  speed = 1;

  constructor(readonly frameCount: number, readonly fps: number) {
    if (!Number.isInteger(frameCount) || frameCount < 1 || !Number.isFinite(fps) || fps <= 0) {
      throw new Error('Invalid animation timing');
    }
  }

  get duration(): number { return this.frameCount / this.fps; }
  get frame(): number {
    return Math.min(this.frameCount - 1, Math.floor(this.time * this.fps + 1e-7));
  }

  seek(seconds: number): void {
    if (!Number.isFinite(seconds)) return;
    this.time = ((seconds % this.duration) + this.duration) % this.duration;
  }

  advance(seconds: number): void {
    if (this.playing && Number.isFinite(seconds) && seconds > 0) {
      this.seek(this.time + seconds * this.speed);
    }
  }
}
