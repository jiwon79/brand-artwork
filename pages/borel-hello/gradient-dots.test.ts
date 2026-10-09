import { expect, test } from 'vitest';
import { composeText } from './lettering';
import { gradientColor, gradientPalette, gradientPieces, gradientPieceGeometry } from './gradient-ink';
import { preparePen } from './pen-geometry';
import { createPenPlayback } from './pen-playback';
import { letterContexts } from './stroke-order';
import { catalog, raster, shaper } from './test-font';

test('deferred dots borrow their own anchor colors without advancing body colors or changing timing', () => {
  const bodies = [0, 100].map(x => preparePen({ d: `M${x} 0L${x} 200`, width: 40 }));
  // Put the first dot nearer the wrong stem: ownership must use its glyph
  // anchor, not proximity to the dot or the most recently drawn stroke.
  const dots = [
    preparePen({ d: 'M95 -10L95.01 -10', width: 30, colorAnchor: [0, 0] }),
    preparePen({ d: 'M100 -50L100.01 -50', width: 30, colorAnchor: [100, 0] }),
  ];
  const pens = [...bodies, ...dots], pieces = gradientPieces(pens);
  expect(pieces.slice(0, 2)).toEqual(gradientPieces(bodies));
  expect(pieces[2][0].from).toBe(gradientColor(0));
  expect(pieces[3][0].from).toBe(gradientColor(.5));
  const withoutAnchors = pens.map(({ colorAnchor: _, ...pen }) => pen);
  const times = (values: typeof pens) => createPenPlayback(values).strokes.map(({ start, end, dot }) => ({ start, end, dot }));
  expect(times(pens)).toEqual(times(withoutAnchors));
});

const phrases = ['i', 'j', 'ij', 'jiwon', 'iii', 'jjj', 'liji', 'fiji', 'big jumps', 'my name is jiwon', 'i j', 'i\nj', 'jiwon\niji'];
const witnesses = ['i', 'j'].flatMap(letter => letterContexts(letter, shaper, catalog).map(context => context.text));
for (const text of new Set([...phrases, ...witnesses])) {
  test(`dot colors match their own rendered letter body: ${JSON.stringify(text)}`, () => {
    const pens = composeText(text, shaper, catalog).strokes.map(preparePen), pieces = gradientPieces(pens);
    const dots = pens.flatMap((pen, index) => pen.colorAnchor ? [{ pen, index }] : []);
    expect(dots).toHaveLength([...text].filter(letter => letter === 'i' || letter === 'j').length);
    const spectrum = `<linearGradient id="s">${gradientPalette.map((color, i) => `<stop offset="${i / (gradientPalette.length - 1)}" stop-color="${color}"/>`).join('')}</linearGradient>`;
    let definitions = spectrum, body = '';
    for (const [index, parts] of pieces.entries()) {
      if (pens[index].colorAnchor) continue;
      for (const [j, piece] of parts.entries()) {
        const [x1, y1, x2, y2] = piece.axis, id = `c${index}-${j}`;
        definitions += `<linearGradient id="${id}" href="#s" gradientUnits="userSpaceOnUse" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
        body += `<path fill="url(#${id})" d="${gradientPieceGeometry(piece, pens[index].length, 1)}"/>`;
      }
    }
    for (const { pen, index } of dots) {
      const [x, y] = pen.colorAnchor!;
      // Sample the actual colored stem at the attached point. Rendering gives
      // an independent check on the palette position assigned to the dot.
      const pixel = raster(`<defs>${definitions}</defs>${body}`, [x - .5, y - .5, x + .5, y + .5], 1);
      expect(pixel[3]).toBe(255);
      const color = pieces[index][0].from;
      const rgb = [1, 3, 5].map(start => parseInt(color.slice(start, start + 2), 16));
      expect(Math.max(...rgb.map((value, channel) => Math.abs(value - pixel[channel]))), `dot at ${x},${y}`).toBeLessThanOrEqual(8);
      for (const piece of pieces[index]) expect(piece.to).toBe(color);
    }
  });
}

test('punctuation dots keep their own sequential colors rather than borrowing a neighboring letter', () => {
  const pens = composeText('i! j? 7:30.', shaper, catalog).strokes.map(preparePen);
  expect(pens.filter(pen => pen.colorAnchor)).toHaveLength(2);
  expect(pens.filter(pen => pen.length <= .1 && !pen.colorAnchor).length).toBeGreaterThan(0);
});
