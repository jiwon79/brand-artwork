export const SHELL_COUNT = 13;
export const RIBBON_STATIONS = [0, 0.22, 0.48, 0.73, 1] as const;

export function shellDistance(index: number, exponent = 1.3): number {
  return 0.5 + 29 * (index / (SHELL_COUNT - 1)) ** exponent;
}

export type Point = { x: number; y: number };

/** Camera-space counterpart of fur-ribbon.vert, before orthographic projection. */
export function ribbonGeometry(angle: number, width: number, bend: number, length = 25) {
  const root = { x: 0, y: 0 };
  const tip = { x: 0, y: length * Math.cos(angle * Math.PI / 180) };
  const axis = { x: tip.x - root.x, y: tip.y - root.y };
  const projectedLength = Math.hypot(axis.x, axis.y);
  const fallback = projectedLength <= 0.001;
  const across = fallback ? { x: 1, y: 0 } : { x: -axis.y / projectedLength, y: axis.x / projectedLength };
  const stations = RIBBON_STATIONS.map(t => {
    const halfWidth = width * (1 - t) ** 1.4;
    const curve = bend * Math.sin(Math.PI * t);
    const center = { x: axis.x * t + across.x * curve, y: axis.y * t + across.y * curve };
    const point = (side: number): Point => ({ x: center.x + across.x * halfWidth * side, y: center.y + across.y * halfWidth * side });
    return { t, halfWidth, center, left: point(-1), right: point(1) };
  });
  return { root, tip, across, stations, projectedLength, fallback };
}
