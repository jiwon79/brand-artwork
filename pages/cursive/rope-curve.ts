import type { PenPath, PenPoint } from './pen-geometry';

export interface RopeKnot { node: number; distance: number; rest: PenPoint }
export interface RopePosition { x: number; y: number }

/** Interpolate the authored material coordinate, independently of deformation. */
export function sampleRopePen(pen: PenPath, distance: number): PenPoint {
  let low = 0, high = pen.points.length - 1;
  while (low + 1 < high) {
    const middle = (low + high) >> 1;
    if (pen.points[middle].distance < distance) low = middle; else high = middle;
  }
  const a = pen.points[low], b = pen.points[high];
  const t = Math.max(0, Math.min(1, (distance - a.distance) / (b.distance - a.distance || 1)));
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t,
    radius: a.radius + (b.radius - a.radius) * t, distance };
}

/** One derivative per material knot, shared by both adjoining cubics. */
export function ropeTangents(knots: readonly RopeKnot[], positions: readonly RopePosition[]): RopePosition[] {
  return knots.map((_, i) => {
    const before = Math.max(0, i - 1), after = Math.min(knots.length - 1, i + 1);
    const a = positions[before], b = positions[after];
    const span = knots[after].distance - knots[before].distance || 1;
    // Material-coordinate tangents stay bounded even on a coalesced fast drag.
    const x = (b.x - a.x) / span, y = (b.y - a.y) / span;
    const scale = Math.min(1, 1.5 / (Math.hypot(x, y) || 1));
    return { x: x * scale, y: y * scale };
  });
}

export function ropeCubic(a: RopePosition, b: RopePosition, da: RopePosition, db: RopePosition, span: number, t: number): RopePosition {
  const t2 = t * t, t3 = t2 * t;
  const h0 = 2 * t3 - 3 * t2 + 1, h1 = t3 - 2 * t2 + t;
  const h2 = -2 * t3 + 3 * t2, h3 = t3 - t2;
  return { x: h0 * a.x + h1 * span * da.x + h2 * b.x + h3 * span * db.x,
    y: h0 * a.y + h1 * span * da.y + h2 * b.y + h3 * span * db.y };
}

const inkSamples = new WeakMap<PenPath, { point: PenPoint; radius: number }[]>();
function sampledInk(pen: PenPath) {
  const cached = inkSamples.get(pen);
  if (cached) return cached;
  const count = Math.max(1, Math.ceil(pen.length / 4));
  const samples = Array.from({ length: count + 1 }, (_, i) => {
    const point = sampleRopePen(pen, pen.length * i / count);
    let radius = 0, sum = 0;
    for (let offset = -90; offset <= 90; offset += 10) {
      const weight = Math.exp(-.5 * (offset / 35) ** 2);
      radius += sampleRopePen(pen, Math.max(0, Math.min(pen.length, point.distance + offset))).radius * weight;
      sum += weight;
    }
    return { point, radius: radius / sum };
  });
  inkSamples.set(pen, samples);
  return samples;
}

/** Reconstruct a continuous curve from physical particles. The tiny residual
 * between the authored path and its rest spline preserves the original ink
 * exactly at rest and fades as the material changes shape, instead of rotating a separate old arc on every physical link. */
export function ropeCurve(pen: PenPath, knots: readonly RopeKnot[], positions: readonly RopePosition[], tangents?: readonly RopePosition[], restTangents?: readonly RopePosition[]): PenPath {
  if (!knots.length || knots.every((k, i) => Math.hypot(positions[i].x - k.rest.x, positions[i].y - k.rest.y) < 1e-8)) return pen;
  const rest = knots.map(k => k.rest), originalTangents = restTangents ?? ropeTangents(knots, rest);
  const currentTangents = tangents ?? ropeTangents(knots, positions);
  const displacement = { x: positions[0].x - rest[0].x, y: positions[0].y - rest[0].y };
  const changedShape = Math.max(...knots.map((k, i) => Math.hypot(positions[i].x - k.rest.x - displacement.x, positions[i].y - k.rest.y - displacement.y)));
  const blend = Math.min(1, changedShape / 60);
  const points: PenPoint[] = [];
  let segment = 0;
  // Dense samples are important after a formerly straight piece bends. Its
  // original Bézier tessellation alone cannot represent the new curvature.
  for (const { point, radius } of sampledInk(pen)) {
    const distance = point.distance;
    while (segment + 2 < knots.length && knots[segment + 1].distance < distance) segment++;
    const end = Math.min(segment + 1, knots.length - 1), span = knots[end].distance - knots[segment].distance;
    const t = span ? (distance - knots[segment].distance) / span : 0;
    const now = ropeCubic(positions[segment], positions[end], currentTangents[segment], currentTangents[end], span, t);
    const was = ropeCubic(rest[segment], rest[end], originalTangents[segment], originalTangents[end], span, t);
    // A brush-width ripple becomes a row of bumps once its old loop is
    // stretched straight. Filter the material radius too, blending smoothly
    // from the untouched outline as the rope changes shape.
    // Rest fitting detail is useful only while preserving a letter. Under
    // tension it would stamp the old loop's little arcs onto the new rope.
    points.push({ ...point, radius: point.radius + (radius - point.radius) * blend,
      x: now.x + (point.x - was.x) * (1 - blend), y: now.y + (point.y - was.y) * (1 - blend) });
  }
  return { ...pen, points };
}
