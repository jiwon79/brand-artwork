import type { PenPath } from './pen-geometry';

export type Vec3 = [number, number, number];
export interface TubePoint { center: Vec3; radius: number; distance: number }
export interface TubePath { points: TubePoint[]; length: number }
export interface TubeFrame { tangent: Vec3; normal: Vec3 }
interface DepthRamp { start: number; end: number; height: number }
interface Contact { earlier: Segment; later: Segment; before: number; after: number; clearance: number }
interface Segment { a: TubePoint; b: TubePoint; path: number; group: number; offset: number; index: number }
export const TUBE_SCALE = .001;
export const TUBE_SIDES = 48;
// A sculptural tube is fuller than the 2D nib. Apply this before depth layout
// so crossing clearance and framing reserve the actual 150% tube diameter.
export const TUBE_RADIUS_SCALE = 2;
export const TUBE_DOT_RADIUS_SCALE = 1.5;
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const subtract = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const multiply = (v: Vec3, scale: number): Vec3 => [v[0] * scale, v[1] * scale, v[2] * scale];
export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const unit = (v: Vec3): Vec3 => multiply(v, 1 / (Math.hypot(...v) || 1));
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

const smoothStep = (t: number) => { const u = Math.max(0, Math.min(1, t)); return u * u * u * (u * (u * 6 - 15) + 10); };

/** Closest positions on two XY segments, including parallel stem returns. */
function proximity(a: TubePoint, b: TubePoint, u: TubePoint, v: TubePoint) {
  const dx = b.center[0] - a.center[0], dy = b.center[1] - a.center[1];
  const ex = v.center[0] - u.center[0], ey = v.center[1] - u.center[1];
  const px = u.center[0] - a.center[0], py = u.center[1] - a.center[1], determinant = dx * ey - dy * ex;
  const candidates: [number, number][] = [];
  if (Math.abs(determinant) > 1e-12) {
    const t = (px * ey - py * ex) / determinant, s = (px * dy - py * dx) / determinant;
    if (t >= 0 && t <= 1 && s >= 0 && s <= 1) candidates.push([t, s]);
  }
  const clamp = (t: number) => Math.max(0, Math.min(1, t));
  candidates.push([0, clamp((-px * ex - py * ey) / (ex * ex + ey * ey || 1))],
    [1, clamp(((dx - px) * ex + (dy - py) * ey) / (ex * ex + ey * ey || 1))],
    [clamp((px * dx + py * dy) / (dx * dx + dy * dy || 1)), 0],
    [clamp(((px + ex) * dx + (py + ey) * dy) / (dx * dx + dy * dy || 1)), 1]);
  return candidates.map(([t, s]) => ({ t, s, distance: Math.hypot(dx * t - px - ex * s, dy * t - py - ey * s) }))
    .sort((a, b) => a.distance - b.distance)[0];
}

/** Lay out depth over complete connected writing runs. Each separation adds a
 * broad monotone ramp, never a local bump that goes up and back down. All
 * relaxed XY coordinates and authored playback distances stay fixed. Later ramps
 * cannot undo clearance already established between two earlier positions.
 */
