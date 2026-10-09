import { expect, test } from 'vitest';
import { composeText, createGlyphResolver } from './lettering';
import { penGeometry, preparePen, type PenPoint } from './pen-geometry';
import { createPenPlayback, strokeState } from './pen-playback';
import { routeWord } from './pen-routing';
import { catalog, raster, shaper, supportedGlyphWitnesses, textForegroundIoU } from './test-font';
import { auditPen, inkTravelPasses, isLocalStemReturn, measureInkTravel } from './test-pen-quality';

const forms = [...supportedGlyphWitnesses()].filter(([id]) => /^[cegjlnopqrsvz](?:\.|$)/.test(catalog.glyphs[id].name));
const ligatures = [...supportedGlyphWitnesses()].filter(([id]) => catalog.glyphs[id].name.startsWith('t_t.'));
const body = (id: number) => catalog.penPaths![id].filter(stroke => !stroke.mark);
const family = (letters: string) => forms.filter(([id]) => letters.includes(catalog.glyphs[id].name[0]));
function signedArea(points: PenPoint[]): number {
  return points.reduce((sum, a, i) => {
    const b = points[(i + 1) % points.length];
    return sum + a.x * b.y - b.x * a.y;
  }, 0) / 2;
}

test('all 130 remaining lowercase forms use compact authored bodies with smooth curve joins', () => {
  expect(forms).toHaveLength(130);
  for (const [id, witness] of forms) {
    const name = `${catalog.glyphs[id].name} in ${witness}`, strokes = body(id);
    expect(strokes, name).toHaveLength(1);
    expect(strokes[0].ordered && !strokes[0].retrace, name).toBe(true);
    expect(strokes[0].widths!.length, name).toBeLessThanOrEqual(12);
    expect(routeWord([strokes]), name).toEqual(strokes);
    const issues = auditPen(strokes, { turnDegrees: 1, bulgeRatio: 1.15 });
    expect(issues.filter(issue => !isLocalStemReturn(strokes[issue.stroke], issue)), name).toEqual([]);
    for (const point of preparePen(strokes[0]).points) {
      expect(point.radius, name).toBeGreaterThan(39);
      expect(point.radius, name).toBeLessThan(49);
    }
  }
});

test('e, l and o wind counterclockwise in every contextual form', () => {
  // These are y-up font coordinates. Reversing the bowl/loop reverses this
  // signed area even when its completed pixels remain exactly the same.
  for (const [id] of family('elo')) {
    expect(signedArea(preparePen(body(id)[0]).points), catalog.glyphs[id].name).toBeGreaterThan(20_000);
  }
  for (const [id] of family('l')) {
    const high = preparePen(body(id)[0]).points.filter(point => point.y > 650);
    expect(high[0].x - high[high.length - 1].x, catalog.glyphs[id].name).toBeGreaterThan(180);
  }
  const isolated = shaper.shape('o')[0].id, points = preparePen(body(isolated)[0]).points;
  expect(points[0].y).toBeGreaterThan(420);
});

test('g and q close the counterclockwise bowl before climbing and descending the upright', () => {
  for (const [id] of family('gq')) {
    const name = catalog.glyphs[id].name, points = preparePen(body(id)[0]).points;
    const top = points.findIndex(point => point.y > 350);
    const left = points.findIndex((point, i) => i > top && point.y < 240);
    const right = points.findIndex((point, i) => i > left && point.y > 240);
    const upright = points.findIndex((point, i) => i > right && point.y > 425);
    const descender = points.findIndex(point => point.y < -250);
    expect(left, name).toBeGreaterThan(top);
    expect(right, name).toBeGreaterThan(left);
    expect(points[right].x - points[left].x, name).toBeGreaterThan(250);
    expect(upright, name).toBeGreaterThan(right);
    expect(descender, name).toBeGreaterThan(upright);
  }
});

test('g, j and z descend on the right before returning around the left side of the lower loop', () => {
  for (const [id] of family('gjz')) {
    const name = catalog.glyphs[id].name, points = preparePen(body(id)[0]).points;
    const down = points.findIndex(point => point.y < -220);
    const bottom = points.findIndex(point => point.y < -420);
    const left = points.findIndex((point, i) => i > down && point.x < points[down].x - 120);
    expect(bottom, name).toBeGreaterThan(down);
    expect(left, name).toBeGreaterThan(bottom);
    expect(signedArea(points.filter(point => point.y < -220)), name).toBeLessThan(-35_000);
    expect(points[points.length - 1].y, name).toBeGreaterThan(-60);
    // A completed exit must not be followed by a journey back to the top.
    expect(points.slice(bottom).every(point => point.y < 120), name).toBe(true);
  }
});

test('n and p finish their first stem before the right shoulder and never return to the first stem afterward', () => {
  for (const [id] of family('np')) {
    const name = catalog.glyphs[id].name, points = preparePen(body(id)[0]).points;
    const peak = points.findIndex(point => point.y > 350);
    const down = points.findIndex((point, i) => i > peak && point.y < (name[0] === 'p' ? -330 : 55));
    const shoulder = points.findIndex((point, i) => i > down && point.x > points[down].x + 100 && point.y > 380);
    expect(down, name).toBeGreaterThan(0);
    expect(shoulder, name).toBeGreaterThan(down);
    expect(points.slice(shoulder).every(point => point.x > points[down].x + 80), name).toBe(true);
  }
});

