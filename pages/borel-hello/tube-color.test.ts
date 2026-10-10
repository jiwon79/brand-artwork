import { Color } from 'three';
import { expect, test } from 'vitest';
import { composeText } from './lettering';
import { gradientColor, gradientPalette, gradientPieces } from './gradient-ink';
import { preparePen, type PenPath } from './pen-geometry';
import { catalog, shaper } from './test-font';
import { createTubeColors, tubeRainbowColor } from './tube-color';

// Probe colors on the actual piecewise-linear mesh centerline, independently
// of the gradient-axis and mark mapping code. Ties select the visible late pass.
function probe(pens: readonly PenPath[], colors: readonly Color[][], x: number, y: number, marked: boolean) {
  let nearest = Infinity, color = new Color();
  for (const [index, pen] of pens.entries()) {
    if (pen.retrace || !!pen.colorAnchors !== marked || pen.length <= .1) continue;
    for (let i = 1; i < pen.points.length; i++) {
      const a = pen.points[i - 1], b = pen.points[i], dx = b.x - a.x, dy = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1)));
      const distance = Math.hypot(a.x + t * dx - x, a.y + t * dy - y);
      if (distance <= nearest + 1e-8) { nearest = distance; color = colors[index][i - 1].clone().lerp(colors[index][i], t); }
    }
  }
  return color;
}

test('3D dots use their own stem anchors even when physically nearer another letter', () => {
  const bodies = [0, 100, 200].map(x => preparePen({ d: `M${x} 0L${x} 200`, width: 40 }));
  const dots = [
    preparePen({ d: 'M95 -10L95.01 -10', width: 30, colorAnchors: [[0, 0]] }),
    preparePen({ d: 'M100 -50L100.01 -50', width: 30, colorAnchors: [[100, 0]] }),
  ];
  const colors = createTubeColors([...bodies, ...dots]);
  expect(colors.slice(0, 3)).toEqual(createTubeColors(bodies));
  expect(colors[3][0].getHexString()).toBe('ff5f5f');
  expect(colors[4][0]).toEqual(colors[1][0]);
  for (const dot of colors.slice(3)) expect(dot.every(color => color.equals(dot[0]))).toBe(true);
});

for (const text of ['jiwon', 'ij', 'tttsss', 'little letters flow', 'my name is jiwon', 'tttsss\niji']) {
  test(`3D dots and crossbars match nearby body colors: ${JSON.stringify(text)}`, () => {
    const pens = composeText(text, shaper, catalog).strokes.map(preparePen), colors = createTubeColors(pens);
    expect(colors.map(values => values.length)).toEqual(pens.map(pen => pen.points.length));
    let checked = 0;
    for (const [index, pen] of pens.entries()) for (const [x, y] of pen.colorAnchors ?? []) {
      const body = probe(pens, colors, x, y, false);
      const mark = pen.length <= .1 ? colors[index][0] : probe([pen], [colors[index]], x, y, true);
      for (const channel of ['r', 'g', 'b'] as const) expect(Math.abs(body[channel] - mark[channel])).toBeLessThan(.015);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });
}

test('3D palette leaves existing 2D colors unchanged and empty text creates no colors', () => {
  const pens = composeText('hello', shaper, catalog).strokes.map(preparePen);
  const palette = [...gradientPalette], before = gradientPieces(pens);
  createTubeColors(pens);
  expect(gradientPieces(pens)).toEqual(before);
  expect(gradientPalette).toEqual(palette);
  expect(gradientColor(0)).toBe('#2589a6');
  expect(gradientColor(1)).toBe('#7ab6da');
  expect(tubeRainbowColor(-1).getHexString()).toBe('ff5f5f');
  expect(tubeRainbowColor(2).getHexString()).toBe('ff5f5f');
  expect(createTubeColors([])).toEqual([]);
});


test('3D color follows position through reversed curves, independent of stroke order and retracing', () => {
  const forward = preparePen({ d: 'M0 0L100 0L200 0', width: 40 });
  const reverse = preparePen({ d: 'M200 100L100 100L0 100', width: 40 });
  const retrace = preparePen({ d: 'M-2000 0L3000 0', width: 40, retrace: true });
  const [a, b] = createTubeColors([forward, reverse, retrace]);
  for (const [i, color] of a.entries()) for (const channel of ['r', 'g', 'b'] as const) {
    expect(color[channel]).toBeCloseTo(b[b.length - 1 - i][channel], 12);
  }
  expect(createTubeColors([reverse, forward]).reverse()).toEqual([a, b]);
  expect(tubeRainbowColor(.495215).getHexString()).toBe('8edccb');
  expect(tubeRainbowColor(.7).getHexString()).toBe('819bfc');
});

test('mark-only and vertical text have finite, stable colors', () => {
  for (const strokes of [
    [{ d: 'M50 0L50 200', width: 40 }],
    [{ d: 'M50 0L50.01 0', width: 40, colorAnchors: [[50, 100] as const] }],
  ]) {
    const colors = createTubeColors(strokes.map(preparePen));
    expect(colors.flat().every(color => [color.r, color.g, color.b].every(Number.isFinite))).toBe(true);
  }
});
