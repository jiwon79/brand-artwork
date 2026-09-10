export type RotationSettings = {
  dragSpeed: number;
  dragAmount: number;
  releaseSpeed: number;
  releaseTurns: number;
};

export function createRotationSettings(): RotationSettings {
  return { dragSpeed: 1, dragAmount: 1, releaseSpeed: 1, releaseTurns: 3 };
}
