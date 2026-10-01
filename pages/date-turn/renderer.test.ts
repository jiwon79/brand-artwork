import { expect, test } from 'vitest';
import { encodeDistance, signedDistance } from './distance-field';
import { dragRotation, followAngle, isValidNumber, motionPose, rollAngle } from './motion';

test('numeral counters remain outside the solid, while the glyph is inside', () => {
  const mask = new Uint8Array(49);
  for (let y = 1; y <= 5; y++) for (let x = 1; x <= 5; x++) mask[y * 7 + x] = 1;
  mask[3 * 7 + 3] = 0;
  const field = signedDistance(mask, 7, 7);
  expect(field[3 * 7 + 3]).toBeGreaterThan(0);
  expect(field[2 * 7 + 2]).toBeLessThan(0);
  expect(field[0]).toBeCloseTo(Math.sqrt(2) - 0.5);
});

test('the GPU texture encodes negative, zero and positive distances accurately', () => {
  const values = new Float32Array([-17.25, 0, 23.5]);
  const encoded = encodeDistance(values, 0.01, 4.6);
  values.forEach((value, index) => {
    const decoded = ((encoded[index * 4] * 256 + encoded[index * 4 + 1]) / 65535 - 0.5) * 9.2;
    expect(Math.abs(decoded - value * 0.01)).toBeLessThan(9.2 / 65535);
  });
});

test('the third face rolls continuously back to the first physical orientation', () => {
  expect(rollAngle(0)).toBe(0);
  expect(rollAngle(1)).toBeCloseTo(Math.PI * 2 / 3);
  expect(rollAngle(2)).toBeCloseTo(Math.PI * 4 / 3);
  expect(rollAngle(3)).toBeCloseTo(Math.PI * 2);
  expect(Math.abs(rollAngle(3 - 1e-6) - rollAngle(3 + 1e-6))).toBeLessThan(1e-4);
});

test('a large drag rotates both axes and respects user sensitivity', () => {
  const slow = dragRotation(300, -240, 390, 0.5);
  const fast = dragRotation(300, -240, 390, 2);
  expect(fast[0]).toBeCloseTo(slow[0] * 4);
  expect(fast[1]).toBeCloseTo(slow[1] * 4);
  expect(fast.every(Number.isFinite)).toBe(true);
  expect(dragRotation(390, 0, 390, 1)[1]).toBeCloseTo(Math.PI);
});

test('the roll spreads acceleration and braking around the half-second pose', () => {
  const degrees = (time: number) => rollAngle(time) * 180 / Math.PI;
  expect(degrees(0.4)).toBeGreaterThan(20);
  expect(degrees(0.4)).toBeLessThan(26);
  expect(degrees(0.5)).toBeCloseTo(60);
  expect(degrees(0.7)).toBeGreaterThan(115);
  expect(degrees(0.7)).toBeLessThan(120);
  expect(degrees(0.8)).toBeCloseTo(120);
});

test('transition duration preserves the turn midpoint and the full three-face cycle', () => {
  for (const duration of [0.3, 0.56, 0.9]) {
    expect(rollAngle(0.5, duration)).toBeCloseTo(Math.PI / 3);
    expect(rollAngle(3, duration)).toBeCloseTo(Math.PI * 2);
    const dt = 1e-4;
    const start = (1 - duration) / 2;
    expect((rollAngle(start + dt, duration) - rollAngle(start, duration)) / dt).toBeLessThan(0.001);
  }
});

test('yaw reverses across the cycle and all secondary motion closes at the loop boundary', () => {
  const beginning = motionPose(0);
  const middle = motionPose(1.5);
  const ending = motionPose(3);
  expect(beginning.yaw).toBeLessThan(-0.5);
  expect(middle.yaw).toBeGreaterThan(0.5);
  expect(ending.yaw).toBeCloseTo(beginning.yaw);
  expect(ending.roll).toBeCloseTo(beginning.roll);
  expect(ending.height).toBeCloseTo(beginning.height);
  expect(motionPose(0, 0.56, 0, 0).yaw).toBeCloseTo(0);
});

test('drag settles equally at 30 and 144 Hz, including a rapid direction reversal', () => {
  const follow = (fps: number) => {
    let current = 0;
    for (let frame = 0; frame < fps; frame++) current = followAngle(current, frame < fps / 2 ? 1 : -0.5, 1 / fps, 0.065);
    return current;
  };
  expect(follow(30)).toBeCloseTo(follow(144), 8);
  expect(follow(30)).toBeLessThan(-0.49);
  expect(follow(30)).toBeGreaterThanOrEqual(-0.5);
  expect(followAngle(0, 1, 0, 0.065)).toBe(0);
});

test('number settings preserve leading zeros and reject unsupported input', () => {
  expect(isValidNumber('09')).toBe(true);
  expect(isValidNumber('202610')).toBe(true);
  expect(isValidNumber('')).toBe(false);
  expect(isValidNumber('12A')).toBe(false);
  expect(isValidNumber('1234567')).toBe(false);
});
