import { test, expect } from 'vitest';
import { activeOrderStep, createStrokeOrder, letterContexts, orderTip, pointAt } from './stroke-order';
import { createPenPlayback, strokeState } from './pen-playback';
import { preparePen } from './pen-geometry';
import { composeText } from './lettering';
import { catalog, shaper, supportedGlyphWitnesses } from './test-font';

test('inspection follows actual ink positions at every frame, including lifts and dots', () => {
  for (const text of ['hello', 'jiwon', 'my name is jiwon', 'th la', 'x f d b k', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', '0123 !? &@']) {
    const playback = createPenPlayback(composeText(text, shaper, catalog).strokes.map(preparePen));
    const steps = createStrokeOrder(playback);
    expect(steps[0].start).toBe(0);
    expect(steps[steps.length - 1].end).toBeCloseTo(playback.duration, 10);
    for (let frame = 0; frame <= Math.ceil(playback.duration * 60); frame++) {
      const time = Math.min(playback.duration, frame / 60), step = steps[activeOrderStep(steps, time)];
      const tip = orderTip(playback, step, time), timed = playback.strokes[step.stroke];
      if (step.kind === 'lift') {
        expect(time).toBeGreaterThanOrEqual(playback.strokes[step.stroke - 1].end);
        expect(time).toBeLessThan(timed.start);
        expect(strokeState(timed, time).written).toBe(0);
      } else {
        const ink = pointAt(timed.pen, strokeState(timed, time).written);
        expect(Math.hypot(ink.x - tip.x, ink.y - tip.y)).toBeLessThan(.000001);
      }
    }
    for (let i = 1; i < steps.length; i++) expect(steps[i].start).toBeCloseTo(steps[i - 1].end, 10);
  }
});

test('inspection retains repeated movement, separate dot timing and empty input', () => {
  const pen = preparePen({ d: 'M0 0C0 -200 0 -400 0 -600' });
  const playback = createPenPlayback([pen, { ...pen, retrace: true }, preparePen({ d: 'M0 -900C0 -900 0 -900 0 -900' })]);
  const steps = createStrokeOrder(playback);
  expect(steps.filter(step => step.kind === 'retrace').length).toBeGreaterThan(0);
  expect(steps.filter(step => step.kind === 'lift')).toHaveLength(2);
  const dot = steps[steps.length - 1];
  expect(dot.kind).toBe('dot'); expect(dot.end - dot.start).toBeCloseTo(.16);
  expect(createStrokeOrder({ strokes: [], duration: 0 })).toEqual([]);
  expect(activeOrderStep([], 0)).toBe(-1);
});

test('letter selector reaches every supported unaccented contextual letter form', () => {
  const witnesses = supportedGlyphWitnesses();
  for (const letter of 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ') {
    const expected = [...witnesses.keys()].filter(id => catalog.glyphs[id].name.split('.')[0] === letter);
    const actual = letterContexts(letter, shaper, catalog);
    expect(actual.map(value => value.id).sort((a, b) => a - b), letter).toEqual(expected.sort((a, b) => a - b));
    for (const context of actual) expect(shaper.shape(context.text).some(glyph => glyph.id === context.id)).toBe(true);
  }
});
