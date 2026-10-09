import { expect, test } from 'vitest';
import { composeText, type Bounds } from './lettering';
import { penGeometry, preparePen } from './pen-geometry';
import { createPenPlayback, strokeState } from './pen-playback';
import { catalog, raster, shaper } from './test-font';
import { inkTravelPasses, measureInkTravel } from './test-pen-quality';

/** Read the outside edge at subpixel precision. Compare tangents on either
 * side of a five-font-unit window: a smooth centerline alone misses a notch
 * made by two round caps or a returning stroke that starts off the stem.
 */
function maximumEdgeTurn(ink: string, bounds: Bounds, axis: 'x' | 'y'): number {
  const scale = 4, pixels = raster(ink, bounds, scale);
  const width = Math.ceil((bounds[2] - bounds[0]) * scale), height = Math.ceil((bounds[3] - bounds[1]) * scale);
  const along = axis === 'x' ? width : height, across = axis === 'x' ? height : width;
  const alpha = (a: number, b: number) => pixels[(axis === 'x' ? b * width + a : a * width + b) * 4 + 3];
  const edge = Array.from({ length: along }, (_, a) => {
    let last = -1;
    for (let b = 0; b < across; b++) if (alpha(a, b) > 127) last = b;
    // The crop must include both the ink and the background after its edge.
    expect(last).toBeGreaterThanOrEqual(0);
    expect(last).toBeLessThan(across - 1);
    return last + (alpha(a, last) - 127) / (alpha(a, last) - alpha(a, last + 1));
  });
  const step = 5 * scale;
  let maximum = 0;
  for (let i = step; i < edge.length - step; i++) {
    const before = (edge[i] - edge[i - step]) / step, after = (edge[i + step] - edge[i]) / step;
    maximum = Math.max(maximum, Math.abs(Math.atan(before) - Math.atan(after)) * 180 / Math.PI);
  }
  return maximum;
}

test('magnified jiwon edges have no cap seam or returning-stem bump', () => {
  const text = composeText('jiwon', shaper, catalog);
  const ink = text.strokes.map(stroke => `<path d="${penGeometry(preparePen(stroke))}"/>`).join('');
  const glyphs = shaper.shape('jiwon'), origin = (6200 - glyphs.reduce((sum, glyph) => sum + glyph.advance, 0)) / 2;
  const regions: { name: string; glyph: number; bounds: Bounds; axis: 'x' | 'y' }[] = [
    { name: 'i baseline into w', glyph: 1, bounds: [214, -70, 284, 40], axis: 'x' },
    { name: 'i returning stem', glyph: 1, bounds: [114, -330, 214, -210], axis: 'y' },
    { name: 'w returning middle stem', glyph: 2, bounds: [616, -280, 716, -150], axis: 'y' },
  ];
  for (const region of regions) {
    const x = origin + glyphs[region.glyph].x, [left, top, right, bottom] = region.bounds;
    expect(maximumEdgeTurn(ink, [left + x, top, right + x, bottom], region.axis), region.name).toBeLessThan(6);
  }
});

test('edge test detects a cap seam even when both paths have round ends', () => {
  const ink = '<path d="M0 0H45 M50 -3H100" fill="none" stroke="black" stroke-width="40" stroke-linecap="round"/>';
  expect(maximumEdgeTurn(ink, [25, -30, 70, 30], 'x')).toBeGreaterThan(12);
});

test('j crosses into i with a full nib and i meets w with matching curvature', () => {
  const shapes = shaper.shape('jiwon'), pens = composeText('jiwon', shaper, catalog).strokes.map(preparePen);
  const origin = (6200 - shapes.reduce((sum, glyph) => sum + glyph.advance, 0)) / 2;
  const crossing = pens.filter(pen => !pen.retrace).flatMap(pen => pen.points).filter(point =>
    point.x > origin + 275 && point.x < origin + 325 && point.y > -10 && point.y < 45);
  expect(crossing.length).toBeGreaterThan(2);
  expect(Math.min(...crossing.map(point => point.radius))).toBeGreaterThan(40);

  const i = catalog.penPaths![shapes[1].id].filter(stroke => !stroke.mark);
  const w = catalog.penPaths![shapes[2].id].filter(stroke => !stroke.mark);
  expect(i).toHaveLength(1);
  expect(w).toHaveLength(1);
  expect([...i, ...w].every(stroke => stroke.ordered && !stroke.retrace)).toBe(true);
  const a = i[0].d.match(/[-+]?(?:\d*\.)?\d+/g)!.map(Number), b = w[0].d.match(/[-+]?(?:\d*\.)?\d+/g)!.map(Number);
  const n = a.length;
  expect(a[n - 2] + shapes[1].x).toBeCloseTo(b[0] + shapes[2].x, 3);
  expect(a[n - 1]).toBeCloseTo(b[1], 3);
  // Both handles are horizontal. Compare signed endpoint curvature as well
  // as direction, so replacing the join with a short flat bridge fails.
  expect(a[n - 3]).toBe(a[n - 1]);
  expect(b[3]).toBe(b[1]);
  const incoming = 2 * (a[n - 5] - a[n - 1]) / (3 * (a[n - 2] - a[n - 4]) ** 2);
  const outgoing = 2 * (b[5] - b[1]) / (3 * (b[2] - b[0]) ** 2);
  expect(incoming / outgoing).toBeCloseTo(1, 4);
  const widths = i[0].widths!;
  expect(widths[widths.length - 1][3]).toBe(w[0].widths![0][0]);
});

test('every jiwon playback frame preserves ink and stays inside the moving nib', () => {
  const text = composeText('jiwon', shaper, catalog), pens = text.strokes.map(preparePen);
  const playback = createPenPlayback(pens), frames = Math.ceil(playback.duration * 60), scale = .15;
  const full = pens.map(pen => `<path d="${penGeometry(pen)}"/>`);
  let previous = raster('', text.bounds, scale), from = 0;
  for (let frame = 1; frame <= frames; frame++) {
    const states = playback.strokes.map(stroke => strokeState(stroke, playback.duration * frame / frames));
    const to = states.reduce((sum, state) => sum + state.written, 0);
    const ink = pens.map((pen, i) => states[i].written >= pen.length ? full[i] :
      `<path d="${penGeometry(pen, states[i].written, states[i].pressure)}"/>`).join('');
    const current = raster(ink, text.bounds, scale);
    expect(inkTravelPasses(measureInkTravel(previous, current, text.bounds, scale, pens, from, to)), `frame ${frame}`).toBe(true);
    let erased = 0, written = 0;
    for (let i = 3; i < current.length; i += 4) { erased += Math.max(0, previous[i] - current[i]); written += previous[i]; }
    expect(erased / Math.max(1, written), `erased ink at ${frame}`).toBeLessThan(.002);
    previous = current; from = to;
  }
}, 120_000);
