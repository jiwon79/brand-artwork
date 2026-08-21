import {
  SVG_TO_DESIGN,
  channelColors,
  channelX,
  channelY,
  settings,
} from './config';
import { clamp, hash } from './math';
import { BodyEchoRuntime } from './runtime';
import type { DesignPoint, DragParticleState, FigurePoint } from './types';

/** Owns drag gesture traces, hit testing, and the drag-only render pass. */
export class DragDissolve {
  pointStates: Array<Array<DragParticleState | null>> = [];
  hitCounts: number[] = [];
  pointers = new Map<number, DesignPoint>();
  endedAt = 0;

  constructor(
    private readonly runtime: BodyEchoRuntime,
    private readonly canvas: HTMLCanvasElement,
    private readonly ctx: CanvasRenderingContext2D,
  ) {}

  clear(): void {
    this.pointStates = this.runtime.echoLineGeometry.map((geometry) => (
      Array.from<DragParticleState | null>({ length: geometry.points.length }).fill(null)
    ));
    this.hitCounts = this.runtime.echoLineGeometry.map(() => 0);
    this.pointers.clear();
    this.endedAt = 0;
  }

  ensureState(): void {
    const geometries = this.runtime.echoLineGeometry;
    const matches = this.pointStates.length === geometries.length
      && this.pointStates.every((states, index) => states.length === geometries[index].points.length);
    if (!matches) this.clear();
  }

  begin(pointerId: number, point: DesignPoint): boolean {
    const runtime = this.runtime;
    if (runtime.phase === 'gathering' || runtime.phase === 'dissolving') return false;
    if (this.pointers.size >= 2) return false;
    if (runtime.phase !== 'dragging') {
      this.clear();
      runtime.phase = 'dragging';
    }

    const now = runtime.lastNow || performance.now() * 0.001;
    this.endedAt = 0;
    const joiningConnector = this.pointers.size === 1;
    this.pointers.set(pointerId, point);
    if (!joiningConnector) this.applyStroke(point, point, now);
    const connector = this.connectorPoints();
    if (connector) this.applyStroke(connector[0], connector[1], now, settings.dragConnectorRadius);
    this.canvas.focus({ preventScroll: true });
    return true;
  }

  move(pointerId: number, point: DesignPoint): void {
    if (this.runtime.phase !== 'dragging') return;
    const previousPoint = this.pointers.get(pointerId);
    if (!previousPoint) return;
    const now = this.runtime.lastNow || performance.now() * 0.001;
    const entries = [...this.pointers.entries()];
    const movedIndex = entries.findIndex(([id]) => id === pointerId);
    const otherPoint = entries[movedIndex === 0 ? 1 : 0]?.[1];

    if (otherPoint) {
      const travel = Math.hypot(point.x - previousPoint.x, point.y - previousPoint.y);
      const steps = Math.max(
        1,
        Math.ceil(travel / Math.max(1.5, settings.dragConnectorRadius * 0.5)),
      );
      for (let step = 1; step <= steps; step += 1) {
        const progress = step / steps;
        const interpolated = {
          x: previousPoint.x + (point.x - previousPoint.x) * progress,
          y: previousPoint.y + (point.y - previousPoint.y) * progress,
        };
        this.applyStroke(
          movedIndex === 0 ? interpolated : otherPoint,
          movedIndex === 0 ? otherPoint : interpolated,
          now,
          settings.dragConnectorRadius,
        );
      }
    } else this.applyStroke(previousPoint, point, now);

    this.pointers.set(pointerId, point);
  }

  end(pointerId: number, point?: DesignPoint): void {
    if (this.runtime.phase !== 'dragging' || !this.pointers.has(pointerId)) return;
    if (point) this.move(pointerId, point);
    this.pointers.delete(pointerId);
    if (this.pointers.size === 0) {
      this.endedAt = this.runtime.lastNow || performance.now() * 0.001;
    }
  }

  connectorPoints(): [DesignPoint, DesignPoint] | null {
    if (this.pointers.size < 2) return null;
    const iterator = this.pointers.values();
    const first = iterator.next().value as DesignPoint | undefined;
    const second = iterator.next().value as DesignPoint | undefined;
    return first && second ? [first, second] : null;
  }

  renderConnector(): void {
    const { runtime, ctx } = this;
    if (runtime.phase !== 'dragging' || !runtime.isDragDissolve()) return;
    const connector = this.connectorPoints();
    if (!connector) return;
    const [start, end] = connector;
    const { view } = runtime;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(0.35, settings.dragConnectorWidth * view.fit);
    ctx.globalAlpha = 0.68;
    for (let channelIndex = 0; channelIndex < channelColors.length; channelIndex += 1) {
      const offsetX = channelX[channelIndex] * settings.rgbOffset * view.fit;
      const offsetY = channelY[channelIndex] * settings.rgbOffset * view.fit;
      ctx.beginPath();
      ctx.moveTo(view.offsetX + start.x * view.fit + offsetX, view.offsetY + start.y * view.fit + offsetY);
      ctx.lineTo(view.offsetX + end.x * view.fit + offsetX, view.offsetY + end.y * view.fit + offsetY);
      ctx.strokeStyle = channelColors[channelIndex];
      ctx.stroke();
    }
    ctx.restore();
  }

