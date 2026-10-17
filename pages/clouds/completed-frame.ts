import { CACHE_REVISION } from './scene-cache';

// Bump when the renderer kernels or the stored accumulation representation change.
export const FRAME_REVISION = 'clouds-hdr-v1';
export const FRAME_MEMORY_LIMIT = 128 * 1024 * 1024;
export const FRAME_DISK_LIMIT = 256 * 1024 * 1024;
export type CompletedFrame = {
  width: number; height: number; samples: number; precision: 16 | 32;
  // Float32 readback represents every original 16-bit value exactly, too.
  // The second plane retains compensated half-float accumulation residuals.
  planes: Float32Array[];
};
export type CompletedView = {
  source: unknown; camera: unknown; instances: unknown;
  resolution: number[]; precision: number[]; rasterSubpixel: number;
  samples: number; settings: Record<string, unknown>;
};
const POST_OR_SCHEDULING = new Set([
  'exposure', 'glare', 'vignette', 'aberration', 'detailCrispness',
  'autoPerformance', 'orbit', 'lightning', 'samplesPerFrame',
  'quality', 'cloudScale', 'lodMultiplier',
]);
export function completedViewKey(view: CompletedView): string {
  const settings = Object.fromEntries(Object.entries(view.settings)
    .filter(([name]) => !POST_OR_SCHEDULING.has(name)).sort(([a], [b]) => a.localeCompare(b)));
  return JSON.stringify([FRAME_REVISION, CACHE_REVISION, { ...view, settings }]);
}
export function frameBytes(frame: CompletedFrame): number {
  return frame.planes.reduce((sum, plane) => sum + plane.byteLength, 0);
}
export function validCompletedFrame(frame: CompletedFrame | undefined): frame is CompletedFrame {
  return !!frame && Number.isInteger(frame.width) && frame.width > 0 && Number.isInteger(frame.height) && frame.height > 0
    && Number.isInteger(frame.samples) && frame.samples >= 128 && [16, 32].includes(frame.precision)
    && Array.isArray(frame.planes) && frame.planes.length === (frame.precision === 16 ? 2 : 1)
    && frame.planes.every(plane => plane instanceof Float32Array && plane.length === frame.width * frame.height * 4)
    && frameBytes(frame) <= FRAME_MEMORY_LIMIT;
}
export class FrameMemoryCache {
  private entries = new Map<string, CompletedFrame>();
  bytes = 0;
  constructor(readonly limit = FRAME_MEMORY_LIMIT) {}
  get(key: string) {
    const frame = this.entries.get(key); if (!frame) return;
    this.entries.delete(key); this.entries.set(key, frame); return frame;
  }
  put(key: string, frame: CompletedFrame) {
    const bytes = frameBytes(frame); if (bytes > this.limit) return;
    const previous = this.entries.get(key);
    if (previous) { this.bytes -= frameBytes(previous); this.entries.delete(key); }
    this.entries.set(key, frame); this.bytes += bytes;
    while (this.bytes > this.limit) {
      const oldest = this.entries.keys().next().value!;
      this.bytes -= frameBytes(this.entries.get(oldest)!); this.entries.delete(oldest);
    }
  }
  clear() { this.entries.clear(); this.bytes = 0; }
}
