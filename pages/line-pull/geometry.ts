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
  lensStrength: number;
  horizontalLens: number;
  boundaryEase: number;
  boundaryCreep: number;
  apexSpacing: number;
}

export interface Pull {
  originY: number;
  apexX: number;
  apexY: number;
}

export function restY(surface: Surface, x: number, y: number): number {
  const nx = (x - surface.width / 2) / Math.max(surface.width / 2, 1);
  return surface.height / 2
    + (y - surface.height / 2) * (1 - surface.surfaceCurvature * nx * nx);
}

export function pullDelta(surface: Surface, pull: Pull): number {
  return pull.apexY - restY(surface, pull.apexX, pull.originY);
}

export function lensProgress(surface: Surface, pull: Pull): number {
  return -Math.expm1(-Math.abs(pullDelta(surface, pull)) / (surface.lineGap * 1.35));
}

export function surfacePoint(surface: Surface, pull: Pull | null, x: number, y: number): Point {
  if (!pull) return { x, y: restY(surface, x, y) };

  const direction = Math.sign(pullDelta(surface, pull));
  const strength = lensProgress(surface, pull);
  // Keep the lens anchored near the opening, rather than moving its falloff past it.
  const pivotY = restY(surface, x, pull.originY - direction * surface.lineGap * 2);
  const scale = 1 + surface.lensStrength * strength;
  return {
    x: pull.apexX + (x - pull.apexX) * (1 + surface.horizontalLens * strength),
    y: pivotY + (restY(surface, x, y) - pivotY) * scale,
  };
}

export function copyLayout(surface: Surface, pull: Pull, lineCount: number) {
  // Typography has its own centered lens: moving the pointer sideways must not
  // translate the copy, including indirectly through the surface's curvature.
  const x = surface.width / 2;
  const centeredPull = { ...pull, apexX: x };
  const strength = lensProgress(surface, centeredPull);
  const fontSize = Math.min(190, Math.max(64, surface.width * 0.205)) * (1 + 0.065 * strength);
  const lineHeight = fontSize * 0.83;
  return {
    x,
    y: surfacePoint(surface, centeredPull, x, pull.originY).y
      + Math.sign(pullDelta(surface, centeredPull)) * fontSize * 0.4
      - (lineCount - 1) * lineHeight / 2,
    fontSize,
    lineHeight,
    scaleX: 1 + 0.12 * strength,
  };
}

function opening(surface: Surface, pull: Pull) {
  const delta = pullDelta(surface, pull);
  const direction = Math.sign(delta);
  const travel = Math.abs(delta);
  const origin = surfacePoint(surface, pull, pull.apexX, pull.originY).y;
  return {
    direction,
    travel,
    distance: Math.max(0, direction * (pull.apexY - origin)),
    creep: surface.lineGap * surface.boundaryCreep * Math.log1p(travel / surface.lineGap),
  };
}

export function boundaryPoint(surface: Surface, pull: Pull, x: number): Point {
  const motion = opening(surface, pull);
  const origin = surfacePoint(surface, pull, x, pull.originY);
  const neighbor = surfacePoint(surface, pull, x, pull.originY - motion.direction * surface.lineGap);
  const progress = -Math.expm1(-motion.travel / (surface.lineGap * surface.boundaryEase));
  const strength = lensProgress(surface, pull);
  const halfWidth = Math.max(surface.width / 2, 1);
  const nx = (x - surface.width / 2) / halfWidth;
  const slope = -2 * (pull.originY - motion.direction * surface.lineGap - surface.height / 2)
    * surface.surfaceCurvature * nx / halfWidth
    * (1 + surface.lensStrength * strength) / (1 + surface.horizontalLens * strength);
  // Adjacent stroke edges meet; their centerlines stay one stroke width apart.
  // Account for the curved neighbor's slope in rendered (CSS pixel) coordinates.
  const separation = surface.lineWidth * Math.hypot(1, slope);
  return {
    x: origin.x,
    y: origin.y + (neighbor.y + motion.direction * separation - origin.y) * progress
      - motion.direction * motion.creep,
  };
}

// A C1 hinge: a newly reached line acquires its bend continuously, including on reversal.
function softPositive(value: number, radius: number): number {
  if (radius <= 0 || value >= radius) return Math.max(0, value);
  if (value <= -radius) return 0;
  return (value + radius) ** 2 / (4 * radius);
}

export function linePoint(surface: Surface, pull: Pull | null, baseY: number, x: number): Point {
  const point = surfacePoint(surface, pull, x, baseY);
  if (!pull) return point;
  const motion = opening(surface, pull);
  const offset = motion.direction * (baseY - pull.originY);

  if (offset < -0.001) {
    return { x: point.x, y: point.y - motion.direction * motion.creep };
  }

  const originAtTip = surfacePoint(surface, pull, pull.apexX, pull.originY).y;
  const lineAtTip = surfacePoint(surface, pull, pull.apexX, baseY).y;
  const distanceFromOrigin = motion.direction * (lineAtTip - originAtTip);
  const bend = (1 - surface.apexSpacing) * softPositive(
    motion.distance - distanceFromOrigin,
    Math.min(surface.lineGap * 0.16, motion.distance * 0.25),
  );
  const tent = x <= pull.apexX
    ? (pull.apexX <= 0 ? 1 : x / pull.apexX)
    : (pull.apexX >= surface.width ? 1 : (surface.width - x) / (surface.width - pull.apexX));
  return {
    x: point.x,
    y: point.y + motion.direction * (surface.apexSpacing * motion.distance + bend * tent),
  };
}

export function sampleXs(surface: Surface, pull: Pull | null): number[] {
  const count = Math.max(24, Math.ceil(surface.width / 28));
  const xs = Array.from({ length: count + 1 }, (_, i) => i * surface.width / count);
  if (pull) xs.push(pull.apexX);
  return [...new Set(xs)].sort((a, b) => a - b);
}

export function pointsPath(points: Point[], close = false): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
    .join(' ') + (close ? ' Z' : '');
}

// Intersect the pointer segment with the actual curved resting line, in CSS pixels.
export function crossingTime(surface: Surface, from: Point, to: Point, baseY: number): number | null {
  const start = from.y - restY(surface, from.x, baseY);
  const end = to.y - restY(surface, to.x, baseY);
  const mid = (from.y + to.y) / 2 - restY(surface, (from.x + to.x) / 2, baseY);
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
  return roots.filter(t => t > 1e-7 && t <= 1).sort((x, y) => x - y)[0] ?? null;
}
