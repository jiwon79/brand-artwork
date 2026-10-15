import { expect, test } from 'vitest';
import { renderPlan, outputSize, feedbackScale } from './performance';

test('interaction reduces pixels and samples; idle refines independently', () => {
  const moving = renderPlan(true), settled = renderPlan(false), high = renderPlan(false, 'high');
  expect(moving.scale ** 2).toBe(0.36); expect(moving.samples).toBe(1);
  expect(settled.samples).toBe(24); expect(settled.scale).toBe(1); expect(high.samples).toBe(48); expect(high.scale).toBe(1);
  expect(moving.steps).toBeLessThan(settled.steps);
});

test('4K and high-DPI outputs remain bounded without changing aspect ratio', () => {
  const large = outputSize(3840, 2160, 2);
  expect(large[0] * large[1]).toBeLessThanOrEqual(4_002_000);
  expect(large[0] / large[1]).toBeCloseTo(16 / 9, 2);
  expect(outputSize(1265, 750, 2)).toEqual([2530, 1500]);
  expect(outputSize(390, 844, 3)).toEqual([780, 1688]);
  expect(outputSize(0, 0, 1)).toEqual([1, 1]);
});

test('GPU workload feedback remains within interactive quality bounds', () => {
  expect(feedbackScale(0.5, 30)).toBe(0.45);
  expect(feedbackScale(0.35, 100)).toBe(0.35);
  expect(feedbackScale(0.45, 10)).toBe(0.5);
  expect(feedbackScale(0.6, 18)).toBe(0.6);
});
