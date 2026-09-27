import { expect, test } from 'vitest';
import { BoneRig } from './bone-rig';

test('rest pose preserves a point and skin weights sum to one', () => {
  const rig = new BoneRig(Array(64).fill(140));
  const weights = rig.weightsFor(-90, 24);
  const output = new Float32Array(3);
  rig.skinPoint(-90, 24, 82, weights, output, 0);
  expect(Array.from(weights).reduce((sum, value) => sum + value, 0)).toBeCloseTo(1);
  expect(Array.from(output)).toEqual([-90, 24, 82]);
});

test('left contour expansion moves its weighted surface outward', () => {
  const rig = new BoneRig(Array(64).fill(140));
  const radii = Array(64).fill(140);
  for (let index = 26; index <= 38; index++) radii[index] += 20;
  rig.poseFromRadii(radii, 1);
  const output = new Float32Array(3);
  rig.skinPoint(-130, 0, 0, rig.weightsFor(-130, 0), output, 0);
  expect(output[0]).toBeLessThan(-135);
  expect(rig.jointPosition(1)[0]).toBeLessThan(-105);
});
