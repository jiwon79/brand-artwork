import { expect, test } from 'vitest';
import { composeText } from './lettering';
import { penGeometry, preparePen } from './pen-geometry';
import { createPenPlayback, strokeState } from './pen-playback';
import { catalog, raster, shaper } from './test-font';

for (const text of ['ij', 'jiwon', 'iii', 'jjj', 'my name is jiwon', 'i j', 'i\nj', '7:30!']) {
  test(`stationary dots press separately with a pen lift: ${text}`, () => {
    const lettering = composeText(text, shaper, catalog);
    const playback = createPenPlayback(lettering.strokes.map(preparePen));
    const dots = playback.strokes.filter(stroke => stroke.dot);
    expect(dots.length).toBeGreaterThan(0);
    let previousEnd = -Infinity;
    for (const dot of dots) {
      expect(dot.end - dot.start).toBeGreaterThanOrEqual(.159);
      expect(dot.start - previousEnd).toBeGreaterThanOrEqual(.1);
      previousEnd = dot.end;
      const visible = Array.from({ length: Math.ceil(playback.duration * 60) + 1 }, (_, frame) => frame / 60)
        .filter(time => time > dot.start && time < dot.end);
      expect(visible.length).toBeGreaterThanOrEqual(9);
      const penIndex = playback.strokes.indexOf(dot), before = playback.strokes[penIndex - 1];
      if (before) expect(dot.start - before.end).toBeGreaterThanOrEqual(.1);
      for (const time of visible) {
        expect(playback.strokes.filter(stroke => time > stroke.start && time < stroke.end)).toEqual([dot]);
      }
    }
    // Ordered schedule is still valid when the GUI rescales overall duration.
    for (const speed of [.5, 1, 2]) {
      const starts = dots.map(dot => Math.ceil(dot.start * 60 / speed));
      for (let i = 1; i < starts.length; i++) expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(7);
    }
    for (const stroke of playback.strokes) {
      const state = strokeState(stroke, playback.duration);
      expect(penGeometry(stroke.pen, state.written, state.pressure)).toBe(penGeometry(stroke.pen));
    }
  });
}

test('a dot grows round contact area instead of appearing at full diameter', () => {
  const pen = preparePen({ d: 'M0 0 C0.003 0 0.007 0 0.01 0', width: 120, nibScale: [1, 1.1] });
  const playback = createPenPlayback([pen]), dot = playback.strokes[0];
  const amounts = [0, .1, .25, .5, .75, 1].map(progress => {
    const state = strokeState(dot, dot.start + (dot.end - dot.start) * progress);
    const pixels = raster(`<path d="${penGeometry(pen, state.written, state.pressure)}"/>`, [-80, -80, 80, 80], 1);
    return pixels.reduce((sum, alpha, i) => sum + (i % 4 === 3 ? alpha : 0), 0);
  });
  expect(amounts[0]).toBe(0);
  expect(amounts[1] / amounts[5]).toBeLessThan(.02);
  expect(amounts[3] / amounts[5]).toBeCloseTo(.25, 1);
  for (let i = 1; i < amounts.length; i++) expect(amounts[i]).toBeGreaterThan(amounts[i - 1]);
});

test('pen-up travel never paints a line between distant dots', () => {
  const pens = [0, 300].map(x => preparePen({ d: `M${x} 0 L${x + .01} 0`, width: 100 }));
  const playback = createPenPlayback(pens), [first, second] = playback.strokes;
  const time = (first.end + second.start) / 2;
  expect(strokeState(first, time)).toEqual({ written: first.pen.length, pressure: 1 });
  expect(strokeState(second, time)).toEqual({ written: 0, pressure: 0 });
  expect(playback.strokes).toHaveLength(2);
});