export function createTubePaths(pens: readonly PenPath[], origin: readonly [number, number]): TubePath[] {
  const paths: TubePath[] = pens.map(pen => ({ length: pen.length, points: pen.points.map(p => ({
    center: [(p.x - origin[0]) * TUBE_SCALE, (origin[1] - p.y) * TUBE_SCALE, 0],
    radius: p.radius * TUBE_SCALE * (pen.length <= .1 ? TUBE_DOT_RADIUS_SCALE : TUBE_RADIUS_SCALE), distance: p.distance,
  })) }));
  softenTubeCenters(paths, pens);
  const groups: { ramps: DepthRamp[]; offset: number; length: number }[] = [];
  const owners = paths.map((path, index) => {
    const previous = paths[index - 1], from = previous?.points[previous.points.length - 1], to = path.points[0];
    const joined = from && to && !pens[index].retrace && !pens[index - 1].retrace && previous.length > .1 && path.length > .1 && Math.hypot(...subtract(from.center, to.center)) < TUBE_SCALE;
    if (!joined) groups.push({ ramps: [], offset: 0, length: 0 });
    const group = groups.length - 1, offset = groups[group].length;
    groups[group].length += path.length;
    return { group, offset };
  });
  const contacts: Contact[] = [], grid = new Map<string, Segment[]>(), cellSize = .2;
  for (const [pathIndex, path] of paths.entries()) {
    if (pens[pathIndex].retrace || path.length <= .1) continue;
    for (let i = 1; i < path.points.length; i++) {
      const a = path.points[i - 1], b = path.points[i], segment: Segment = { a, b, path: pathIndex, ...owners[pathIndex], index: i };
      const reach = Math.max(a.radius, b.radius) * 3.3, keys: string[] = [];
      for (let x = Math.floor((Math.min(a.center[0], b.center[0]) - reach) / cellSize); x <= Math.floor((Math.max(a.center[0], b.center[0]) + reach) / cellSize); x++) {
        for (let y = Math.floor((Math.min(a.center[1], b.center[1]) - reach) / cellSize); y <= Math.floor((Math.max(a.center[1], b.center[1]) + reach) / cellSize); y++) keys.push(`${x},${y}`);
      }
      for (const earlier of new Set(keys.flatMap(key => grid.get(key) ?? []))) {
        if (earlier.path === pathIndex && i - earlier.index < 4) continue;
        const near = proximity(a, b, earlier.a, earlier.b);
        const radius = Math.max(a.radius, b.radius, earlier.a.radius, earlier.b.radius);
        const separation = radius * 3.3; // Includes the maximum 150% diameter.
        if (near.distance >= separation) continue;
        const after = segment.offset + a.distance + (b.distance - a.distance) * near.t;
        const before = earlier.offset + earlier.a.distance + (earlier.b.distance - earlier.a.distance) * near.s;
        // Nearby points belong to the same bend, not two crossing cylinders.
        if (earlier.group === segment.group && after - before < radius / TUBE_SCALE * 6) continue;
        contacts.push({ earlier, later: segment, before, after, clearance: Math.sqrt(separation * separation - near.distance * near.distance) });
      }
      for (const key of keys) { const values = grid.get(key) ?? []; values.push(segment); grid.set(key, values); }
    }
  }
  const elevation = (group: number, distance: number) => groups[group].ramps.reduce((height, ramp) =>
    height + ramp.height * smoothStep((distance - ramp.start) / (ramp.end - ramp.start)), groups[group].offset);
  // Finish each connected body's smooth profile before positioning pen-lifted
  // strokes, so a crossbar follows the actual height of the stems beneath it.
  for (const contact of contacts) {
    const { earlier, later, before, after, clearance } = contact;
    if (earlier.group !== later.group) continue;
    const deficit = clearance - (elevation(later.group, after) - elevation(earlier.group, before));
    if (deficit <= .0001) continue;
    const padding = Math.max(180, (after - before) * .6), start = before - padding, end = after + padding;
    const difference = smoothStep((after - start) / (end - start)) - smoothStep((before - start) / (end - start));
    groups[later.group].ramps.push({ start, end, height: deficit / difference });
  }
  for (const contact of contacts) {
    const { earlier, later, before, after, clearance } = contact;
    if (earlier.group === later.group) continue;
    const deficit = elevation(earlier.group, before) + clearance - elevation(later.group, after);
    if (deficit > 0) groups[later.group].offset += deficit;
  }
  for (const [index, path] of paths.entries()) {
    const owner = owners[index];
    for (const point of path.points) point.center[2] = elevation(owner.group, owner.offset + point.distance);
  }
  // Deferred dots sit at their own letter's depth, not the word's final depth.
  for (const [index, path] of paths.entries()) if (path.length <= .1 && path.points.length) {
    const anchor = pens[index].colorAnchors?.[0];
    const target = anchor ? [(anchor[0] - origin[0]) * TUBE_SCALE, (origin[1] - anchor[1]) * TUBE_SCALE] : path.points[0].center;
    let closest = Infinity, depth = 0;
    for (const [bodyIndex, body] of paths.entries()) if (body.length > .1 && !pens[bodyIndex].colorAnchors) {
      for (const point of body.points) {
        const distance = Math.hypot(point.center[0] - target[0], point.center[1] - target[1]);
        if (distance <= closest) { closest = distance; depth = point.center[2]; }
      }
    }
    for (const point of path.points) point.center[2] = depth;
  }
  return paths;
}

/** Relax the 3D sweep over a fixed arc neighborhood, retaining the authored
 * playback parameter. This broadens short curvature spikes for fuller tubes;
 * the 2D pen geometry is never modified. Joined bodies use one shared filter. */
function softenTubeCenters(paths: readonly TubePath[], pens: readonly PenPath[]) {
  for (let first = 0; first < paths.length;) {
    let last = first;
    const points = [...paths[first].points], offsets = [0];
    while (last + 1 < paths.length && !pens[last].retrace && !pens[last + 1].retrace &&
      paths[last].length > .1 && paths[last + 1].length > .1 &&
      Math.hypot(...subtract(points[points.length - 1].center, paths[last + 1].points[0].center)) < 1e-6) {
      offsets.push(points.length - 1); points.push(...paths[++last].points.slice(1));
    }
    if (points.length < 3 || paths[first].length <= .1 || pens[first].retrace) { first = last + 1; continue; }
    const distance = [0];
    for (let i = 1; i < points.length; i++) distance[i] = distance[i - 1] + Math.hypot(...subtract(points[i].center, points[i - 1].center));
    const closed = Math.hypot(...subtract(points[0].center, points[points.length - 1].center)) < 1e-8;
    const length = distance[distance.length - 1];
    const sample = (at: number): Vec3 => {
      if (closed && length > 0) at = ((at % length) + length) % length;
      let low = 0, high = points.length - 1;
      if (at <= 0) high = 1;
      else if (at >= distance[high]) low = high - 1;
      else while (low + 1 < high) { const middle = (low + high) >>> 1; if (distance[middle] < at) low = middle; else high = middle; }
      const t = (at - distance[low]) / (distance[high] - distance[low] || 1);
      return add(points[low].center, multiply(subtract(points[high].center, points[low].center), t));
    };
    const sigma = .07, step = sigma / 5;
    const smooth = points.map((_, i): Vec3 => {
      let total = 0, center: Vec3 = [0, 0, 0];
      for (let k = -15; k <= 15; k++) {
        const weight = Math.exp(-.5 * (k / 5) ** 2);
        center = add(center, multiply(sample(distance[i] + k * step), weight)); total += weight;
      }
      return multiply(center, 1 / total);
    });
    for (let i = first; i <= last; i++) for (let j = 0; j < paths[i].points.length; j++) {
      paths[i].points[j].center = [...smooth[offsets[i - first] + j]];
    }
    first = last + 1;
  }
}

