import { expect, test } from 'vitest';
import { loopFrame, variantGesture } from './motion-loop';

test('motion returns to the first measured pose without a position or speed jump', () => {
  const frameCount = 120;
  const turnaround = (frameCount - 1) / 24;
  const period = turnaround * 2;
  const step = 0.001;
  expect(loopFrame(0, frameCount)).toBe(0);
  expect(loopFrame(turnaround, frameCount)).toBe(frameCount - 1);
  expect(loopFrame(period, frameCount)).toBe(0);
  expect(Math.abs(loopFrame(period - step, frameCount) - loopFrame(period + step, frameCount))).toBeLessThan(0.001);
  expect(Math.abs(loopFrame(turnaround, frameCount) - loopFrame(turnaround - step, frameCount))).toBeLessThan(0.001);
});

test('each variant gesture extends once and releases smoothly', () => {
  const period = (120 - 1) / 24;
  const step = 0.001;
  expect(variantGesture(0, 120)).toBe(0);
  expect(variantGesture(period * 0.38, 120)).toBeCloseTo(1);
  expect(variantGesture(period, 120)).toBe(0);
  expect(Math.abs(variantGesture(period - step, 120) - variantGesture(period + step, 120))).toBeLessThan(0.001);
});
