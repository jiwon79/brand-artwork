import { expect, test } from 'vitest';
import { composeText } from './lettering';
import { gradientColor, gradientPalette, gradientPieceGeometry, gradientPieces } from './gradient-ink';
import { penGeometry, preparePen } from './pen-geometry';
import { createPenPlayback, strokeState } from './pen-playback';
import { catalog, foregroundIoU, raster, shaper } from './test-font';

test('a crossing may recolor only the actual nib footprint, even inside existing ink', () => {
  const pens = [preparePen({ d: 'M0 -300L0 300', width: 90 }), preparePen({ d: 'M-300 0L300 0', width: 90 })];
  const pieces = gradientPieces(pens);
  // Use contrasting flat colors to make ownership independent of the palette.
  // The shared mask alone cannot catch recoloring inside the previous stroke.
  const ink = pens.map(pen => `<path d="${penGeometry(pen)}"/>`).join('');
  const color = pieces.map((parts, i) => parts.map(part => `<path fill="${i ? '#0000ff' : '#ff0000'}" d="${gradientPieceGeometry(part, pens[i].length, 1)}"/>`).join('')).join('');
  const actual = raster(`<defs><mask id="ink" mask-type="alpha" maskUnits="userSpaceOnUse" x="-350" y="-350" width="700" height="700">${ink}</mask></defs><g mask="url(#ink)">${color}</g>`, [-350, -350, 350, 350], 1);
  const pixel = (x: number, y: number) => Array.from(actual.slice(((y + 350) * 700 + x + 350) * 4, ((y + 350) * 700 + x + 350) * 4 + 4));
  expect(pixel(0, 0)).toEqual([0, 0, 255, 255]);
  for (const y of [-55, -50, 49, 54]) expect(pixel(0, y), `old ink at y=${y}`).toEqual([255, 0, 0, 255]);
});

test('the spectrum follows the full pen journey without restarting at a stroke or pen lift', () => {
  const pens = composeText('hello jiwon', shaper, catalog).strokes.map(preparePen);
  const pieces = gradientPieces(pens), flat = pieces.filter((_, index) => !pens[index].colorAnchors).flat();
  expect(flat[0].from).toBe(gradientColor(0));
  expect(flat[flat.length - 1].to).toBe(gradientColor(1));
  for (let i = 1; i < flat.length; i++) expect(flat[i].from).toBe(flat[i - 1].to);
  for (const [index, parts] of pieces.entries()) {
    expect(parts.reduce((sum, part) => sum + part.pen.length, 0)).toBeCloseTo(pens[index].length, 6);
    for (let i = 1; i < parts.length; i++) {
      const previous = parts[i - 1].pen.points;
      expect(parts[i].start).toBe(parts[i - 1].end);
      expect(parts[i].pen.points[0].x).toBe(previous[previous.length - 1].x);
      expect(parts[i].pen.points[0].y).toBe(previous[previous.length - 1].y);
    }
  }
});

test('empty input and inkless retraces do not consume colors or produce colored geometry', () => {
  const pen = preparePen({ d: 'M0 0L200 0', width: 50 });
  expect(gradientPieces([])).toEqual([]);
  const withReturn = gradientPieces([pen, { ...pen, retrace: true }, pen]);
  expect(withReturn[1]).toEqual([]);
  expect([withReturn[0], withReturn[2]]).toEqual(gradientPieces([pen, pen]));
});

test('a later piece is invisible until the nib arrives and a completed piece stays fixed', () => {
  const pieces = gradientPieces([preparePen({ d: 'M0 0L600 0', width: 80 })])[0];
  const piece = pieces[2];
  expect(gradientPieceGeometry(piece, piece.start, 1)).toBe('');
  expect(gradientPieceGeometry(piece, piece.end, 0)).toBe('');
  expect(gradientPieceGeometry(piece, piece.end, 1)).toBe(gradientPieceGeometry(piece, 600, 1));
  expect(gradientPieceGeometry(piece, piece.start + 20, 1)).not.toBe(gradientPieceGeometry(piece, piece.end, 1));
});

test('overlapping round caps share the same extended color field along a straight stroke', () => {
  const pieces = gradientPieces([preparePen({ d: 'M100 200L900 200', width: 80 })])[0];
  // A local two-stop gradient would clamp each back cap to its starting color.
  // Each interval must instead reproduce this single, analytic color field.
  for (const piece of pieces) {
    const [x1, y1, x2, y2] = piece.axis;
    expect(x1).toBeCloseTo(100, 6);
    expect(x2).toBeCloseTo(900, 6);
    expect(y1).toBe(200); expect(y2).toBe(200);
    for (const x of [piece.pen.points[0].x - 30, piece.pen.points[0].x + 30]) {
      expect(gradientColor((x - x1) / (x2 - x1))).toBe(gradientColor((x - 100) / 800));
    }
  }
});

