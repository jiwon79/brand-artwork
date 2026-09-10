export type RotationSettings = {
  dragSpeed: number;
  dragAmount: number;
  releaseSpeed: number;
  releaseTurns: number;
};

export function createRotationSettings(): RotationSettings {
  return { dragSpeed: 0.5, dragAmount: 0.5, releaseSpeed: 1, releaseTurns: 1 };
}
