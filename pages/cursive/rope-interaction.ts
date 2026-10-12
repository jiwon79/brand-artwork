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
      const matrix = artwork.getScreenCTM();
      if (!matrix) return;
      const point = this.point(event);
      const scale = Math.min(Math.hypot(matrix.a, matrix.b), Math.hypot(matrix.c, matrix.d));
      // Keep small lettering grabbable: the screen-space target must not shrink
      // with the font-coordinate viewBox, and fingers need more room than mice.
      const reach = Math.max(85 * this.weight(), (event.pointerType === 'touch' ? 28 : 22) / scale);
      if (!point || !Number.isFinite(reach) || !this.rope.pick(point.x, point.y, reach)) return;
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
    artwork.addEventListener('pointerup', event => {
      if (event.pointerId !== this.pointer) return;
      const point = this.point(event);
      if (point) this.rope.move(point.x, point.y);
      this.clearPointer(); this.rope.release(); this.wake();
    }, options);
    for (const name of ['pointercancel', 'lostpointercapture'] as const) artwork.addEventListener(name, event => {
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
    this.clearPointer(); this.rope.cancelGrab();
  }

  private clearPointer() {
    const pointer = this.pointer;
    this.pointer = undefined;
    if (pointer !== undefined && this.artwork.hasPointerCapture(pointer)) this.artwork.releasePointerCapture(pointer);
    this.artwork.classList.remove('dragging');
  }

  destroy() { this.cancelGrab(); this.events.abort(); }

  private point(event: PointerEvent) {
    const matrix = this.artwork.getScreenCTM();
    return matrix ? new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse()) : undefined;
  }
}
