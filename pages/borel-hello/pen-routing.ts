import type { PenStroke, Point } from './stroke-alphabet';

interface Curve { start: Point; controls: number[] }
interface Endpoint { point: Point; radius: number }
interface Edge { stroke: PenStroke; from: number; to: number; length: number; visited: boolean }
const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const coordinates = (point: Point) => point.map(value => Number(value.toFixed(3))).join(' ');

function direction(stroke: PenStroke, atEnd = false): Point {
  const segments = curves(stroke), curve = atEnd ? segments[segments.length - 1] : segments[0];
  const c = curve.controls;
  const anchor: Point = atEnd ? [c[4], c[5]] : curve.start;
  const candidates: Point[] = atEnd ? [[c[2], c[3]], [c[0], c[1]], curve.start] : [[c[0], c[1]], [c[2], c[3]], [c[4], c[5]]];
  const point = candidates.find(value => distance(value, anchor) > .001) ?? anchor;
  const sign = atEnd ? -1 : 1, length = distance(point, anchor) || 1;
  return [(point[0] - anchor[0]) * sign / length, (point[1] - anchor[1]) * sign / length];
}

function curves(stroke: PenStroke): Curve[] {
  let start: Point = [0, 0];
  const result: Curve[] = [];
  for (const command of stroke.d.match(/[MLC][^MLC]*/g) ?? []) {
    const values = (command.slice(1).match(/[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi) ?? []).map(Number);
    if (command[0] === 'M') { start = [values[0], values[1]]; continue; }
    const end: Point = [values[values.length - 2], values[values.length - 1]];
    const controls = command[0] === 'C' ? values : [
      start[0] + (end[0] - start[0]) / 3, start[1] + (end[1] - start[1]) / 3,
      start[0] + (end[0] - start[0]) * 2 / 3, start[1] + (end[1] - start[1]) * 2 / 3, ...end,
    ];
    result.push({ start, controls }); start = end;
  }
  return result;
}

function endpoints(stroke: PenStroke): [Endpoint, Endpoint] {
  const segments = curves(stroke), first = segments[0], last = segments[segments.length - 1];
  const scale = Math.min(...(stroke.nibScale ?? [1, 1]));
  return [
    { point: first.start, radius: (stroke.widths?.[0][0] ?? stroke.width ?? 90) / 2 * scale },
    { point: [last.controls[4], last.controls[5]], radius: (stroke.widths?.[segments.length - 1][3] ?? stroke.width ?? 90) / 2 * scale },
  ];
}

/** Reverse the same cubic geometry, including the brush-width controls. */
export function reverseStroke(stroke: PenStroke): PenStroke {
  const segments = curves(stroke).reverse();
  const last = segments[0].controls;
  return {
    ...stroke,
    d: `M${coordinates([last[4], last[5]])}` + segments.map(({ start, controls }) =>
      ` C${coordinates([controls[2], controls[3]])} ${coordinates([controls[0], controls[1]])} ${coordinates(start)}`,
    ).join(''),
    widths: stroke.widths?.slice().reverse().map(([a, b, c, d]) => [d, c, b, a]),
  };
}

/** Keep a smooth writing run in one cubic path, so internal joins are swept
 * by the same brush rather than rendered as independent round end caps.
 * A retrace or a deliberate pen lift still starts a separate run.
 */
export function joinPenStrokes(strokes: readonly PenStroke[]): PenStroke[] {
  const result: PenStroke[] = [];
  for (const stroke of strokes) {
    const previous = result[result.length - 1];
    if (previous?.widths && stroke.widths && !previous.retrace && !stroke.retrace &&
      String(previous.nibScale ?? [1, 1]) === String(stroke.nibScale ?? [1, 1])) {
      const [, a] = endpoints(previous), [b] = endpoints(stroke);
      const incoming = direction(previous, true), outgoing = direction(stroke);
      if (distance(a.point, b.point) < .01 && Math.abs(a.radius - b.radius) < .25 &&
        incoming[0] * outgoing[0] + incoming[1] * outgoing[1] > .97) {
        result[result.length - 1] = {
          ...previous, d: previous.d + stroke.d.replace(/^M[^LC]*/, ' '),
          widths: [...previous.widths, ...stroke.widths],
          ordered: previous.ordered || stroke.ordered,
        };
        continue;
      }
    }
    result.push(stroke);
  }
  return result;
}

/** A short pen handoff inside two overlapping brush caps. The radius narrows
 * enough that every intermediate disc fits inside one of the existing caps.
 * It therefore joins motion without adding a thick seam to the final form.
 */
function capJoin(a: Endpoint, b: Endpoint): PenStroke {
  const length = distance(a.point, b.point), change = b.radius - a.radius;
  const inset = 2 / 3 * (length + Math.abs(change));
  const [x, y] = a.point, [ex, ey] = b.point;
  return {
    d: `M${coordinates(a.point)} C${coordinates([x + (ex - x) / 3, y + (ey - y) / 3])} ${coordinates([x + (ex - x) * 2 / 3, y + (ey - y) * 2 / 3])} ${coordinates(b.point)}`,
    widths: [[a.radius * 2, (a.radius + change / 3 - inset) * 2, (a.radius + change * 2 / 3 - inset) * 2, b.radius * 2]],
  };
}

/** Preserve authored glyph sequences and join their entry/exit caps. Other
 * glyphs use graph traversal through their actual junctions. Keeping authored
 * runs out of that graph prevents reverse trips around completed loops.
 */
export function routeWord(glyphs: readonly (readonly PenStroke[])[]): PenStroke[] {
  if (!glyphs.some(glyph => glyph.some(stroke => stroke.ordered))) return routeGraph(glyphs);
  const result: PenStroke[] = [];
  let pending: (readonly PenStroke[])[] = [];
  const append = (strokes: readonly PenStroke[]) => {
    if (!strokes.length) return;
    if (result.length) {
      const [, a] = endpoints(result[result.length - 1]), [b] = endpoints(strokes[0]);
      const gap = distance(a.point, b.point);
      if (gap >= .01 && gap < a.radius + b.radius) result.push(capJoin(a, b));
    }
    result.push(...strokes);
  };
  const flush = () => { if (pending.length) append(routeGraph(pending)); pending = []; };
  for (const glyph of glyphs) {
    if (glyph.some(stroke => stroke.ordered)) { flush(); append(glyph); }
    else pending.push(glyph);
  }
  flush();
  return result;
}

function routeGraph(glyphs: readonly (readonly PenStroke[])[]): PenStroke[] {
  const nodes: Point[] = [], adjacent: number[][] = [], edges: Edge[] = [];
  const node = (point: Point) => {
    let id = nodes.findIndex(value => distance(value, point) < .01);
    if (id < 0) { id = nodes.length; nodes.push(point); adjacent.push([]); }
    return id;
  };
  const add = (stroke: PenStroke) => {
    const segments = curves(stroke);
    if (!segments.length) return;
    const [start, end] = endpoints(stroke), from = node(start.point), to = node(end.point);
    const length = segments.reduce((sum, { start, controls: c }) => sum +
      distance(start, [c[0], c[1]]) + distance([c[0], c[1]], [c[2], c[3]]) + distance([c[2], c[3]], [c[4], c[5]]), 0);
    const id = edges.length;
    edges.push({ stroke, from, to, length, visited: false });
    adjacent[from].push(id); if (from !== to) adjacent[to].push(id);
  };
  for (let i = 0; i < glyphs.length; i++) {
    glyphs[i].forEach(add);
    const next = glyphs[i + 1];
    if (!next?.length || !glyphs[i].length) continue;
    const left = glyphs[i].flatMap(endpoints), right = next.flatMap(endpoints);
    let pair: [Endpoint, Endpoint] | undefined, best = 1;
    for (const a of left) for (const b of right) {
      const ratio = distance(a.point, b.point) / (a.radius + b.radius);
      if (ratio < best) { pair = [a, b]; best = ratio; }
    }
    if (pair && distance(pair[0].point, pair[1].point) >= .01) add(capJoin(...pair));
  }
  if (!edges.length) return [];
  const result: PenStroke[] = [];
  let current = edges[0].from;
  let heading: Point | undefined;
  const travel = (id: number) => {
    const edge = edges[id];
    let stroke = edge.from === current ? edge.stroke : reverseStroke(edge.stroke);
    if (edge.from === edge.to && heading) {
      const reversed = reverseStroke(stroke), forward = direction(stroke), backward = direction(reversed);
      // At a cursive crossing, continue up the incoming diagonal before
      // returning down the stem, rather than turning into the stem first.
      if (backward[0] * heading[0] + backward[1] * heading[1] > forward[0] * heading[0] + forward[1] * heading[1]) stroke = reversed;
    }
    result.push(edge.visited ? { ...stroke, retrace: true } : stroke);
    heading = direction(stroke, true);
    edge.visited = true; current = edge.from === current ? edge.to : edge.from;
  };
  const reach = (target: Edge): number[] | undefined => {
    const costs = new Map([[current, 0]]), previous = new Map<number, [number, number]>();
    const queue = [{ id: current, cost: 0 }];
    while (queue.length) {
      queue.sort((a, b) => b.cost - a.cost);
      const here = queue.pop()!;
      if (here.cost !== costs.get(here.id)) continue;
      if (here.id === target.from || here.id === target.to) {
        const path: number[] = [];
        let at = here.id;
        while (at !== current) { const [before, edge] = previous.get(at)!; path.push(edge); at = before; }
        return path.reverse();
      }
      for (const id of adjacent[here.id]) {
        const edge = edges[id], next = edge.from === here.id ? edge.to : edge.from, cost = here.cost + edge.length;
        if (cost >= (costs.get(next) ?? Infinity)) continue;
        costs.set(next, cost); previous.set(next, [here.id, id]); queue.push({ id: next, cost });
      }
    }
    return undefined;
  };
  for (const [id, edge] of edges.entries()) {
    if (edge.visited) continue;
    if (current !== edge.from && current !== edge.to) {
      const path = reach(edge);
      if (path) path.forEach(travel); else { current = edge.from; heading = undefined; }
    }
    if (!edge.visited) travel(id);
  }
  return result;
}