// Compare real raster output, including crossings, growing dots and crossbars.
// The color layer is opaque; only the original authored geometry supplies alpha.
for (const text of ['hello', 'jiwon', 'tttsss', 'little letters flow', 'my name is jiwon', 'abcdefghijklmnopqrstuvwxyz', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', '0123456789', 'B D K R !?']) {
  test(`gradient keeps the original ink silhouette throughout playback: ${text}`, () => {
    const lettering = composeText(text, shaper, catalog), pens = lettering.strokes.map(preparePen);
    const playback = createPenPlayback(pens), pieces = gradientPieces(pens);
    const definitions = pieces.map((parts, i) => parts.map((part, j) => {
      const [x1, y1, x2, y2] = part.axis;
      return `<linearGradient id="c-${i}-${j}" href="#spectrum" gradientUnits="userSpaceOnUse" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
    }).join('')).join('');
    const spectrum = `<linearGradient id="spectrum">${gradientPalette.map((color, i) => `<stop offset="${i / (gradientPalette.length - 1)}" stop-color="${color}"/>`).join('')}</linearGradient>`;
    const [left, top, right, bottom] = lettering.bounds;
    const rect = `x="${left}" y="${top}" width="${right - left}" height="${bottom - top}"`;
    const detailFrames = new Set([0, .1, .25, .5, .75, 1].map(fraction => playback.duration * fraction));
    for (const stroke of playback.strokes.filter(stroke => stroke.dot)) {
      for (const fraction of [0, .25, .5, 1]) detailFrames.add(stroke.start + (stroke.end - stroke.start) * fraction);
    }
    const frames = new Set(detailFrames);
    if (['hello', 'jiwon', 'tttsss', 'my name is jiwon', 'abcdefghijklmnopqrstuvwxyz', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', '0123456789'].includes(text)) {
      for (let frame = 0; frame <= Math.ceil(playback.duration * 60); frame++) frames.add(Math.min(playback.duration, frame / 60));
    }
    for (const time of frames) {
      const states = playback.strokes.map(stroke => strokeState(stroke, time));
      const ink = pens.map((pen, i) => `<path d="${penGeometry(pen, states[i].written, states[i].pressure)}"/>`).join('');
      const color = pieces.map((parts, i) => parts.map((part, j) => `<path fill="${part.solid ?? `url(#c-${i}-${j})`}" d="${gradientPieceGeometry(part, states[i].written, states[i].pressure)}"/>`).join('')).join('');
      const opaque = `<filter id="opaque" filterUnits="userSpaceOnUse" ${rect} color-interpolation-filters="sRGB"><feComponentTransfer><feFuncA type="linear" slope="0" intercept="1"/></feComponentTransfer></filter>`;
      const body = `<defs>${spectrum}${definitions}${opaque}<mask id="ink" maskUnits="userSpaceOnUse" mask-type="alpha" ${rect}>${ink}</mask></defs><g mask="url(#ink)"><g filter="url(#opaque)">${color}</g></g>`;
      // Keep every 60 fps frame; long, wrapped passages need less raster area
      // between detailed checkpoints. Dots and completion keep full precision,
      // while gradient-footprint.test.ts checks each nib interval at .5 scale.
      const scale = text.length >= 16 && !detailFrames.has(time) ? .06 : .12;
      const actual = raster(body, lettering.bounds, scale), expected = raster(ink, lettering.bounds, scale);
      // Allow only 8-bit mask-compositing rounding at antialiased edges.
      expect(foregroundIoU(actual, expected), `at ${time}s`).toBeGreaterThan(.99999);
      // Alpha normalization must preserve RGB at edges. An uncovered black
      // fringe could keep perfect silhouette IoU while still looking wrong.
      const minimum = [0, 1, 2].map(channel => Math.min(...gradientPalette.map(hex => parseInt(hex.slice(1 + channel * 2, 3 + channel * 2), 16))));
      for (let i = 0; i < actual.length; i += 4) {
        const alpha = actual[i + 3];
        if (alpha < 64) continue;
        for (let channel = 0; channel < 3; channel++) {
          if (actual[i + channel] * 255 / alpha < minimum[channel] - 5) throw new Error(`uncolored edge at ${time}s, pixel ${i / 4}`);
        }
      }
      if (time === playback.duration) {
        const colors = new Set<string>();
        for (let i = 0; i < actual.length; i += 4) if (actual[i + 3] === 255) colors.add(`${actual[i]},${actual[i + 1]},${actual[i + 2]}`);
        expect(colors.size).toBeGreaterThan(100);
      }
    }
  }, 180_000);
}
