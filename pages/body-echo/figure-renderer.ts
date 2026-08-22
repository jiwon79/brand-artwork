import {
  ACTIVE_FIGURE,
  SVG_TO_DESIGN,
  channelColors,
  channelX,
  channelY,
  chromaticOffsetForEcho,
  echoCenters,
  lineEchoYCenters,
  settings,
} from './config';
import { DragDissolve } from './drag-dissolve';
import { clamp, smoothstep } from './math';
import { ParticleRenderer } from './particles';
import { renderStageState } from './render-stages';
import { BodyEchoRuntime } from './runtime';
import type { FigurePoint, PositionedPoint } from './types';
import { waveRadiusForProgress } from './wave-timing';

/** Renders stable SVG/raster figures and replaces released samples with particles. */
export class FigureRenderer {
  private readonly particles: ParticleRenderer;

  constructor(
    private readonly runtime: BodyEchoRuntime,
    private readonly drag: DragDissolve,
    private readonly ctx: CanvasRenderingContext2D,
  ) {
    this.particles = new ParticleRenderer(runtime, ctx);
  }

  render(now: number): void {
    const elapsed = this.runtime.motionElapsed(now);
    this.ctx.globalCompositeOperation = 'lighter';
    if (ACTIVE_FIGURE === 'Lines' || this.runtime.isDragDissolve()) {
      this.renderLines(now, elapsed);
    } else this.renderSolids(now, elapsed);
    this.ctx.globalAlpha = 1;
    this.ctx.globalCompositeOperation = 'source-over';
  }

  private drawExactLinePath(echoIndex: number, channelIndex: number, now: number): void {
    const { runtime, ctx } = this;
    const geometry = runtime.echoLineGeometry[echoIndex];
    if (!geometry) return;
    const designX = echoCenters[echoIndex] + runtime.lineSway(echoIndex, now)
      + channelX[channelIndex] * chromaticOffsetForEcho(echoIndex);
    const designY = lineEchoYCenters[echoIndex]
      + channelY[channelIndex] * chromaticOffsetForEcho(echoIndex);
    ctx.save();
    ctx.translate(runtime.view.offsetX + designX * runtime.view.fit, runtime.view.offsetY + designY * runtime.view.fit);
    ctx.scale(SVG_TO_DESIGN * runtime.view.fit, SVG_TO_DESIGN * runtime.view.fit);
    ctx.translate(
      -(geometry.viewBoxX + geometry.width * 0.5),
      -(geometry.viewBoxY + geometry.height * 0.5),
    );
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = geometry.strokeWidth * settings.lineThickness;
    ctx.stroke(geometry.path);
    ctx.restore();
  }

