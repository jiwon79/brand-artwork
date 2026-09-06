import type { Point } from './geometry';

export const MAX_NESTED_DEPTH = 3;

interface ReturningLayer {
  parent: ReturningLayer | null;
  pull: { pinned: boolean; returning: boolean; velocityY: number } | null;
  dirty: boolean;
}

// Release the whole opened stack from its current pose, in the same frame.
export function returnLayerChain(layer: ReturningLayer): void {
  for (let current: ReturningLayer | null = layer; current; current = current.parent) {
    if (!current.pull) continue;
    current.pull.pinned = false;
    current.pull.returning = true;
    current.pull.velocityY = 0;
    current.dirty = true;
  }
}

// Content belongs to the slot, not the number of times the user has tried it.
export function isNestedSlot(row: number, depth: number): boolean {
  return depth < MAX_NESTED_DEPTH && ((row % 3) + 3) % 3 === 1;
}

export function layerGap(rootGap: number, depth: number): number {
  return Math.max(32, rootGap * 0.86 ** depth);
}

export function lineRows(height: number, gap: number, phase: number) {
  const first = Math.floor((-gap * 3 - phase) / gap);
  const last = Math.ceil((height + gap * 3 - phase) / gap);
  return Array.from({ length: last - first + 1 }, (_, index) => {
    const row = first + index;
    return { row, baseY: phase + row * gap };
  });
}

export function pointInOpening(polygon: readonly Point[], point: Point, margin = 0): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j], b = polygon[i];
    const dx = b.x - a.x, dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared === 0 ? 0
      : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
    const distance = Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy);
    if (distance <= Math.max(margin, 1e-7)) return margin === 0;
    if ((a.y > point.y) !== (b.y > point.y)
      && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function verticalRange(polygon: readonly Point[], x: number): [number, number] {
  const ys: number[] = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    if (x < Math.min(a.x, b.x) || x > Math.max(a.x, b.x)) continue;
    if (Math.abs(b.x - a.x) < 1e-7) { ys.push(a.y, b.y); continue; }
    ys.push(a.y + (b.y - a.y) * (x - a.x) / (b.x - a.x));
  }
  return ys.length < 2 ? [0, 0] : [Math.min(...ys), Math.max(...ys)];
}

export function visibleOpeningHeight(
  polygon: readonly Point[], x: number, height: number, ancestors: readonly Point[][] = [],
): number {
  let top = 0, bottom = height;
  for (const clip of [polygon, ...ancestors]) {
    const range = verticalRange(clip, x);
    top = Math.max(top, range[0]); bottom = Math.min(bottom, range[1]);
  }
  return Math.max(0, bottom - top);
}

export function canKeepOpening(
  polygon: readonly Point[], x: number, height: number, innerGap: number, ancestors: readonly Point[][] = [],
): boolean {
  // Keep a nested pocket only when at least two inner rows can actually be reached.
  return visibleOpeningHeight(polygon, x, height, ancestors) >= innerGap * 2.2;
}
