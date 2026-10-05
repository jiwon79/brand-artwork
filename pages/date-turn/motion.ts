export const TURN_DURATION = 3;
export const TRANSITION_DURATION = 0.56;

function smootherstep(value: number): number {
  const t = Math.max(0, Math.min(1, value));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** A 120-degree roll centered on each half-second, with zero end velocity/acceleration. */
export function rollAngle(time: number, duration = TRANSITION_DURATION): number {
  const turn = Math.floor(time);
  const progress = time - turn;
  const span = Math.max(0.2, Math.min(0.9, duration));
  return (turn + smootherstep((progress - (1 - span) / 2) / span)) * Math.PI * 2 / 3;
}

/** Yaw, screen tilt and height share the reference's three-second phase. Angles are degrees. */
export function motionPose(time: number, transition = TRANSITION_DURATION, sway = 32, tilt = 13) {
  const cycle = time / TURN_DURATION * Math.PI * 2;
  return {
    pitch: rollAngle(time, transition),
    yaw: -sway * Math.PI / 180 * Math.cos(cycle),
    roll: tilt * Math.PI / 180 * Math.cos(cycle),
    height: Math.cos(cycle),
  };
}

/** The incoming numeral starts thin and fills as the new face settles, after the main roll. */
export function inkInsets(time: number): [number, number, number] {
  const turn = Math.floor(time);
  const progress = time - turn;
  const incoming = ((turn + 1) % 3 + 3) % 3;
  const insets: [number, number, number] = [0, 0, 0];
  insets[incoming] = 0.08 * (1 - smootherstep((progress - 0.66) / 0.24));
  return insets;
}

export function dragRotation(dx: number, dy: number, viewport: number, sensitivity: number): [number, number] {
  const factor = Math.PI * sensitivity / Math.max(240, viewport);
  return [-dy * factor, dx * factor];
}

/** Exponential response is independent of pointer event rate and display refresh rate. */
export function followAngle(current: number, target: number, delta: number, response: number): number {
  if (Math.abs(target - current) < 0.0001) return target;
  return current + (target - current) * -Math.expm1(-Math.max(0, delta) / Math.max(0.001, response));
}

export function isValidNumber(value: string): boolean { return /^\d{1,6}$/.test(value); }
