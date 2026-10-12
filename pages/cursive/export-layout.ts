import type { Bounds } from './coordinates';

/** Use the same centered 9:20 composition for photos and videos. */
export function exportViewBox(bounds: Bounds, width: number, height: number): string {
  const [left, top, right, bottom] = bounds;
  const scale = Math.min(width * .8 / Math.max(1, right - left), height * .44 / Math.max(1, bottom - top));
  const viewWidth = width / scale, viewHeight = height / scale;
  return `${(left + right - viewWidth) / 2} ${(top + bottom - viewHeight) / 2} ${viewWidth} ${viewHeight}`;
}

export function artworkFileName(text: string, extension: string): string {
  const name = text.trim().replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'handwriting';
  return `cursive-${name}.${extension}`;
}
