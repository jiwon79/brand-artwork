export const MIN_ZOOM = 0.65;
export const MAX_ZOOM = 2.5;

export function pinchDistance(first: readonly [number, number], second: readonly [number, number]) {
  return Math.hypot(first[0] - second[0], first[1] - second[1]);
}

export function pinchZoom(startZoom: number, startDistance: number, distance: number) {
  if (startDistance <= 0) return startZoom;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, startZoom * distance / startDistance));
}
