import { expect, test } from 'vitest';
import { BoneRig, neutralBonePose } from './bone-rig';
import { fitBoneFrames, fittedBoneTracks, referenceRadius, sampleBoneTracks, setBoneKey, parseBoneTracks } from './bone-animation';
import { motionFrames } from './motion-data';
import { loopFrame } from './motion-loop';
import { motionPeriod } from './motion-editor';

const contours = motionFrames.map((frame) => frame.radii);
const fitted = fitBoneFrames(contours);
const defaults = fittedBoneTracks(fitted);
const period = motionPeriod(contours.length);
const baseline = contours[0].map((_, index) => contours.reduce((sum, row) => sum + row[index], 0) / contours.length);

test('rest pose preserves a point and skin weights sum to one', () => {
  const rig = new BoneRig();
  const weights = rig.weightsFor(-90, 24);
  const output = new Float32Array(3);
  rig.skinPoint(-90, 24, 82, weights, output, 0);
  expect(Array.from(weights).reduce((sum, value) => sum + value, 0)).toBeCloseTo(1);
  expect(output[0]).toBeCloseTo(-90, 4);
  expect(output[1]).toBeCloseTo(24, 4);
  expect(output[2]).toBe(82);
});

test('fitted rig follows the measured surface throughout the loop', () => {
  const rig = new BoneRig();
  const output = new Float32Array(3);
  let squareError = 0, maximum = 0, count = 0;
  for (let frame = 0; frame <= period; frame += 2) {
    const source = loopFrame(frame / 24, contours.length);
    const a = Math.floor(source), b = Math.min(a + 1, contours.length - 1), fraction = source - a;
    const radii = contours[a].map((radius, index) => radius * (1 - fraction) + contours[b][index] * fraction);
    rig.setPose(sampleBoneTracks(defaults, frame, period));
    for (let i = 0; i < 64; i++) {
      const angle = -(i + 0.5) * Math.PI * 2 / 64;
      const x = Math.cos(angle), y = Math.sin(angle);
      const rest = referenceRadius(x, y, baseline, baseline);
      const target = referenceRadius(x, y, radii, baseline);
      rig.skinPoint(x * rest, y * rest, 0, rig.weightsFor(x * rest, y * rest), output, 0);
      const error = Math.hypot(output[0] - x * target, output[1] - y * target);
      squareError += error * error;
      maximum = Math.max(maximum, error);
      count++;
    }
  }
  expect(Math.sqrt(squareError / count)).toBeLessThan(2);
  expect(maximum).toBeLessThan(8);
});

test('bone keyframe edits remain closed at the loop boundary and presets round-trip', () => {
  const tracks = structuredClone(defaults);
  setBoneKey(tracks, 2, 'dy', 0, 20, period);
  expect(tracks[2].dy[tracks[2].dy.length - 1]?.value).toBe(20);
  expect(sampleBoneTracks(tracks, 0, period)).toEqual(sampleBoneTracks(tracks, period, period));
  const parsed = parseBoneTracks({ version: 2, period, bones: tracks }, period);
  expect(parsed).toEqual(tracks);
  expect(parseBoneTracks({ version: 2, period, bones: [] }, period)).toBeNull();
  const rig = new BoneRig();
  const pose = neutralBonePose();
  pose[2].dy = 20;
  rig.setPose(pose);
  expect(rig.jointPosition(2)[1]).toBeCloseTo(-32.5);
});