  drawRemainingPath(echoIndex: number, channelIndex: number, now: number): void {
    const { runtime, ctx } = this;
    const geometry = runtime.echoLineGeometry[echoIndex];
    const states = this.pointStates[echoIndex];
    if (!geometry || !states) return;

    ctx.beginPath();
    let drawing = false;
    for (let pointIndex = 0; pointIndex < geometry.points.length; pointIndex += 1) {
      const point = geometry.points[pointIndex];
      if (point.startsPath || states[pointIndex]) drawing = false;
      if (states[pointIndex]) continue;
      const position = runtime.linePointPosition(point, echoIndex, now);
      const offset = settings.rgbOffset * runtime.view.fit;
      const x = position.x + channelX[channelIndex] * offset;
      const y = position.y + channelY[channelIndex] * offset;
      if (drawing) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
      drawing = true;
    }
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = geometry.strokeWidth * SVG_TO_DESIGN
      * settings.lineThickness * runtime.view.fit;
    ctx.stroke();
  }

  drawParticle(
    point: FigurePoint,
    state: DragParticleState,
    channelIndex: number,
    now: number,
    baseSize: number,
  ): void {
    const { runtime, ctx } = this;
    const age = Math.max(0, now - state.spawnedAt);
    const life = settings.dragParticleLife * (0.72 + point.seed * 0.48);
    const alpha = Math.pow(clamp(1 - age / life, 0, 1), 1.45) * (0.5 + point.seed * 0.5);
    if (alpha <= 0.01) return;

    const channelSeed = hash(point.x, point.y, channelIndex + 19);
    const curl = Math.sin(age * (5.2 + point.seed * 4.4) + point.seed2 * 17)
      * settings.turbulence * age;
    const velocityLength = Math.max(0.001, Math.hypot(state.velocityX, state.velocityY));
    const normalX = -state.velocityY / velocityLength;
    const normalY = state.velocityX / velocityLength;
    const travelX = state.originX + state.velocityX * age + normalX * curl;
    const travelY = state.originY + state.velocityY * age + normalY * curl;
    const offset = settings.rgbOffset * runtime.view.fit;
    const x = runtime.view.offsetX + travelX * runtime.view.fit + channelX[channelIndex] * offset;
    const y = runtime.view.offsetY + travelY * runtime.view.fit + channelY[channelIndex] * offset;
    const size = baseSize * (0.68 + channelSeed * 0.72)
      * settings.particleSize * settings.dragParticleSize;
    if (x < -8 || x > runtime.view.width + 8 || y < -8 || y > runtime.view.height + 8) return;

    ctx.globalAlpha = alpha;
    ctx.fillRect(x, y, Math.max(0.3, size), Math.max(0.3, size * (0.75 + point.seed2 * 0.45)));
  }

  private applyStroke(
    start: DesignPoint,
    end: DesignPoint,
    now: number,
    radius = settings.dragRadius,
  ): void {
    this.ensureState();
    const segmentX = end.x - start.x;
    const segmentY = end.y - start.y;
    const segmentLength = Math.hypot(segmentX, segmentY);
    const directionX = segmentLength > 0.001 ? segmentX / segmentLength : 1;
    const directionY = segmentLength > 0.001 ? segmentY / segmentLength : 0;
    const normalX = -directionY;
    const normalY = directionX;
    const radiusSquared = radius * radius;
    const echoCount = clamp(
      Math.round(settings.echoes),
      1,
      this.runtime.echoLineGeometry.length,
    );

    for (let echoIndex = 0; echoIndex < echoCount; echoIndex += 1) {
      const geometry = this.runtime.echoLineGeometry[echoIndex];
      const states = this.pointStates[echoIndex];
      for (let pointIndex = 0; pointIndex < geometry.points.length; pointIndex += 1) {
        if (states[pointIndex]) continue;
        const point = geometry.points[pointIndex];
        const position = this.runtime.linePointPosition(point, echoIndex, now);
        if (this.distanceSquaredToSegment(position.designX, position.designY, start, end) > radiusSquared) continue;
        const forwardSpeed = settings.dragForce * (0.62 + point.seed * 0.76);
        const sideSpeed = (point.seed2 - 0.5) * settings.dragSpread;
        states[pointIndex] = {
          spawnedAt: now,
          originX: position.designX,
          originY: position.designY,
          velocityX: directionX * forwardSpeed + normalX * sideSpeed,
          velocityY: directionY * forwardSpeed + normalY * sideSpeed,
        };
        this.hitCounts[echoIndex] += 1;
      }
    }
  }

  private distanceSquaredToSegment(
    pointX: number,
    pointY: number,
    start: DesignPoint,
    end: DesignPoint,
  ): number {
    const segmentX = end.x - start.x;
    const segmentY = end.y - start.y;
    const lengthSquared = segmentX * segmentX + segmentY * segmentY;
    if (lengthSquared <= 0.0001) {
      const deltaX = pointX - start.x;
      const deltaY = pointY - start.y;
      return deltaX * deltaX + deltaY * deltaY;
    }
    const projection = clamp(
      ((pointX - start.x) * segmentX + (pointY - start.y) * segmentY) / lengthSquared,
      0,
      1,
    );
    const deltaX = pointX - (start.x + segmentX * projection);
    const deltaY = pointY - (start.y + segmentY * projection);
    return deltaX * deltaX + deltaY * deltaY;
  }
}
