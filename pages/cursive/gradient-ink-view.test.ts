import { svgDocument, svgNode as node } from './test-svg';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { GradientInkView } from './gradient-ink-view';
import { gradientPalette, gradientPieces, gradientRenderPieces } from './gradient-ink';
import { composeText } from './lettering';
import { penGeometry, preparePen, type PenPath } from './pen-geometry';
import { createPenPlayback, strokeState } from './pen-playback';
import { visibleRopePens } from './rope-playback';
import { FloorRope } from './rope';
import { catalog, foregroundIoU, raster, shaper } from './test-font';

// Rasterize the shipped clips/color planes, rather than reconstructing a filter.
beforeEach(() => vi.stubGlobal('document', svgDocument()));
afterEach(() => vi.unstubAllGlobals());
const body = (view: GradientInkView) => node(view.definitions).outerHTML + node(view.layer).outerHTML;
const ink = (pens: readonly PenPath[]) => pens.map(p => `<path d="${penGeometry(p)}"/>`).join('');

for (const text of ['Jjiwon', 'hello', 'my name is jiwon', 'tttsss', 'abcdefghijklmnopqrstuvwxyz', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', '0123456789 !?']) {
  test(`vector gradient preserves traveled ink at every 60 fps frame: ${text}`, () => {
    const lettering = composeText(text, shaper, catalog), pens = lettering.strokes.map(preparePen);
    const playback = createPenPlayback(pens), view = new GradientInkView('frame');
    view.setPens(pens);
    const markup = body(view);
    expect(markup).not.toMatch(/<(filter|mask)\b/);
    const individual = gradientPieces(pens).flat().length;
    // Capitals already have coarse straight samples; their batching has less
    // headroom than the densely sampled lowercase loops.
    expect(gradientRenderPieces(pens).flat().length).toBeLessThan(individual * (text === text.toUpperCase() ? .55 : .35));
    for (let frame = 0; frame <= Math.ceil(playback.duration * 60); frame++) {
      const time = Math.min(playback.duration, frame / 60);
      playback.strokes.forEach((stroke, i) => {
        const state = strokeState(stroke, time);
        view.renderStroke(i, state.written, state.pressure);
      });
      const expected = raster(ink(visibleRopePens(playback, time)), lettering.bounds, .16);
      const actual = raster(body(view), lettering.bounds, .16);
      // Independent clip edges can differ by a subpixel at patch overlap.
      // No source pixels or outline mask may compensate for wrong geometry.
      expect(foregroundIoU(actual, expected), `frame ${frame}`).toBeGreaterThan(.98);
    }
  }, 120_000);
}

test('zoomed edges keep full color and differ from the solid outline by less than one pixel', () => {
  for (const text of ['J', 'ji', 'o']) {
    const lettering = composeText(text, shaper, catalog), pens = lettering.strokes.map(preparePen);
    const view = new GradientInkView('zoom'); view.setPens(pens);
    pens.forEach((pen, i) => view.renderStroke(i, pen.length, 1));
    const actual = raster(body(view), lettering.bounds, 2), expected = raster(ink(pens), lettering.bounds, 2);
    expect(foregroundIoU(actual, expected), text).toBeGreaterThan(.998);
    const width = Math.ceil((lettering.bounds[2] - lettering.bounds[0]) * 2);
    const minimum = [0, 1, 2].map(channel => Math.min(...gradientPalette.map(hex => parseInt(hex.slice(1 + channel * 2, 3 + channel * 2), 16))));
    for (let i = 3; i < actual.length; i += 4) {
      if (actual[i] > 0 && expected[i] === 0) {
        const offsets = [-4, 4, -width * 4, width * 4];
        if (!offsets.some(offset => (expected[i + offset] ?? 0) > 0)) throw new Error(`outside edge at ${i}`);
      }
      if (actual[i] < 64) continue;
      for (let channel = 0; channel < 3; channel++) {
        if (actual[i - 3 + channel] * 255 / actual[i] < minimum[channel] - 5) throw new Error(`dark fringe at ${i}`);
      }
    }
  }
}, 60_000);

test('vector clipping cannot recolor previous ink outside a crossing nib', () => {
  const pens = [preparePen({ d: 'M0 -300L0 300', width: 90 }), preparePen({ d: 'M-300 0L300 0', width: 90 })];
  const view = new GradientInkView('cross'); view.setPens(pens);
  pens.forEach((pen, i) => view.renderStroke(i, pen.length, 1));
  for (const rect of node(view.layer).children) rect.setAttribute('fill', /color-1-\d+-clip/.test(rect.attributes.get('clip-path')!) ? '#0000ff' : '#ff0000');
  const actual = raster(body(view), [-350, -350, 350, 350], 1);
  const pixel = (x: number, y: number) => Array.from(actual.slice(((y + 350) * 700 + x + 350) * 4, ((y + 350) * 700 + x + 350) * 4 + 4));
  expect(pixel(0, 0)).toEqual([0, 0, 255, 255]);
  for (const y of [-55, -50, 49, 54]) expect(pixel(0, y)).toEqual([255, 0, 0, 255]);
});

test('paused and dragged rope uses the same vector renderer and skips unchanged DOM writes', () => {
  const lettering = composeText('jiwon tttsss', shaper, catalog), pens = lettering.strokes.map(preparePen);
  const playback = createPenPlayback(pens), view = new GradientInkView('rope'); view.setPens(pens);
  const rope = new FloorRope(visibleRopePens(playback, playback.duration * .65));
  const held = rope.nodes[20]; expect(rope.pick(held.x, held.y, 10)).toBe(true);
  rope.move(held.x + 200, held.y - 180); for (let i = 0; i < 30; i++) rope.step(1 / 60);
  const curves = pens.map((_, i) => rope.deformed(i));
  curves.forEach((pen, i) => view.renderDeformedStroke(i, pen));
  expect(foregroundIoU(raster(body(view), lettering.bounds, .3), raster(ink(curves), lettering.bounds, .3))).toBeGreaterThan(.985);
  const writes = () => [...node(view.definitions).all(), ...node(view.layer).all()].reduce((n, el) => n + el.writes, 0);
  const before = writes(); curves.forEach((pen, i) => view.renderDeformedStroke(i, pen));
  expect(writes()).toBe(before);
  // A replay of the authored paths must restore the original color axes too.
  pens.forEach((pen, i) => view.renderStroke(i, pen.length, 1));
  expect(foregroundIoU(raster(body(view), lettering.bounds, .3), raster(ink(pens), lettering.bounds, .3))).toBeGreaterThan(.985);
});
