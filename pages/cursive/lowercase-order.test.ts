import { expect, test } from 'vitest';
import { composeText } from './lettering';
import { penGeometry, preparePen } from './pen-geometry';
import { routeWord } from './pen-routing';
import { catalog, raster, shaper, supportedGlyphWitnesses } from './test-font';
import { inkTravelPasses, measureInkTravel } from './test-pen-quality';
import type { PenStroke } from './stroke-alphabet';

const forms = [...supportedGlyphWitnesses()].filter(([id]) => /^[fdbxk](?:\.|$)/.test(catalog.glyphs[id].name));

test('all reachable f/d/b/x/k forms have compact authored writing runs', () => {
  expect(forms).toHaveLength(50);
  for (const [id] of forms) {
    const name = catalog.glyphs[id].name, strokes = catalog.penPaths![id];
    const body = strokes.filter(stroke => !stroke.mark), marks = strokes.filter(stroke => stroke.mark);
    expect(body, name).toHaveLength(1);
    expect(marks, name).toHaveLength(name.startsWith('x') ? 1 : 0);
    expect(strokes.every(stroke => stroke.ordered && !stroke.retrace), name).toBe(true);
    expect(strokes.reduce((sum, stroke) => sum + stroke.widths!.length, 0), name).toBeLessThanOrEqual(name.startsWith('k') ? 9 : 8);
    // A graph traversal must not reverse a loop or invent a return trip.
    expect(routeWord([body]), name).toEqual(body);
  }
});

test('f, b and k ascend the right side of the loop before descending its left stem', () => {
  for (const [id] of forms.filter(([id]) => /^[fbk]/.test(catalog.glyphs[id].name))) {
    const points = preparePen(catalog.penPaths![id][0]).points;
    const high = points.filter(point => point.y > 650);
    expect(high[0].x - high[high.length - 1].x, catalog.glyphs[id].name).toBeGreaterThan(160);
    let upwardCrossings = 0;
    for (let i = 1; i < points.length; i++) if (points[i - 1].y < 650 && points[i].y >= 650) upwardCrossings++;
    expect(upwardCrossings, catalog.glyphs[id].name).toBe(1);
  }
});

test('k descends its stem before the shoulder loop and carries that loop into the foot', () => {
  for (const [id] of forms.filter(([id]) => /^k/.test(catalog.glyphs[id].name))) {
    const points = preparePen(catalog.penPaths![id][0]).points;
    const top = points.findIndex(point => point.y > 850);
    const baseline = points.findIndex((point, i) => i > top && point.y < 55);
    const stem = points[baseline].x;
    const bowl = points.findIndex((point, i) => i > baseline && point.x > stem + 260 && point.y > 230);
    expect(baseline, catalog.glyphs[id].name).toBeGreaterThan(top);
    expect(bowl, catalog.glyphs[id].name).toBeGreaterThan(baseline);
    expect(points[points.length - 1].x - stem, catalog.glyphs[id].name).toBeGreaterThan(300);
  }
});

test('d completes its ascender before drawing the baseline exit', () => {
  for (const [id] of forms.filter(([id]) => /^d/.test(catalog.glyphs[id].name))) {
    const points = preparePen(catalog.penPaths![id][0]).points, end = points[points.length - 1];
    const top = points.findIndex(point => point.y > 780);
    const exit = points.findIndex(point => point.x > end.x - 25 && point.y < 100);
    expect(top, catalog.glyphs[id].name).toBeGreaterThan(0);
    expect(exit, catalog.glyphs[id].name).toBeGreaterThan(top);
  }
});

