export interface Point {
  x: number;
  y: number;
}

export interface Surface {
  width: number;
  height: number;
  lineGap: number;
  lineWidth: number;
  surfaceCurvature: number;
  spreadStrength: number;
  horizontalSpread: number;
  openingEdgeEase: number;
  openingEdgeCreep: number;
  pullPointSpacing: number;
}

export interface Pull {
  selectedLineY: number;
  pullX: number;
  pullY: number;
}

export function restingLineY(surface: Surface, x: number, y: number): number {
  const nx = (x - surface.width / 2) / Math.max(surface.width / 2, 1);
  return surface.height / 2
    + (y - surface.height / 2) * (1 - surface.surfaceCurvature * nx * nx);
}

export function signedPullDistance(surface: Surface, pull: Pull): number {
  return pull.pullY - restingLineY(surface, pull.pullX, pull.selectedLineY);
}

export function spreadProgress(surface: Surface, pull: Pull): number {
  return -Math.expm1(-Math.abs(signedPullDistance(surface, pull)) / (surface.lineGap * 1.35));
}

export function spreadSurfacePoint(surface: Surface, pull: Pull | null, x: number, y: number): Point {
  if (!pull) return { x, y: restingLineY(surface, x, y) };

  const direction = Math.sign(signedPullDistance(surface, pull));
  const strength = spreadProgress(surface, pull);
  // Keep the spread anchored near the opening instead of moving with the pointer.
  const pivotY = restingLineY(surface, x, pull.selectedLineY - direction * surface.lineGap * 2);
  const scale = 1 + surface.spreadStrength * strength;
  return {
    x: pull.pullX + (x - pull.pullX) * (1 + surface.horizontalSpread * strength),
    y: pivotY + (restingLineY(surface, x, y) - pivotY) * scale,
  };
}

export function copyLayout(surface: Surface, pull: Pull, lineCount: number) {
  // Typography has its own centered spread: moving the pointer sideways must not
  // translate the copy, including indirectly through the surface's curvature.
  const x = surface.width / 2;
  const centeredPull = { ...pull, pullX: x };
  const strength = spreadProgress(surface, centeredPull);
  const fontSize = Math.min(190, Math.max(64, surface.width * 0.205)) * (1 + 0.065 * strength);
  const lineHeight = fontSize * 0.83;
  return {
    x,
    y: spreadSurfacePoint(surface, centeredPull, x, pull.selectedLineY).y
      + Math.sign(signedPullDistance(surface, centeredPull)) * fontSize * 0.4
      - (lineCount - 1) * lineHeight / 2,
    fontSize,
    lineHeight,
    // Keep Hangul proportions intact; fontSize already supplies uniform magnification.
    scaleX: 1,
  };
}

function opening(surface: Surface, pull: Pull) {
  const delta = signedPullDistance(surface, pull);
  const direction = Math.sign(delta);
  const travel = Math.abs(delta);
  const selectedLine = spreadSurfacePoint(surface, pull, pull.pullX, pull.selectedLineY).y;
  return {
    direction,
    travel,
    distance: Math.max(0, direction * (pull.pullY - selectedLine)),
    creep: surface.lineGap * surface.openingEdgeCreep * Math.log1p(travel / surface.lineGap),
  };
}

export function openingEdgePoint(surface: Surface, pull: Pull, x: number): Point {
  const motion = opening(surface, pull);
  const selectedLine = spreadSurfacePoint(surface, pull, x, pull.selectedLineY);
  const neighbor = spreadSurfacePoint(surface, pull, x, pull.selectedLineY - motion.direction * surface.lineGap);
  const progress = -Math.expm1(-motion.travel / (surface.lineGap * surface.openingEdgeEase));
  const strength = spreadProgress(surface, pull);
  const halfWidth = Math.max(surface.width / 2, 1);
  const nx = (x - surface.width / 2) / halfWidth;
  // spreadSurfacePoint scales around a curved pivot, so include the pivot's slope too.
  const effectiveY = pull.selectedLineY - motion.direction * surface.lineGap
    + motion.direction * surface.lineGap * surface.spreadStrength * strength;
  const slope = -2 * (effectiveY - surface.height / 2) * surface.surfaceCurvature * nx / halfWidth
    / (1 + surface.horizontalSpread * strength);
  // Adjacent stroke edges meet; their centerlines stay one stroke width apart.
  // Account for the curved neighbor's slope in rendered (CSS pixel) coordinates.
  const separation = surface.lineWidth * Math.hypot(1, slope);
  return {
    x: selectedLine.x,
    y: selectedLine.y + (neighbor.y + motion.direction * separation - selectedLine.y) * progress
      - motion.direction * motion.creep,
  };
}

