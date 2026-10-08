import { expect, test } from 'vitest';
import { composeText } from './lettering';
import { penGeometry, preparePen, type PenPath } from './pen-geometry';
import { reverseStroke, routeWord } from './pen-routing';
import type { PenStroke, Point } from './stroke-alphabet';
import { catalog, foregroundIoU, raster, shaper } from './test-font';

const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const ink = (strokes: PenStroke[]) => strokes.map(stroke => `<path d="${penGeometry(preparePen(stroke))}"/>`).join('');
const endPoint = (pen: PenPath) => pen.points[pen.points.length - 1];
function head(pens: PenPath[], written: number): Point {
  for (const pen of pens) {
    if (written > pen.length) { written -= pen.length; continue; }
    for (let i = 1; i < pen.points.length; i++) {
      const a = pen.points[i - 1], b = pen.points[i];
      if (b.distance < written) continue;
      const t = (written - a.distance) / (b.distance - a.distance || 1);
      return [a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t];
    }
    const end = pen.points[pen.points.length - 1]; return [end.x, end.y];
  }
  const end = endPoint(pens[pens.length - 1]); return [end.x, end.y];
}

test('reversing a cubic reverses its width profile and retains the ink shape', () => {
  const stroke: PenStroke = { d: 'M0 0 C20 0 50 30 50 60 C50 80 20 100 0 100', widths: [[10, 20, 25, 15], [15, 10, 15, 20]] };
  const reversed = reverseStroke(stroke);
  expect(reversed.widths).toEqual([[20, 15, 10, 15], [15, 25, 20, 10]]);
  expect(reverseStroke(reversed)).toEqual(stroke);
  const bounds = [-20, -20, 80, 120] as const;
  expect(foregroundIoU(raster(ink([stroke]), bounds, 2), raster(ink([reversed]), bounds, 2))).toBeGreaterThan(.999);
});

test('the joining branch is written before a loop and retraced before the exit', () => {
  const entry = { d: 'M0 0 C10 0 20 10 30 20', width: 10 };
  // The forward loop turns left; reversing it continues the incoming diagonal.
  const loop = { d: 'M40 40 C0 60 40 100 70 80 C100 60 60 50 40 40', width: 10 };
  const join = { d: 'M30 20 C33 26 37 34 40 40', width: 10 };
  const exit = { d: 'M30 20 C40 10 50 0 60 0', width: 10 };
  const routed = routeWord([[entry, loop, join, exit]]);
  expect(routed).toEqual([entry, join, reverseStroke(loop), { ...reverseStroke(join), retrace: true }, exit]);
  const pens = routed.map(preparePen);
  for (let i = 1; i < pens.length; i++) {
    const a = endPoint(pens[i - 1]), b = pens[i].points[0];
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(.01);
  }
  // Moving back over a written branch has duration but never paints it twice.
  expect(pens[3].length).toBeGreaterThan(0);
  expect(penGeometry(pens[3], pens[3].length / 2)).toBe('');
});

test('a glyph handoff stays within the existing overlapping caps', () => {
  const left: PenStroke = { d: 'M0 0 C10 0 20 0 30 0', width: 20 };
  const right: PenStroke = { d: 'M40 0 C50 0 60 20 60 40', width: 16 };
  const routed = routeWord([[left], [right]]);
  expect(routed).toHaveLength(3);
  const bounds = [-15, -15, 80, 60] as const;
  // Separate SVG fills composite their antialiased fringes. Check that
  // tolerance here, then verify actual disc containment independently below.
  expect(foregroundIoU(raster(ink([left, right]), bounds, 2), raster(ink(routed), bounds, 2))).toBeGreaterThan(.99);
  const bridge = preparePen(routed[1]);
  for (const p of bridge.points) {
    expect(Math.min(Math.hypot(p.x - 30, p.y) + p.radius - 10, Math.hypot(p.x - 40, p.y) + p.radius - 8)).toBeLessThan(.05);
  }
});

test('separate ink components retain a real pen lift', () => {
  const left = { d: 'M0 0 L20 0', width: 10 }, right = { d: 'M100 0 L120 0', width: 10 };
  expect(routeWord([[left], [right]])).toEqual([left, right]);
});

for (const text of ['hello', 'he', 'el', 'll', 'spell', 'letter', 'all', 'well', 'bell', 'ell', 'elle']) test(`the pen stays continuous at every 60 fps step: ${text}`, () => {
  const pens = composeText(text, shaper, catalog).strokes.map(preparePen);
  for (let i = 1; i < pens.length; i++) {
    const a = endPoint(pens[i - 1]), b = pens[i].points[0];
    expect(Math.hypot(a.x - b.x, a.y - b.y), `stroke boundary ${i}`).toBeLessThan(.01);
  }
  const total = pens.reduce((sum, pen) => sum + pen.length, 0);
  const frames = Math.round(Math.max(4, Math.min(60, Math.round(total / 1750 * 2) / 2)) * 60);
  let previous = head(pens, 0);
  for (let frame = 1; frame <= frames; frame++) {
    const current = head(pens, total * frame / frames);
    // A head cannot move farther than its traveled arc length. This catches
    // an endpoint teleport even when the two round caps hide the ink gap.
    expect(distance(current, previous), `frame ${frame}/${frames}`).toBeLessThanOrEqual(total / frames + .01);
    previous = current;
  }
});

test('both hello l loops ascend diagonally from the incoming he/hel join', () => {
  const strokes = composeText('hello', shaper, catalog).strokes;
  let loops = 0;
  for (let i = 1; i < strokes.length; i++) {
    const pen = preparePen(strokes[i]), start = pen.points[0], end = endPoint(pen);
    if (strokes[i].retrace || pen.length < 1500 || Math.hypot(start.x - end.x, start.y - end.y) > .01) continue;
    const after = head([pen], 3), beforePen = preparePen(strokes[i - 1]), before = head([beforePen], beforePen.length - 3);
    expect(after[0]).toBeGreaterThan(start.x);
    expect(after[1]).toBeLessThan(start.y);
    const arriving: Point = [start.x - before[0], start.y - before[1]], leaving: Point = [after[0] - start.x, after[1] - start.y];
    expect((arriving[0] * leaving[0] + arriving[1] * leaving[1]) / (Math.hypot(...arriving) * Math.hypot(...leaving))).toBeGreaterThan(.8);
    loops++;
  }
  expect(loops).toBe(2);
});
