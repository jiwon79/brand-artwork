export const TURN_DURATION = 3;

function smootherstep(value: number): number {
  const t = Math.max(0, Math.min(1, value));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Three genuine faces, separated by 120 degrees; a short roll between pauses. */
export function rollAngle(time: number): number {
  const turn = Math.floor(time);
  const progress = time - turn;
  return (turn + smootherstep((progress - 0.32) / 0.36)) * Math.PI * 2 / 3;
}

export function dragRotation(dx: number, dy: number, viewport: number, sensitivity: number): [number, number] {
  const factor = Math.PI * 2 * sensitivity / Math.max(240, viewport);
  return [-dy * factor, dx * factor];
}

export function isValidNumber(value: string): boolean { return /^\d{1,6}$/.test(value); }
