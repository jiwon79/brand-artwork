import { preparePen, type PenPath, type PenPoint } from './pen-geometry';
import type { PenStroke, Point } from './stroke-alphabet';
import type { Bounds } from './lettering';

export interface PenIssue {
  kind: 'width-bulge' | 'width-step' | 'tangent-break' | 'nib-collapse';
  stroke: number;
  /** Arc distance within the reported stroke, in font units. */
  distance: number;
  point: Point;
  /** Width ratio for width issues, degrees for tangent issues. */
  value: number;
}
export interface PenQualityLimits {
  bulgeRatio: number;
  widthStepRatio: number;
  turnDegrees: number;
  capRatio: number;
}
// These are review thresholds, not universal rules for writing a letter.
// Sharp capitals/symbols and intentional pressure changes require review.
const defaults: PenQualityLimits = { bulgeRatio: 1.25, widthStepRatio: 1.1, turnDegrees: 35, capRatio: .1 };
const separation = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const median = (values: number[]) => values.slice().sort((a, b) => a - b)[Math.floor(values.length / 2)];

/** Uniform arc sampling avoids giving densely subdivided sharp curves extra
 * weight. Pressure and angle limits are independent of font size and fps. */
export function samplePen(pen: PenPath, distance: number): PenPoint {
  let low = 0, high = pen.points.length - 1;
  const at = Math.max(0, Math.min(pen.length, distance));
  while (low + 1 < high) {
    const middle = (low + high) >>> 1;
    if (pen.points[middle].distance < at) low = middle; else high = middle;
  }
  const a = pen.points[low], b = pen.points[high];
  const t = (at - a.distance) / (b.distance - a.distance || 1);
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, radius: a.radius + (b.radius - a.radius) * t, distance: at };
}

/** A handwritten upright may reverse direction, but it must return over the
 * same stem. A large angle alone cannot distinguish that from a bad join. */
export function isLocalStemReturn(stroke: PenStroke, issue: PenIssue): boolean {
  if (issue.kind !== 'tangent-break' || issue.value < 150) return false;
  const pen = preparePen(stroke), radius = samplePen(pen, issue.distance).radius;
  return [.5, 1, 1.5].every(multiplier => {
    const span = radius * multiplier;
    if (issue.distance < span || issue.distance + span > pen.length) return false;
    const a = samplePen(pen, issue.distance - span), b = samplePen(pen, issue.distance + span);
    return Math.hypot(a.x - b.x, a.y - b.y) < radius * .6;
  });
}

