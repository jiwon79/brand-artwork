import { expect, test } from 'vitest';
import { completedViewKey, FrameMemoryCache, validCompletedFrame, frameBytes, type CompletedFrame, type CompletedView } from './completed-frame';

const view: CompletedView = {
  source: ['cumulus', 7351, 869001, 'webgpu'], camera: { eye: [1, 3, 29], forward: [0, 0, -1] }, instances: [[0, 0, 0]],
  resolution: [1265, 804, 1265, 804], precision: [32, 32], rasterSubpixel: 1 / 256, samples: 128,
  settings: { density: 1.55, scattering: .65, elevation: 38, azimuth: -82, localShadowStrength: .65, fineShadingStrength: .7, shadowReuse: 4, exposure: 0, glare: .32, samplesPerFrame: 4 },
};
function image(precision: 16 | 32 = 32): CompletedFrame {
  const planes = Array.from({ length: precision === 16 ? 2 : 1 }, () => new Float32Array(16));
  // Include HDR, low-amplitude, and signed-zero values that an 8-bit or JPEG cache would lose.
  for (const plane of planes) plane.set([10000.125, 1.0000001192092896, -0, 5.960464477539063e-8]);
  return { width: 2, height: 2, samples: 128, precision, planes };
}

test('completed cache identity includes every lighting, view and precision input', () => {
  const original = completedViewKey(view);
  for (const changed of [
    { source: ['cumulus', 7352, 869001, 'webgpu'] }, { camera: { eye: [2, 3, 29] } },
    { resolution: [2530, 1608, 2530, 1608] }, { precision: [16, 16] }, { samples: 256 },
    { instances: [[0, 0, 0], [1, 0, 0]] }, { rasterSubpixel: 1 / 16 },
  ]) expect(completedViewKey({ ...view, ...changed })).not.toBe(original);
  for (const name of ['density', 'scattering', 'elevation', 'azimuth', 'localShadowStrength', 'fineShadingStrength', 'shadowReuse']) {
    expect(completedViewKey({ ...view, settings: { ...view.settings, [name]: 2 } }), name).not.toBe(original);
  }
});

test('exposure and scheduling changes reuse HDR; object property order is irrelevant', () => {
  const changed = { ...view.settings, exposure: .7, glare: .8, vignette: .4, aberration: .1, detailCrispness: .5, samplesPerFrame: 8, orbit: false, autoPerformance: false, quality: 1, cloudScale: 1, lodMultiplier: 1 };
  expect(completedViewKey({ ...view, settings: Object.fromEntries(Object.entries(changed).reverse()) })).toBe(completedViewKey(view));
});

test('HDR and compensated 16-bit residuals survive storage without losing any bits', () => {
  for (const precision of [16, 32] as const) {
    const frame = image(precision), restored = structuredClone(frame);
    expect(validCompletedFrame(restored)).toBe(true);
    for (let i = 0; i < frame.planes.length; i++) {
      expect(new Uint32Array(restored.planes[i].buffer)).toEqual(new Uint32Array(frame.planes[i].buffer));
    }
    expect(frameBytes(restored)).toBe(precision === 16 ? 128 : 64);
  }
  expect(validCompletedFrame({ ...image(), samples: 127 })).toBe(false);
  expect(validCompletedFrame({ ...image(), width: 3 })).toBe(false);
  expect(validCompletedFrame({ ...image(16), planes: [new Float32Array(16)] })).toBe(false);
});

test('completed image LRU respects its memory budget', () => {
  const cache = new FrameMemoryCache(128);
  cache.put('a', image()); cache.put('b', image()); cache.get('a'); cache.put('c', image());
  expect(cache.get('b')).toBeUndefined(); expect(cache.get('a')).toBeDefined(); expect(cache.get('c')).toBeDefined();
  expect(cache.bytes).toBe(128);
  cache.put('a', image(16)); expect(cache.bytes).toBe(128); expect(cache.get('c')).toBeUndefined();
  cache.clear(); expect(cache.bytes).toBe(0);
});
