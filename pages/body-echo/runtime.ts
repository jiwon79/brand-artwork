import {
  ACTIVE_FIGURE,
  ACTIVE_GATHER_STYLE,
  ACTIVE_INTERACTION,
  ACTIVE_RELEASE_STYLE,
  DESIGN_HEIGHT,
  DESIGN_WIDTH,
  SVG_TO_DESIGN,
  echoCenters,
  lineEchoYCenters,
  settings,
  solidEchoXScales,
  solidEchoYCenters,
  solidEchoYScales,
} from './config';
import { clamp, hash, smoothstep } from './math';
import type {
  ContactExtentCache,
  DesignPoint,
  EchoLineGeometry,
  FigurePoint,
  Phase,
  PositionedPoint,
  RopeField,
  View,
} from './types';
import { measureWaveExtent, waveDelayForDistance } from './wave-timing';

/** Shared simulation state and geometry transforms used by input and rendering. */
export class BodyEchoRuntime {
  view: View = {
    width: DESIGN_WIDTH,
    height: DESIGN_HEIGHT,
    fit: 1,
    offsetX: 0,
    offsetY: 0,
  };

  echoLineGeometry: EchoLineGeometry[] = [];
  solidPoints: FigurePoint[] = [];
  phase: Phase = 'idle';
  triggeredAt = 0;
  releasedAt = 0;
  releasedGatherElapsed = 0;
  releasedHoldAge = 0;
  contactOrigin: DesignPoint = { x: DESIGN_WIDTH * 0.5, y: DESIGN_HEIGHT * 0.5 };
  ropeFields: Array<RopeField | undefined> = [];
  lastNow = 0;

  private contactExtentCache: ContactExtentCache = {
    x: Number.NaN,
    y: Number.NaN,
    value: 1,
  };

  isNameDropWave(): boolean {
    return ACTIVE_INTERACTION === 'NameDrop Wave';
  }

  isPreviousContactRelease(): boolean {
    return ACTIVE_RELEASE_STYLE === 'Previous · Shockwave';
  }

  isRopePull(): boolean {
    return ACTIVE_GATHER_STYLE === 'Rope Pull' && ACTIVE_FIGURE === 'Lines';
  }

  isDragDissolve(): boolean {
    return ACTIVE_INTERACTION === 'Drag Dissolve';
  }

  contactReleaseTime(): number {
    return settings.contactGatherDuration + settings.contactDensityDuration;
  }

  contactWaveExtent(): number {
    const { contactOrigin, contactExtentCache } = this;
    if (
      contactExtentCache.x === contactOrigin.x
      && contactExtentCache.y === contactOrigin.y
    ) return contactExtentCache.value;

    const value = measureWaveExtent(contactOrigin);
    this.contactExtentCache = { x: contactOrigin.x, y: contactOrigin.y, value };
    return value;
  }

  motionElapsed(now: number): number {
    if (this.phase === 'gathering') {
      return Math.min(
        Math.max(0, now - this.triggeredAt),
        Math.max(0, this.contactReleaseTime() - 0.0001),
      );
    }
    if (this.phase === 'dissolving' && this.isNameDropWave()) {
      return this.contactReleaseTime() + Math.max(0, now - this.releasedAt);
    }
    if (this.phase === 'dissolving') return Math.max(0, now - this.triggeredAt);
    return 0;
  }

  visualGatherElapsed(now: number): number {
    const releaseTime = this.contactReleaseTime();
    if (this.phase === 'gathering') {
      return Math.min(Math.max(0, now - this.triggeredAt), Math.max(0, releaseTime - 0.0001));
    }
    if (this.phase !== 'dissolving' || !this.isNameDropWave()) return 0;

    const releaseAge = Math.max(0, now - this.releasedAt);
    const settle = smoothstep(releaseAge / 0.16);
    return this.releasedGatherElapsed
      + (releaseTime - this.releasedGatherElapsed) * settle;
  }

  resizeView(width: number, height: number): void {
    const fit = Math.min(width / DESIGN_WIDTH, height / DESIGN_HEIGHT);
    this.view = {
      width,
      height,
      fit,
      offsetX: (width - DESIGN_WIDTH * fit) * 0.5,
      offsetY: (height - DESIGN_HEIGHT * fit) * 0.5,
    };
  }

  lineSway(echoIndex: number, time: number): number {
    const echoPhase = time * 1.45 - echoIndex * 0.19;
    return Math.sin(echoPhase * 0.44) * (1.1 - echoIndex * 0.09) * settings.idleMotion;
  }

  linePointPosition(point: FigurePoint, echoIndex: number, time: number): PositionedPoint {
    const designX = echoCenters[echoIndex] + point.x * SVG_TO_DESIGN
      + this.lineSway(echoIndex, time);
    const designY = lineEchoYCenters[echoIndex] + point.y * SVG_TO_DESIGN;
    return this.positioned(designX, designY);
  }

