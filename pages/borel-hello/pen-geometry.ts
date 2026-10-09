import type { PenStroke, Point } from './stroke-alphabet';

export interface PenPoint { x: number; y: number; radius: number; distance: number }
export interface PenPath { points: PenPoint[]; length: number; nibScale: Point; retrace?: boolean }

export function cubic(a: number, b: number, c: number, d: number, t: number): number {
  const s = 1 - t;
  return s * s * s * a + 3 * s * s * t * b + 3 * s * t * t * c + t * t * t * d;
}

/** Compile editable cubic center paths and cubic brush-width controls. */
export function preparePen(stroke: PenStroke): PenPath {
  const commands = stroke.d.match(/[MLC][^MLC]*/g) ?? [];
  const points: PenPoint[] = [];
  let start: Point = [0, 0], curveIndex = 0, distance = 0;
  for (const command of commands) {
    const values = (command.slice(1).match(/[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi) ?? []).map(Number);
    if (command[0] === 'M') { start = [values[0], values[1]]; continue; }
    const end: Point = [values[values.length - 2], values[values.length - 1]];
    const controls = command[0] === 'C' ? values : [
      start[0] + (end[0] - start[0]) / 3, start[1] + (end[1] - start[1]) / 3,
      start[0] + (end[0] - start[0]) * 2 / 3, start[1] + (end[1] - start[1]) * 2 / 3, ...end,
    ];
    const widths = stroke.widths?.[curveIndex] ?? [stroke.width ?? 90, stroke.width ?? 90, stroke.width ?? 90, stroke.width ?? 90];
    const sample = (t: number): PenPoint => ({
      x: cubic(start[0], controls[0], controls[2], end[0], t),
      y: cubic(start[1], controls[1], controls[3], end[1], t),
      radius: Math.max(.05, cubic(...widths, t) / 2), distance: 0,
    });
    const append = (point: PenPoint) => {
      const previous = points[points.length - 1];
      if (previous) distance += Math.hypot(point.x - previous.x, point.y - previous.y);
      points.push({ ...point, distance });
    };
    const subdivide = (t0: number, a: PenPoint, t1: number, b: PenPoint, depth: number) => {
      let error = 0;
      for (const fraction of [.25, .5, .75]) {
        const actual = sample(t0 + (t1 - t0) * fraction);
        error = Math.max(error, Math.hypot(actual.x - a.x - (b.x - a.x) * fraction, actual.y - a.y - (b.y - a.y) * fraction), Math.abs(actual.radius - a.radius - (b.radius - a.radius) * fraction));
      }
      // Bound even perfectly straight intervals. Extending one very long SVG
      // polygon can retessellate an old antialias fringe far behind the nib.
      // Short, completed capsules remain stable while only the tip advances.
      const span = Math.hypot(b.x - a.x, b.y - a.y);
      if (error <= .2 && span <= Math.max(8, Math.min(a.radius, b.radius)) || depth >= 14) { append(b); return; }
      const middle = (t0 + t1) / 2, midpoint = sample(middle);
      subdivide(t0, a, middle, midpoint, depth + 1);
      subdivide(middle, midpoint, t1, b, depth + 1);
    };
    const a = sample(0), b = sample(1);
    if (!points.length) append(a);
    subdivide(0, a, 1, b, 0);
    start = end; curveIndex++;
  }
  return { points, length: distance, nibScale: stroke.nibScale ?? [1, 1], retrace: stroke.retrace };
}

const number = (value: number) => Number(value.toFixed(3));
function disk(point: PenPoint, [sx, sy]: Point): string {
  const { x, y, radius: r } = point;
  const rx = r * sx, ry = r * sy;
  return `M${number(x+rx)} ${number(y)}A${number(rx)} ${number(ry)} 0 1 1 ${number(x-rx)} ${number(y)}A${number(rx)} ${number(ry)} 0 1 1 ${number(x+rx)} ${number(y)}Z`;
}

interface Tangent { rightA: Point; rightB: Point; leftA: Point; leftB: Point; slope: number }

/** Outer tangents between two brush discs, computed in nib coordinates. */
function tangent(a: PenPoint, b: PenPoint, [sx, sy]: Point): Tangent {
  const dx = (b.x - a.x) / sx, dy = (b.y - a.y) / sy;
  const length = Math.hypot(dx, dy);
  const slope = (b.radius - a.radius) / length;
  const tx = dx / length, ty = dy / length, k = Math.sqrt(1 - slope * slope);
  const right: Point = [-slope * tx + k * ty, -slope * ty - k * tx];
  const left: Point = [-slope * tx - k * ty, -slope * ty + k * tx];
  const at = (p: PenPoint, n: Point): Point => [p.x + p.radius * n[0] * sx, p.y + p.radius * n[1] * sy];
  return { rightA: at(a, right), rightB: at(b, right), leftA: at(a, left), leftB: at(b, left), slope };
}

const coordinates = ([x, y]: Point) => `${number(x)} ${number(y)}`;
function arc(center: PenPoint, from: Point, to: Point, scale: Point, large = false, sweep?: number): string {
  const cross = (from[0] - center.x) * (to[1] - center.y) - (from[1] - center.y) * (to[0] - center.x);
  return `A${number(center.radius * scale[0])} ${number(center.radius * scale[1])} 0 ${Number(large)} ${sweep ?? Number(cross > 0)} ${coordinates(to)}`;
}

/** Build a vector ribbon along the traveled Bézier center curve. Its boundary
 * follows brush tangents and round joins; it never samples a source image.
 */
export function penGeometry(pen: PenPath, written = pen.length, pressure = 1): string {
  if (pen.retrace || written <= 0 || pressure <= 0 || !pen.points.length) return '';
  if (pressure < 1) return penGeometry({ ...pen, points: pen.points.map(point => ({ ...point, radius: point.radius * pressure })) }, written);
  let d = disk(pen.points[0], pen.nibScale);
  for (let i = 1; i < pen.points.length; i++) {
    const a = pen.points[i - 1], sample = pen.points[i];
    if (a.distance >= written) break;
    const t = Math.min(1, (written - a.distance) / (sample.distance - a.distance || 1));
    const b = t === 1 ? sample : { x: a.x + (sample.x - a.x) * t, y: a.y + (sample.y - a.y) * t, radius: a.radius + (sample.radius - a.radius) * t, distance: written };
    // Each traveled interval contributes its own positively wound capsule.
    // A self-crossing outline can cancel old ink or expose a remote sliver as
    // the tip moves. Independent capsules form the union of the swept nib;
    // their completed prefix never changes when another interval is added.
    const separation = Math.hypot((b.x - a.x) / pen.nibScale[0], (b.y - a.y) / pen.nibScale[1]);
    if (separation <= Math.abs(b.radius - a.radius) + .000001) {
      d += disk(a.radius >= b.radius ? a : b, pen.nibScale);
    } else {
      const edge = tangent(a, b, pen.nibScale);
      d += `M${coordinates(edge.rightA)}L${coordinates(edge.rightB)}` +
        arc(b, edge.rightB, edge.leftB, pen.nibScale, edge.slope > 0, 1) +
        `L${coordinates(edge.leftA)}` +
        arc(a, edge.leftA, edge.rightA, pen.nibScale, edge.slope < 0, 1) + 'Z';
    }
    if (t < 1) break;
  }
  return d;
}
