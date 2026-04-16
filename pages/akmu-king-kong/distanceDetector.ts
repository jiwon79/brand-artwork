import type { Landmark } from './handTracker';

export interface DistanceResult {
  distance: number;
  handDetected: boolean;
}

export function computePinchDistance(
  landmarks: Landmark[] | null,
): DistanceResult {
  if (!landmarks) {
    return { distance: 0, handDetected: false };
  }

  // Thumb tip (4) ↔ Index finger tip (8)
  const thumb = landmarks[4];
  const index = landmarks[8];

  const dx = thumb.x - index.x;
  const dy = thumb.y - index.y;
  const distance = Math.sqrt(dx * dx + dy * dy);

  return { distance, handDetected: true };
}
