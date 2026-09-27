import { expect, test } from 'vitest';
import { MAX_ZOOM, MIN_ZOOM, pinchDistance, pinchZoom } from './zoom';

test('two-finger distance changes zoom continuously within view limits', () => {
  expect(pinchDistance([0, 0], [60, 80])).toBe(100);
  expect(pinchZoom(1, 100, 150)).toBe(1.5);
  expect(pinchZoom(1.5, 150, 100)).toBe(1);
  expect(pinchZoom(1, 100, 10)).toBe(MIN_ZOOM);
  expect(pinchZoom(1, 100, 1000)).toBe(MAX_ZOOM);
  expect(pinchZoom(1, 0, 100)).toBe(1);
});
