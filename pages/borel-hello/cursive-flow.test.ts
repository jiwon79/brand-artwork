import { expect, test } from 'vitest';
import { composeText, createGlyphResolver } from './lettering';
import { penGeometry, preparePen } from './pen-geometry';
import { createPenPlayback, strokeState } from './pen-playback';
import { catalog, font, foregroundIoU, raster, shaper } from './test-font';
import { inkTravelPasses, measureInkTravel } from './test-pen-quality';

// These are the actual contextual forms exposed by the lowercase preset and
// its two-letter witnesses. An isolated letter is not a substitute for them.
const reviewed = [
  'a.init', 'a.isol', 'c.init', 'c.medi.cv02', 'c.fina.cv02', 'g.init',
  'h.medi.cv03', 'h.fina.cv03', 'j', 'j.fina', 'l.fina', 'q', 'q.init',
  'r.medi.cv03', 'r.fina.cv03', 's', 's.init', 't.medi.cv01', 't.fina.cv01',
  'u', 'u.init', 'u.fina', 'v', 'w.medi.cv02', 'w.fina.cv02', 'y.medi.cv01', 'z.fina.cv03',
];
const strokes = (name: string) => catalog.penPaths![catalog.glyphs.findIndex(glyph => glyph.name === name)];
const body = (name: string) => strokes(name).filter(stroke => !stroke.mark);

for (const name of reviewed) test(`reviewed cursive form keeps round, compact paths and 95% source ink: ${name}`, () => {
  const id = catalog.glyphs.findIndex(glyph => glyph.name === name), paths = strokes(name);
  expect(body(name)).toHaveLength(1);
  expect(paths.every(stroke => stroke.ordered && !stroke.retrace)).toBe(true);
  expect(paths.reduce((sum, stroke) => sum + stroke.widths!.length, 0)).toBeLessThanOrEqual(12);
  for (const stroke of body(name)) for (const point of preparePen(stroke).points) {
    expect(point.radius, 'needle cap or inflated crossing').toBeGreaterThan(38);
    expect(point.radius, 'needle cap or inflated crossing').toBeLessThan(50);
  }
  const [x0, y0, x1, y1] = catalog.glyphs[id].bounds!;
  const bounds = [x0 - 70, y0 - 70, x1 + 70, y1 + 70] as const;
  // Use the font's glyph outline, independently of the authored pen recipe.
  const actual = paths.map(stroke => `<path d="${penGeometry(preparePen(stroke))}"/>`).join('');
  expect(foregroundIoU(raster(actual, bounds), raster(`<path d="${font.glyphToPath(id)}"/>`, bounds))).toBeGreaterThanOrEqual(.95);
});

test('a closes the bowl, climbs the upright, then descends into its exit', () => {
  for (const name of ['a.init', 'a.isol']) {
    const points = preparePen(body(name)[0]).points;
    const low = points.findIndex(point => point.y < 90);
    const top = points.findIndex((point, i) => i > low && point.x > 390 && point.y > 420);
    const exit = points.findIndex(point => point.x > 500 && point.y < 100);
    expect(low, name).toBeGreaterThan(0);
    expect(top, name).toBeGreaterThan(low);
    expect(exit, name).toBeGreaterThan(top);
    expect(points[points.length - 1].y, name).toBeLessThan(100);
  }
});

test('h and l enter from the preceding letter before ascending the right side of their loop', () => {
  for (const name of ['h.medi.cv03', 'h.fina.cv03', 'l.fina']) {
    const points = preparePen(body(name)[0]).points;
    expect(points[0].y, name).toBeLessThan(80);
    const high = points.filter(point => point.y > 650);
    expect(high[0].x - high[high.length - 1].x, name).toBeGreaterThan(140);
  }
});

test('g, j, y and z descend to the bottom before returning up the left side of the lower loop', () => {
  for (const name of ['g.init', 'j', 'j.fina', 'y.medi.cv01', 'z.fina.cv03']) {
    const points = preparePen(body(name)[0]).points;
    const down = points.findIndex(point => point.y < -220);
    const bottom = points.findIndex(point => point.y < -420);
    const left = points.findIndex((point, i) => i > down && point.x < points[down].x - 120);
    expect(down, name).toBeGreaterThan(0);
    expect(bottom, name).toBeGreaterThan(down);
    expect(left, name).toBeGreaterThan(bottom);
    expect(points[points.length - 1].y, name).toBeGreaterThan(-100);
  }
});

test('q returns from its descender only to the baseline handoff, not the top of the letter', () => {
  for (const name of ['q', 'q.init']) {
    const points = preparePen(body(name)[0]).points;
    expect(Math.min(...points.map(point => point.y)), name).toBeLessThan(-320);
    expect(Math.abs(points[points.length - 1].y), name).toBeLessThan(50);
  }
});

test('both corrected t forms enter before ascending and defer one complete crossbar', () => {
  for (const name of ['t.medi.cv01', 't.fina.cv01']) {
    const points = preparePen(body(name)[0]).points, marks = strokes(name).filter(stroke => stroke.mark);
    expect(points[0].x, name).toBeLessThan(0);
    expect(points[0].y, name).toBeLessThan(80);
    expect(points.some(point => point.y > 680), name).toBe(true);
    expect(points[points.length - 1].y, name).toBeLessThan(100);
    expect(marks, name).toHaveLength(1);
    const bar = preparePen(marks[0]).points;
    expect(bar[bar.length - 1].x - bar[0].x, name).toBeGreaterThan(250);
    expect(bar.every((point, i) => !i || point.x >= bar[i - 1].x), name).toBe(true);
  }
});

