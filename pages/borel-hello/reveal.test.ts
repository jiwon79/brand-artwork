import { expect, test } from 'vitest';
import { revealFrame, revealTimes, skeletonize, traceSkeleton } from './reveal';

test('a crossing retains future branch pixels until their own trajectory reaches them', () => {
  const times = revealTimes(21, 21, [
    ...Array.from({ length: 21 }, (_, x) => ({ x, y: 10, time: x / 42 })),
    ...Array.from({ length: 21 }, (_, y) => ({ x: 10, y, time: .5 + y / 42 })),
  ]);
  expect(times[10 * 21 + 3]).toBeCloseTo(3 / 42);
  expect(times[3 * 21 + 10]).toBeCloseTo(.5 + 3 / 42);
  const source = new Uint8ClampedArray(21 * 21 * 4).fill(255), output = new Uint8ClampedArray(source.length);
  revealFrame(source, times, .3, output);
  expect(output[(10 * 21 + 3) * 4 + 3]).toBe(255);
  expect(output[(3 * 21 + 10) * 4 + 3]).toBe(0);
});

test('nearest-trajectory assignment agrees with brute force distances', () => {
  const seeds = [{ x: 2, y: 3, time: .1 }, { x: 16, y: 5, time: .4 }, { x: 7, y: 17, time: .8 }];
  const times = revealTimes(20, 20, seeds);
  for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) {
    const distances = seeds.map(s => (s.x - x) ** 2 + (s.y - y) ** 2);
    const minimum = Math.min(...distances);
    expect(seeds.filter((_, i) => distances[i] === minimum).some(s => Math.abs(s.time - times[y * 20 + x]) < 1e-6)).toBe(true);
  }
});

test('all frames are monotonic subsets of the original, and the final frame is byte-identical', () => {
  const source = Uint8ClampedArray.from({ length: 80 }, (_, i) => (i * 71) % 256);
  const times = Float32Array.from({ length: 20 }, (_, i) => i / 19), output = new Uint8ClampedArray(80), previous = new Uint8ClampedArray(80);
  for (let frame = 0; frame <= 360; frame++) {
    revealFrame(source, times, frame / 360, output);
    for (let i = 0; i < 20; i++) {
      expect(output[i * 4 + 3]).toBeGreaterThanOrEqual(previous[i * 4 + 3]);
      expect(output[i * 4 + 3]).toBeLessThanOrEqual(source[i * 4 + 3]);
      expect([...output.slice(i * 4, i * 4 + 3)]).toEqual([...source.slice(i * 4, i * 4 + 3)]);
    }
    previous.set(output);
  }
  expect(output).toEqual(source);
  revealFrame(source, times, 0, output);
  expect(Array.from(output).filter((_, i) => i % 4 === 3).every(a => a === 0)).toBe(true);
});

test('thinning preserves a connected crossing and traces every center pixel', () => {
  const width = 31, height = 31;
  const alpha = Uint8Array.from({ length: width * height }, (_, i) => Math.abs(i % width - 15) <= 3 || Math.abs(Math.floor(i / width) - 15) <= 3 ? 255 : 0);
  // Padding isolates the glyph from the raster boundary, as the renderer does.
  for (let i = 0; i < alpha.length; i++) if (i % width === 0 || i % width === width - 1 || i < width || i >= width * (height - 1)) alpha[i] = 0;
  const skeleton = skeletonize(alpha, width, height), paths = traceSkeleton(skeleton, width, height);
  const visited = new Set(paths.flat().map(([x, y]) => Math.floor(y) * width + Math.floor(x)));
  for (let i = 0; i < skeleton.length; i++) if (skeleton[i]) expect(visited.has(i), String(i)).toBe(true);
  expect(skeleton.reduce((sum, p) => sum + p, 0)).toBeLessThan(80);
  expect(paths.length).toBeGreaterThan(1);
});
