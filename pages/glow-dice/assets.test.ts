import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

test('the share card is a complete 1200 by 630 PNG below the asset size limit', () => {
  const png = readFileSync(new URL('./assets/og-image.png', import.meta.url));
  expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  expect(png.subarray(12, 16).toString()).toBe('IHDR');
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);
  expect(png.subarray(-8, -4).toString()).toBe('IEND');
  expect(png.length).toBeLessThan(5 * 1024 * 1024);
});
