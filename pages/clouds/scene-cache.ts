/** Immutable Gaussian arrays. The first LOD records are exact source copies. */
type GaussianLOD = ReturnType<typeof import('./gaussian/spatial-lod.js').buildSpatialLOD> & {
  lighting: Uint8Array; detail: Uint8Array; lightning?: Uint8Array;
};
export type GaussianScene = {
  count: number; data: Float32Array; lighting: Uint8Array; detail: Uint8Array;
  seed: number; preset: string; min: number[]; max: number[]; preview?: boolean;
  lod?: GaussianLOD;
  lightBounds?: ReturnType<typeof import('./gaussian/lighting.js').clusterLightBounds>;
  generationTimings?: Record<string, number | string>;
  [key: string]: unknown;
};

// Bump whenever authoring, detail baking, or the LOD representation changes.
export const CACHE_REVISION = 'gaussian-2026-10-17-v1';
export const sceneKey = (preset: string, seed: number) => `${CACHE_REVISION}:${preset === 'sunset' ? 'cumulus' : preset}:${seed >>> 0}`;

export function sceneBuffers(value: unknown): ArrayBuffer[] {
  const seen = new Set<object>(), result: ArrayBuffer[] = [];
  function visit(item: unknown) {
    if (!item || typeof item !== 'object' || seen.has(item)) return;
    seen.add(item);
    if (item instanceof ArrayBuffer) { result.push(item); return; }
    if (ArrayBuffer.isView(item)) { visit(item.buffer); return; }
    for (const child of Object.values(item)) visit(child);
  }
  visit(value); return result;
}
export const sceneBytes = (scene: GaussianScene) => sceneBuffers(scene).reduce((sum, buffer) => sum + buffer.byteLength, 0);

// No quantization or resampling: release duplicate source allocations and keep
// views into the identical prefix of the immutable LOD arrays instead.
export function shareSourceBuffers(scene: GaussianScene): GaussianScene {
  if (!scene.lod) return scene;
  if (scene.count !== scene.lod.sourceCount) throw new Error('Gaussian cache source count mismatch');
  return { ...scene, data: scene.lod.data.subarray(0, scene.count * 8),
    lighting: scene.lod.lighting.subarray(0, scene.count * 4), detail: scene.lod.detail.subarray(0, scene.count * 12),
    ...(scene.lod.lightning ? { lightning: scene.lod.lightning.subarray(0, scene.count * 4) } : {}) };
}

/** Lossless, bounded LRU; aliases retain array identity for GPU reuse. */
export class SceneMemoryCache {
  readonly entries = new Map<string, { scene: GaussianScene; bytes: number }>();
  bytes = 0;
  constructor(readonly limit = 240 * 1024 * 1024) {}
  get(key: string, preset: string): GaussianScene | undefined {
    const entry = this.entries.get(key); if (!entry) return;
    this.entries.delete(key); this.entries.set(key, entry);
    return { ...entry.scene, preset };
  }
  put(key: string, scene: GaussianScene) {
    const bytes = sceneBytes(scene); if (bytes > this.limit) return;
    const previous = this.entries.get(key);
    if (previous) { this.bytes -= previous.bytes; this.entries.delete(key); }
    this.entries.set(key, { scene, bytes }); this.bytes += bytes;
    while (this.bytes > this.limit) {
      const oldest = this.entries.keys().next().value!;
      this.bytes -= this.entries.get(oldest)!.bytes; this.entries.delete(oldest);
    }
  }
  clear() { this.entries.clear(); this.bytes = 0; }
}

// IndexedDB structured clone preserves Float32 bits and shared backing buffers.
// All reads/writes run in the generation worker; storage failure is a cache miss.
const DATABASE = 'studio-clouds-gaussian';
function openCache(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('scenes');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Cloud cache unavailable'));
  });
}
export async function readScene(key: string): Promise<GaussianScene | undefined> {
  let database: IDBDatabase | undefined;
  try {
    database = await openCache();
    return await new Promise((resolve, reject) => {
      const request = database!.transaction('scenes').objectStore('scenes').get(key);
      request.onsuccess = () => resolve(request.result?.scene);
      request.onerror = () => reject(request.error);
    });
  } catch { return undefined; } finally { database?.close(); }
}
export async function writeScene(key: string, scene: GaussianScene, limit = 320 * 1024 * 1024) {
  let database: IDBDatabase | undefined;
  try {
    const bytes = sceneBytes(scene); if (bytes > limit) return;
    database = await openCache();
    await new Promise<void>((resolve, reject) => {
      const transaction = database!.transaction('scenes', 'readwrite'), store = transaction.objectStore('scenes');
      // One atomic transaction prevents a terminated worker leaving half a cache.
      const request = store.openCursor();
      const entries: { key: IDBValidKey; bytes: number; at: number }[] = [];
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          const value = cursor.value;
          if (!String(cursor.key).startsWith(CACHE_REVISION)) cursor.delete();
          else if (cursor.key !== key) entries.push({ key: cursor.key, bytes: value.bytes, at: value.at });
          cursor.continue(); return;
        }
        let total = entries.reduce((sum, entry) => sum + entry.bytes, bytes);
        entries.sort((a, b) => a.at - b.at);
        for (const entry of entries) { if (total <= limit) break; store.delete(entry.key); total -= entry.bytes; }
        store.put({ scene, bytes, at: Date.now() }, key);
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = transaction.onabort = () => reject(transaction.error);
    });
  } catch { /* Storage is optional; the generated image remains valid. */ } finally { database?.close(); }
}
