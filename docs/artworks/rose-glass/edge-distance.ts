import { foregroundGlassShape, glassBodyWidthAt } from '../../../pages/rose-glass/deformation';
import { outlinePoint } from './outline-demo';

const steps = 256, step = 2 * Math.PI / steps;
const boundaryAt = (angle: number) => outlinePoint(angle, foregroundGlassShape.exponent, 3);
const outline = Array.from({ length: steps }, (_, i) => boundaryAt(i * step));

/** Numerically find the closest point on the undeformed foreground silhouette. */
export function nearestEdge(u: number, v: number) {
  const y = v * foregroundGlassShape.height;
  const point = { x: u * glassBodyWidthAt(2, v) + y * foregroundGlassShape.shear, y };
  const squaredDistance = (boundary: { x: number; y: number }) => (boundary.x - point.x) ** 2 + (boundary.y - point.y) ** 2;
  const distances = outline.map(squaredDistance);
  let boundary = outline[0], best = distances[0];
  // Refine every sampled local minimum so either side of the body can win.
  for (let i = 0; i < steps; i++) {
    if (distances[i] > distances[(i + steps - 1) % steps] || distances[i] > distances[(i + 1) % steps]) continue;
    let lo = (i - 1) * step, hi = (i + 1) * step;
    const ratio = (Math.sqrt(5) - 1) / 2;
    let a = hi - ratio * (hi - lo), b = lo + ratio * (hi - lo);
    let da = squaredDistance(boundaryAt(a)), db = squaredDistance(boundaryAt(b));
    for (let iteration = 0; iteration < 40; iteration++) {
      if (da < db) {
        hi = b; b = a; db = da; a = hi - ratio * (hi - lo); da = squaredDistance(boundaryAt(a));
      } else {
        lo = a; a = b; da = db; b = lo + ratio * (hi - lo); db = squaredDistance(boundaryAt(b));
      }
    }
    const candidate = boundaryAt((lo + hi) / 2), distance = squaredDistance(candidate);
    if (distance < best) { best = distance; boundary = candidate; }
  }
  return { point, boundary, distance: Math.sqrt(best) };
}
