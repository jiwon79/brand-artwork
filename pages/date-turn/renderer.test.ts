import { expect, test } from 'vitest';
import { encodeDistance, signedDistance } from './distance-field';
import { dragRotation, isValidNumber, rollAngle } from './motion';

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
});

test('number settings preserve leading zeros and reject unsupported input', () => {
  expect(isValidNumber('09')).toBe(true);
  expect(isValidNumber('202610')).toBe(true);
  expect(isValidNumber('')).toBe(false);
  expect(isValidNumber('12A')).toBe(false);
  expect(isValidNumber('1234567')).toBe(false);
});
