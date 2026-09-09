import { CELLS, REFERENCE_HEIGHT, REFERENCE_WIDTH } from './reference-layout';
import { FLIP_DURATION, REST_ANGLE, otherModel, sampleFlip, type ModelName } from './flip-motion';

type Point = { x: number; y: number };
type CellState = { model: ModelName; elapsed?: number };
const HIT_RADIUS = 0.9;

// Clip captured pointer paths to the artwork before testing the swept segment.
// This also catches cells between sparse pointer events during a fast swipe.
export function cellsAlongStroke(from: Point, to: Point) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  let start = 0;
  let end = 1;
  for (const [origin, delta, halfSize] of [
    [from.x, dx, REFERENCE_WIDTH / 2], [from.y, dy, REFERENCE_HEIGHT / 2],
  ]) {
    if (delta === 0) {
      if (Math.abs(origin) > halfSize) return [];
      continue;
    }
    const first = (-halfSize - origin) / delta;
    const last = (halfSize - origin) / delta;
    start = Math.max(start, Math.min(first, last));
    end = Math.min(end, Math.max(first, last));
    if (start > end) return [];
  }
  const lengthSquared = dx * dx + dy * dy;
  return CELLS.flatMap((cell, index) => {
    const projected = lengthSquared ? ((cell.x - from.x) * dx + (cell.y - from.y) * dy) / lengthSquared : 0;
    const t = Math.max(start, Math.min(end, projected));
    const distance = Math.hypot(cell.x - from.x - t * dx, cell.y - from.y - t * dy);
    return distance <= HIT_RADIUS ? [index] : [];
  });
}

export function createFieldMotion() {
  const cells: CellState[] = CELLS.map(() => ({ model: 'flower' }));
  return {
    stroke(from: Point, to: Point, visited: Set<number>, reducedMotion: boolean) {
      let changed = false;
      for (const index of cellsAlongStroke(from, to)) {
        if (visited.has(index)) continue;
        visited.add(index);
        const cell = cells[index];
        if (cell.elapsed !== undefined) continue;
        if (reducedMotion) cell.model = otherModel(cell.model);
        else cell.elapsed = 0;
        changed = true;
      }
      return changed;
    },
    advance(delta: number) {
      let changed = false;
      for (const cell of cells) {
        if (cell.elapsed === undefined) continue;
        changed = true;
        cell.elapsed += delta;
        if (cell.elapsed >= FLIP_DURATION[cell.model]) {
          cell.model = otherModel(cell.model);
          cell.elapsed = undefined;
        }
      }
      return changed;
    },
    pose(index: number) {
      const cell = cells[index];
      return cell.elapsed === undefined ? { model: cell.model, rotationX: REST_ANGLE[cell.model] }
        : sampleFlip(cell.model, cell.elapsed / FLIP_DURATION[cell.model]);
    },
    settle() {
      for (const cell of cells) {
        if (cell.elapsed !== undefined) cell.model = otherModel(cell.model);
        cell.elapsed = undefined;
      }
    },
    reset() {
      for (const cell of cells) { cell.model = 'flower'; cell.elapsed = undefined; }
    },
  };
}

export function createFieldInteraction(
  canvas: HTMLCanvasElement, enabled: () => boolean, reducedMotion: () => boolean, onChange: () => void,
) {
  const motion = createFieldMotion();
  const events = new AbortController();
  const options = { signal: events.signal };
  let pointer: { id: number; point: Point; visited: Set<number> } | undefined;

  function point(event: PointerEvent): Point {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width - 0.5) * REFERENCE_WIDTH,
      y: (0.5 - (event.clientY - rect.top) / rect.height) * REFERENCE_HEIGHT,
    };
  }
  function release() {
    const id = pointer?.id;
    pointer = undefined;
    canvas.classList.remove('is-painting');
    if (id !== undefined && canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
  }
  canvas.addEventListener('pointerdown', event => {
    if (!enabled() || pointer || !event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    pointer = { id: event.pointerId, point: point(event), visited: new Set() };
    canvas.setPointerCapture(event.pointerId);
    canvas.classList.add('is-painting');
    if (motion.stroke(pointer.point, pointer.point, pointer.visited, reducedMotion())) onChange();
  }, options);
  canvas.addEventListener('pointermove', event => {
    if (!pointer || pointer.id !== event.pointerId) return;
    if (!enabled() || event.buttons === 0) return release();
    const next = point(event);
    if (motion.stroke(pointer.point, next, pointer.visited, reducedMotion())) onChange();
    pointer.point = next;
  }, options);
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
    canvas.addEventListener(name, event => { if (pointer?.id === event.pointerId) release(); }, options);
  }
  window.addEventListener('blur', release, options);
  window.addEventListener('resize', release, options);
  document.addEventListener('visibilitychange', () => { if (document.hidden) release(); }, options);
  return {
    ...motion,
    release,
    reset() { release(); motion.reset(); onChange(); },
    dispose() { release(); events.abort(); },
  };
}
