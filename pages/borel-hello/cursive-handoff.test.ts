import { expect, test } from 'vitest';
import { composeText } from './lettering';
import { preparePen } from './pen-geometry';
import { routeWord } from './pen-routing';
import { catalog, shaper, textForegroundIoU } from './test-font';
import { createTubePaths, subtract, unit, dot } from './tube-geometry';

for (const text of ['ji', 'jiwon', 'jiji', 'fiji', 'aji', 'bji', 'gji']) {
  test(`the j-to-i handoff has no reverse wiggle or folded tube rings: ${text}`, () => {
    const glyphs = shaper.shape(text), origin = (6200 - glyphs.reduce((sum, glyph) => sum + glyph.advance, 0)) / 2;
    const pens = composeText(text, shaper, catalog).strokes.map(preparePen);
    const tubes = createTubePaths(pens, [0, 0]);
    for (let g = 1; g < glyphs.length; g++) {
      if (!/^j(?:\.|$)/.test(catalog.glyphs[glyphs[g - 1].id].name) || !/^i(?:\.|$)/.test(catalog.glyphs[glyphs[g].id].name)) continue;
      const entry = origin + glyphs[g].x - 145;
      let samples = 0;
      for (const tube of tubes) for (let i = 1; i + 1 < tube.points.length; i++) {
        const [a, b, c] = tube.points.slice(i - 1, i + 2), [x, y] = b.center;
        if (x < (entry - 75) * .001 || x > (entry + 75) * .001 || Math.abs(y) > .08) continue;
        const incoming = subtract(b.center, a.center), outgoing = subtract(c.center, b.center);
        // Only the rightward return from j's lower loop, not its vertical stem.
        if (incoming[0] <= 0 || unit(incoming)[0] < .4) continue;
        samples++;
        expect(outgoing[1], `reversed ascent at ${i}`).toBeGreaterThanOrEqual(-.00001);
        const angle = Math.acos(Math.max(-1, Math.min(1, dot(unit(incoming), unit(outgoing)))));
        const curvature = angle / ((Math.hypot(...incoming) + Math.hypot(...outgoing)) / 2);
        // A bend tighter than the tube radius folds its inner surface. Leave
        // a 20% margin at maximum weight, independently of pixel overlap.
        expect(curvature * b.radius * 1.5, `tight bend at ${i}`).toBeLessThan(.8);
      }
      expect(samples).toBeGreaterThan(3);
    }
    expect(textForegroundIoU(text)).toBeGreaterThanOrEqual(.95);
  });
}

test('a short offset between aligned curves is absorbed without a tiny S-shaped bridge or mutating the recipes', () => {
  const a = { d: 'M0 100 C20 80 40 60 100 20', widths: [[90, 90, 90, 90] as [number, number, number, number]], ordered: true };
  const b = { d: 'M125 18 C170 -12 200 -50 200 -100', widths: [[92, 92, 92, 92] as [number, number, number, number]], ordered: true };
  const before = JSON.stringify([a, b]), result = routeWord([[a], [b]]);
  expect(result).toHaveLength(2);
  const left = preparePen(result[0]), right = preparePen(result[1]);
  expect(left.points[left.points.length - 1]).toMatchObject({ x: right.points[0].x, y: right.points[0].y, radius: right.points[0].radius });
  expect(result[0].d.match(/C/g)).toHaveLength(2);
  expect(result[1]).toEqual(b);
  expect(JSON.stringify([a, b])).toBe(before);
});