interface Segment { start: Point; end: Point; incoming: Point; outgoing: Point; r0: number; r1: number; distance: number }
function segments(stroke: PenStroke): Segment[] {
  let start: Point = [0, 0], distance = 0;
  const result: Segment[] = [];
  for (const command of stroke.d.match(/[MLC][^MLC]*/g) ?? []) {
    const v = (command.slice(1).match(/[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi) ?? []).map(Number);
    if (command[0] === 'M') { start = [v[0], v[1]]; continue; }
    const end: Point = [v[v.length - 2], v[v.length - 1]];
    const c1: Point = command[0] === 'C' ? [v[0], v[1]] : end;
    const c2: Point = command[0] === 'C' ? [v[2], v[3]] : start;
    const forward = [c1, c2, end].find(p => separation(start, p) > 1e-8) ?? end;
    const backward = [c2, c1, start].find(p => separation(end, p) > 1e-8) ?? start;
    const widths = stroke.widths?.[result.length] ?? Array(4).fill(stroke.width ?? 90);
    result.push({ start, end, incoming: [forward[0] - start[0], forward[1] - start[1]],
      outgoing: [end[0] - backward[0], end[1] - backward[1]], r0: widths[0] / 2, r1: widths[3] / 2, distance });
    distance += preparePen({ d: `M${start.join(' ')} ${command}` }).length;
    start = end;
  }
  return result;
}

/** Candidates for human review. A large angle can be a valid corner or a
 * turnback; a large radius can be deliberate pressure. Only approved smooth
 * glyphs should use an empty issue list as a hard regression requirement. */
export function auditPen(strokes: readonly PenStroke[], limits: Partial<PenQualityLimits> = {}): PenIssue[] {
  const policy = { ...defaults, ...limits }, issues: PenIssue[] = [];
  const issue = (kind: PenIssue['kind'], stroke: number, distance: number, point: Point, value: number) =>
    issues.push({ kind, stroke, distance, point, value });
  let previous: Segment | undefined;
  let run: { pen: PenPath; stroke: number; offset: number }[] = [];
  const flush = () => {
    if (!run.length) return;
    const points = run.flatMap(({ pen, offset }, index) => pen.points.slice(index ? 1 : 0).map(p => ({ ...p, distance: p.distance + offset })));
    const pen: PenPath = { ...run[0].pen, points, length: points[points.length - 1].distance };
    const radius = median(points.map(p => p.radius)), step = Math.max(.001, radius / 5);
    const samples = Array.from({ length: Math.ceil(pen.length / step) + 1 }, (_, i) => samplePen(pen, Math.min(pen.length, i * step)));
    let lastPeak = -Infinity;
    for (let i = 1; i + 1 < samples.length; i++) {
      const p = samples[i];
      if (p.radius < samples[i - 1].radius || p.radius < samples[i + 1].radius ||
        p.radius === samples[i - 1].radius && p.radius === samples[i + 1].radius) continue;
      const shoulder = (sign: number) => {
        let minimum = Infinity;
        for (let j = i + sign; j >= 0 && j < samples.length; j += sign) {
          const span = Math.abs(samples[j].distance - p.distance);
          if (span > radius * 5) break;
          if (span >= radius) minimum = Math.min(minimum, samples[j].radius);
        }
        return minimum;
      };
      // Both shoulders must be thinner: do not flag a terminal taper or a
      // long, uniformly wider stem just because its nib differs from a loop.
      const ratio = p.radius / Math.max(shoulder(-1), shoulder(1));
      if (ratio > policy.bulgeRatio && p.distance - lastPeak > radius * 2) {
        const owner = run.find(({ pen, offset }) => p.distance <= offset + pen.length)!;
        issue('width-bulge', owner.stroke, p.distance - owner.offset, [p.x, p.y], ratio);
        lastPeak = p.distance;
      }
    }
    run = [];
  };
  for (const [strokeIndex, stroke] of strokes.entries()) {
    if (stroke.retrace) { flush(); previous = undefined; continue; }
    const pen = preparePen(stroke), parts = segments(stroke);
    if (!parts.length || !pen.points.length) continue;
    const nominalRadius = median(pen.points.map(point => point.radius));
    for (const point of [pen.points[0], pen.points[pen.points.length - 1]]) {
      if (point.radius < nominalRadius * policy.capRatio) {
        issue('nib-collapse', strokeIndex, point.distance, [point.x, point.y], nominalRadius / point.radius);
      }
    }
    if (previous && separation(previous.end, parts[0].start) > 1e-5) { flush(); previous = undefined; }
    run.push({ pen, stroke: strokeIndex, offset: run.length ? run[run.length - 1].offset + run[run.length - 1].pen.length : 0 });
    for (const part of parts) {
      if (previous) {
        const norm = Math.hypot(...previous.outgoing) * Math.hypot(...part.incoming);
        const dot = previous.outgoing[0] * part.incoming[0] + previous.outgoing[1] * part.incoming[1];
        const angle = norm ? Math.acos(Math.max(-1, Math.min(1, dot / norm))) * 180 / Math.PI : 0;
        if (angle > policy.turnDegrees) issue('tangent-break', strokeIndex, part.distance, part.start, angle);
        const ratio = Math.max(previous.r1, part.r0) / Math.max(1e-9, Math.min(previous.r1, part.r0));
        if (ratio > policy.widthStepRatio) issue('width-step', strokeIndex, part.distance, part.start, ratio);
      }
      previous = part;
    }
  }
  flush();
  return issues;
}

/** Independent frame oracle: newly painted pixels must lie near the nib's
 * traveled center path for this time interval. This checks the renderer,
 * whereas auditPen checks the trajectory/pressure that feeds the renderer. */
export function measureInkTravel(previous: Uint8Array, current: Uint8Array, bounds: Bounds,
  scale: number, pens: readonly PenPath[], from: number, to: number): { fraction: number; outsideAlpha: number; addedAlpha: number; maximumOutsideDelta: number } {
  if (previous.length !== current.length) throw new Error('Raster dimensions differ');
  const nibs: { point: PenPoint; scale: Point }[] = [];
  let offset = 0;
  for (const pen of pens) {
    const start = Math.max(0, from - offset), end = Math.min(pen.length, to - offset);
    if (!pen.retrace && pen.points.length && end > start) {
      const spacing = Math.max(.001, Math.min(...pen.points.map(p => p.radius)) / 4);
      const count = Math.max(1, Math.ceil((end - start) / spacing));
      for (let i = 0; i <= count; i++) nibs.push({ point: samplePen(pen, start + (end - start) * i / count), scale: pen.nibScale });
      // Uniform samples alone can miss the exact apex of an acute N/W turn.
      // Include the traveled vertices as well: the pen really visits them,
      // even when a whole corner falls between two regular arc samples.
      for (const point of pen.points) {
        if (point.distance > start && point.distance < end) nibs.push({ point, scale: pen.nibScale });
      }
    }
    offset += pen.length;
  }
  const width = Math.ceil((bounds[2] - bounds[0]) * scale), height = Math.ceil((bounds[3] - bounds[1]) * scale);
  // SVG's default xMidYMid meet uses a uniform scale plus letterboxing.
  const fit = Math.min(width / (bounds[2] - bounds[0]), height / (bounds[3] - bounds[1]));
  const insetX = (width - (bounds[2] - bounds[0]) * fit) / 2, insetY = (height - (bounds[3] - bounds[1]) * fit) / 2;
  const margin = 1 / fit;
  let outside = 0, added = 0, maximumOutsideDelta = 0;
  for (let i = 3; i < current.length; i += 4) {
    const delta = Math.max(0, current[i] - previous[i]);
    // Judge newly visible foreground. A few alpha levels changing along an
    // already present tessellation fringe are not a newly painted stroke.
    if (current[i] < 128 || previous[i] >= 128 || delta < 32) continue;
    const pixel = (i - 3) / 4, x = bounds[0] + (pixel % width + .5 - insetX) / fit, y = bounds[1] + (Math.floor(pixel / width) + .5 - insetY) / fit;
    const covered = nibs.some(nib => Math.hypot((x - nib.point.x) / nib.scale[0], (y - nib.point.y) / nib.scale[1]) <= nib.point.radius + margin);
    added += delta;
    if (!covered) { outside += delta; maximumOutsideDelta = Math.max(maximumOutsideDelta, delta); }
  }
  return { fraction: added ? outside / added : 0, outsideAlpha: outside, addedAlpha: added, maximumOutsideDelta };
}

/** Foreground outside the traveled nib footprint is a renderer regression. */
export function inkTravelPasses(result: ReturnType<typeof measureInkTravel>): boolean {
  return result.fraction < .002;
}

/** A round/elliptical nib must cover its interior even at a turnback or cap.
 * Compare actual ink with the mathematical nib footprint, without using the
 * renderer to construct its own expected silhouette. Ignore the one-pixel
 * antialias boundary. A truncated cap or a self-overlap hole is still counted. */
export function missingNibInterior(pixels: Uint8Array, bounds: Bounds, scale: number,
  point: PenPoint, nibScale: Point = [1, 1]): number {
  const width = Math.ceil((bounds[2] - bounds[0]) * scale), height = Math.ceil((bounds[3] - bounds[1]) * scale);
  const fit = Math.min(width / (bounds[2] - bounds[0]), height / (bounds[3] - bounds[1]));
  const insetX = (width - (bounds[2] - bounds[0]) * fit) / 2, insetY = (height - (bounds[3] - bounds[1]) * fit) / 2;
  const cx = (point.x - bounds[0]) * fit + insetX, cy = (point.y - bounds[1]) * fit + insetY;
  const rx = point.radius * nibScale[0] * fit - 1, ry = point.radius * nibScale[1] * fit - 1;
  if (rx <= 0 || ry <= 0) return 0; // Too small to judge independently of AA.
  let missing = 0, interior = 0;
  for (let y = Math.max(0, Math.floor(cy - ry)); y < Math.min(height, Math.ceil(cy + ry)); y++) {
    for (let x = Math.max(0, Math.floor(cx - rx)); x < Math.min(width, Math.ceil(cx + rx)); x++) {
      if (Math.hypot((x + .5 - cx) / rx, (y + .5 - cy) / ry) > 1) continue;
      interior++;
      if (pixels[(y * width + x) * 4 + 3] < 128) missing++;
    }
  }
  return interior ? missing / interior : 0;
}