  private drawDissolvingLinePath(
    echoIndex: number,
    channelIndex: number,
    now: number,
    elapsed: number,
  ): void {
    const { runtime, ctx } = this;
    const geometry = runtime.echoLineGeometry[echoIndex];
    if (!geometry) return;
    const gatherElapsed = runtime.isNameDropWave()
      ? runtime.visualGatherElapsed(now)
      : elapsed;

    if (runtime.isNameDropWave() && !runtime.isPreviousContactRelease()) {
      const bucketCount = 6;
      const opacityBuckets = Array.from({ length: bucketCount }, () => new Path2D());
      const fadeDuration = Math.max(0.01, settings.contactLineFadeDuration);
      const channelOffset = chromaticOffsetForEcho(echoIndex) * runtime.view.fit;
      let previousPosition: PositionedPoint | null = null;
      let previousOpacity = 0;

      for (let pointIndex = 0; pointIndex < geometry.points.length; pointIndex += 1) {
        const point = geometry.points[pointIndex];
        if (point.startsPath) previousPosition = null;
        const basePosition = runtime.linePointPosition(point, echoIndex, now);
        const spawnPosition = runtime.lineSpawnReferencePosition(
          point, pointIndex, echoIndex, now, basePosition,
        );
        const spawnTime = runtime.spawnTimeFor(
          spawnPosition.designX, spawnPosition.designY, point, echoIndex,
        );
        const opacity = 1 - smoothstep((elapsed - spawnTime) / fadeDuration);
        const position = runtime.gatheredLinePosition(
          point, pointIndex, echoIndex, now, gatherElapsed, basePosition,
        );
        const channelPosition = {
          ...position,
          x: position.x + channelX[channelIndex] * channelOffset,
          y: position.y + channelY[channelIndex] * channelOffset,
        };
        if (previousPosition) {
          const segmentOpacity = (previousOpacity + opacity) * 0.5;
          if (segmentOpacity > 0.01) {
            const bucket = opacityBuckets[Math.min(
              bucketCount - 1,
              Math.floor(segmentOpacity * bucketCount),
            )];
            bucket.moveTo(previousPosition.x, previousPosition.y);
            bucket.lineTo(channelPosition.x, channelPosition.y);
          }
        }
        previousPosition = channelPosition;
        previousOpacity = opacity;
      }

      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = geometry.strokeWidth * SVG_TO_DESIGN
        * settings.lineThickness * runtime.view.fit;
      for (let bucketIndex = 0; bucketIndex < bucketCount; bucketIndex += 1) {
        ctx.globalAlpha = 0.84 * ((bucketIndex + 1) / bucketCount);
        ctx.stroke(opacityBuckets[bucketIndex]);
      }
      ctx.restore();
      return;
    }

    ctx.beginPath();
    let drawing = false;
    for (let pointIndex = 0; pointIndex < geometry.points.length; pointIndex += 1) {
      const point = geometry.points[pointIndex];
      if (point.startsPath) drawing = false;
      const basePosition = runtime.linePointPosition(point, echoIndex, now);
      const spawnPosition = runtime.lineSpawnReferencePosition(
        point, pointIndex, echoIndex, now, basePosition,
      );
      if (elapsed >= runtime.spawnTimeFor(
        spawnPosition.designX, spawnPosition.designY, point, echoIndex,
      )) {
        drawing = false;
        continue;
      }
      const position = runtime.gatheredLinePosition(
        point, pointIndex, echoIndex, now, gatherElapsed, basePosition,
      );
      const offset = chromaticOffsetForEcho(echoIndex) * runtime.view.fit;
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

  private renderLines(now: number, elapsed: number): void {
    const { runtime, drag, ctx } = this;
    const echoCount = clamp(Math.round(settings.echoes), 1, runtime.echoLineGeometry.length);
    const channelIndices = renderStageState.current >= 1 ? [0, 1, 2] : [1];
    for (const channelIndex of channelIndices) {
      const channelColor = renderStageState.current >= 1 ? channelColors[channelIndex] : '#ffffff';
      ctx.strokeStyle = channelColor;
      ctx.fillStyle = channelColor;
      ctx.globalAlpha = 0.84;
      for (let echoIndex = 0; echoIndex < echoCount; echoIndex += 1) {
        ctx.globalAlpha = 0.84;
        if (renderStageState.current < 4) {
          if (renderStageState.current < 2 || runtime.phase === 'idle') {
            this.drawExactLinePath(echoIndex, channelIndex, now);
          } else {
            this.drawStableGatheredLinePath(echoIndex, channelIndex, now);
            if (renderStageState.current === 3) {
              this.drawWaveIntersections(echoIndex, channelIndex, now);
            }
          }
          continue;
        }
        if (runtime.isDragDissolve() && runtime.phase === 'dragging') {
          drag.ensureState();
          if (drag.hitCounts[echoIndex] > 0) drag.drawRemainingPath(echoIndex, channelIndex, now);
          else this.drawExactLinePath(echoIndex, channelIndex, now);
          const geometry = runtime.echoLineGeometry[echoIndex];
          const states = drag.pointStates[echoIndex];
          const baseSize = geometry.strokeWidth * SVG_TO_DESIGN * 0.68 * runtime.view.fit;
          for (let pointIndex = 0; pointIndex < geometry.points.length; pointIndex += 1) {
            const state = states[pointIndex];
            if (state) drag.drawParticle(
              geometry.points[pointIndex], state, echoIndex, channelIndex, now, baseSize,
            );
          }
          continue;
        }

        if (runtime.phase === 'idle') {
          this.drawExactLinePath(echoIndex, channelIndex, now);
          continue;
        }

        this.drawDissolvingLinePath(echoIndex, channelIndex, now, elapsed);
        const geometry = runtime.echoLineGeometry[echoIndex];
        const baseSize = geometry.strokeWidth * SVG_TO_DESIGN * 0.68 * runtime.view.fit;
        const particlePoints = runtime.isNameDropWave() ? geometry.points : geometry.samples;
        const sampleInterval = runtime.isNameDropWave()
          ? 3 / clamp(settings.contactParticleDensity, 0.5, 3)
          : 1;
        let nextSampleIndex = 0;
        for (let pointIndex = 0; pointIndex < particlePoints.length; pointIndex += 1) {
          if (pointIndex + 0.0001 < nextSampleIndex) continue;
          nextSampleIndex += sampleInterval;
          const point = particlePoints[pointIndex];
          const currentPosition = runtime.linePointPosition(point, echoIndex, now);
          const spawnPosition = runtime.lineSpawnReferencePosition(
            point, pointIndex, echoIndex, now, currentPosition,
          );
          const spawnTime = runtime.spawnTimeFor(
            spawnPosition.designX, spawnPosition.designY, point, echoIndex,
          );
          if (elapsed >= spawnTime) this.particles.draw(
            point,
            pointIndex,
            echoIndex,
            channelIndex,
            spawnTime,
            elapsed - spawnTime,
            baseSize,
            true,
          );
        }
      }
    }
  }

  private drawStableGatheredLinePath(
    echoIndex: number,
    channelIndex: number,
    now: number,
  ): void {
    const { runtime, ctx } = this;
    const geometry = runtime.echoLineGeometry[echoIndex];
    if (!geometry) return;
    const gatherElapsed = runtime.visualGatherElapsed(now);
    const channelOffset = settings.rgbOffset * runtime.view.fit;
    ctx.beginPath();
    let drawing = false;
    for (let pointIndex = 0; pointIndex < geometry.points.length; pointIndex += 1) {
      const point = geometry.points[pointIndex];
      if (point.startsPath) drawing = false;
      const position = runtime.gatheredLinePosition(
        point,
        pointIndex,
        echoIndex,
        now,
        gatherElapsed,
      );
      const x = position.x + channelX[channelIndex] * channelOffset;
      const y = position.y + channelY[channelIndex] * channelOffset;
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

  private drawWaveIntersections(
    echoIndex: number,
    channelIndex: number,
    now: number,
  ): void {
    const { runtime, ctx } = this;
    if (runtime.phase !== 'dissolving' || !runtime.isNameDropWave()) return;
    const geometry = runtime.echoLineGeometry[echoIndex];
    if (!geometry) return;

    const releaseAge = Math.max(0, now - runtime.releasedAt);
    const duration = Math.max(0.001, settings.contactWaveDuration);
    const progress = clamp(releaseAge / duration, 0, 1);
    const radius = waveRadiusForProgress(progress, runtime.contactWaveExtent()) * runtime.view.fit;
    const band = Math.max(3.5, settings.contactWaveBandWidth * 0.16 * runtime.view.fit);
    const centerX = runtime.view.offsetX + runtime.contactOrigin.x * runtime.view.fit;
    const centerY = runtime.view.offsetY + runtime.contactOrigin.y * runtime.view.fit;
    const gatherElapsed = runtime.visualGatherElapsed(now);
    const channelOffset = settings.rgbOffset * runtime.view.fit;
    const fade = 1 - smoothstep((releaseAge - duration * 0.72) / (duration * 0.28));

    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#ffe600';
    ctx.shadowColor = '#ff8a00';
    ctx.shadowBlur = Math.max(5, 9 * runtime.view.fit);
    for (let pointIndex = 0; pointIndex < geometry.points.length; pointIndex += 3) {
      const point = geometry.points[pointIndex];
      const position = runtime.gatheredLinePosition(
        point,
        pointIndex,
        echoIndex,
        now,
        gatherElapsed,
      );
      const x = position.x + channelX[channelIndex] * channelOffset;
      const y = position.y + channelY[channelIndex] * channelOffset;
      const distanceToFront = Math.abs(Math.hypot(x - centerX, y - centerY) - radius);
      const strength = 1 - clamp(distanceToFront / band, 0, 1);
      if (strength <= 0.05) continue;
      const size = Math.max(1.4, (1.2 + strength * 3.2) * runtime.view.fit);
      ctx.globalAlpha = (0.42 + strength * 0.58) * fade;
      ctx.fillRect(x - size * 0.5, y - size * 0.5, size, size);
    }
    ctx.restore();
  }

  private drawStableSolidPoint(
    point: FigurePoint,
    echoIndex: number,
    channelIndex: number,
    now: number,
    size: number,
    elapsed: number,
  ): void {
    const { runtime, ctx } = this;
    const position = runtime.gatheredPosition(
      runtime.solidPointPosition(point, echoIndex, now),
      echoIndex,
      elapsed,
    );
    const offset = chromaticOffsetForEcho(echoIndex) * runtime.view.fit;
    ctx.fillRect(
      position.x + channelX[channelIndex] * offset,
      position.y + channelY[channelIndex] * offset,
      size,
      size,
    );
  }

  private renderSolids(now: number, elapsed: number): void {
    const { runtime, ctx } = this;
    const baseSize = 2.25 * runtime.view.fit;
    const echoCount = clamp(Math.round(settings.echoes), 1, echoCenters.length);
    const gatherElapsed = runtime.isNameDropWave()
      ? runtime.visualGatherElapsed(now)
      : elapsed;
    for (let channelIndex = 0; channelIndex < channelColors.length; channelIndex += 1) {
      ctx.fillStyle = channelColors[channelIndex];
      ctx.globalAlpha = 0.84;
      for (let echoIndex = 0; echoIndex < echoCount; echoIndex += 1) {
        for (const point of runtime.solidPoints) {
          if (runtime.phase === 'idle') {
            this.drawStableSolidPoint(point, echoIndex, channelIndex, now, baseSize, 0);
            continue;
          }
          const currentPosition = runtime.solidPointPosition(point, echoIndex, now);
          const spawnPosition = runtime.spawnReferencePosition(currentPosition, echoIndex);
          const spawnTime = runtime.spawnTimeFor(
            spawnPosition.designX, spawnPosition.designY, point, echoIndex,
          );
          if (elapsed < spawnTime) {
            this.drawStableSolidPoint(
              point, echoIndex, channelIndex, now, baseSize, gatherElapsed,
            );
          } else this.particles.draw(
            point,
            -1,
            echoIndex,
            channelIndex,
            spawnTime,
            elapsed - spawnTime,
            baseSize,
            false,
          );
        }
      }
    }
  }
}
