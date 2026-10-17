import type { GaussianScene } from '../scene-cache';
export type RenderStatus = { state?: string; progress?: number; samples?: number; target?: number; count?: number; visibleCount?: number; error?: string };
export class CloudRenderer {
  constructor(canvas: HTMLCanvasElement, onStatus?: (status: RenderStatus) => void);
  canvas: HTMLCanvasElement;
  settings: Record<string, number | boolean> & { exposure: number; orbit: boolean; lightning: boolean };
  scene: GaussianScene | null;
  camera: { target: number[]; distance: number; yaw: number; pitch: number };
  sampleFence: WebGLSync | null;
  animationPaused: boolean;
  readyToSave: boolean;
  shadowSize: number[];
  configure(values: Record<string, number | boolean>): void;
  resetCamera(preset: { target: number[]; distance: number; yaw: number; pitch: number }): void;
  setCloud(scene: GaussianScene, options?: { reuse?: boolean; keepLighting?: boolean }): void;
  zoomBy(factor: number): void;
  flashLightning(): void;
  exportPNG(): Promise<Blob>;
  diagnostics(): Record<string, unknown>;
  renderStats(): { state: string; fps: number | null; lod: { scale: number | null } };
  dispose(): void;
}
