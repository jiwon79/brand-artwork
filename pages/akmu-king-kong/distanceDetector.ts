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

  const thumb = landmarks[4];
  const index = landmarks[8];

  // 3D distance (x, y, z)
  const dx = thumb.x - index.x;
  const dy = thumb.y - index.y;
  const dz = thumb.z - index.z;
  const rawDist = Math.sqrt(dx * dx + dy * dy + dz * dz);

  // Normalize by hand size (wrist→middle MCP) to cancel camera distance effect
  const wrist = landmarks[0];
  const mid = landmarks[9];
  const hx = wrist.x - mid.x;
  const hy = wrist.y - mid.y;
  const hz = wrist.z - mid.z;
  const handSize = Math.sqrt(hx * hx + hy * hy + hz * hz);

  const distance = handSize > 0.01 ? rawDist / handSize : 0;

  return { distance, handDetected: true };
}
