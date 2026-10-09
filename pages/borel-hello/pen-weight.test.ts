import { expect, test } from 'vitest';
import { composeText } from './lettering';
import { expandPenBounds, penGeometry, preparePen } from './pen-geometry';
import { gradientPieceGeometry, gradientPieces } from './gradient-ink';
import { createPenPlayback, strokeState } from './pen-playback';
import { catalog, foregroundIoU, raster, shaper } from './test-font';

const paths = (values: string[]) => values.map(d => `<path d="${d}"/>`).join('');

test('weight scales the elliptical nib width without moving the centerline or endpoints', () => {
  const pen = preparePen({ d: 'M0 0L200 0', width: 40, nibScale: [1, 2] });
  for (const weight of [.5, 1, 1.5]) {
    // At the middle of a horizontal stroke the expected vertical width is
    // known analytically, independent of the generated outline.
    const pixels = raster(paths([penGeometry(pen, pen.length, 1, weight)]), [99.5, -100, 100.5, 100], 1);
    let coverage = 0;
    for (let i = 3; i < pixels.length; i += 4) coverage += pixels[i] / 255;
    expect(coverage).toBeCloseTo(80 * weight, 0);
  }
});

test('weight and growing dot pressure multiply while reset restores the exact original ink', () => {
  const pen = preparePen({ d: 'M0 0L.01 0', width: 80 });
  const original = JSON.stringify(pen), normal = penGeometry(pen);
  const area = (pressure: number, weight: number) => {
    const pixels = raster(paths([penGeometry(pen, pen.length, pressure, weight)]), [-70, -70, 70, 70], 2);
    let value = 0;
    for (let i = 3; i < pixels.length; i += 4) value += pixels[i];
    return value;
  };
  expect(area(.5, 1.5) / area(1, 1)).toBeCloseTo(.75 ** 2, 2);
  expect(penGeometry(pen, pen.length, 0, 1.5)).toBe('');
  expect(penGeometry(pen, pen.length, 1, 1)).toBe(normal);
  expect(JSON.stringify(pen)).toBe(original);
});

test('the reserved frame contains a wide elliptical nib at maximum weight without moving on slider changes', () => {
  const pen = preparePen({ d: 'M0 0L.01 0', width: 200, nibScale: [3, 1] });
  expect(expandPenBounds([-200, -200, 200, 200], [pen], 1.5)).toEqual([-452, -200, 452.01, 200]);
  expect(expandPenBounds([-200, -200, 200, 200], [{ ...pen, retrace: true }], 1.5)).toEqual([-200, -200, 200, 200]);
});

for (const text of ['hello', 'jiwon', 'tttsss', 'my name is jiwon', 'abcdefghijklmnopqrstuvwxyz', 'B D K R !? @']) {
  test(`thin and bold ink preserve the gradient footprint during writing: ${text}`, () => {
    const lettering = composeText(text, shaper, catalog), pens = lettering.strokes.map(preparePen);
    const playback = createPenPlayback(pens), pieces = gradientPieces(pens);
    const bounds = expandPenBounds(lettering.bounds, pens, 1.5);
    const snapshots = new Set([0, playback.duration]);
    for (const stroke of playback.strokes) for (const fraction of [0, .25, .5, .75, 1]) snapshots.add(stroke.start + (stroke.end - stroke.start) * fraction);
    const original = pens.map(pen => penGeometry(pen));
    for (const weight of [.5, 1.5]) for (const time of snapshots) {
      const states = playback.strokes.map(stroke => strokeState(stroke, time));
      const solid = paths([pens.map((pen, i) => penGeometry(pen, states[i].written, states[i].pressure, weight)).join(' ')]);
      // Compare unmasked geometric unions. Separate painted paths accumulate
      // antialias alpha at their overlaps; that is not a footprint difference.
      const gradient = paths([pieces.flatMap((parts, i) => parts.map(part => gradientPieceGeometry(part, states[i].written, states[i].pressure, weight))).join(' ')]);
      const a = raster(solid, bounds, .12), b = raster(gradient, bounds, .12);
      // Reordering coincident capsule contours changes a few antialias edge
      // samples. Allow 0.05% soft-alpha variance, never a new opaque pixel.
      for (let i = 3; i < a.length; i += 4) {
        if (a[i] === 0 && b[i] === 255) throw new Error(`escaped opaque pixel at ${weight}, ${time}s, pixel ${(i - 3) / 4}`);
      }
      expect(foregroundIoU(a, b), `${weight} at ${time}s`).toBeGreaterThan(.9995);
    }
    expect(pens.map(pen => penGeometry(pen))).toEqual(original);
  }, 30_000);
}
