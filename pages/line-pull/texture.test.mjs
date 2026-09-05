import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bakeRelief, reliefOverlay } from '../../scripts/generate-line-pull-texture.mjs';

const clamp = x => Math.min(1, Math.max(0, x));
test('single alpha tile preserves the previous multiply/screen result for any backdrop', () => {
  for (let i = 0; i <= 100; i++) {
    const value = i / 100;
    const multiply = clamp(clamp((value - 0.5) * 1.2 + 0.5) * 1.8);
    const screen = clamp((value - 0.5) * 2.2 + 0.5) * 0.32;
    const { gray, alpha } = reliefOverlay(value);
    for (const backdrop of [0, 5 / 255, 31 / 255, 63 / 255, 198 / 255, 244 / 255, 1]) {
      const shaded = backdrop * (0.5 + 0.5 * multiply);
      const old = shaded + (1 - shaded) * screen * 0.34;
      const baked = Math.round(gray * 255) / 255 * (Math.round(alpha * 255) / 255)
        + backdrop * (1 - Math.round(alpha * 255) / 255);
      assert.ok(Math.abs(old - baked) <= 1 / 255, 'baked overlay changed a backdrop color');
    }
  }
});

test('flat source has no baked edge seams or color tint', () => {
  const source = Buffer.alloc(8 * 8 * 4);
  for (let i = 0; i < source.length; i += 4) { source.fill(96, i, i + 3); source[i + 3] = 255; }
  const output = bakeRelief(source, 8, 8);
  for (let i = 0; i < output.length; i += 4) assert.deepEqual(output.subarray(i, i + 4), output.subarray(0, 4));
  assert.equal(output[0], output[1]);
  assert.equal(output[1], output[2]);
});
