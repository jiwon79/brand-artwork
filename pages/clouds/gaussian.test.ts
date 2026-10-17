import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { generateCloud } from './gaussian/cloud.js';
import { buildSpatialLOD } from './gaussian/spatial-lod.js';
import { ShadowHistory, sampleSequence } from './gaussian/sampling.js';
import { shareSourceBuffers, sceneBytes, SceneMemoryCache, sceneKey, type GaussianScene } from './scene-cache';
import { MotionRefinement } from './refinement';

const hash = (array: ArrayBufferView) => createHash('sha256').update(new Uint8Array(array.buffer, array.byteOffset, array.byteLength)).digest('hex');

test('the default source retains the reference geometry and lighting bytes', () => {
  const scene = generateCloud('cumulus', 7351) as unknown as GaussianScene;
  expect(scene.count).toBe(869001);
  expect(hash(scene.data)).toBe('c27e96ab48e923a5e9996a8b2920831fc7f3fd94724d8b1948aa2046a317d22a');
  expect(hash(scene.lighting)).toBe('937bc9ee72bb92a0cda3eae24be3a2f2b2a93e340e62387461ecded81f99d14f');
  expect(hash(scene.detail)).toBe('c7ca7c2b133e08b21d82995d612b6213737e836c1cd8dc12bc7f8abd7f97f384');
  scene.lod = buildSpatialLOD(scene) as GaussianScene['lod'];
  const before = sceneBytes(scene), shared = shareSourceBuffers(scene);
  for (const name of ['data', 'lighting', 'detail'] as const) {
    expect(hash(shared[name])).toBe(hash(scene[name]));
    expect(shared[name].buffer).toBe(shared.lod![name].buffer);
  }
  expect(before - sceneBytes(shared)).toBe(scene.data.byteLength + scene.lighting.byteLength + scene.detail.byteLength);
  const restored = structuredClone(shared);
  expect(hash(restored.data)).toBe(hash(scene.data));
  expect(restored.data.buffer).toBe(restored.lod!.data.buffer);
  const memory = new SceneMemoryCache(sceneBytes(shared));
  memory.put(sceneKey('cumulus', 7351), shared);
  const sunset = memory.get(sceneKey('sunset', 7351), 'sunset')!;
  expect(sunset.preset).toBe('sunset'); expect(sunset.data).toBe(shared.data);
  memory.put('new-seed', { ...shared, data: new Float32Array(shared.data) });
  expect(memory.bytes).toBeLessThanOrEqual(memory.limit);
  memory.clear(); expect(memory.bytes).toBe(0);
}, 20000);

test('extinction, scattering, morphology and sample kernels match the source snapshot', () => {
  const manifest = JSON.parse(readFileSync(new URL('./gaussian/upstream.json', import.meta.url), 'utf8'));
  for (const name of ['cloud.js', 'morphology.js', 'surface-detail.js', 'shaders.js', 'config.js', 'sampling.js', 'detail.js', 'detail-gpu.js', 'spatial-lod.js', 'accumulation.js']) {
    const actual = createHash('sha256').update(readFileSync(new URL(`./gaussian/${name}`, import.meta.url))).digest('hex');
    expect(actual, name).toBe(manifest.sha256[name]);
  }
});

test('camera changes reuse the current shadow field and a new sun resets it', () => {
  const shadow = new ShadowHistory();
  expect(shadow.select('cloud:sun1', false, 4)).toBe(0);
  for (let i = 0; i < 4; i++) shadow.commit(4);
  expect(shadow.select('cloud:sun1', true, 4)).toBe(0);
  expect(shadow.select('cloud:sun1', false, 4)).toBe(1);
  expect(shadow.select('cloud:sun2', false, 4)).toBe(0);
  // Changing samples per frame changes submission grouping, never the estimator.
  const singles = Array.from({ length: 128 }, (_, i) => sampleSequence(i));
  const batches = Array.from({ length: 32 }, (_, batch) => Array.from({ length: 4 }, (_, i) => sampleSequence(batch * 4 + i))).flat();
  expect(batches).toEqual(singles);
});

test('motion returns directly to final detail before accumulating 128 samples', () => {
  const policy = new MotionRefinement();
  expect(policy.update(0, 'initial')).toBe(false); expect(policy.active).toBe(false);
  expect(policy.update(10, 'camera-moved')).toBe(true); expect(policy.active).toBe(true);
  policy.update(100, 'sun-moved');
  expect(policy.update(279, 'sun-moved')).toBe(false);
  expect(policy.update(280, 'sun-moved')).toBe(true); expect(policy.active).toBe(false);
  policy.update(500, 'sun-moved', true); expect(policy.active).toBe(true);
  policy.update(700, 'sun-moved', false); expect(policy.active).toBe(false);
});
