import { expect, test } from 'vitest';
import { motionPeriod, sampleTrack, type Keyframe } from './motion-track';

test('control motion interpolation joins smoothly at the loop seam', () => {
  const period = motionPeriod(120);
  const keys: Keyframe[] = [
    { frame: 0, value: 1 },
    { frame: 60, value: 1.8 },
    { frame: 160, value: 0.7 },
    { frame: period, value: 1 },
  ];
  expect(sampleTrack(keys, 60, period)).toBeCloseTo(1.8);
  expect(sampleTrack(keys, 160, period)).toBeCloseTo(0.7);
  const incoming = (1 - sampleTrack(keys, period - 0.001, period)) / 0.001;
  const outgoing = (sampleTrack(keys, 0.001, period) - 1) / 0.001;
  expect(incoming).toBeCloseTo(outgoing, 5);
});
