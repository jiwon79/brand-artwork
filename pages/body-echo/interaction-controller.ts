import { DESIGN_HEIGHT, DESIGN_WIDTH, settings } from './config';
import { DragDissolve } from './drag-dissolve';
import { clamp } from './math';
import { BodyEchoRuntime } from './runtime';
import type { DebugApi, DesignPoint } from './types';

type GuiToggle = { toggle: () => void };

/** Converts browser input into explicit simulation state transitions. */
export class InteractionController {
  private activePointerId: number | null = null;
  private keyboardGathering = false;

  constructor(
    private readonly runtime: BodyEchoRuntime,
    private readonly drag: DragDissolve,
    private readonly canvas: HTMLCanvasElement,
    private readonly tuningGui: GuiToggle,
  ) {}

  bind(onError: (message: string) => void, onResize: () => void): void {
    this.canvas.addEventListener('pointerdown', this.handlePointerDown);
    window.addEventListener('pointermove', this.handlePointerMove);
    window.addEventListener('pointerup', this.finishPointerInteraction);
    window.addEventListener('pointercancel', this.finishPointerInteraction);
    this.canvas.addEventListener('lostpointercapture', this.handleLostPointerCapture);
    this.canvas.addEventListener('contextmenu', this.preventCanvasGesture);
    this.canvas.addEventListener('dragstart', this.preventCanvasGesture);
    this.canvas.addEventListener('selectstart', this.preventCanvasGesture);
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('resize', onResize);
    window.addEventListener('error', (event) => {
      onError(event.message || 'Body Echo could not start.');
    });
  }

  updateLifecycle(now: number): void {
    if (
      this.runtime.phase === 'dragging'
      && this.runtime.isDragDissolve()
      && this.drag.pointers.size === 0
      && this.drag.endedAt > 0
      && now - this.drag.endedAt > settings.dragRestoreDelay + settings.dragParticleLife * 1.2
    ) this.reset();

    if (this.runtime.phase !== 'dissolving') return;
    const phaseStartedAt = this.runtime.isNameDropWave()
      ? this.runtime.releasedAt
      : this.runtime.triggeredAt;
    if (now - phaseStartedAt <= this.runtime.releaseAnimationDuration()) return;
    if (this.runtime.isNameDropWave()) this.reset();
    else this.runtime.phase = 'blank';
  }

  reset = (): void => {
    this.runtime.phase = 'idle';
    this.runtime.triggeredAt = 0;
    this.runtime.releasedAt = 0;
    this.runtime.releasedGatherElapsed = 0;
    this.runtime.releasedHoldAge = 0;
    this.activePointerId = null;
    this.drag.clear();
  };

  replay = (point?: DesignPoint): void => {
    if (this.runtime.isNameDropWave()) {
      this.beginGather(point);
      this.releaseGather();
    } else if (this.runtime.isDragDissolve()) this.reset();
    else this.dissolve();
  };

  previewPull = (point: DesignPoint): void => {
    this.reset();
    this.beginGather(point);
    this.runtime.triggeredAt = this.now() - this.runtime.contactReleaseTime();
  };

  previewRelease = (point: DesignPoint): void => {
    this.previewPull(point);
    this.releaseGather();
  };

  debugApi(): DebugApi {
    return {
      dissolve: this.replay,
      burst: (clientX = window.innerWidth * 0.5, clientY = window.innerHeight * 0.5) => {
        this.replay(this.designPointFromClient(clientX, clientY, false));
      },
      reset: this.reset,
      getPhase: () => this.runtime.phase,
    };
  }

  private dissolve(): void {
    if (this.runtime.phase === 'gathering' || this.runtime.phase === 'dissolving') return;
    if (this.runtime.phase === 'blank') this.reset();
    this.runtime.phase = 'dissolving';
    this.runtime.triggeredAt = this.now();
    this.runtime.releasedAt = 0;
    this.canvas.focus({ preventScroll: true });
  }

  private beginGather(point?: DesignPoint): void {
    if (this.runtime.phase === 'gathering' || this.runtime.phase === 'dissolving') return;
    if (this.runtime.phase === 'blank') this.reset();
    this.runtime.contactOrigin = point ?? {
      x: DESIGN_WIDTH * 0.5,
      y: DESIGN_HEIGHT * 0.5,
    };
    this.runtime.ropeFields = [];
    this.runtime.phase = 'gathering';
    this.runtime.triggeredAt = this.now();
    this.runtime.releasedAt = 0;
    this.runtime.releasedGatherElapsed = 0;
    this.runtime.releasedHoldAge = 0;
    this.canvas.focus({ preventScroll: true });
  }

