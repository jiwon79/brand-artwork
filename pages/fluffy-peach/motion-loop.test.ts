import { expect, test } from 'vitest';
import { loopFrame, motionPhase } from './motion-loop';

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

test('secondary shape motion has the same pose at each loop boundary', () => {
  const period = 2 * (120 - 1) / 24;
  const step = 0.001;
  const pulse = (seconds: number) => {
    const phase = motionPhase(seconds, 120);
    return Math.max(0, Math.sin(phase)) ** 2;
  };
  expect(pulse(0)).toBe(0);
  expect(pulse(period)).toBe(0);
  expect(Math.abs(pulse(period - step) - pulse(period + step))).toBeLessThan(0.001);
});
