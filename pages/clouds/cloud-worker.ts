import { generateDensity, type Formation } from './volume';
self.onmessage = ({ data }: MessageEvent<{ id: number; formation: Formation; seed: number }>) => {
  try {
    const start = performance.now(), density = generateDensity(data.formation, data.seed);
    self.postMessage({ id: data.id, density, seed: data.seed, milliseconds: performance.now() - start }, { transfer: [density.buffer] });
  } catch (error) {
    self.postMessage({ id: data.id, error: error instanceof Error ? error.message : String(error) });
  }
};
