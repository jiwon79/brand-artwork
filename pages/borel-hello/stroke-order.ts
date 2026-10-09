import type { PenPath, PenPoint } from './pen-geometry';
import type { PenPlayback } from './pen-playback';
import type { FontCatalog, TextShaper } from './lettering';

export interface OrderStep {
  index: number;
  stroke: number;
  kind: 'ink' | 'dot' | 'retrace' | 'lift';
  start: number;
  end: number;
  from: number;
  to: number;
  d: string;
  color: string;
  arrow: { x: number; y: number; angle: number };
  label: { x: number; y: number };
}

export function pointAt(pen: PenPath, distance: number): PenPoint {
  if (!pen.points.length) return { x: 0, y: 0, radius: 0, distance: 0 };
  let low = 0, high = pen.points.length - 1;
  const at = Math.max(0, Math.min(pen.length, distance));
  while (low + 1 < high) {
    const middle = (low + high) >>> 1;
    if (pen.points[middle].distance < at) low = middle; else high = middle;
  }
  const a = pen.points[low], b = pen.points[high], t = (at - a.distance) / (b.distance - a.distance || 1);
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, radius: a.radius + (b.radius - a.radius) * t, distance: at };
}

const xy = (point: { x: number; y: number }) => `${+point.x.toFixed(3)} ${+point.y.toFixed(3)}`;

/** Segment the actual playback by arc length, not by tiny fitted cubics.
 * Numbers identify inspection intervals, not invented pen lifts or strokes. */
export function createStrokeOrder(playback: PenPlayback): OrderStep[] {
  const steps: OrderStep[] = [], spacing = Math.max(300, playback.strokes.reduce((sum, stroke) => sum + stroke.pen.length, 0) / 180);
  const add = (stroke: number, kind: OrderStep['kind'], start: number, end: number, pen: PenPath, from: number, to: number) => {
    const a = pointAt(pen, from), b = pointAt(pen, to), middle = pointAt(pen, (from + to) / 2);
    const before = pointAt(pen, (from + to) / 2 - 8), after = pointAt(pen, (from + to) / 2 + 8);
    const angle = Math.atan2(after.y - before.y, after.x - before.x);
    const points = [a, ...pen.points.filter(point => point.distance > from && point.distance < to), b];
    let label = { x: middle.x - Math.sin(angle) * 80, y: middle.y + Math.cos(angle) * 80 };
    for (let attempt = 0; attempt < 5 && steps.some(step => Math.hypot(step.label.x - label.x, step.label.y - label.y) < 90); attempt++) {
      const offset = (attempt % 2 ? -1 : 1) * (110 + attempt * 30);
      label = { x: middle.x - Math.sin(angle) * offset, y: middle.y + Math.cos(angle) * offset };
    }
    steps.push({ index: steps.length, stroke, kind, start, end, from, to, color: '',
      d: points.map((point, i) => `${i ? 'L' : 'M'}${xy(point)}`).join(''),
      arrow: { x: middle.x, y: middle.y, angle }, label });
  };
  playback.strokes.forEach((timed, index) => {
    const previous = playback.strokes[index - 1];
    if (previous && timed.start > previous.end) {
      const a = pointAt(previous.pen, previous.pen.length), b = pointAt(timed.pen, 0), length = Math.hypot(b.x - a.x, b.y - a.y);
      const pen = { points: [{ ...a, distance: 0 }, { ...b, distance: length }], length, nibScale: [1, 1] as [number, number] };
      add(index, 'lift', previous.end, timed.start, pen, 0, length);
    }
    const count = Math.max(1, Math.ceil(timed.pen.length / spacing));
    for (let i = 0; i < count; i++) add(index, timed.pen.retrace ? 'retrace' : timed.dot ? 'dot' : 'ink',
      timed.start + (timed.end - timed.start) * i / count, timed.start + (timed.end - timed.start) * (i + 1) / count,
      timed.pen, timed.pen.length * i / count, timed.pen.length * (i + 1) / count);
  });
  steps.forEach((step, index) => { step.color = `hsl(${Math.round(225 - 215 * index / Math.max(1, steps.length - 1))} 72% 38%)`; });
  return steps;
}

export function activeOrderStep(steps: readonly OrderStep[], time: number): number {
  const index = steps.findIndex(step => time < step.end);
  return index < 0 ? steps.length - 1 : index;
}

export function orderTip(playback: PenPlayback, step: OrderStep, time: number) {
  const t = Math.max(0, Math.min(1, (time - step.start) / (step.end - step.start || 1)));
  if (step.kind === 'lift') {
    const a = pointAt(playback.strokes[step.stroke - 1].pen, playback.strokes[step.stroke - 1].pen.length);
    const b = pointAt(playback.strokes[step.stroke].pen, 0);
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }
  return pointAt(playback.strokes[step.stroke].pen, step.from + (step.to - step.from) * t);
}

/** Find real shaping witnesses for every form of the selected letter. */
export function letterContexts(letter: string, shaper: TextShaper, catalog: FontCatalog) {
  const found = new Map<number, { id: number; name: string; text: string }>();
  const add = (text: string) => {
    for (const glyph of shaper.shape(text)) {
      const name = catalog.glyphs[glyph.id].name;
      if (name.split('.')[0] === letter && !found.has(glyph.id)) found.set(glyph.id, { id: glyph.id, name, text });
    }
  };
  add(letter);
  const lower = 'abcdefghijklmnopqrstuvwxyz';
  for (const next of lower) add(letter + next);
  for (const previous of lower) add(previous + letter);
  for (const previous of lower) for (const next of lower) add(previous + letter + next);
  return [...found.values()];
}