  private releaseGather(): void {
    if (this.runtime.phase !== 'gathering') return;
    const now = this.now();
    this.runtime.releasedGatherElapsed = Math.min(
      Math.max(0, now - this.runtime.triggeredAt),
      this.runtime.contactReleaseTime(),
    );
    this.runtime.releasedHoldAge = Math.max(
      0,
      now - this.runtime.triggeredAt - this.runtime.contactReleaseTime(),
    );
    this.runtime.phase = 'dissolving';
    this.runtime.releasedAt = now;
  }

  private designPointFromClient(
    clientX: number,
    clientY: number,
    constrainToArtwork = true,
  ): DesignPoint {
    const rect = this.canvas.getBoundingClientRect();
    const internalX = (clientX - rect.left)
      * (this.canvas.width / Math.max(1, rect.width));
    const internalY = (clientY - rect.top)
      * (this.canvas.height / Math.max(1, rect.height));
    const x = (internalX - this.runtime.view.offsetX) / this.runtime.view.fit;
    const y = (internalY - this.runtime.view.offsetY) / this.runtime.view.fit;
    return constrainToArtwork
      ? { x: clamp(x, 0, DESIGN_WIDTH), y: clamp(y, 0, DESIGN_HEIGHT) }
      : { x, y };
  }

  private handlePointerDown = (event: PointerEvent): void => {
    event.preventDefault();
    if (this.runtime.isDragDissolve()) {
      if (this.runtime.phase === 'blank') this.reset();
      const point = this.designPointFromClient(event.clientX, event.clientY);
      if (!this.drag.begin(event.pointerId, point)) return;
      this.canvas.setPointerCapture(event.pointerId);
      return;
    }
    if (this.runtime.isNameDropWave()) {
      if (
        this.activePointerId !== null
        || this.runtime.phase === 'gathering'
        || this.runtime.phase === 'dissolving'
      ) return;
      this.beginGather(this.designPointFromClient(event.clientX, event.clientY, false));
      this.activePointerId = event.pointerId;
      this.canvas.setPointerCapture(event.pointerId);
      return;
    }
    this.replay();
  };

  private handlePointerMove = (event: PointerEvent): void => {
    if (
      this.runtime.isDragDissolve()
      && this.runtime.phase === 'dragging'
      && this.drag.pointers.has(event.pointerId)
    ) {
      event.preventDefault();
      this.drag.move(
        event.pointerId,
        this.designPointFromClient(event.clientX, event.clientY),
      );
      return;
    }
    if (
      !this.runtime.isNameDropWave()
      || this.runtime.phase !== 'gathering'
      || event.pointerId !== this.activePointerId
    ) return;
    event.preventDefault();
    this.runtime.contactOrigin = this.designPointFromClient(event.clientX, event.clientY, false);
  };

  private finishPointerInteraction = (event: PointerEvent): void => {
    event.preventDefault();
    if (this.runtime.isDragDissolve()) {
      if (!this.drag.pointers.has(event.pointerId)) return;
      this.drag.end(
        event.pointerId,
        event.type === 'pointerup'
          ? this.designPointFromClient(event.clientX, event.clientY)
          : undefined,
      );
      return;
    }
    if (event.pointerId !== this.activePointerId) return;
    if (this.runtime.isNameDropWave() && event.type === 'pointerup') {
      this.runtime.contactOrigin = this.designPointFromClient(
        event.clientX,
        event.clientY,
        false,
      );
    }
    this.activePointerId = null;
    this.releaseGather();
  };

  private handleLostPointerCapture = (event: PointerEvent): void => {
    if (this.runtime.isDragDissolve() && this.drag.pointers.has(event.pointerId)) {
      this.drag.end(event.pointerId);
    }
  };

  private handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      if (event.repeat) return;
      if (this.runtime.isNameDropWave()) {
        this.keyboardGathering = true;
        this.beginGather();
      } else if (!this.runtime.isDragDissolve()) this.replay();
    } else if (event.key.toLowerCase() === 'r') this.reset();
    else if (event.key.toLowerCase() === 'g') this.tuningGui.toggle();
  };

  private handleKeyUp = (event: KeyboardEvent): void => {
    if (event.key !== ' ' && event.key !== 'Enter') return;
    event.preventDefault();
    if (!this.keyboardGathering) return;
    this.keyboardGathering = false;
    this.releaseGather();
  };

  private preventCanvasGesture = (event: Event): void => {
    event.preventDefault();
  };

  private now(): number {
    return this.runtime.lastNow || performance.now() * 0.001;
  }
}
