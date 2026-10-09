import { expect, test } from 'vitest';
import { composeText, type Bounds } from './lettering';
import { penGeometry, preparePen } from './pen-geometry';
import { createPenPlayback, strokeState } from './pen-playback';
import { routeWord } from './pen-routing';
import { catalog, raster, shaper, supportedGlyphWitnesses } from './test-font';
import { auditPen, inkTravelPasses, isLocalStemReturn, measureInkTravel } from './test-pen-quality';
import { maximumEdgeTurn } from './test-pen-silhouette';

const forms = [...supportedGlyphWitnesses()].filter(([id]) => /^[ahimtuwy](?:\.|$)/.test(catalog.glyphs[id].name));

test('all 80 a/h/i/m/t/u/w/y contexts use compact, ordered bodies', () => {
  expect(forms).toHaveLength(80);
  for (const [id, witness] of forms) {
    const name = catalog.glyphs[id].name, strokes = catalog.penPaths![id];
    const body = strokes.filter(stroke => !stroke.mark), marks = strokes.filter(stroke => stroke.mark);
    expect(body, `${name} in ${witness}`).toHaveLength(1);
    expect(marks, name).toHaveLength(/^[it]/.test(name) ? 1 : 0);
    expect(strokes.every(stroke => stroke.ordered && !stroke.retrace), name).toBe(true);
    expect(body[0].widths!.length, name).toBeLessThanOrEqual(10);
    expect(routeWord([body]), name).toEqual(body);
    const issues = auditPen(body, { turnDegrees: 1, bulgeRatio: 1.15 });
    expect(issues.filter(issue => !isLocalStemReturn(body[issue.stroke], issue)), name).toEqual([]);
  }
});

test('a enters its bowl counterclockwise, then climbs and descends its right stem', () => {
  for (const [id] of forms.filter(([id]) => catalog.glyphs[id].name.startsWith('a'))) {
    const name = catalog.glyphs[id].name, points = preparePen(catalog.penPaths![id][0]).points;
    const top = points.findIndex(point => point.y > 350);
    const left = points.findIndex((point, i) => i > top && point.y < 240);
    const right = points.findIndex((point, i) => i > left && point.y > 240);
    const upright = points.findIndex((point, i) => i > right && point.y > 425);
    const exit = points.findIndex((point, i) => i > upright && point.y < 100);
    expect(left, name).toBeGreaterThan(top);
    expect(right, name).toBeGreaterThan(left);
    expect(points[right].x - points[left].x, name).toBeGreaterThan(250);
    expect(upright, name).toBeGreaterThan(right);
    expect(exit, name).toBeGreaterThan(upright);
  }
});

test('h draws its entire ascender before the baseline and shoulder', () => {
  for (const [id] of forms.filter(([id]) => catalog.glyphs[id].name.startsWith('h'))) {
    const name = catalog.glyphs[id].name, points = preparePen(catalog.penPaths![id][0]).points;
    const high = points.filter(point => point.y > 650);
    expect(high[0].x - high[high.length - 1].x, name).toBeGreaterThan(140);
    const peak = points.findIndex(point => point.y > 850);
    const baseline = points.findIndex((point, i) => i > peak && point.y < 55);
    const shoulder = points.findIndex((point, i) => i > baseline && point.x > points[baseline].x + 130 && point.y > 350);
    expect(peak, name).toBeGreaterThan(0);
    expect(baseline, name).toBeGreaterThan(peak);
    expect(shoulder, name).toBeGreaterThan(baseline);
  }
});

test('the stem-return guard rejects an angled corner and a return that veers off the upright', () => {
  for (const d of ['M0 0 L0 200 L200 200', 'M0 0 L0 200 C0 190 200 100 200 0']) {
    const stroke = { d, width: 88 }, issues = auditPen([stroke]);
    expect(issues).toHaveLength(1);
    expect(isLocalStemReturn(stroke, issues[0])).toBe(false);
  }
  const stroke = { d: 'M0 0 L0 200 L0 0', width: 88 };
  expect(isLocalStemReturn(stroke, auditPen([stroke])[0])).toBe(true);
});

// Source-font stem locations, independent of the fitted control points.
// cv01/02/03 change the entry and the stem's x position; init/isol share an
// initial body. Scan the actual filled edge, including overlaps and round caps.
const stems: Record<string, number[][]> = {
  a: [[520], [492], [468], [409], [436]],
  h: [[217], [184], [108], [94], [138]],
  i: [[187], [193], [126], [141], [189]],
  m: [[373,668], [395,690], [181,476], [302,597], [302,597]],
  t: [[237], [218], [143], [157], [212]],
  u: [[187,536], [192,541], [126,475], [141,490], [191,540]],
  w: [[638], [660], [446], [566], [566]],
  y: [[187,536], [192,541], [126,475], [146,496], [191,542]],
};
for (const [id, witness] of forms) test(`magnified contextual stems have no edge seam: ${catalog.glyphs[id].name} in ${witness}`, () => {
  const name = catalog.glyphs[id].name, family = name[0];
  const variant = /\.(init|isol)/.test(name) ? 4 : Number(name.match(/cv0([123])/)?.[1] ?? 0);
  const paths = catalog.penPaths![id], ink = `<g transform="scale(1,-1)">${paths.map(stroke => `<path d="${penGeometry(preparePen(stroke))}"/>`).join('')}</g>`;
  const [low, high, width] = family === 'a' ? [170,350,120] : family === 'h' || family === 'm' ? [100,280,200] :
    family === 't' ? [170,400,120] : family === 'w' ? [130,240,120] : [180,340,120];
  for (const x of stems[family][variant]) {
    const bounds: Bounds = [x, -high, x + width, -low];
    expect(maximumEdgeTurn(ink, bounds, 'y'), `${name}: stem ${x}`).toBeLessThan(6);
  }
});

for (const text of ['th', 'la', 'aia', 'ma', 'ta', 'wa', 'ya', 'bua']) test(`reported word preserves ink at every playback frame: ${text}`, () => {
  const lettering = composeText(text, shaper, catalog), pens = lettering.strokes.map(preparePen);
  const playback = createPenPlayback(pens), frames = Math.ceil(playback.duration * 60), scale = .15;
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
    expect(erased / Math.max(1, written), `erased ink at ${frame}`).toBeLessThan(.002);
    previous = current; from = to;
  }
}, 120_000);
