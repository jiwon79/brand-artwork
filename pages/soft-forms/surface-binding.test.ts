import { expect, test } from 'vitest';
import { DeformationRig } from './deformation-rig';
import { bindSurface, skinBoundPoint } from './surface-binding';
import { restSurface } from './rest-surface';
import { variants } from './variants';

const directions = new Float32Array([0.6, -0.48, 0.64, -0.8, 0.6, 0]);
const baseline = new Float32Array(64).fill(130);

test('body bindings preserve the rest surface for all shapes in the neutral pose', () => {
  for (const { id } of variants) {
    const rig = new DeformationRig(id);
    const binding = bindSurface(rig, directions, baseline);
    const actual = new Float32Array(3), expected = new Float32Array(3);
    for (let index = 0; index < 2; index++) {
      const at = index * 3;
      restSurface(id, directions[at], directions[at + 1], directions[at + 2], baseline, expected);
      skinBoundPoint(rig, binding, index, 0, actual, 0);
      actual.forEach((value, axis) => expect(value).toBeCloseTo(expected[axis], 4));
    }
  }
});

test('inset fur roots retain body control weights and move with the same rigid pose', () => {
  const rig = new DeformationRig('wave');
  const body = bindSurface(rig, directions, baseline);
  const fur = bindSurface(rig, directions, baseline, 3, 1.5);
  expect(fur.controlWeights).toEqual(body.controlWeights);
  rig.setPose(rig.poses.map(() => ({ dx: 8, dy: -12, angle: Math.PI / 2 })));
  const bodyPoint = new Float32Array(3), root = new Float32Array(3);
  for (let index = 0; index < 2; index++) {
    skinBoundPoint(rig, body, index, 0, bodyPoint, 0);
    skinBoundPoint(rig, fur, index, 0, root, 0);
    const at = index * 3;
    expect(root[0] - bodyPoint[0]).toBeCloseTo(directions[at + 1] * 1.5, 4);
    expect(root[1] - bodyPoint[1]).toBeCloseTo(-directions[at] * 1.5, 4);
    expect(root[2] - bodyPoint[2]).toBeCloseTo(-directions[at + 2] * 1.5, 4);
  }
});

test('cheek displacement affects only the original shape and its front surface', () => {
  const points = new Float32Array([0.71, -0.38, 0.5, 0.71, -0.38, -0.5]);
  const output = new Float32Array(6);
  for (const { id } of variants) {
    const rig = new DeformationRig(id), binding = bindSurface(rig, points, baseline);
    skinBoundPoint(rig, binding, 0, 1, output, 0);
    skinBoundPoint(rig, binding, 1, 1, output, 3);
    expect(output[2] - binding.restPositions[2]).toBeCloseTo(id === 'original' ? 22 : 0);
    expect(output[5]).toBe(binding.restPositions[5]);
  }
});
