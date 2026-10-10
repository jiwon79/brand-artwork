import { Color, SRGBColorSpace } from 'three';
import type { PenPath } from './pen-geometry';

export type TubeColorMode = 'solid' | 'rainbow';

// Horizontal, smoothly interpolated stops observed in the public Spline scene.
// Timing and traveled distance do not move a color already assigned to a letter.
export const tubeRainbowStops = [
  [0, '#ff5f5f'], [.196167, '#ffa17e'], [.288135, '#ffcb44'],
  [.425439, '#8fd668'], [.495215, '#8edccb'], [.633081, '#819bfc'],
  [.774878, '#819bfc'], [.839478, '#d183ff'], [.964551, '#ff60ab'], [1, '#ff5f5f'],
] as const;

export function tubeRainbowColor(progress: number): Color {
  const t = Math.max(0, Math.min(1, progress));
  let index = 1;
  while (index < tubeRainbowStops.length - 1 && tubeRainbowStops[index][0] < t) index++;
  const [left, from] = tubeRainbowStops[index - 1], [right, to] = tubeRainbowStops[index];
  const fraction = (t - left) / (right - left), smooth = fraction * fraction * (3 - 2 * fraction);
  const a = new Color(from).convertLinearToSRGB(), b = new Color(to).convertLinearToSRGB();
  a.lerp(b, smooth);
  return new Color().setRGB(a.r, a.g, a.b, SRGBColorSpace);
}

/** One fixed horizontal field across the whole text. Deferred dots use their
 * own stem's anchor; crossbars sample the same field at each stem crossing. */
export function createTubeColors(pens: readonly PenPath[]): Color[][] {
  const bodies = pens.filter(pen => !pen.retrace && !pen.colorAnchors && pen.points.length);
  const bounds = bodies.length ? bodies : pens.filter(pen => !pen.retrace);
  let left = Infinity, right = -Infinity;
  for (const pen of bounds) for (const point of pen.points) {
    left = Math.min(left, point.x); right = Math.max(right, point.x);
  }
  const span = right - left;
  return pens.map(pen => pen.points.map(point => {
    const x = pen.length <= .1 && pen.colorAnchors?.length ? pen.colorAnchors[0][0] : point.x;
    return tubeRainbowColor(span > 1e-8 ? (x - left) / span : .5);
  }));
}