  solidPointPosition(point: FigurePoint, echoIndex: number, time: number): PositionedPoint {
    const echoPhase = time * 1.45 - echoIndex * 0.19;
    const motion = settings.idleMotion;
    const scaleX = solidEchoXScales[echoIndex];
    const scaleY = solidEchoYScales[echoIndex];
    const wave = (
      Math.sin(point.y * 0.205 + echoPhase) * 0.72
      + Math.sin(point.y * 0.067 - echoPhase * 0.73) * 0.48
    ) * motion;
    const sway = Math.sin(echoPhase * 0.44) * (1.1 - echoIndex * 0.09) * motion;
    const verticalJitter = Math.sin(point.x * 0.13 + echoPhase * 1.31) * 0.16 * motion;
    const rasterWave = (
      Math.sin(point.x * 0.115 + point.y * 0.052 + echoPhase * 0.18) * 0.5
      + Math.sin(point.x * 0.041 - point.y * 0.103) * 0.24
    );
    const designX = echoCenters[echoIndex] + (point.x + wave) * scaleX + sway;
    const designY = solidEchoYCenters[echoIndex]
      + (point.y + rasterWave) * scaleY + verticalJitter;
    return this.positioned(designX, designY);
  }

  contactGatherProgress(elapsed: number): number {
    if (!this.isNameDropWave()) return 0;
    return smoothstep(elapsed / Math.max(0.001, settings.contactGatherDuration));
  }

  contactDensityProgress(elapsed: number): number {
    if (!this.isNameDropWave()) return 0;
    return smoothstep(
      (elapsed - settings.contactGatherDuration)
      / Math.max(0.001, settings.contactDensityDuration),
    );
  }

  gatheredPosition(
    position: PositionedPoint,
    echoIndex: number,
    elapsed: number,
  ): PositionedPoint {
    const gather = this.contactGatherProgress(elapsed);
    const density = this.contactDensityProgress(elapsed);
    const progress = gather * 0.72 + density * 0.28;
    if (progress <= 0) return position;

    const deltaX = this.contactOrigin.x - position.designX;
    const deltaY = this.contactOrigin.y - position.designY;
    const distance = Math.max(0.001, Math.hypot(deltaX, deltaY));
    const proximity = smoothstep(1 - distance / (DESIGN_WIDTH * 0.52));
    const localTension = 0.22 + proximity * proximity * 1.78;
    const pull = settings.contactCompression
      * progress * localTension * this.contactTensionPulse(echoIndex);
    return this.positioned(
      position.designX + deltaX * pull,
      position.designY + deltaY * pull,
    );
  }

  gatheredLinePosition(
    point: FigurePoint,
    pointIndex: number,
    echoIndex: number,
    time: number,
    elapsed: number,
    basePosition = this.linePointPosition(point, echoIndex, time),
  ): PositionedPoint {
    if (!this.isRopePull()) return this.gatheredPosition(basePosition, echoIndex, elapsed);

    const gather = this.contactGatherProgress(elapsed);
    const density = this.contactDensityProgress(elapsed);
    if (gather <= 0 && density <= 0) return basePosition;

    const geometry = this.echoLineGeometry[echoIndex];
    const field = this.ropeFieldFor(echoIndex);
    if (!geometry || !field) return basePosition;

    const graphDistance = field.graphDistances[pointIndex] ?? Number.POSITIVE_INFINITY;
    const graphExtent = Math.max(1, field.maxGraphDistance);
    const normalizedDistance = clamp(graphDistance / graphExtent, 0, 1);
    const effectiveReach = Math.max(1, settings.contactRopeReach)
      * (0.68 + gather * 0.65 + density * 0.25);
    const localTension = Math.exp(-graphDistance / Math.max(1, effectiveReach));
    const transmittedTension = (0.045 + gather * 0.075 + density * 0.045)
      * (1 - normalizedDistance * 0.35);
    const distanceTension = localTension + (1 - localTension) * transmittedTension;
    const springResponse = 1 - Math.exp(-elapsed / (0.055 + normalizedDistance * 0.3));
    const influence = springResponse * distanceTension;
    if (influence <= 0.0001) return basePosition;

    const anchorPoint = geometry.points[field.anchorPointIndex];
    const anchorPosition = this.linePointPosition(anchorPoint, echoIndex, time);
    const deltaX = this.contactOrigin.x - anchorPosition.designX;
    const deltaY = this.contactOrigin.y - anchorPosition.designY;
    const anchorDistance = Math.max(0.001, Math.hypot(deltaX, deltaY));
    const proximity = 0.12
      + Math.exp(-field.anchorDistance / (DESIGN_WIDTH * 0.24)) * 0.88;
    const tension = gather * 0.76 + density * 0.24;
    const pullDistance = Math.min(anchorDistance * 0.78, settings.contactRopePull)
      * tension * influence * proximity;
    const tangentX = point.tangentX ?? 1;
    const tangentY = point.tangentY ?? 0;
    const pathCoordinate = (point.pathDistance ?? 0) * SVG_TO_DESIGN;
    const pathPhase = (point.pathIndex ?? 0) * 1.37 + echoIndex * 0.53;
    const slack = Math.sin(pathCoordinate * 0.065 + pathPhase)
      * settings.contactRopeSlack * gather * influence * (1 - influence * 0.28);

    return this.positioned(
      basePosition.designX + (deltaX / anchorDistance) * pullDistance - tangentY * slack,
      basePosition.designY + (deltaY / anchorDistance) * pullDistance + tangentX * slack,
    );
  }

