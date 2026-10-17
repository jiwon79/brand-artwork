import { FrameMemoryCache, validCompletedFrame, type CompletedFrame } from './completed-frame';

export class CompletedFrameCache {
  readonly memory = new FrameMemoryCache();
  readonly metrics = { hits: 0, reads: 0, writes: 0, persisted: 0, restored: 0, source: '', restoreMs: 0, errors: 0 };
  private worker?: Worker;
  private requested = new Map<string, { pending: boolean; at: number }>();
  private stored = new Set<string>();
  private diskHits = new Set<string>();
  private nextID = 0;
  constructor(readonly enabled: boolean, private onUpdate: (key: string, redraw: boolean) => void) {}
  private backend() {
    if (!this.worker) {
      this.worker = new Worker(new URL('./completed-frame-worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = ({ data }: MessageEvent<{ type: string; key: string; frame?: CompletedFrame; stored?: boolean }>) => {
        if (data.type === 'put') { if (data.stored) this.metrics.persisted++; this.onUpdate(data.key, false); return; }
        const request = this.requested.get(data.key);
        if (request) request.pending = false;
        if (validCompletedFrame(data.frame)) { this.memory.put(data.key, data.frame); this.diskHits.add(data.key); }
        this.onUpdate(data.key, true);
      };
      this.worker.onerror = () => {
        this.metrics.errors++;
        for (const request of this.requested.values()) request.pending = false;
        this.worker?.terminate(); this.worker = undefined;
      };
    }
    return this.worker;
  }
  lookup(key: string) {
    const frame = this.memory.get(key);
    if (frame) {
      const source = this.diskHits.has(key) ? 'disk' : 'memory'; this.diskHits.delete(key);
      return { frame, source, pending: false };
    }
    let request = this.requested.get(key);
    if (!request) {
      request = { pending: true, at: performance.now() }; this.requested.set(key, request);
      if (this.requested.size > 128) this.requested.delete(this.requested.keys().next().value!);
      this.metrics.reads++;
      try { this.backend().postMessage({ id: ++this.nextID, type: 'get', key }); }
      catch { request.pending = false; this.metrics.errors++; }
    }
    // Optional storage can never prevent the real renderer from progressing.
    return { frame: undefined, source: '', pending: request.pending && performance.now() - request.at < 150 };
  }
  hasStored(key: string) { return this.stored.has(key); }
  store(key: string, frame: CompletedFrame) {
    if (!this.enabled || !validCompletedFrame(frame)) return;
    this.memory.put(key, frame); this.stored.add(key); this.diskHits.delete(key);
    if (this.stored.size > 128) this.stored.delete(this.stored.values().next().value!);
    this.metrics.writes++;
    try { this.backend().postMessage({ id: ++this.nextID, type: 'put', key, frame }); }
    catch { this.metrics.errors++; }
  }
  restored(source: string, milliseconds = 0) {
    this.metrics.hits++; this.metrics.restored++; this.metrics.source = source; this.metrics.restoreMs = milliseconds;
  }
  diagnostics() { return { enabled: this.enabled, bytes: this.memory.bytes, ...this.metrics }; }
  dispose() { this.worker?.terminate(); this.memory.clear(); this.requested.clear(); }
}
