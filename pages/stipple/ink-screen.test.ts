import { expect, test } from 'vitest';
import { makeInkPoints, makeInkScreen } from './ink-screen';

test('ink points maintain spacing across tile seams without a grid', () => {
  const period = 32;
  const separation = 3.1;
  const points = makeInkPoints(period, separation);
  expect(points.length).toBeGreaterThan(50);
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const dx = Math.abs(points[i].x - points[j].x);
      const dy = Math.abs(points[i].y - points[j].y);
      expect(Math.hypot(Math.min(dx, period - dx), Math.min(dy, period - dy))).toBeGreaterThanOrEqual(separation - 1e-8);
    }
  }
  expect(makeInkPoints(period, separation)).toEqual(points);
});

test('ink area follows the full tonal range, including dark shadows', () => {
  const pixels = makeInkScreen(32, 128);
  const ranks: number[] = [];
  for (let i = 0; i < pixels.length; i += 4) ranks.push((pixels[i] * 256 + pixels[i + 1]) / 65535);
  for (const tone of [0.05, 0.2, 0.5, 0.8, 0.95]) {
    const covered = ranks.filter(rank => rank < tone).length / ranks.length;
    expect(covered).toBeCloseTo(tone, 3);
  }
});
