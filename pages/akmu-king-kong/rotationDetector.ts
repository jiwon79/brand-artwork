import type { Landmark } from './handTracker';

const DEADZONE_DEG = 1.5;

function getHandAngle(landmarks: Landmark[]): number {
  const wrist = landmarks[0];
  const middleMCP = landmarks[9];
  return (
    Math.atan2(middleMCP.y - wrist.y, middleMCP.x - wrist.x) * (180 / Math.PI)
  );
}

function normalizeAngleDelta(delta: number): number {
  let d = delta;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
}

export interface RotationResult {
  delta: number;
  accumulated: number;
  angle: number | null;
}

export function createRotationDetector() {
  let prevAngle: number | null = null;
  let accumulated = 0;

  return {
    update(landmarks: Landmark[] | null): RotationResult {
      if (!landmarks || landmarks.length === 0) {
        prevAngle = null;
        return { delta: 0, accumulated, angle: null };
      }

      const angle = getHandAngle(landmarks);

      if (prevAngle === null) {
        prevAngle = angle;
        return { delta: 0, accumulated, angle };
      }

      let delta = normalizeAngleDelta(angle - prevAngle);

      if (Math.abs(delta) < DEADZONE_DEG) {
        delta = 0;
      }

      accumulated += delta;
      prevAngle = angle;

      return { delta, accumulated, angle };
    },

    reset() {
      prevAngle = null;
      accumulated = 0;
    },
  };
}
