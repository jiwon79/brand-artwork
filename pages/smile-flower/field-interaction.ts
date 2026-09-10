import { createRotationSettings, type RotationSettings } from './rotation-settings';
import { CELLS, REFERENCE_HEIGHT, REFERENCE_WIDTH } from './reference-layout';
import { REST_ANGLE, type ModelName } from './flip-motion';
import { createBloomMotion } from './bloom-motion';

type Point = { x: number; y: number };
type HitPose = Point & { scale?: number };
type CellState = { angle: number; velocity: number; target?: number; drive?: number; waveSpin?: { from: number; target: number; elapsed: number } };
const WAVE_SPIN_DURATION = 0.84;
const ROTATION_PLAYBACK_RATE = 0.6;
const FRICTION = 2.4;
const SETTLE_SPEED = 1.8;
const SPRING = 9;
const HIT_RADIUS = 1.8;

// Integrate a short sine acceleration and a long cosine deceleration.
// Velocity is continuous, starts/ends at zero, and has no slow cubic tail.
export function releaseSpinProgress(progress: number) {
  const t = Math.max(0, Math.min(1, progress));
  const acceleration = 0.12;
  if (t < acceleration) return acceleration * (1 - Math.cos(Math.PI / 2 * t / acceleration));
  return acceleration + (1 - acceleration) * Math.sin(Math.PI / 2 * (t - acceleration) / (1 - acceleration));
}

// Clip captured pointer paths to the artwork before testing the swept segment.
// This also catches cells between sparse pointer events during a fast swipe.
export function cellsAlongStroke(from: Point, to: Point, positions: readonly HitPose[] = CELLS) {
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
  return positions.flatMap((cell, index) => {
    const projected = lengthSquared ? ((cell.x - from.x) * dx + (cell.y - from.y) * dy) / lengthSquared : 0;
    const t = Math.max(start, Math.min(end, projected));
    const distance = Math.hypot(cell.x - from.x - t * dx, cell.y - from.y - t * dy);
    return distance <= HIT_RADIUS * (cell.scale ?? 1) ? [index] : [];
  });
}

// Continuous angular momentum: a stroke transfers velocity, then friction slows
// the spin. A critically damped spring seats the nearest face at low speed.
// Travel time is convex in radius: the front starts fast and decelerates outward.
export function waveArrival(distance: number) {
  return 0.012 * distance + 0.0075 * distance * distance;
}