  spawnReferencePosition(position: PositionedPoint, echoIndex: number): PositionedPoint {
    if (!this.isNameDropWave() || this.isPreviousContactRelease()) return position;
    return this.gatheredPosition(position, echoIndex, this.contactReleaseTime());
  }

  lineSpawnReferencePosition(
    point: FigurePoint,
    pointIndex: number,
    echoIndex: number,
    time: number,
    position = this.linePointPosition(point, echoIndex, time),
  ): PositionedPoint {
    if (!this.isNameDropWave() || this.isPreviousContactRelease()) return position;
    return this.gatheredLinePosition(
      point, pointIndex, echoIndex, time, this.contactReleaseTime(), position,
    );
  }

  spawnTimeFor(
    designX: number,
    designY: number,
    point: FigurePoint,
    echoIndex: number,
  ): number {
    if (this.isNameDropWave()) {
      const distance = Math.hypot(
        designX - this.contactOrigin.x,
        designY - this.contactOrigin.y,
      );
      if (this.isPreviousContactRelease()) {
        return this.contactReleaseTime()
          + clamp(distance / (DESIGN_WIDTH * 0.72), 0, 1) * settings.contactWaveDuration;
      }
      return this.contactReleaseTime()
        + waveDelayForDistance(distance, this.contactWaveExtent(), settings.contactWaveDuration);
    }

    const xProgress = clamp(designX / DESIGN_WIDTH, 0, 1);
    const jitter = (hash(point.x, point.y, echoIndex) - 0.5) * settings.sweepJitter;
    return settings.hold + xProgress * settings.sweepDuration + jitter;
  }

  releaseAnimationDuration(): number {
    if (!this.isNameDropWave()) {
      return settings.hold + settings.sweepDuration + settings.particleLife + 0.45;
    }
    if (this.isPreviousContactRelease()) {
      return settings.contactWaveDuration
        + settings.particleLife / settings.contactReleaseSpeed + 0.8;
    }
    return settings.contactWaveDuration + Math.max(
      settings.contactDiffusionDuration / settings.contactReleaseSpeed,
      settings.contactParticleFadeDuration,
    ) + 0.65;
  }

  private positioned(designX: number, designY: number): PositionedPoint {
    return {
      x: this.view.offsetX + designX * this.view.fit,
      y: this.view.offsetY + designY * this.view.fit,
      designX,
      designY,
    };
  }

  private contactTensionPulse(echoIndex: number): number {
    const holdAge = this.phase === 'gathering'
      ? Math.max(0, this.lastNow - this.triggeredAt - this.contactReleaseTime())
      : this.phase === 'dissolving' ? this.releasedHoldAge : 0;
    if (holdAge <= 0) return 1;
    const releaseDecay = this.phase === 'dissolving'
      ? 1 - smoothstep((this.lastNow - this.releasedAt) / 0.16)
      : 1;
    return 1 + Math.sin(holdAge * 4.4 + echoIndex * 0.72) * 0.025 * releaseDecay;
  }

  private ropeFieldFor(echoIndex: number): RopeField | null {
    const cached = this.ropeFields[echoIndex];
    if (cached) return cached;
    const geometry = this.echoLineGeometry[echoIndex];
    if (!geometry || geometry.points.length === 0) return null;

    let anchorPointIndex = 0;
    let anchorDistance = Number.POSITIVE_INFINITY;
    for (let pointIndex = 0; pointIndex < geometry.points.length; pointIndex += 1) {
      const position = this.linePointPosition(geometry.points[pointIndex], echoIndex, this.lastNow);
      const distance = Math.hypot(
        this.contactOrigin.x - position.designX,
        this.contactOrigin.y - position.designY,
      );
      if (distance >= anchorDistance) continue;
      anchorPointIndex = pointIndex;
      anchorDistance = distance;
    }

    const graphDistances = Array.from<number>({ length: geometry.points.length })
      .fill(Number.POSITIVE_INFINITY);
    graphDistances[anchorPointIndex] = 0;
    const stack = [anchorPointIndex];
    while (stack.length > 0) {
      const pointIndex = stack.pop();
      if (pointIndex === undefined) break;
      for (const edge of geometry.graph[pointIndex]) {
        const distance = graphDistances[pointIndex] + edge.distance;
        if (distance >= graphDistances[edge.pointIndex]) continue;
        graphDistances[edge.pointIndex] = distance;
        stack.push(edge.pointIndex);
      }
    }

    const maxGraphDistance = graphDistances.reduce((maximum, distance) => (
      Number.isFinite(distance) ? Math.max(maximum, distance) : maximum
    ), 0);
    const field = { anchorPointIndex, anchorDistance, graphDistances, maxGraphDistance };
    this.ropeFields[echoIndex] = field;
    return field;
  }
}