// A C1 hinge: a newly reached line acquires its bend continuously, including on reversal.
function softPositive(value: number, radius: number): number {
  if (radius <= 0 || value >= radius) return Math.max(0, value);
  if (value <= -radius) return 0;
  return (value + radius) ** 2 / (4 * radius);
}

export function bentLinePoint(surface: Surface, pull: Pull | null, rowY: number, x: number): Point {
  const point = spreadSurfacePoint(surface, pull, x, rowY);
  if (!pull) return point;
  const motion = opening(surface, pull);
  const offset = motion.direction * (rowY - pull.selectedLineY);

  if (offset < -0.001) {
    return { x: point.x, y: point.y - motion.direction * motion.creep };
  }

  const selectedLineAtPullX = spreadSurfacePoint(surface, pull, pull.pullX, pull.selectedLineY).y;
  const lineAtPullX = spreadSurfacePoint(surface, pull, pull.pullX, rowY).y;
  const distanceFromSelectedLine = motion.direction * (lineAtPullX - selectedLineAtPullX);
  const bend = (1 - surface.pullPointSpacing) * softPositive(
    motion.distance - distanceFromSelectedLine,
    Math.min(surface.lineGap * 0.16, motion.distance * 0.25),
  );
  const horizontalBend = x <= pull.pullX
    ? (pull.pullX <= 0 ? 1 : x / pull.pullX)
    : (pull.pullX >= surface.width ? 1 : (surface.width - x) / (surface.width - pull.pullX));
  return {
    x: point.x,
    y: point.y + motion.direction * (surface.pullPointSpacing * motion.distance + bend * horizontalBend),
  };
}

export function sampleLineXs(surface: Surface, pull: Pull | null): number[] {
  const count = Math.max(24, Math.ceil(surface.width / 28));
  const xs = Array.from({ length: count + 1 }, (_, i) => i * surface.width / count);
  if (pull) xs.push(pull.pullX);
  return [...new Set(xs)].sort((a, b) => a - b);
}

export function pointsPath(points: Point[], close = false): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
    .join(' ') + (close ? ' Z' : '');
}

// Intersect the pointer segment with the actual curved resting line, in CSS pixels.
export function crossingTimes(surface: Surface, from: Point, to: Point, rowY: number): number[] {
  const start = from.y - restingLineY(surface, from.x, rowY);
  const end = to.y - restingLineY(surface, to.x, rowY);
  const mid = (from.y + to.y) / 2 - restingLineY(surface, (from.x + to.x) / 2, rowY);
  const a = 2 * (start + end - 2 * mid);
  const b = end - start - a;
  const roots: number[] = [];
  if (Math.abs(a) < 1e-9) {
    if (Math.abs(b) > 1e-9) roots.push(-start / b);
  } else {
    const discriminant = b * b - 4 * a * start;
    if (discriminant >= 0) {
      const root = Math.sqrt(discriminant);
      roots.push((-b - root) / (2 * a), (-b + root) / (2 * a));
    }
  }
  return roots.filter(t => t > 1e-7 && t <= 1).sort((x, y) => x - y);
}

export function crossingTime(surface: Surface, from: Point, to: Point, rowY: number): number | null {
  return crossingTimes(surface, from, to, rowY)[0] ?? null;
}
