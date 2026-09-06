import type { Point } from './geometry';

export interface CopyBounds { x: number; y: number; width: number; height: number }
interface CopyLayout { x: number; y: number; fontSize: number; lineHeight: number; scaleX: number }

// Every reveal is x-monotone: one sampled boundary going right, the other left.
// Inspect whole edge portions, not just the box corners (which miss curved peaks).
function stripRange(polygon: readonly Point[], left: number, right: number): [number, number] {
  if (polygon.length < 3) return [Infinity, -Infinity];
  let area = 0, minX = Infinity, maxX = -Infinity;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    area += a.x * b.y - b.x * a.y;
    minX = Math.min(minX, a.x); maxX = Math.max(maxX, a.x);
  }
  if (left < minX || right > maxX || Math.abs(area) < 1e-7) return [Infinity, -Infinity];
  let top = -Infinity, bottom = Infinity;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    const dx = b.x - a.x;
    if (Math.abs(dx) < 1e-7) continue;
    const start = Math.max(left, Math.min(a.x, b.x)), end = Math.min(right, Math.max(a.x, b.x));
    if (start > end) continue;
    const y1 = a.y + (b.y - a.y) * (start - a.x) / dx;
    const y2 = a.y + (b.y - a.y) * (end - a.x) / dx;
    if (dx * area > 0) top = Math.max(top, y1, y2);
    else bottom = Math.min(bottom, y1, y2);
  }
  return [top, bottom];
}

export function fitCopyInOpenings(
  layout: CopyLayout, bounds: CopyBounds, polygons: readonly (readonly Point[])[],
  width: number, height: number, padding: number,
): CopyLayout {
  const range = (fontSize: number): [number, number] => {
    const left = layout.x + bounds.x * fontSize * layout.scaleX - padding;
    const right = layout.x + (bounds.x + bounds.width) * fontSize * layout.scaleX + padding;
    if (left < 0 || right > width) return [Infinity, -Infinity];
    let top = padding, bottom = height - padding;
    for (const polygon of polygons) {
      const [upper, lower] = stripRange(polygon, left, right);
      top = Math.max(top, upper + padding); bottom = Math.min(bottom, lower - padding);
    }
    return [top, bottom];
  };
  let low = 0, high = layout.fontSize;
  // The safe strip only gets smaller as the centered text becomes wider.
  for (let i = 0; i < 16; i++) {
    const candidate = (low + high) / 2;
    const [top, bottom] = range(candidate);
    if (bounds.height * candidate <= bottom - top) low = candidate;
    else high = candidate;
  }
  const [top, bottom] = range(low);
  if (!Number.isFinite(top) || !Number.isFinite(bottom) || bottom <= top) {
    return { ...layout, fontSize: 0, lineHeight: 0 };
  }
  const desiredY = layout.y + (bounds.y + bounds.height / 2) * (layout.fontSize - low);
  return {
    ...layout,
    y: Math.max(top - bounds.y * low, Math.min(bottom - (bounds.y + bounds.height) * low, desiredY)),
    fontSize: low,
    lineHeight: layout.lineHeight * low / layout.fontSize,
  };
}
