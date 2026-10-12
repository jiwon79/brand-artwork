import { expect, test } from 'vitest';
import { composeText, createGlyphResolver } from './lettering';
import { gradientPalette, gradientPieces, gradientPieceGeometry } from './gradient-ink';
import { preparePen, type PenPath } from './pen-geometry';
import { createPenPlayback, strokeState } from './pen-playback';
import { letterContexts } from './stroke-order';
import { catalog, raster, shaper, supportedGlyphWitnesses } from './test-font';

function colorRenderer(pens: PenPath[]) {
  const pieces = gradientPieces(pens);
  const spectrum = `<linearGradient id="s">${gradientPalette.map((color, i) => `<stop offset="${i / (gradientPalette.length - 1)}" stop-color="${color}"/>`).join('')}</linearGradient>`;
  const definitions = pieces.flatMap((parts, i) => parts.map((part, j) => {
    const [x1, y1, x2, y2] = part.axis;
    return `<linearGradient id="c${i}-${j}" href="#s" gradientUnits="userSpaceOnUse" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
  })).join('');
  return (written = pens.map(pen => pen.length), bodiesOnly = false) => `<defs>${spectrum}${definitions}</defs>` + pieces.flatMap((parts, i) =>
    bodiesOnly && pens[i].colorAnchors ? [] : parts.map((part, j) => `<path fill="${part.solid ?? `url(#c${i}-${j})`}" d="${gradientPieceGeometry(part, written[i], 1)}"/>`),
  ).join('');
}
function pixel(body: string, x: number, y: number) { return raster(body, [x - .5, y - .5, x + .5, y + .5], 1); }
function expectColor(actual: Uint8Array, expected: Uint8Array, context: string) {
  expect(actual[3], context).toBe(255);
  expect(expected[3], context).toBe(255);
  expect(Math.max(...[0, 1, 2].map(i => Math.abs(actual[i] - expected[i]))), context).toBeLessThanOrEqual(8);
}

test('a shared crossbar matches both stems and uses the same color field across every brush cap', () => {
  const bodies = [0, 200].map(x => preparePen({ d: `M${x} -100L${x} 300`, width: 40 }));
  const bar = preparePen({ d: 'M-50 0L250 0', width: 30, colorAnchors: [[0, 0], [200, 0]] });
  const pens = [...bodies, bar], pieces = gradientPieces(pens), render = colorRenderer(pens);
  expect(pieces.slice(0, 2)).toEqual(gradientPieces(bodies));
  for (const x of [0, 200]) expectColor(pixel(render(), x, 0), pixel(render(undefined, true), x, 0), `stem ${x}`);
  for (const piece of pieces[2]) expect(piece.axis).toEqual(pieces[2][0].axis);
  expect(pieces[2][0].from).not.toBe(pieces[2][pieces[2].length - 1].to);
  expect(new Set(pieces[2].map(piece => piece.from)).size).toBeGreaterThan(4);
});

const ligatures = [...supportedGlyphWitnesses()].filter(([id]) => catalog.glyphs[id].name.startsWith('t_t.'));
test('all contextual t and tt forms bind only to their own downward stem crossings', () => {
  const ids = new Set([...letterContexts('t', shaper, catalog).map(context => context.id), ...ligatures.map(([id]) => id), shaper.shape('tt')[0].id]);
  const resolve = createGlyphResolver(catalog);
  expect(ligatures).toHaveLength(9);
  expect(ids.size).toBeGreaterThanOrEqual(18);
  for (const id of ids) {
    const name = catalog.glyphs[id].name, ink = resolve(id);
    expect(ink.marks).toHaveLength(1);
    const anchors = ink.marks[0].colorAnchors!;
    expect(anchors, name).toHaveLength(name.startsWith('t_t.') ? 2 : 1);
    const bodies = ink.strokes.map(preparePen);
    for (const [x, y] of anchors) {
      const onDownstroke = bodies.some(body => body.points.some((b, i) => {
        if (!i) return false;
        const a = body.points[i - 1], t = (y - a.y) / (b.y - a.y);
        return b.y < a.y && t >= 0 && t <= 1 && Math.abs(a.x + (b.x - a.x) * t - x) < .001;
      }));
      expect(onDownstroke, name).toBe(true);
    }
  }
});

const texts = new Set(['t', 'tt', 'tttsss', 'tttttttsssss', 'tst', 'little letters flow', 'titi', 'tjijt', 't t', 'tt\nt', 'tttsss\niji', ...letterContexts('t', shaper, catalog).map(context => context.text), ...ligatures.map(([, text]) => text)]);
for (const text of texts) test(`deferred crossbars match their own body colors: ${JSON.stringify(text)}`, () => {
  const pens = composeText(text, shaper, catalog).strokes.map(preparePen), render = colorRenderer(pens);
  const bars = pens.filter(pen => pen.colorAnchors && pen.length > .1);
  expect(bars.reduce((sum, pen) => sum + pen.colorAnchors!.length, 0)).toBe([...text].filter(letter => letter === 't').length);
  const before = render(undefined, true), after = render();
  for (const bar of bars) for (const [x, y] of bar.colorAnchors!) expectColor(pixel(after, x, y), pixel(before, x, y), `stem ${x},${y}`);
  const withoutAnchors = pens.map(({ colorAnchors: _, ...pen }) => pen);
  const timeline = (values: PenPath[]) => createPenPlayback(values).strokes.map(({ start, end, dot }) => ({ start, end, dot }));
  expect(timeline(pens)).toEqual(timeline(withoutAnchors));
});

test('tttsss crossbars retain their final color on every frame while the original writing order stays intact', () => {
  const pens = composeText('tttsss', shaper, catalog).strokes.map(preparePen), playback = createPenPlayback(pens), render = colorRenderer(pens);
  const bars = pens.flatMap((pen, i) => pen.colorAnchors && pen.length > .1 ? [i] : []);
  expect(bars).toHaveLength(2);
  expect(playback.strokes[bars[0]].start).toBeGreaterThan(playback.strokes[0].end);
  const complete = render();
  let checked = 0;
  for (let frame = Math.floor(playback.strokes[bars[0]].start * 60); frame <= Math.ceil(playback.duration * 60); frame++) {
    const written = playback.strokes.map(stroke => strokeState(stroke, frame / 60).written);
    const current = render(written);
    for (const i of bars) {
      for (const point of pens[i].points) {
        // Compare only the fully covered prefix, leaving the growing cap out.
        if (point.distance + point.radius >= written[i]) continue;
        expectColor(pixel(current, point.x, point.y), pixel(complete, point.x, point.y), `frame ${frame}, stroke ${i}`);
        checked++;
      }
    }
  }
  expect(checked).toBeGreaterThan(100);
}, 30_000);
