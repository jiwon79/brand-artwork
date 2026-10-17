import { test, expect } from 'vitest';
import { pullSample } from './deformation-demo';
import { GlassBodyMotion } from '../../../pages/rose-glass/interaction';
import { applyDeformation } from '../../../pages/rose-glass/deformation';

test('the illustrated weight predicts the actual production pull at the center and farther away', () => {
  const displacement = { x: 120, y: -40 }, radius = pullSample({ x: 0, y: 0 }, displacement).radius;
  for (const multiple of [0, 1, 2]) {
    const point = { x: -radius * multiple, y: 0 }, sample = pullSample(point, displacement);
    expect(sample.weight).toBeCloseTo(Math.exp(-multiple * multiple / 2), 12);
    expect(sample.moved.x - point.x).toBeCloseTo(displacement.x * sample.weight, 10);
    expect(sample.moved.y - point.y).toBeCloseTo(displacement.y * sample.weight, 10);
    expect(sample.travel).toBeCloseTo(Math.hypot(displacement.x, displacement.y) * sample.weight, 10);
  }
  const rest = pullSample({ x: -220, y: 30 }, { x: 0, y: 0 });
  expect(rest.moved).toEqual({ x: -220, y: 30 }); expect(rest.travel).toBe(0);
});

test('the held grip composes four maps with advancing centers and carries its original anchor', () => {
  const motion = new GlassBodyMotion(); motion.grab(-1, { x: 420, y: 645 }); motion.move(-1, { x: 600, y: 580 });
  for (let i = 0; i < 90; i++) motion.step(1 / 60, 85, 1, { softness: 1.1, indentationDepth: 1, recovery: 1, stretchLimit: 430 }, false);
  const fields = motion.deformationFields;
  expect(fields).toHaveLength(4);
  for (let i = 1; i < fields.length; i++) {
    expect(fields[i].center.x).toBeCloseTo(fields[i - 1].center.x + fields[i - 1].displacement.x, 10);
    expect(fields[i].center.y).toBeCloseTo(fields[i - 1].center.y + fields[i - 1].displacement.y, 10);
  }
  const anchor = fields[0].center, final = applyDeformation(anchor, motion);
  expect(final.x).toBeCloseTo(anchor.x + fields.reduce((sum, f) => sum + f.displacement.x, 0), 10);
  expect(final.y).toBeCloseTo(anchor.y + fields.reduce((sum, f) => sum + f.displacement.y, 0), 10);
});

test('two-dimensional points at the same distance share the influence and move in both pull axes', () => {
  const displacement = { x: -120, y: 90 };
  const points = [{ x: 120, y: 160 }, { x: -160, y: 120 }, { x: -120, y: -160 }];
  const expected = pullSample(points[0], displacement);
  for (const point of points) {
    const sample = pullSample(point, displacement);
    expect(sample.distance).toBe(200);
    expect(sample.weight).toBeCloseTo(expected.weight, 12);
    expect(sample.travel).toBeCloseTo(expected.travel, 12);
    expect(sample.moved.x).toBeLessThan(point.x);
    expect(sample.moved.y).toBeGreaterThan(point.y);
    expect((sample.moved.x - point.x) / (sample.moved.y - point.y)).toBeCloseTo(displacement.x / displacement.y, 10);
  }
});