test('smooth shoulders, bowls and exits share tangents instead of making a corner', () => {
  const joins: Record<string, number[]> = {
    'h.medi.cv03': [1,2,3,5,6], 'h.fina.cv03': [1,2,3,5,6],
    'r.medi.cv03': [2,3,4], 'r.fina.cv03': [2,3,4],
    s: [1,3,4,5,7], 's.init': [1,3,4,5,7],
    'w.medi.cv02': [1,2,4,5,6], 'w.fina.cv02': [1,2,4,5,6,7],
  };
  // Deliberate turnarounds at upright tips are excluded. Everywhere else,
  // compare the incoming and outgoing Bézier derivatives geometrically.
  for (const [name, knots] of Object.entries(joins)) {
    const values = body(name)[0].d.match(/[-+]?(?:\d*\.)?\d+/g)!.map(Number);
    for (const knot of knots) {
      const i = knot * 6, ax = values[i] - values[i - 2], ay = values[i + 1] - values[i - 1];
      const bx = values[i + 2] - values[i], by = values[i + 3] - values[i + 1];
      expect((ax * bx + ay * by) / Math.hypot(ax, ay) / Math.hypot(bx, by), `${name}: join ${knot}`).toBeGreaterThan(.999);
    }
  }
});

for (const text of ['abcdefghijklmnopqrstuvwxyz', 'abcdefghijkl', 'mnopqrstu', 'vwxyz',
  'ab', 'bc', 'cd', 'gh', 'ij', 'kl', 'qr', 'st', 'uv', 'vw', 'xy', 'yz', 'lm',
]) test(`the cursive word body has no unintentional lift: ${text}`, () => {
  // Also exercise the whole alphabet without wrapping. Marks are the only
  // intentional lifts, and composeText places them after the word body.
  const lettering = composeText(text, shaper, catalog, 20000), resolve = createGlyphResolver(catalog);
  const marks = shaper.shape(text).reduce((sum, glyph) => sum + resolve(glyph.id).marks.length, 0);
  const pens = lettering.strokes.slice(0, lettering.strokes.length - marks).map(preparePen);
  for (let i = 1; i < pens.length; i++) {
    const before = pens[i - 1].points, a = before[before.length - 1], b = pens[i].points[0];
    expect(Math.hypot(a.x - b.x, a.y - b.y), `stroke ${i}`).toBeLessThan(.01);
  }
});

test('r and u do not spend the animation revisiting completed ink', () => {
  for (const name of ['r.medi.cv03', 'r.fina.cv03', 'u', 'u.init', 'u.fina']) {
    const id = catalog.glyphs.findIndex(glyph => glyph.name === name), pen = preparePen(body(name)[0]);
    const [x0, y0, x1, y1] = catalog.glyphs[id].bounds!;
    const bounds = [x0 - 60, y0 - 60, x1 + 60, y1 + 60] as const;
    let previous = raster('', bounds, .2), pause = 0, longest = 0;
    for (let frame = 1; frame <= 240; frame++) {
      const current = raster(`<path d="${penGeometry(pen, pen.length * frame / 240)}"/>`, bounds, .2);
      let added = 0;
      for (let i = 3; i < current.length; i += 4) if (current[i] > 192 && previous[i] < 64) added++;
      pause = added ? 0 : pause + 1; longest = Math.max(longest, pause); previous = current;
    }
    // Short straight-stem returns are legitimate; a trip around an already
    // complete glyph is not. This measures visible output, not retrace flags.
    expect(longest, name).toBeLessThan(40);
  }
});

for (const text of ['abcdefghijklmnopqrstuvwxyz', 'bc', 'gh', 'ij', 'qr', 'st', 'uv', 'vw', 'xy', 'yz']) {
  test(`corrected connections retain ink throughout every playback frame: ${text}`, () => {
    const lettering = composeText(text, shaper, catalog), pens = lettering.strokes.map(preparePen);
    const playback = createPenPlayback(pens), frames = Math.ceil(playback.duration * 60), scale = .1;
    const full = pens.map(pen => `<path d="${penGeometry(pen)}"/>`);
    let previous = raster('', lettering.bounds, scale), from = 0;
    for (let frame = 1; frame <= frames; frame++) {
      const states = playback.strokes.map(stroke => strokeState(stroke, playback.duration * frame / frames));
      const to = states.reduce((sum, state) => sum + state.written, 0);
      const ink = pens.map((pen, i) => states[i].written >= pen.length ? full[i] :
        `<path d="${penGeometry(pen, states[i].written, states[i].pressure)}"/>`).join('');
      const current = raster(ink, lettering.bounds, scale);
      expect(inkTravelPasses(measureInkTravel(previous, current, lettering.bounds, scale, pens, from, to)), `frame ${frame}`).toBe(true);
      let erased = 0, written = 0;
      for (let i = 3; i < current.length; i += 4) { erased += Math.max(0, previous[i] - current[i]); written += previous[i]; }
      expect(erased / Math.max(1, written), `frame ${frame}`).toBeLessThan(.002);
      previous = current; from = to;
    }
    expect(foregroundIoU(previous, raster(lettering.outlines.map(d => `<path d="${d}"/>`).join(''), lettering.bounds, scale))).toBeGreaterThanOrEqual(.95);
  }, 120_000);
}
