import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { generateDensity, bakeShadow, densityAt, decodeVolume, VOLUME_SIZE, SHADOW_SIZE, MIN, EXTENT, DEFAULT_SEED } from './volume';

test('procedural formation is repeatable and a new seed changes the volume', () => {
  const size = [32, 24, 20];
  const a = generateDensity('cumulus', 7351, size), b = generateDensity('cumulus', 7351, size), c = generateDensity('cumulus', 42, size);
  expect(a).toEqual(b); expect(a).not.toEqual(c);
  expect(a.some(n => n > 200)).toBe(true); expect(a.filter(n => n === 0).length).toBeGreaterThan(a.length * 0.7);
});

test('density lookup matches normalized texture interpolation and excludes outside space', () => {
  const size = [2, 2, 2], data = new Uint8Array([0, 255, 0, 255, 0, 255, 0, 255]);
  const middle = MIN.map((n, i) => n + EXTENT[i] / 2);
  expect(densityAt(data, middle, size)).toBeCloseTo(0.5);
  expect(densityAt(data, [MIN[0] - 0.01, middle[1], middle[2]], size)).toBe(0);
  expect(densityAt(data, [MIN[0], middle[1], middle[2]], size)).toBe(0);
  expect(densityAt(data, [MIN[0] + EXTENT[0], middle[1], middle[2]], size)).toBe(1);
});

test('shadow bake transmits empty space and attenuates dense space', () => {
  const empty = bakeShadow(new Uint8Array(8), [2, 2, 2], [4, 4, 4]);
  const opaque = bakeShadow(new Uint8Array(8).fill(255), [2, 2, 2], [4, 4, 4]);
  expect([...empty].every(n => n === 255)).toBe(true);
  expect(Math.min(...opaque)).toBeLessThan(5);
  expect(Math.max(...opaque)).toBeLessThan(255);
});

for (const formation of ['cumulus', 'tower', 'bank']) {
  test(`shipped ${formation} cache contains a complete nonempty volume and shadow`, () => {
    const bytes = gunzipSync(readFileSync(new URL(`./assets/${formation}.cloud`, import.meta.url)));
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const volume = decodeVolume(buffer);
    expect(volume.seed).toBe(DEFAULT_SEED);
    expect(volume.density.length).toBe(VOLUME_SIZE.reduce((a, b) => a * b, 1));
    expect(volume.shadow.length).toBe(SHADOW_SIZE.reduce((a, b) => a * b, 1));
    expect(volume.density.some(n => n > 200)).toBe(true); expect(volume.shadow.some(n => n < 10)).toBe(true);
    expect(() => decodeVolume(buffer.slice(0, buffer.byteLength - 1))).toThrow();
    new DataView(buffer).setUint32(0, 0, true);
    expect(() => decodeVolume(buffer)).toThrow();
  });
}

// Compare bytes rather than recursively inspecting millions of numeric entries.
test('default high-resolution cache is reproducible by the runtime generator', () => {
  const bytes = gunzipSync(readFileSync(new URL('./assets/cumulus.cloud', import.meta.url)));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const cached = decodeVolume(buffer).density;
  expect(Buffer.from(cached).equals(Buffer.from(generateDensity('cumulus', DEFAULT_SEED)))).toBe(true);
});
