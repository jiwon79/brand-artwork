import type { Bounds } from './lettering';
import { raster } from './test-font';

/** Read the outside edge at subpixel precision. Compare tangents on either
 * side of a five-font-unit window: a smooth centerline alone misses a notch
 * made by two round caps or a returning stroke that starts off the stem.
 */
export function maximumEdgeTurn(ink: string, bounds: Bounds, axis: 'x' | 'y'): number {
  const scale = 4, pixels = raster(ink, bounds, scale);
  const width = Math.ceil((bounds[2] - bounds[0]) * scale), height = Math.ceil((bounds[3] - bounds[1]) * scale);
  const along = axis === 'x' ? width : height, across = axis === 'x' ? height : width;
  const alpha = (a: number, b: number) => pixels[(axis === 'x' ? b * width + a : a * width + b) * 4 + 3];
  const edge = Array.from({ length: along }, (_, a) => {
    let last = -1;
    for (let b = 0; b < across; b++) if (alpha(a, b) > 127) last = b;
    // The crop must include both the ink and the background after its edge.
    if (last < 0 || last >= across - 1) throw new Error('Edge crop must contain ink and trailing paper');
    return last + (alpha(a, last) - 127) / (alpha(a, last) - alpha(a, last + 1));
  });
  const step = 5 * scale;
  let maximum = 0;
  for (let i = step; i < edge.length - step; i++) {
    const before = (edge[i] - edge[i - step]) / step, after = (edge[i + step] - edge[i]) / step;
    maximum = Math.max(maximum, Math.abs(Math.atan(before) - Math.atan(after)) * 180 / Math.PI);
  }
  return maximum;
}

