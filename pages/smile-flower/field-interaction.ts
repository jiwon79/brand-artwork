import { CELLS, REFERENCE_HEIGHT, REFERENCE_WIDTH } from './reference-layout';
import { REST_ANGLE, type ModelName } from './flip-motion';

type Point = { x: number; y: number };
type CellState = { angle: number; velocity: number; target?: number };
const FRICTION = 2.4;
const SETTLE_SPEED = 1.8;
const SPRING = 9;
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

// Continuous angular momentum: a stroke transfers velocity, then friction slows
// the spin. A critically damped spring seats the nearest face at low speed.
export function createFieldMotion() {
  const cells: CellState[] = CELLS.map(() => ({ angle: 0, velocity: 0 }));
  function seat(cell: CellState) {
    const turns = Math.round((cell.target ?? cell.angle) / Math.PI);
    cell.angle = (Math.abs(turns % 2)) * Math.PI;
    cell.velocity = 0;
    cell.target = undefined;
  }
  return {
    stroke(from: Point, to: Point, seconds: number, visited: Set<number>, reducedMotion: boolean) {
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const distance = Math.hypot(dx, dy);
      if (distance < 0.00001) return false;
      const direction = Math.sign(Math.abs(dx) >= Math.abs(dy) ? dx : -dy);
      const speed = Math.min(28, distance / Math.max(seconds, 0.008) * 2.4) * direction;
      let changed = false;
      for (const index of cellsAlongStroke(from, to)) {
        const cell = cells[index];
        if (reducedMotion) {
          if (visited.has(index)) continue;
          visited.add(index);
          seat(cell);
          cell.angle = cell.angle === 0 ? Math.PI : 0;
        } else {
          // Weight the impulse by the actual distance inside this cell's disk.
          // Sparse pointer events must not transfer a whole long swipe to each cell.
          const center = CELLS[index];
          const along = ((center.x - from.x) * dx + (center.y - from.y) * dy) / distance;
          const perpendicular = ((center.x - from.x) * dy - (center.y - from.y) * dx) / distance;
          const halfChord = Math.sqrt(Math.max(0, HIT_RADIUS ** 2 - perpendicular ** 2));
          const contact = Math.max(0, Math.min(distance, along + halfChord) - Math.max(0, along - halfChord));
          if (!contact) continue;
          cell.angle += direction * contact * 0.8;
          cell.velocity += (speed - cell.velocity) * (1 - Math.exp(-contact * 2.8));
          cell.target = undefined;
        }
        changed = true;
      }
      return changed;
    },
    advance(delta: number) {
      if (delta <= 0) return false;
      let changed = false;
      for (const cell of cells) {
        if (cell.velocity === 0 && cell.target === undefined) continue;
        changed = true;
        let remaining = delta;
        if (cell.target === undefined) {
          const coast = Math.min(remaining, Math.max(0, Math.log(Math.abs(cell.velocity) / SETTLE_SPEED) / FRICTION));
          const decay = Math.exp(-FRICTION * coast);
          cell.angle += cell.velocity * (1 - decay) / FRICTION;
          cell.velocity *= decay;
          remaining -= coast;
          if (remaining <= 1e-9) continue;
          cell.target = Math.round((cell.angle + cell.velocity / SPRING) / Math.PI) * Math.PI;
        }
        // Exact critically damped solution keeps 30/60/120 Hz motion consistent.
        const offset = cell.angle - cell.target;
        const impulse = cell.velocity + SPRING * offset;
        const decay = Math.exp(-SPRING * remaining);
        cell.angle = cell.target + (offset + impulse * remaining) * decay;
        cell.velocity = (cell.velocity - SPRING * impulse * remaining) * decay;
        if (Math.abs(cell.angle - cell.target) < 0.001 && Math.abs(cell.velocity) < 0.01) seat(cell);
      }
      return changed;
    },
    pose(index: number) {
      const cell = cells[index];
      const halfTurns = Math.round(cell.angle / Math.PI);
      const model: ModelName = Math.abs(halfTurns % 2) ? 'smiley' : 'flower';
      const localAngle = cell.angle - halfTurns * Math.PI;
      return { model, rotationX: localAngle + REST_ANGLE[model] * Math.cos(localAngle) ** 2 };
    },
    settle() { cells.forEach(seat); },
    reset() { for (const cell of cells) { cell.angle = 0; cell.velocity = 0; cell.target = undefined; } },
  };
}

export function createFieldInteraction(
  canvas: HTMLCanvasElement, enabled: () => boolean, reducedMotion: () => boolean, onChange: () => void,
) {
  const motion = createFieldMotion();
  const events = new AbortController();
  const options = { signal: events.signal };
  let pointer: { id: number; point: Point; time: number; visited: Set<number> } | undefined;

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
    pointer = { id: event.pointerId, point: point(event), time: event.timeStamp, visited: new Set() };
    canvas.setPointerCapture(event.pointerId);
    canvas.classList.add('is-painting');
  }, options);
  canvas.addEventListener('pointermove', event => {
    if (!pointer || pointer.id !== event.pointerId) return;
    if (!enabled() || event.buttons === 0) return release();
    const next = point(event);
    if (motion.stroke(pointer.point, next, (event.timeStamp - pointer.time) / 1000, pointer.visited, reducedMotion())) onChange();
    pointer.point = next;
    pointer.time = event.timeStamp;
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