export function createFieldMotion(settings: RotationSettings = createRotationSettings()) {
  const cells: CellState[] = CELLS.map(() => ({ angle: 0, velocity: 0 }));
  function seat(cell: CellState) {
    const turns = Math.round((cell.target ?? cell.angle) / Math.PI);
    cell.angle = (Math.abs(turns % 2)) * Math.PI;
    cell.velocity = 0;
    cell.target = undefined;
    cell.waveSpin = undefined;
  }
  const waves: { elapsed: number; arrivals: number[]; turns: number; visited: Set<number> }[] = [];
  return {
    wave(center: Point, positions: readonly HitPose[], reducedMotion: boolean) {
      if (reducedMotion) return;
      const distances = positions.map(p => Math.hypot(p.x - center.x, p.y - center.y));
      const nearest = Math.min(...distances);
      waves.push({ elapsed: 0, turns: settings.releaseTurns, arrivals: distances.map(distance => waveArrival(distance - nearest)), visited: new Set() });
    },
    stroke(from: Point, to: Point, seconds: number, visited: Set<number>, reducedMotion: boolean, positions: readonly HitPose[] = CELLS) {
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const distance = Math.hypot(dx, dy);
      if (distance < 0.00001) return false;
      const direction = Math.sign(Math.abs(dx) >= Math.abs(dy) ? dx : -dy);
      // One velocity-dependent kick per contacted model, with extra energy only
      // for acceleration or reversal. Slow continuous movement cannot refill the
      // same minimum impulse on every pointer event and spin indefinitely.
      const speed = Math.min(100, 20 + distance / Math.max(seconds, 0.001) * 3) * direction * settings.dragAmount;
      let changed = false;
      for (const index of cellsAlongStroke(from, to, positions)) {
        const cell = cells[index];
        if (reducedMotion) {
          if (visited.has(index)) continue;
          visited.add(index);
          seat(cell);
          cell.angle = cell.angle === 0 ? Math.PI : 0;
        } else {
          // Weight the impulse by the actual distance inside this cell's disk.
          // Sparse pointer events must not transfer a whole long swipe to each cell.
          const center = positions[index];
          const along = ((center.x - from.x) * dx + (center.y - from.y) * dy) / distance;
          const perpendicular = ((center.x - from.x) * dy - (center.y - from.y) * dx) / distance;
          const halfChord = Math.sqrt(Math.max(0, (HIT_RADIUS * (center.scale ?? 1)) ** 2 - perpendicular ** 2));
          const contact = Math.max(0, Math.min(distance, along + halfChord) - Math.max(0, along - halfChord));
          if (!contact) continue;
          if (!visited.has(index) || Math.sign(cell.drive ?? 0) !== direction) {
            cell.velocity = speed;
            cell.drive = speed;
          } else if (Math.abs(speed) > Math.abs(cell.drive ?? 0)) {
            cell.velocity += speed - (cell.drive ?? 0);
            cell.drive = speed;
          }
          visited.add(index);
          cell.angle += direction * contact * 0.3 * settings.dragAmount;
          cell.target = undefined;
          cell.waveSpin = undefined;
        }
        changed = true;
      }
      return changed;
    },
    advance(delta: number) {
      if (delta <= 0) return false;
      const rotationDelta = delta * ROTATION_PLAYBACK_RATE * settings.dragSpeed;
      let changed = false;
      for (const wave of waves) {
        wave.elapsed += delta * settings.waveSpeed;
        wave.arrivals.forEach((arrival, index) => {
          if (wave.elapsed < arrival || wave.visited.has(index)) return;
          wave.visited.add(index);
          const cell = cells[index];
          cell.waveSpin = { from: cell.angle, target: Math.round(cell.angle / Math.PI) * Math.PI + wave.turns * 2 * Math.PI, elapsed: 0 };
          cell.velocity = 0;
          cell.target = undefined;
          changed = true;
        });
      }
      for (let i = waves.length - 1; i >= 0; i--) if (waves[i].visited.size === cells.length) waves.splice(i, 1);
      for (const cell of cells) {
        if (cell.waveSpin) {
          changed = true;
          const spin = cell.waveSpin;
          spin.elapsed = Math.min(WAVE_SPIN_DURATION, spin.elapsed + delta * ROTATION_PLAYBACK_RATE * settings.releaseSpeed);
          const progress = spin.elapsed / WAVE_SPIN_DURATION;
          cell.angle = spin.from + (spin.target - spin.from) * releaseSpinProgress(progress);
          if (progress === 1) seat(cell);
          continue;
        }
        if (cell.velocity === 0 && cell.target === undefined) continue;
        changed = true;
        let remaining = rotationDelta;
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
    settle() { waves.length = 0; cells.forEach(seat); },
    reset() { waves.length = 0; for (const cell of cells) { cell.angle = 0; cell.velocity = 0; cell.target = undefined; cell.waveSpin = undefined; cell.drive = undefined; } },
  };
}

export function createFieldInteraction(
  canvas: HTMLCanvasElement, enabled: () => boolean, reducedMotion: () => boolean, onChange: () => void,
  settings: RotationSettings = createRotationSettings(),
) {
  const motion = createFieldMotion(settings);
  const bloom = createBloomMotion();
  const events = new AbortController();
  const options = { signal: events.signal };
  const pointers = new Map<number, { point: Point; origin: Point; clientX: number; clientY: number; time: number; age: number; mode: 'pending' | 'drag' | 'hold'; index: number; visited: Set<number> }>();

  function point(event: PointerEvent): Point {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width - 0.5) * REFERENCE_WIDTH,
      y: (0.5 - (event.clientY - rect.top) / rect.height) * REFERENCE_HEIGHT,
    };
  }
  function releasePointer(id: number, ripple = false) {
    const pointer = pointers.get(id);
    if (ripple && pointer?.mode === 'hold') motion.wave(pointer.point, bloom.layout, reducedMotion());
    pointers.delete(id);
    bloom.release(id);
    onChange();
    canvas.classList.toggle('is-painting', pointers.size > 0);
    if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
  }
  function release() { for (const id of [...pointers.keys()]) releasePointer(id); }
  canvas.addEventListener('pointerdown', event => {
    if (!enabled() || pointers.has(event.pointerId) || event.button !== 0) return;
    event.preventDefault();
    const origin = point(event);
    let index = -1;
    let distance = Infinity;
    bloom.layout.forEach((pose, i) => {
      const d = Math.hypot(origin.x - pose.x, origin.y - pose.y);
      if (d < 0.98 * pose.scale && d < distance) { distance = d; index = i; }
    });
    pointers.set(event.pointerId, { point: origin, origin, clientX: event.clientX, clientY: event.clientY,
      time: event.timeStamp, age: 0, mode: 'pending', index, visited: new Set() });
    canvas.setPointerCapture(event.pointerId);
    canvas.classList.add('is-painting');
  }, options);
  canvas.addEventListener('pointermove', event => {
    const pointer = pointers.get(event.pointerId);
    if (!pointer) return;
    if (!enabled()) return release();
    if (event.buttons === 0) return releasePointer(event.pointerId);
    const next = point(event);
    if (pointer.mode === 'hold') {
      bloom.move(event.pointerId, next);
      pointer.point = next;
      pointer.time = event.timeStamp;
      onChange();
      return;
    }
    if (pointer.mode !== 'drag') {
      if (Math.hypot(event.clientX - pointer.clientX, event.clientY - pointer.clientY) < 8) return;
      bloom.release(event.pointerId);
      pointer.mode = 'drag';
      pointer.point = pointer.origin;
    }
    if (motion.stroke(pointer.point, next, (event.timeStamp - pointer.time) / 1000, pointer.visited, reducedMotion(), bloom.layout)) onChange();
    pointer.point = next;
    pointer.time = event.timeStamp;
  }, options);
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
    canvas.addEventListener(name, event => { if (pointers.has(event.pointerId)) releasePointer(event.pointerId, name === 'pointerup'); }, options);
  }
  canvas.addEventListener('contextmenu', event => { if (enabled()) event.preventDefault(); }, options);
  window.addEventListener('blur', release, options);
  window.addEventListener('resize', release, options);
  document.addEventListener('visibilitychange', () => { if (document.hidden) release(); }, options);
  return {
    ...motion,
    release,
    layout: bloom.layout,
    advance(delta: number) {
      for (const [id, pointer] of pointers) {
        if (pointer.mode !== 'pending' || pointer.index < 0) continue;
        pointer.age += delta;
        if (pointer.age >= 0.38) {
          pointer.mode = 'hold';
          bloom.hold(id, pointer.index);
          pointer.point = { x: CELLS[pointer.index].x, y: CELLS[pointer.index].y };
        }
      }
      const spinning = motion.advance(delta);
      const growing = bloom.advance(delta, reducedMotion());
      return spinning || growing;
    },
    settle() { motion.settle(); bloom.reset(); },
    reset() { release(); motion.reset(); bloom.reset(); onChange(); },
    dispose() { release(); events.abort(); },
  };
}
