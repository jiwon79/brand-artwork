import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ArtworkView, type InkStyle } from './artwork-view';
import { composeText } from './lettering';
import { preparePen } from './pen-geometry';
import { createPenPlayback } from './pen-playback';
import { visibleRopePens } from './rope-playback';
import { catalog, foregroundIoU, raster, shaper } from './test-font';
import { SVGNode, svgDocument } from './test-svg';

beforeEach(() => vi.stubGlobal('document', svgDocument()));
afterEach(() => vi.unstubAllGlobals());

const style: InkStyle = { weight: 1, ink: '#6f4031', paper: '#f3e8de', gradient: true, guides: false, reference: false };
function scene(text: string) {
  const lettering = composeText(text, shaper, catalog);
  const playback = createPenPlayback(lettering.strokes.map(preparePen));
  const artwork = new SVGNode('svg'); artwork.style.color = style.ink;
  const view = new ArtworkView(artwork as unknown as SVGSVGElement);
  view.setLettering(lettering, playback);
  return { lettering, playback, artwork, view };
}

test('freezing a partial frame and resuming preserves both solid and gradient ink', () => {
  for (const gradient of [false, true]) {
    const { view, playback, artwork, lettering } = scene('jiwon tt');
    const inkStyle = { ...style, gradient };
    const time = playback.duration * .63;
    view.render(playback, time, inkStyle, false);
    const before = raster(artwork.children.map(node => node.outerHTML).join(''), lettering.bounds, .25);
    view.resetRope(playback);
    view.render(playback, time, inkStyle, false, visibleRopePens(playback, time));
    const frozen = raster(artwork.children.map(node => node.outerHTML).join(''), lettering.bounds, .25);
    expect(foregroundIoU(before, frozen)).toBeGreaterThan(.999);
    view.render(playback, time, inkStyle, false);
    expect(raster(artwork.children.map(node => node.outerHTML).join(''), lettering.bounds, .25)).toEqual(before);
  }
}, 30_000);

test('replacing text clears old rope and stroke-order layers before preparing the next text', () => {
  const { view, playback, artwork } = scene('hello');
  view.prepareOrder(playback);
  view.resetRope(playback);
  view.render(playback, playback.duration, style, false, visibleRopePens(playback, playback.duration));
  const empty = composeText('', shaper, catalog);
  const next = createPenPlayback([]);
  view.setLettering(empty, next);
  view.render(next, 0, style, false);
  expect(view.order.steps).toEqual([]);
  const pixels = raster(artwork.children.map(node => node.outerHTML).join(''), empty.bounds, .1);
  expect(pixels.every(value => value === 0)).toBe(true);
  view.prepareOrder(next);
  expect(view.order.steps).toEqual([]);
});

test('stroke-order inspection uses authored ink and seeks identically in either direction', () => {
  const { view, playback, artwork } = scene('ij');
  view.prepareOrder(playback);
  const time = playback.duration * .4;
  const step = view.render(playback, time, style, true);
  const before = artwork.outerHTML;
  view.render(playback, playback.duration, style, true);
  expect(view.render(playback, time, style, true)).toBe(step);
  expect(artwork.outerHTML).toBe(before);
});
