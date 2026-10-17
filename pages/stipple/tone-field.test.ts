import { expect, test } from 'vitest';
import { softenInkField } from './tone-field';

test('suppresses a narrow black contour while retaining the wide shadow beneath it', () => {
  const width = 120;
  const height = 100;
  const source = new Float32Array(width * height).fill(0.45);
  for (let y = 0; y < height; y++) {
    for (let x = 58; x <= 61; x++) source[y * width + x] = 1;
  }
  const field = softenInkField(source, width, height);
  expect(field[50 * width + 60]).toBeLessThan(0.49);
  expect(field[50 * width + 30]).toBeCloseTo(0.45, 3);
});

test('turns a hard silhouette into a continuous falloff of ink without erasing its interior', () => {
  const width = 160;
  const height = 100;
  const source = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < 80; x++) source[y * width + x] = 0.8;
  }
  const field = softenInkField(source, width, height);
  const row = field.subarray(50 * width, 51 * width);
  expect(row[35]).toBeCloseTo(0.8, 3);
  expect(row[79]).toBeLessThan(0.5);
  expect(row[83]).toBeGreaterThan(0.1);
  expect(row[94]).toBeGreaterThan(0);
  expect(row[110]).toBeCloseTo(0, 4);
  for (let x = 60; x < 100; x++) expect(row[x + 1]).toBeLessThanOrEqual(row[x] + 1e-6);
});

test('retains relative midtones instead of flattening all shading into one gray', () => {
  for (const tone of [0, 0.2, 0.5, 0.8]) {
    const field = softenInkField(new Float32Array(50 * 50).fill(tone), 50, 50);
    expect(field[25 * 50 + 25]).toBeCloseTo(tone, 4);
  }
});
