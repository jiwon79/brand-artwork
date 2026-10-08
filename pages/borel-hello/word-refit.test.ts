import { expect, test } from 'vitest';
import { composeText } from './lettering';
import { penGeometry, preparePen, type PenPath } from './pen-geometry';
import { catalog, raster, shaper, textForegroundIoU } from './test-font';
import { auditPen, inkTravelPasses, measureInkTravel, missingNibInterior, samplePen } from './test-pen-quality';

// Exercise initial, medial and final forms in real words. Final-shape parity
// and intermediate pen quality are independent requirements.
for (const text of [
  'my', 'amy', 'mama', 'many', 'mom', 'mommy', 'mum', 'memory', 'maybe', 'monday',
  'yummy', 'happy', 'sunny', 'rhythm', 'mystery', 'family', 'your', 'yellow', 'maya',
  'name', 'is', 'jiwon', 'my name', 'my name is jiwon',
]) test(`refitted words retain source ink overlap: ${text}`, () => {
  expect(textForegroundIoU(text)).toBeGreaterThanOrEqual(.95);
});

for (const text of ['my', 'name', 'is', 'jiwon', 'my name is jiwon']) test(`reviewed phrase has no nib or flow regressions: ${text}`, () => {
  expect(auditPen(composeText(text, shaper, catalog).strokes)).toEqual([]);
});

for (const text of ['my', 'name', 'is', 'jiwon']) test(`word body remains connected before dotting: ${text}`, () => {
  // Dots are separate marks with a stationary center, drawn after the word.
  const pens = composeText(text, shaper, catalog).strokes.map(preparePen).filter(pen => pen.length > .1);
  for (let i = 1; i < pens.length; i++) {
    const before = pens[i - 1].points, a = before[before.length - 1], b = pens[i].points[0];
    expect(Math.hypot(a.x - b.x, a.y - b.y), `pen lift inside ${text}, stroke ${i}`).toBeLessThan(.01);
  }
});

function atDistance(pens: PenPath[], distance: number) {
  let remaining = distance, active = pens[0], written = 0;
  const body = pens.map(pen => {
    const traveled = Math.max(0, Math.min(pen.length, remaining));
    if (remaining > 0) { active = pen; written = traveled; }
    remaining -= pen.length;
    return `<path d="${penGeometry(pen, traveled)}"/>`;
  }).join('');
  return { body, active, written };
}

test('my reported frames and their neighbors retain a round, full-size pen tip', () => {
  const lettering = composeText('my', shaper, catalog), pens = lettering.strokes.map(preparePen);
  const length = pens.reduce((sum, pen) => sum + pen.length, 0);
  for (const reported of [22, 60, 120, 166]) for (const frame of [reported - 1, reported, reported + 1]) {
    const { body, active, written } = atDistance(pens, length * frame / 240);
    expect(active.retrace, `reported visible pen tip at ${frame}`).not.toBe(true);
    const tip = samplePen(active, written);
    // A nearly zero tip can pass a round-cap raster test while looking angular.
    expect(tip.radius, `collapsed nib at ${frame}`).toBeGreaterThan(32);
    expect(tip.radius, `inflated crossing at ${frame}`).toBeLessThan(52);
    expect(missingNibInterior(raster(body, lettering.bounds, .35), lettering.bounds, .35, tip, active.nibScale),
      `cut-off cap at ${frame}`).toBeLessThan(.002);
  }
});

test('every phrase frame preserves ink and paints only the traveled pen footprint', () => {
  const lettering = composeText('my name is jiwon', shaper, catalog), pens = lettering.strokes.map(preparePen);
  const length = pens.reduce((sum, pen) => sum + pen.length, 0), scale = .1;
  const frames = Math.round(Math.max(4, Math.min(60, Math.round(length / 1750 * 2) / 2)) * 60);
  let previous = raster('', lettering.bounds, scale);
  for (let frame = 1; frame <= frames; frame++) {
    const from = length * (frame - 1) / frames, to = length * frame / frames;
    const { body } = atDistance(pens, to), current = raster(body, lettering.bounds, scale);
    expect(inkTravelPasses(measureInkTravel(previous, current, lettering.bounds, scale, pens, from, to)),
      `early ink at frame ${frame}/${frames}`).toBe(true);
    let erased = 0, written = 0;
    for (let i = 3; i < current.length; i += 4) { erased += Math.max(0, previous[i] - current[i]); written += previous[i]; }
    expect(erased / Math.max(1, written), `erased ink at frame ${frame}/${frames}`).toBeLessThan(.002);
    previous = current;
  }
}, 120_000);
