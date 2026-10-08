import { type FontCatalog, type Lettering, type Point } from './lettering';
import { revealFrame, revealTimes, skeletonize, traceSkeleton, type Seed } from './reveal';

export const FONT_FAMILY = 'Borel Handwriting';
const traceCache = new Map<string, Point[][]>();

/** Thin the assembled native line so joins have a single continuous center graph.
 * Thinning separate glyphs would leave two competing trajectories at a join.
 */
function lineTraces(lettering: Lettering, lineIndex: number, catalog: FontCatalog): Point[][] {
  const line = lettering.lines[lineIndex];
  const cached = traceCache.get(line.text);
  if (cached) return cached;
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const glyph of lettering.glyphs) if (glyph.origin[1] === line.origin[1]) {
    const bounds = catalog.glyphs[glyph.id].bounds;
    if (!bounds) continue;
    left = Math.min(left, glyph.x + bounds[0]); right = Math.max(right, glyph.x + bounds[2]);
    top = Math.min(top, -glyph.y - bounds[3]); bottom = Math.max(bottom, -glyph.y - bounds[1]);
  }
  if (!Number.isFinite(left)) return [];
  const scale = .2, padding = 6, canvas = document.createElement('canvas');
  canvas.width = Math.ceil((right - left) * scale) + padding * 2; canvas.height = Math.ceil((bottom - top) * scale) + padding * 2;
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  context.font = `${catalog.unitsPerEm * scale}px "${FONT_FAMILY}"`; context.fontKerning = 'normal';
  context.fillText(line.text, padding - left * scale, padding - top * scale);
  const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const alpha = Uint8Array.from({ length: canvas.width * canvas.height }, (_, i) => rgba[i * 4 + 3]);
  const paths = traceSkeleton(skeletonize(alpha, canvas.width, canvas.height), canvas.width, canvas.height)
    .map(path => path.map(([x, y]): Point => [(x - padding) / scale + left, (y - padding) / scale + top]));
  if (traceCache.size > 64) traceCache.clear();
  traceCache.set(line.text, paths); return paths;
}

export interface FontRaster {
  source: ImageData;
  times: Float32Array;
  totalLength: number;
  scale: number;
  offset: Point;
  traces: Point[][];
}

/** Native text is the only source of visible ink, including its antialiasing. */
export function prepareFontRaster(lettering: Lettering, catalog: FontCatalog, width: number, height: number, pixelRatio: number, ink: string): FontRaster {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * pixelRatio)); canvas.height = Math.max(1, Math.round(height * pixelRatio));
  const context = canvas.getContext('2d')!;
  const [left, top, right, bottom] = lettering.bounds;
  const scale = Math.max(.001, Math.min((width - 24) / (right - left), (height - 24) / (bottom - top))) * pixelRatio;
  const offset: Point = [(canvas.width - (right - left) * scale) / 2 - left * scale, (canvas.height - (bottom - top) * scale) / 2 - top * scale];
  context.font = `${catalog.unitsPerEm * scale}px "${FONT_FAMILY}"`;
  context.fontKerning = 'normal'; context.textBaseline = 'alphabetic'; context.fillStyle = ink;
  for (const line of lettering.lines) context.fillText(line.text, offset[0] + line.origin[0] * scale, offset[1] + line.origin[1] * scale);
  const source = context.getImageData(0, 0, canvas.width, canvas.height);
  const traces: Point[][] = [];
  for (const [lineIndex, line] of lettering.lines.entries()) {
    traces.push(...lineTraces(lettering, lineIndex, catalog).map(path => path.map(([x, y]): Point => [offset[0] + (line.origin[0] + x) * scale, offset[1] + (line.origin[1] + y) * scale])));
  }
  const seeds: Seed[] = [];
  let distance = 0;
  for (const path of traces) {
    // Detached one-pixel dots still receive a short writing interval.
    seeds.push({ x: path[0][0], y: path[0][1], time: distance });
    if (path.length === 1) distance += Math.max(1, 24 * scale);
    for (let i = 1; i < path.length; i++) {
      const [x, y] = path[i - 1], [nx, ny] = path[i];
      const length = Math.hypot(nx - x, ny - y), steps = Math.max(1, Math.ceil(length));
      for (let s = 1; s <= steps; s++) seeds.push({ x: x + (nx - x) * s / steps, y: y + (ny - y) * s / steps, time: distance + length * s / steps });
      distance += length;
    }
  }
  for (const seed of seeds) seed.time /= distance || 1;
  return { source, times: revealTimes(canvas.width, canvas.height, seeds, { radius: 45 * scale }), totalLength: distance / scale, scale, offset, traces };
}

export function paintFontFrame(context: CanvasRenderingContext2D, raster: FontRaster, progress: number, output: ImageData): void {
  revealFrame(raster.source.data, raster.times, progress, output.data, Math.min(.01, 1.5 / (raster.totalLength * raster.scale || 1)));
  context.putImageData(output, 0, 0);
}
