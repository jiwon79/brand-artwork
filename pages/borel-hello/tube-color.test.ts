import { Color } from 'three';
import { expect, test } from 'vitest';
import { composeText } from './lettering';
import { gradientColor, gradientPalette, gradientPieces } from './gradient-ink';
import { preparePen, type PenPath } from './pen-geometry';
import { catalog, shaper } from './test-font';
import { createTubeColors, tubeRainbowPalette } from './tube-color';

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
  const bodies = [0, 100].map(x => preparePen({ d: `M${x} 0L${x} 200`, width: 40 }));
  const dots = [
    preparePen({ d: 'M95 -10L95.01 -10', width: 30, colorAnchors: [[0, 0]] }),
    preparePen({ d: 'M100 -50L100.01 -50', width: 30, colorAnchors: [[100, 0]] }),
  ];
  const colors = createTubeColors([...bodies, ...dots]);
  expect(colors.slice(0, 2)).toEqual(createTubeColors(bodies));
  expect(colors[2][0].getHexString()).toBe('1686ff');
  expect(colors[3][0].getHexString()).toBe('fa473c');
  for (const dot of colors.slice(2)) expect(dot.every(color => color.equals(dot[0]))).toBe(true);
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
  expect(gradientColor(-1, tubeRainbowPalette)).toBe('#1686ff');
  expect(gradientColor(2, tubeRainbowPalette)).toBe('#00b6a0');
  expect(createTubeColors([])).toEqual([]);
});
