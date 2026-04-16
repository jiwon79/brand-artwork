import type { Landmark } from './handTracker';

export interface DistanceResult {
  distance: number;
  handsDetected: boolean;
}

export function computeHandDistance(
  multiHandLandmarks: Landmark[][] | undefined,
): DistanceResult {
  if (!multiHandLandmarks || multiHandLandmarks.length < 2) {
    return { distance: 0, handsDetected: false };
  }

  // Use middle finger MCP (landmark 9) as palm center
  const palm1 = multiHandLandmarks[0][9];
  const palm2 = multiHandLandmarks[1][9];

  const dx = palm1.x - palm2.x;
  const dy = palm1.y - palm2.y;
  const distance = Math.sqrt(dx * dx + dy * dy);

  return { distance, handsDetected: true };
}