test('x draws complete opposing diagonals and keeps its connecting exit before crossing', () => {
  for (const [id] of forms.filter(([id]) => /^x/.test(catalog.glyphs[id].name))) {
    const [body, crossing] = catalog.penPaths![id].map(preparePen);
    const finish = body.points[body.points.length - 1];
    const secondStart = crossing.points[0], secondEnd = crossing.points[crossing.points.length - 1];
    expect(secondStart.x - secondEnd.x, catalog.glyphs[id].name).toBeGreaterThan(400);
    expect(secondStart.y - secondEnd.y, catalog.glyphs[id].name).toBeGreaterThan(300);
    const firstTop = body.points.find(point => point.y > 370)!;
    expect(finish.x - firstTop.x, catalog.glyphs[id].name).toBeGreaterThan(250);
    expect(finish.y, catalog.glyphs[id].name).toBeLessThan(100);
    expect(secondEnd.x, catalog.glyphs[id].name).toBeLessThan(finish.x - 300);
  }
  // The crossing is delayed like a t crossbar, so a following letter does not
  // make the pen travel back from x's lower-left arm to its lower-right exit.
  const crossed = composeText('xax', shaper, catalog).strokes;
  expect(crossed.filter(stroke => stroke.ordered && stroke.retrace)).toEqual([]);
});

/** Raster stagnation catches a pen traveling over a complete written loop.
 * It is independent of the stroke.retrace flag: repainting old ink also counts.
 */
function longestInkPause(strokes: PenStroke[], bounds: readonly [number, number, number, number]) {
  const pens = strokes.map(preparePen), total = pens.reduce((sum, pen) => sum + pen.length, 0);
  let previous = raster('', bounds, .18), longest = 0, pause = 0;
  for (let frame = 1; frame <= 240; frame++) {
    let remaining = total * frame / 240;
    const body = pens.map(pen => { const d = penGeometry(pen, Math.max(0, Math.min(pen.length, remaining))); remaining -= pen.length; return `<path d="${d}"/>`; }).join('');
    const current = raster(body, bounds, .18);
    let added = 0;
    // Repainting can darken an old antialias fringe without reaching new
    // paper. Count solid new coverage outside the previous soft fringe.
    for (let i = 3; i < current.length; i += 4) if (current[i] > 192 && previous[i] < 64) added++;
    pause = added === 0 ? pause + 1 : 0;
    longest = Math.max(longest, pause); previous = current;
  }
  return longest;
}

test('the pause detector rejects a full painted-loop return trip', () => {
  const loop: PenStroke = { d: 'M0 0 C150 0 150 200 0 200 C-150 200 -150 0 0 0', width: 60 };
  const exit: PenStroke = { d: 'M0 0 L100 -100', width: 60 };
  expect(longestInkPause([loop, loop, exit], [-180, -150, 180, 250])).toBeGreaterThan(80);
});

test('f, b and k no longer pause for a full-loop return in any contextual form', () => {
  for (const [id] of forms.filter(([id]) => /^[fbk]/.test(catalog.glyphs[id].name))) {
    const [x0, y0, x1, y1] = catalog.glyphs[id].bounds!;
    const name = catalog.glyphs[id].name;
    // k briefly reverses its straight stem before the shoulder and its short
    // crossbar before the foot. Neither return traverses a completed loop.
    expect(longestInkPause(catalog.penPaths![id], [x0 - 60, y0 - 60, x1 + 60, y1 + 60]), name).toBeLessThan(name.startsWith('k') ? 30 : 20);
  }
}, 120_000);

test('every intermediate state of all 50 forms stays inside the moving nib', () => {
  for (const [id] of forms) {
    const pens = catalog.penPaths![id].map(preparePen), total = pens.reduce((sum, pen) => sum + pen.length, 0);
    const [x0, y0, x1, y1] = catalog.glyphs[id].bounds!;
    const bounds = [x0 - 60, y0 - 60, x1 + 60, y1 + 60] as const, scale = .18;
    let previous = raster('', bounds, scale);
    for (let frame = 1; frame <= 240; frame++) {
      const from = total * (frame - 1) / 240, to = total * frame / 240;
      let remaining = to;
      const body = pens.map(pen => { const d = penGeometry(pen, Math.max(0, Math.min(pen.length, remaining))); remaining -= pen.length; return `<path d="${d}"/>`; }).join('');
      const current = raster(body, bounds, scale);
      expect(inkTravelPasses(measureInkTravel(previous, current, bounds, scale, pens, from, to)), `${catalog.glyphs[id].name}: frame ${frame}`).toBe(true);
      previous = current;
    }
  }
}, 120_000);