test('all q forms end at the bottom rather than drawing a return up the completed stem', () => {
  for (const [id] of family('q')) {
    const points = preparePen(body(id)[0]).points, end = points[points.length - 1];
    expect(end.y, catalog.glyphs[id].name).toBeLessThan(-340);
    expect(end.y - Math.min(...points.map(point => point.y)), catalog.glyphs[id].name).toBeLessThan(1);
  }
});

test('all lowercase pair contexts connect their bodies, with a deliberate lift only after q', () => {
  const resolve = createGlyphResolver(catalog);
  for (const a of 'abcdefghijklmnopqrstuvwxyz') for (const b of 'abcdefghijklmnopqrstuvwxyz') {
    const text = a + b + 'a', shaped = shaper.shape(text);
    const marks = shaped.reduce((sum, glyph) => sum + resolve(glyph.id).marks.length, 0);
    const lettering = composeText(text, shaper, catalog, 20000);
    const pens = lettering.strokes.slice(0, lettering.strokes.length - marks).map(preparePen);
    let lifts = 0;
    for (let i = 1; i < pens.length; i++) {
      const previous = pens[i - 1].points, from = previous[previous.length - 1], to = pens[i].points[0];
      const gap = Math.hypot(from.x - to.x, from.y - to.y);
      if (gap > 1) {
        lifts++;
        expect(from.y - to.y, text).toBeGreaterThan(300);
      } else expect(gap, text).toBeLessThan(.01);
    }
    expect(lifts, text).toBe((text.match(/q/g) ?? []).length);
  }
});

test('all nine tt ligatures write two full stems before one deferred crossbar', () => {
  expect(ligatures).toHaveLength(9);
  for (const [id] of ligatures) {
    const name = catalog.glyphs[id].name, strokes = body(id);
    const marks = catalog.penPaths![id].filter(stroke => stroke.mark);
    expect(strokes, name).toHaveLength(1);
    expect(marks, name).toHaveLength(1);
    expect(strokes[0].ordered && !strokes[0].retrace, name).toBe(true);
    expect(strokes[0].widths!.length, name).toBeLessThanOrEqual(9);
    const points = preparePen(strokes[0]).points;
    const first = points.findIndex(point => point.y > 680);
    const baseline = points.findIndex((point, i) => i > first && point.y < 65);
    const second = points.findIndex((point, i) => i > baseline && point.y > 680);
    expect(baseline, name).toBeGreaterThan(first);
    expect(second, name).toBeGreaterThan(baseline);
    expect(points[second].x - points[first].x, name).toBeGreaterThan(350);
    const bar = preparePen(marks[0]).points;
    expect(bar[bar.length - 1].x - bar[0].x, name).toBeGreaterThan(560);
    expect(bar.every(point => point.y > 490 && point.y < 560), name).toBe(true);
  }
});

for (const text of ['bm', 'bma', 'bn', 'bna', 'bv', 'bva', 'bw', 'bwa', 'B', 'D', 'K', 'R']) {
  test(`joined strokes retain source ink: ${text}`, () => expect(textForegroundIoU(text)).toBeGreaterThanOrEqual(.95));
}

for (const [id, witness] of [...forms, ...ligatures]) test(`all playback frames preserve ink and follow the nib: ${catalog.glyphs[id].name} in ${witness}`, () => {
  const pens = catalog.penPaths![id].map(preparePen), playback = createPenPlayback(pens);
  const frames = Math.ceil(playback.duration * 60), scale = .15;
  const [x0, y0, x1, y1] = catalog.glyphs[id].bounds!;
  const bounds = [x0 - 60, y0 - 60, x1 + 60, y1 + 60] as const;
  const full = pens.map(pen => `<path d="${penGeometry(pen)}"/>`);
  let previous = raster('', bounds, scale), from = 0;
  for (let frame = 1; frame <= frames; frame++) {
    const states = playback.strokes.map(stroke => strokeState(stroke, playback.duration * frame / frames));
    const to = states.reduce((sum, state) => sum + state.written, 0);
    const ink = pens.map((pen, i) => states[i].written >= pen.length ? full[i] :
      `<path d="${penGeometry(pen, states[i].written, states[i].pressure)}"/>`).join('');
    const current = raster(ink, bounds, scale);
    expect(inkTravelPasses(measureInkTravel(previous, current, bounds, scale, pens, from, to)), `frame ${frame}`).toBe(true);
    let erased = 0, written = 0;
    for (let i = 3; i < current.length; i += 4) { erased += Math.max(0, previous[i] - current[i]); written += previous[i]; }
    expect(erased / Math.max(1, written), `erased ink at frame ${frame}`).toBeLessThan(.002);
    previous = current; from = to;
  }
}, 30_000);
