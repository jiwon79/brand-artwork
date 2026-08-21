import { DESIGN_HEIGHT, DESIGN_WIDTH } from './config';
import { clamp } from './math';
import type { DesignPoint } from './types';

export function measureWaveExtent(origin: DesignPoint): number {
  return Math.max(
    Math.hypot(origin.x, origin.y),
    Math.hypot(DESIGN_WIDTH - origin.x, origin.y),
    Math.hypot(origin.x, DESIGN_HEIGHT - origin.y),
    Math.hypot(DESIGN_WIDTH - origin.x, DESIGN_HEIGHT - origin.y),
  );
}

export function waveEase(progress: number): number {
  return 1 - Math.pow(1 - clamp(progress, 0, 1), 1.25);
}

export function inverseWaveEase(progress: number): number {
  return 1 - Math.pow(1 - clamp(progress, 0, 1), 1 / 1.25);
}

export function waveDelayForDistance(
  distance: number,
  extent: number,
  duration: number,
): number {
  const distanceProgress = clamp(distance / Math.max(1, extent), 0, 1);
  return inverseWaveEase(distanceProgress) * duration;
}

export function waveRadiusForProgress(progress: number, extent: number): number {
  return waveEase(progress) * extent;
}
