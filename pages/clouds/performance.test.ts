import { expect, test } from 'vitest';
import { renderPlan, outputSize, feedbackScale } from './performance';

test('interaction reduces pixels and samples; idle refines independently', () => {
  const moving = renderPlan(true), settled = renderPlan(false), high = renderPlan(false, 'high');
  expect(moving.scale ** 2).toBe(0.25); expect(moving.samples).toBe(1);
  expect(settled.samples).toBe(24); expect(high.samples).toBe(64); expect(high.scale).toBe(1);
  expect(moving.steps).toBeLessThan(settled.steps);
});

test('4K and high-DPI outputs remain bounded without changing aspect ratio', () => {
  expect(outputSize(3840, 2160, 2)).toEqual([1600, 900]);
  expect(outputSize(390, 844, 3)).toEqual([585, 1266]);
  expect(outputSize(0, 0, 1)).toEqual([1, 1]);
});

test('GPU workload feedback remains within interactive quality bounds', () => {
  expect(feedbackScale(0.5, 30)).toBe(0.45);
  expect(feedbackScale(0.3, 100)).toBe(0.3);
  expect(feedbackScale(0.45, 10)).toBe(0.5);
  expect(feedbackScale(0.5, 18)).toBe(0.5);
});
