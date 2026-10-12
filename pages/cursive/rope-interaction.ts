import { FloorRope } from './rope';
import { visibleRopePens } from './rope-playback';
import type { PenPlayback } from './pen-playback';

/** Pointer capture and screen-to-artwork coordinates around the rope solver. */
export class RopeInteraction {
  private rope = new FloorRope([]);
  private pointer: number | undefined;
  private floor = Infinity;
  private events = new AbortController();

  constructor(private readonly artwork: SVGSVGElement, private readonly enabled: () => boolean,
    private readonly weight: () => number, private readonly wake: () => void) {
    const options = { signal: this.events.signal };
    artwork.addEventListener('pointerdown', event => {
      if (!this.enabled() || this.pointer !== undefined || event.button !== 0) return;
      const point = this.point(event);
      if (!point || !this.rope.pick(point.x, point.y, 85 * this.weight())) return;
      event.preventDefault(); this.pointer = event.pointerId;
      artwork.setPointerCapture(event.pointerId); artwork.classList.add('dragging');
      this.wake();
    }, options);
    artwork.addEventListener('pointermove', event => {
      if (event.pointerId !== this.pointer) return;
      const point = this.point(event);
      if (point) this.rope.move(point.x, point.y);
      this.wake();
    }, options);
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) artwork.addEventListener(name, event => {
      if (event.pointerId === this.pointer) { this.cancelGrab(); this.wake(); }
    }, options);
  }

  get awake() { return this.rope.awake; }
  get pens() { return this.rope.pens.map((_, index) => this.rope.deformed(index)); }
  step(seconds: number) { this.rope.step(seconds); }

  setFloor(y: number) {
    this.floor = y;
    this.rope.setFloor(y, this.weight());
  }

  reset(playback: PenPlayback, time: number) {
    this.cancelGrab();
    this.rope = new FloorRope(visibleRopePens(playback, time));
    this.rope.setFloor(this.floor, this.weight());
  }

  cancelGrab() {
    const pointer = this.pointer;
    this.pointer = undefined; this.rope.release();
    if (pointer !== undefined && this.artwork.hasPointerCapture(pointer)) this.artwork.releasePointerCapture(pointer);
    this.artwork.classList.remove('dragging');
  }

  destroy() { this.cancelGrab(); this.events.abort(); }

  private point(event: PointerEvent) {
    const matrix = this.artwork.getScreenCTM();
    return matrix ? new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse()) : undefined;
  }
}
