import { expect, test } from 'vitest';
import { deformGradientPiece, gradientColor, gradientPalette, gradientPieceGeometry, gradientPieces, type GradientPiece } from './gradient-ink';
import { composeText } from './lettering';
import { expandPenBounds, penGeometry, preparePen, type PenPath } from './pen-geometry';
import { FloorRope } from './rope';
import { catalog, foregroundIoU, raster, shaper } from './test-font';

const position = (piece: GradientPiece, x: number, y: number) => {
  const [ax, ay, bx, by] = piece.axis, dx = bx - ax, dy = by - ay;
  return ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1);
};

test('color stays attached to material points under translation, rotation and uneven stretch', () => {
  const pen = preparePen({ d: 'M0 0L400 0', width: 30 });
  const templates = gradientPieces([pen])[0], before = JSON.stringify(templates);
  const deformed = { ...pen, points: pen.points.map(p => ({ ...p, x: 700 + p.distance ** 2 / 400, y: -200 + p.distance * .7 })) };
  for (const template of templates) {
    const piece = deformGradientPiece(template, deformed);
    const a = piece.pen.points[0], b = piece.pen.points[piece.pen.points.length - 1];
    expect(position(piece, a.x, a.y)).toBeCloseTo(template.start / pen.length, 10);
    expect(position(piece, b.x, b.y)).toBeCloseTo(template.end / pen.length, 10);
    expect(piece.from).toBe(template.from); expect(piece.to).toBe(template.to);
  }
  expect(JSON.stringify(templates)).toBe(before);
});

test('new bend samples and radii remain inside each fixed material color interval', () => {
  const pen: PenPath = { length: 100, nibScale: [1, 1], points: [
    { x: 0, y: 0, radius: 15, distance: 0 }, { x: 100, y: 0, radius: 15, distance: 100 },
  ] };
  const deformed = { ...pen, points: Array.from({ length: 21 }, (_, i) => ({ x: i * 5, y: 30 * Math.sin(i * Math.PI / 20), radius: 15 + i / 20, distance: i * 5 })) };
  const piece = deformGradientPiece(gradientPieces([pen])[0][0], deformed);
  expect(piece.pen.points).toHaveLength(deformed.points.length);
  for (const [i, point] of piece.pen.points.entries()) {
    expect(point.x).toBeCloseTo(deformed.points[i].x, 10);
    expect(point.y).toBeCloseTo(deformed.points[i].y, 10);
    expect(point.radius).toBe(deformed.points[i].radius);
    expect(point.distance).toBe(deformed.points[i].distance);
  }
  expect(piece.pen.length).toBe(100);
});

test('moving a deferred dot near the wrong stem cannot change its assigned color', () => {
  const pens = [
    preparePen({ d: 'M0 0L0 200', width: 40 }),
    preparePen({ d: 'M100 0L100 200', width: 40 }),
    preparePen({ d: 'M0 -50L.01 -50', width: 30, colorAnchors: [[0, 0]] }),
  ];
  const templates = gradientPieces(pens);
  const moved = { ...pens[2], points: pens[2].points.map(p => ({ ...p, x: p.x + 1000, y: p.y + 500 })) };
  for (const template of templates[2]) {
    const piece = deformGradientPiece(template, moved);
    expect(piece.solid).toBe(gradientColor(0));
    expect(piece.pen.points[0].x).toBeGreaterThan(900);
  }
});

test('tt crossbar colors keep their two stem assignments after the lettering moves', () => {
  const pens = composeText('tttsss', shaper, catalog).strokes.map(preparePen), templates = gradientPieces(pens);
  for (const [i, pen] of pens.entries()) {
    if (!pen.colorAnchors) continue;
    const moved = { ...pen, points: pen.points.map(p => ({ ...p, x: 500 - p.y, y: -800 + p.x })) };
    for (const template of templates[i]) {
      const piece = deformGradientPiece(template, moved);
      expect(piece.from).toBe(template.from); expect(piece.to).toBe(template.to);
      if (piece.solid) { expect(piece.solid).toBe(template.solid); continue; }
      for (const end of [0, template.pen.points.length - 1]) {
        const original = template.pen.points[end], current = piece.pen.points[end];
        expect(position(piece, current.x, current.y)).toBeCloseTo(position(template, original.x, original.y), 8);
      }
    }
  }
});

