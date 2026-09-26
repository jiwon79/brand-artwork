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

test('variant accents follow the measured contour through the same seamless loop', () => {
  const widths = [100, 150, 120, 180];
  const period = 2 * (widths.length - 1) / 24;
  const step = 0.001;
  const gesture = (seconds: number) => variantGesture(loopFrame(seconds, widths.length), widths);
  expect(gesture(0)).toBe(0);
  expect(gesture(1 / 24)).toBeCloseTo(0.625);
  expect(gesture(2 / 24)).toBeCloseTo(0.25);
  expect(gesture(3 / 24)).toBe(1);
  expect(gesture(period)).toBe(0);
  expect(Math.abs(gesture(period - step) - gesture(period + step))).toBeLessThan(0.001);
});
