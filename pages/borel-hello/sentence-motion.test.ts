import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { composeText } from './lettering';
import { penGeometry, preparePen } from './pen-geometry';
import { createPenPlayback, strokeState } from './pen-playback';
import { catalog, foregroundIoU, raster, shaper } from './test-font';
import { auditPen, inkTravelPasses, measureInkTravel } from './test-pen-quality';

// Follow the actual menu so a newly offered sentence cannot silently escape
// intermediate-frame QA. The source-font comparison is a separate gate.
const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const group = html.match(/<optgroup label="테스트 문장">([\s\S]*?)<\/optgroup>/)![1];
const sentences = [...group.matchAll(/<option[^>]*>([^<]+)<\/option>/g)].map(match => match[1]);

test('the sentence menu keeps broad motion coverage', () => {
  expect(sentences.length).toBeGreaterThanOrEqual(12);
  expect(sentences).toContain('my name is jiwon');
  expect(sentences).toContain('Hello, world!');
  expect(sentences).toContain('See you at 7:30!');
  expect(new Set(sentences.join('').toLowerCase().match(/[a-z]/g)).size).toBe(26);
});

test('reviewed letter forms stay compact and do not regain pressure knots or needle caps', () => {
  const ids = new Set([...sentences, ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].flatMap(text => shaper.shape(text).map(glyph => glyph.id)));
  for (const id of ids) {
    const name = catalog.glyphs[id].name;
    if (!/^[A-Za-z](?:\.|$)|^t_t/.test(name)) continue;
    const strokes = catalog.penPaths![id];
    const painted = strokes.filter(stroke => !stroke.retrace && !stroke.mark);
    expect(painted.reduce((sum, stroke) => sum + (stroke.d.match(/[LC]/g)?.length ?? 0), 0), name).toBeLessThanOrEqual(20);
    expect(auditPen(strokes).filter(issue => issue.kind !== 'tangent-break'), name).toEqual([]);
  }
});

test('new l variants ascend the right side of the loop before descending the stem', () => {
  for (const name of ['l', 'l.init', 'l.medi.cv02']) {
    const id = catalog.glyphs.findIndex(glyph => glyph.name === name);
    const strokes = catalog.penPaths![id];
    expect(strokes).toHaveLength(1);
    const points = preparePen(strokes[0]).points;
    const ascending = points.find(point => point.y > 700)!;
    const returning = points.slice(points.indexOf(ascending)).find(point => point.y < 400)!;
    expect(ascending.x - returning.x, name).toBeGreaterThan(140);
  }
});

test('f ascenders finish before their lower loop, and t crossbars are deferred marks', () => {
  for (const name of ['f', 'f.init']) {
    const id = catalog.glyphs.findIndex(glyph => glyph.name === name);
    const points = preparePen(catalog.penPaths![id][0]).points;
    expect(points.findIndex(point => point.y > 900), name).toBeLessThan(points.findIndex(point => point.y < -200));
  }
  for (const name of ['t', 't.init', 't.fina', 't_t.liga', 't_t.liga.medi.cv01']) {
    const id = catalog.glyphs.findIndex(glyph => glyph.name === name);
    const marks = catalog.penPaths![id].filter(stroke => stroke.mark);
    expect(marks, name).toHaveLength(1);
    const pen = preparePen(marks[0]);
    expect(pen.points.every(point => point.y > 490 && point.y < 570), name).toBe(true);
    expect(pen.points[0].x, name).toBeLessThan(pen.points[pen.points.length - 1].x);
  }
});

for (const text of [...sentences, ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ']) test(`every intermediate state follows the pen: ${text}`, () => {
  const lettering = composeText(text, shaper, catalog), pens = lettering.strokes.map(preparePen);
  const playback = createPenPlayback(pens);
  const frames = Math.ceil(playback.duration * 60);
  const scale = text.length === 1 ? .35 : .08;
  const full = pens.map(pen => `<path d="${penGeometry(pen)}"/>`);
  let previous = raster('', lettering.bounds, scale);
  let from = 0;
  for (let frame = 1; frame <= frames; frame++) {
    const states = playback.strokes.map(stroke => strokeState(stroke, playback.duration * frame / frames));
    const to = states.reduce((sum, state) => sum + state.written, 0);
    const body = pens.map((pen, i) => {
      const { written, pressure } = states[i];
      if (written <= 0) return '';
      return written >= pen.length ? full[i] : `<path d="${penGeometry(pen, written, pressure)}"/>`;
    }).join('');
    const current = raster(body, lettering.bounds, scale);
    expect(inkTravelPasses(measureInkTravel(previous, current, lettering.bounds, scale, pens, from, to)), `foreign ink at frame ${frame}/${frames}`).toBe(true);
    let erased = 0, written = 0;
    for (let i = 3; i < current.length; i += 4) {
      erased += Math.max(0, previous[i] - current[i]); written += previous[i];
    }
    expect(erased / Math.max(1, written), `erased ink at frame ${frame}/${frames}`).toBeLessThan(.002);
    previous = current;
    from = to;
  }
  const actual = raster(full.join(''), lettering.bounds);
  const reference = raster(lettering.outlines.map(d => `<path d="${d}"/>`).join(''), lettering.bounds);
  expect(foregroundIoU(actual, reference), text).toBeGreaterThanOrEqual(.95);
}, 120_000);

const principalStrokes: Record<string, number> = {
  A: 2, B: 2, C: 1, D: 1, E: 2, F: 3, G: 1, H: 3, I: 3,
  J: 2, K: 2, L: 1, M: 1, N: 1, O: 1, P: 2, Q: 2, R: 2,
  S: 1, T: 2, U: 1, V: 1, W: 1, X: 2, Y: 2, Z: 1,
};
for (const [letter, count] of Object.entries(principalStrokes)) test(`capital ${letter} uses complete writing strokes without corrective fragments`, () => {
  const id = shaper.shape(letter)[0].id, strokes = catalog.penPaths![id];
  expect(strokes.length).toBe(count);
  expect(strokes.reduce((sum, stroke) => sum + (stroke.d.match(/[LC]/g)?.length ?? 0), 0)).toBeLessThanOrEqual(12);
  for (const stroke of strokes) {
    const pen = preparePen(stroke);
    expect(pen.length).toBeGreaterThan(100);
    // Round, full-size tips; tiny corrective cap wedges cannot return.
    expect(pen.points[0].radius).toBeGreaterThan(30);
    expect(pen.points[pen.points.length - 1].radius).toBeGreaterThan(30);
  }
});

test('H descends each complete stem before its crossbar; X draws each complete diagonal', () => {
  for (const letter of ['H', 'X']) {
    const pens = catalog.penPaths![shaper.shape(letter)[0].id].map(preparePen);
    for (const pen of pens.slice(0, 2)) {
      expect(pen.points[0].y).toBeGreaterThan(640);
      expect(pen.points[pen.points.length - 1].y).toBeLessThan(80);
      for (let i = 1; i < pen.points.length; i++) expect(pen.points[i].y).toBeLessThanOrEqual(pen.points[i - 1].y + .01);
    }
  }
});
