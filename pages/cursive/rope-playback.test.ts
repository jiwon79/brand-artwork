import { expect, test } from 'vitest';
import { visibleRopePens } from './rope-playback';
import { createPenPlayback, strokeState } from './pen-playback';
import { penGeometry, preparePen } from './pen-geometry';
import { composeText } from './lettering';
import { FloorRope } from './rope';
import { catalog, foregroundIoU, raster, shaper } from './test-font';
import { deformGradientPiece, gradientPieces } from './gradient-ink';

for (const text of ['hello', 'jiwon', 'ij', 'tttsss']) test(`pausing preserves only the existing ink and moving dot pressure: ${text}`, () => {
  const lettering = composeText(text, shaper, catalog);
  const playback = createPenPlayback(lettering.strokes.map(preparePen));
  const times = [0, .18, playback.duration * .37, playback.duration * .81, playback.duration,
    ...playback.strokes.filter(stroke => stroke.dot).map(stroke => (stroke.start + stroke.end) / 2)];
  for (const time of times) {
    const snapshot = visibleRopePens(playback, time), rope = new FloorRope(snapshot);
    const before = playback.strokes.map(stroke => {
      const { written, pressure } = strokeState(stroke, time);
      return `<path d="${penGeometry(stroke.pen, written, pressure)}"/>`;
    }).join('');
    const after = snapshot.map((_, index) => `<path d="${penGeometry(rope.deformed(index))}"/>`).join('');
    if (time > 0) expect(foregroundIoU(raster(before, lettering.bounds, .2), raster(after, lettering.bounds, .2))).toBeGreaterThan(.9999);
    for (const [index, stroke] of playback.strokes.entries()) if (time <= stroke.start) expect(snapshot[index].points).toEqual([]);
  }
  // Snapshotting and dragging do not mutate the recipes used to resume/replay.
  expect(visibleRopePens(playback, playback.duration).filter(pen => !pen.retrace)).toEqual(playback.strokes.map(stroke => stroke.pen).filter(pen => !pen.retrace));
});

test('a partially written rainbow interval keeps its material color instead of stretching the remaining colors', () => {
  const pen = preparePen({ d: 'M0 0L100 0', width: 20 });
  const playback = createPenPlayback([pen]);
  const clipped = visibleRopePens(playback, playback.duration * .575)[0];
  const templates = gradientPieces([pen])[0];
  const template = templates.find(piece => piece.start < clipped.length && piece.end > clipped.length)!;
  const piece = deformGradientPiece(template, clipped);
  const tip = piece.pen.points[piece.pen.points.length - 1];
  const [x1, y1, x2, y2] = piece.axis;
  const position = ((tip.x - x1) * (x2 - x1) + (tip.y - y1) * (y2 - y1)) / ((x2 - x1) ** 2 + (y2 - y1) ** 2);
  expect(position).toBeCloseTo(.575, 10);
  expect(piece.pen.length).toBeCloseTo(clipped.length - template.start, 10);
});