export function sampleTube(path: TubePath, distance: number): { point: TubePoint; segment: number; fraction: number } {
  const at = Math.max(0, Math.min(path.length, distance));
  let low = 0, high = path.points.length - 1;
  while (low + 1 < high) { const middle = (low + high) >>> 1; if (path.points[middle].distance < at) low = middle; else high = middle; }
  const a = path.points[low], b = path.points[high] ?? a;
  const fraction = (at - a.distance) / (b.distance - a.distance || 1);
  return { segment: low, fraction, point: {
    center: add(a.center, multiply(subtract(b.center, a.center), fraction)),
    radius: a.radius + (b.radius - a.radius) * fraction, distance: at,
  } };
}

export function tubeTangent(path: TubePath, index: number): Vec3 {
  const points = path.points, p = points[index];
  const before = index > 0 ? unit(subtract(p.center, points[index - 1].center)) : undefined;
  const after = index + 1 < points.length ? unit(subtract(points[index + 1].center, p.center)) : undefined;
  if (!before) return after ?? [1, 0, 0];
  if (!after) return before;
  const average = add(before, after);
  return Math.hypot(...average) < 1e-8 ? after : unit(average);
}

/** Parallel transport prevents rings from flipping when a return approaches
 * the depth axis. A world-up frame would suddenly roll through half a turn. */
function transportNormal(normal: Vec3, from: Vec3, to: Vec3): Vec3 {
  const axis = cross(from, to), cosine = dot(from, to);
  const rotated = cosine < -.999999 ? normal : add(add(normal, cross(axis, normal)), multiply(cross(axis, cross(axis, normal)), 1 / (1 + cosine)));
  return unit(subtract(rotated, multiply(to, dot(rotated, to))));
}

export function createTubeFrames(paths: readonly TubePath[]): TubeFrame[][] {
  const result: TubeFrame[][] = paths.map(() => []);
  for (let first = 0; first < paths.length;) {
    let last = first;
    const points = [...paths[first].points], offsets = [0];
    while (last + 1 < paths.length && paths[last].length > .1 && paths[last + 1].length > .1 &&
      Math.hypot(...subtract(points[points.length - 1].center, paths[last + 1].points[0].center)) < 1e-6) {
      offsets.push(points.length - 1); points.push(...paths[++last].points.slice(1));
    }
    const run = { points, length: 0 };
    const frames = points.map((_, i): TubeFrame => ({ tangent: tubeTangent(run, i), normal: [0, 0, 1] }));
    for (const [i, frame] of frames.entries()) {
      frame.normal = i ? transportNormal(frames[i - 1].normal, frames[i - 1].tangent, frame.tangent) :
        unit(cross(Math.abs(frame.tangent[2]) < .9 ? [0, 0, 1] : [0, 1, 0], frame.tangent));
    }
    for (let i = first; i <= last; i++) result[i] = frames.slice(offsets[i - first], offsets[i - first] + paths[i].points.length);
    first = last + 1;
  }
  return result;
}

export function interpolateTubeFrame(a: TubeFrame, b: TubeFrame, fraction: number): TubeFrame {
  const tangent = unit(add(multiply(a.tangent, 1 - fraction), multiply(b.tangent, fraction)));
  return { tangent, normal: transportNormal(a.normal, a.tangent, tangent) };
}

export function tubeRing(point: TubePoint, tangent: Vec3, weight: number, sides = TUBE_SIDES, frameNormal?: Vec3) {
  const normal = frameNormal ?? unit(cross(Math.abs(tangent[2]) < .9 ? [0, 0, 1] : [0, 1, 0], tangent));
  const binormal = unit(cross(tangent, normal));
  return Array.from({ length: sides + 1 }, (_, i) => {
    const angle = i / sides * Math.PI * 2, radial = add(multiply(normal, Math.cos(angle)), multiply(binormal, Math.sin(angle)));
    return { position: add(point.center, multiply(radial, point.radius * weight)), normal: radial };
  });
}
