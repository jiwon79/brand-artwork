import { generateCloud, generateCloudPreview } from './gaussian/cloud.js';
import { clusterLightBounds } from './gaussian/lighting.js';
import { buildSpatialLOD } from './gaussian/spatial-lod.js';
import { createGPUDetailBaker, bakeWithGPUFallback } from './gaussian/detail-gpu.js';
import { readScene, writeScene, sceneKey, sceneBuffers, sceneBytes, shareSourceBuffers, type GaussianScene } from './scene-cache';

type Request = { id: number; preset: string; seed: number; persistent?: boolean };
function send(id: number, scene: GaussianScene, stage: 'preview' | 'complete', started: number, cacheHit = false) {
  self.postMessage({ id, scene, stage, cacheHit, milliseconds: performance.now() - started }, { transfer: sceneBuffers(scene) });
}
async function generate({ id, preset, seed, persistent = true }: Request) {
  const started = performance.now(), key = sceneKey(preset, seed);
  try {
    const cached = persistent ? await readScene(key) : undefined;
    if (cached?.lod && cached.count === cached.lod.sourceCount && cached.data.length === cached.count * 8) {
      send(id, { ...cached, preset }, 'complete', started, true); return;
    }
    // Give the camera a real Gaussian silhouette while full source preparation
    // continues in this worker. This is never marked as the completed image.
    const preview = generateCloudPreview(preset, seed, 0.25) as unknown as GaussianScene;
    preview.lightBounds = clusterLightBounds(preview.data);
    preview.lod = buildSpatialLOD(preview) as GaussianScene['lod'];
    send(id, preview, 'preview', started);
    const sourceStart = performance.now();
    const scene = generateCloud(preset, seed, { deferDetail: true }) as unknown as GaussianScene;
    const bakeStart = performance.now();
    const baker = preset === 'storm' ? null : await createGPUDetailBaker().catch(() => null);
    try { scene.detailBake = await bakeWithGPUFallback(scene, scene.detail, baker); } finally { baker?.dispose(); }
    const bounded = performance.now();
    scene.lightBounds = clusterLightBounds(scene.data);
    scene.lod = buildSpatialLOD(scene) as GaussianScene['lod'];
    scene.generationTimings = { sourceMs: bakeStart - sourceStart, detailMs: bounded - bakeStart, lodMs: performance.now() - bounded, totalMs: performance.now() - started };
    const shared = shareSourceBuffers(scene);
    // Start optional persistence before transferring ownership. Never wait for
    // a disk write before displaying the finished geometry.
    const persistable = persistent && sceneBytes(shared) <= 320 * 1024 * 1024;
    const persistence = persistable ? writeScene(key, shared) : Promise.resolve();
    // Keep storage ownership intact while IndexedDB opens asynchronously.
    // A separate display clone lets disk IO and rendering proceed concurrently.
    if (persistable) {
      const display = structuredClone(shared);
      send(id, display, 'complete', started);
      await persistence;
    } else send(id, shared, 'complete', started);
  } catch (error) { self.postMessage({ id, error: error instanceof Error ? error.message : String(error) }); }
}
let work = Promise.resolve();
self.onmessage = ({ data }: MessageEvent<Request>) => { work = work.then(() => generate(data)); };
