export type RotationSettings = {
  motionSpeed: number;
  dragStrength: number;
  waveRotationSpeed: number;
  waveTurns: number;
  waveTravelSpeed: number;
  waveSlowdown: number;
};

export function createRotationSettings(): RotationSettings {
  return {
    motionSpeed: 0.5,
    dragStrength: 0.5,
    waveRotationSpeed: 1.6,
    waveTurns: 1,
    waveTravelSpeed: 1.2,
    waveSlowdown: 1,
  };
}
