import { expect, test } from 'vitest';
import { loopFrame } from './motion-loop';

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