for (const text of ['hello', 'jiwon', 'tttsss', 'my name is jiwon']) {
  test(`pulled gradient rope keeps the solid silhouette, edge color and weight: ${text}`, () => {
    const lettering = composeText(text, shaper, catalog), pens = lettering.strokes.map(preparePen);
    const rope = new FloorRope(pens), templates = gradientPieces(pens);
    const body = pens.find(p => !p.retrace && p.length > 500)!;
    const start = body.points[Math.floor(body.points.length / 2)];
    expect(rope.pick(start.x, start.y, 35)).toBe(true);
    rope.move(start.x + 1100, start.y - 1000);
    for (let frame = 0; frame < 12; frame++) rope.step(1 / 30);
    rope.release();
    for (let frame = 0; frame < 36; frame++) rope.step(1 / 30);
    const curves = pens.map((_, i) => rope.deformed(i));
    const parts = templates.map((pieces, i) => pieces.map(piece => deformGradientPiece(piece, curves[i])));
    const spectrum = `<linearGradient id="s">${gradientPalette.map((color, i) => `<stop offset="${i / (gradientPalette.length - 1)}" stop-color="${color}"/>`).join('')}</linearGradient>`;
    const axes = parts.map((pieces, i) => pieces.map((piece, j) => {
      const [x1, y1, x2, y2] = piece.axis;
      return `<linearGradient id="c${i}-${j}" href="#s" gradientUnits="userSpaceOnUse" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
    }).join('')).join('');
    for (const weight of [.5, 1, 1.5]) {
      const bounds = expandPenBounds(lettering.bounds, curves, weight), [left, top, right, bottom] = bounds;
      const rect = `x="${left}" y="${top}" width="${right - left}" height="${bottom - top}"`;
      const ink = curves.map(pen => `<path d="${penGeometry(pen, undefined, 1, weight)}"/>`).join('');
      const color = parts.map((pieces, i) => pieces.map((piece, j) => `<path fill="${piece.solid ?? `url(#c${i}-${j})`}" d="${gradientPieceGeometry(piece, curves[i].length, 1, weight)}"/>`).join('')).join('');
      const opaque = `<filter id="o" filterUnits="userSpaceOnUse" ${rect} color-interpolation-filters="sRGB"><feComponentTransfer><feFuncA type="linear" slope="0" intercept="1"/></feComponentTransfer></filter>`;
      const actual = raster(`<defs>${spectrum}${axes}${opaque}<mask id="m" maskUnits="userSpaceOnUse" mask-type="alpha" ${rect}>${ink}</mask></defs><g mask="url(#m)"><g filter="url(#o)">${color}</g></g>`, bounds, .1);
      const expected = raster(ink, bounds, .1);
      // Moving fractional filter/mask bounds can round edge alpha differently.
      // Keep >99.9% overlap, and independently reject uncolored RGB fringes.
      expect(foregroundIoU(actual, expected)).toBeGreaterThan(.999);
      const minimum = [0, 1, 2].map(channel => Math.min(...gradientPalette.map(hex => parseInt(hex.slice(1 + channel * 2, 3 + channel * 2), 16))));
      for (let i = 0; i < actual.length; i += 4) {
        if (actual[i + 3] < 64) continue;
        for (let channel = 0; channel < 3; channel++) {
          if (actual[i + channel] * 255 / actual[i + 3] < minimum[channel] - 5) throw new Error(`uncolored edge at ${weight}, pixel ${i / 4}`);
        }
      }
    }
  });
}

test('empty ropes and invisible retraces have no color pieces', () => {
  expect(gradientPieces([])).toEqual([]);
  const pen = preparePen({ d: 'M0 0L100 0', width: 30 });
  expect(gradientPieces([{ ...pen, retrace: true }])).toEqual([[]]);
});
