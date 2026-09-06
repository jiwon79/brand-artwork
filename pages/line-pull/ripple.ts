import type { Point } from './geometry';

export const RIPPLE_DURATION = 0.8;
const PACKET_DURATION = 0.28;

export interface ReleaseRipple {
  x: number;
  originY: number;
  amplitude: number;
  speed: number;
  spread: number;
  age: number;
}

export interface RippleColumn {
  offset: number;
  centerY: number;
  spread: number;
}

export function createReleaseRipple(input: {
  x: number; originY: number; travel: number; lineGap: number; width: number; strength: number;
}): ReleaseRipple | null {
  const { x, originY, travel, lineGap, width, strength } = input;
  if (Math.abs(travel) < 4 || strength <= 0) return null;
  return {
    x, originY, age: 0,
    amplitude: -Math.sign(travel) * lineGap * 0.22 * Math.min(1, strength)
      * -Math.expm1(-Math.abs(travel) / (lineGap * 1.6)),
    speed: Math.min(1800, Math.max(600, width * 1.1)),
    spread: lineGap * 1.8,
  };
}

export function advanceRipple(ripple: ReleaseRipple | null, dt: number): ReleaseRipple | null {
  if (!ripple) return null;
  const age = ripple.age + Math.max(0, dt);
  return age >= RIPPLE_DURATION ? null : { ...ripple, age };
}

// One outgoing pulse per side. Arrival is delayed by horizontal distance;
// the squared sine window makes both ends of the packet meet the resting line smoothly.
export function rippleOffset(ripple: ReleaseRipple, x: number): number {
  if (ripple.age <= 0 || ripple.age >= RIPPLE_DURATION) return 0;
  const localTime = ripple.age - Math.abs(x - ripple.x) / ripple.speed;
  if (localTime <= 0 || localTime >= PACKET_DURATION) return 0;
  const phase = localTime / PACKET_DURATION;
  const fade = Math.min(1, (RIPPLE_DURATION - ripple.age) / 0.18);
  return ripple.amplitude * Math.sin(2 * Math.PI * phase) * Math.sin(Math.PI * phase) ** 2
    * Math.exp(-2.8 * ripple.age) * fade * fade * (3 - 2 * fade);
}

// Warp the rendered Y, not the line index. Adjacent lines and both clip boundaries
// then share the same continuous deformation, even when the opening nearly closes.
export function ripplePoint(point: Point, column?: RippleColumn): Point {
  if (!column || column.offset === 0) return point;
  const distance = (point.y - column.centerY) / column.spread;
  if (Math.abs(distance) > 4) return point;
  return { x: point.x, y: point.y + column.offset * Math.exp(-distance * distance) };
}
