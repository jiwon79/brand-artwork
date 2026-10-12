import { afterEach, expect, test, vi } from 'vitest';
import { RopeInteraction } from './rope-interaction';
import { preparePen } from './pen-geometry';
import { createPenPlayback } from './pen-playback';

class Point {
  constructor(readonly x: number, readonly y: number) {}
  matrixTransform(matrix: { a: number; d: number }) { return new Point(this.x * matrix.a, this.y * matrix.d); }
}

class Artwork extends EventTarget {
  readonly classList = new Set<string>();
  private captured = new Set<number>();
  constructor(readonly scale: number) { super(); }
  getScreenCTM() { return { a: this.scale, b: 0, c: 0, d: this.scale, inverse: () => ({ a: 1 / this.scale, d: 1 / this.scale }) }; }
  setPointerCapture(id: number) { this.captured.add(id); }
  hasPointerCapture(id: number) { return this.captured.has(id); }
  releasePointerCapture(id: number) {
    this.captured.delete(id);
    this.dispatchEvent(Object.assign(new Event('lostpointercapture'), { pointerId: id }));
  }
  pointer(type: string, x: number, y: number, pointerType = 'mouse') {
    return this.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), {
      clientX: x, clientY: y, pointerId: 1, pointerType, button: 0,
    }));
  }
}

afterEach(() => vi.unstubAllGlobals());

function setup(scale: number) {
  vi.stubGlobal('DOMPoint', Point);
  const artwork = new Artwork(scale);
  // Match the DOMTokenList remove method without introducing a DOM runtime.
  Object.assign(artwork.classList, { remove: (name: string) => artwork.classList.delete(name) });
  const interaction = new RopeInteraction(artwork as unknown as SVGSVGElement, () => true, () => .5, () => {});
  const playback = createPenPlayback([preparePen({ d: 'M0 0L200 0', width: 30 })]);
  interaction.reset(playback, playback.duration);
  return { artwork, interaction };
}

for (const scale of [.04, .125, .4]) for (const pointerType of ['mouse', 'touch']) {
  test(`small lettering can be grabbed 15 CSS pixels from its centerline: ${scale}, ${pointerType}`, () => {
    const { artwork, interaction } = setup(scale);
    artwork.pointer('pointerdown', 100 * scale, 15, pointerType);
    expect(artwork.hasPointerCapture(1)).toBe(true);
    artwork.pointer('pointermove', 100 * scale, -25, pointerType);
    artwork.pointer('pointerup', 100 * scale, -25, pointerType);
    expect(artwork.hasPointerCapture(1)).toBe(false);
    for (let frame = 0; frame < 30; frame++) interaction.step(1 / 60);
    expect(Math.min(...interaction.pens[0].points.map(point => point.y))).toBeLessThan(-20 / scale);
    interaction.destroy();
  });
}

test('touch has extra room, while far-away clicks leave the rope unchanged', () => {
  const { artwork, interaction } = setup(.04);
  artwork.pointer('pointerdown', 4, 25, 'mouse');
  expect(artwork.hasPointerCapture(1)).toBe(false);
  artwork.pointer('pointerdown', 4, 40, 'touch');
  expect(artwork.hasPointerCapture(1)).toBe(false);
  artwork.pointer('pointerdown', 4, 25, 'touch');
  expect(artwork.hasPointerCapture(1)).toBe(true);
  interaction.destroy();
});

test('pointer cancellation and capture loss discard an unprocessed drag', () => {
  for (const event of ['pointercancel', 'lostpointercapture']) {
    const { artwork, interaction } = setup(.4);
    artwork.pointer('pointerdown', 40, 0);
    artwork.pointer('pointermove', 40, -25);
    artwork.pointer(event, 40, -25);
    interaction.step(1 / 60);
    expect(artwork.hasPointerCapture(1)).toBe(false);
    expect(interaction.pens[0].points.every(point => point.y === 0)).toBe(true);
    interaction.destroy();
  }
});
