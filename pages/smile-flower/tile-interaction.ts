import { createRotationSettings, type RotationSettings } from './rotation-settings';
import { TILES, REFERENCE_HEIGHT, REFERENCE_WIDTH } from './reference-layout';
import { MODEL_REST_ROTATION, type TileModel } from './tile-model';
import { createHoldLayout } from './hold-layout';

type Point = { x: number; y: number };
type TileHitArea = Point & { scale?: number };
type TileRotationState = {
  rotation: number;
  angularVelocity: number;
  settleRotation?: number;
  lastDragVelocity?: number;
  waveRotation?: { startRotation: number; endRotation: number; elapsed: number };
};
type RotationWave = {
  elapsed: number;
  arrivalTimes: number[];
  turns: number;
  visited: Set<number>;
};
type PointerState = {
  position: Point;
  startPosition: Point;
  clientX: number;
  clientY: number;
  time: number;
  age: number;
  mode: 'pending' | 'drag' | 'hold';
  tileIndex: number;
  visited: Set<number>;
};
const WAVE_SPIN_DURATION = 0.84;
const ROTATION_PLAYBACK_RATE = 0.6;
const FRICTION = 2.4;
const SETTLE_SPEED = 1.8;
const SPRING = 9;
const HIT_RADIUS = 1.8;

// Integrate a short sine acceleration and a long cosine deceleration.
// Velocity is continuous, starts/ends at zero, and has no slow cubic tail.
export function rotationWaveProgress(progress: number) {
  const t = Math.max(0, Math.min(1, progress));
  const acceleration = 0.12;
  if (t < acceleration) return acceleration * (1 - Math.cos(Math.PI / 2 * t / acceleration));
  return acceleration + (1 - acceleration) * Math.sin(Math.PI / 2 * (t - acceleration) / (1 - acceleration));
}

// Clip captured pointer paths to the artwork before testing the swept segment.
// This also catches tiles between sparse pointer events during a fast swipe.
export function tilesAlongDrag(from: Point, to: Point, positions: readonly TileHitArea[] = TILES) {
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
  return positions.flatMap((tileArea, index) => {
    const projected = lengthSquared ? ((tileArea.x - from.x) * dx + (tileArea.y - from.y) * dy) / lengthSquared : 0;
    const t = Math.max(start, Math.min(end, projected));
    const distance = Math.hypot(tileArea.x - from.x - t * dx, tileArea.y - from.y - t * dy);
    return distance <= HIT_RADIUS * (tileArea.scale ?? 1) ? [index] : [];
  });
}

// Continuous angular momentum: a stroke transfers velocity, then friction slows
// the spin. A critically damped spring seats the nearest face at low speed.
// Travel time is convex in radius: the front starts fast and decelerates outward.
export function rotationWaveArrival(distance: number, deceleration = 1) {
  return 0.012 * distance + 0.0075 * deceleration * distance * distance;
}

export function createTileRotation(settings: RotationSettings = createRotationSettings()) {
  const tileRotations: TileRotationState[] = TILES.map(() => ({ rotation: 0, angularVelocity: 0 }));
  function settleTile(tileRotation: TileRotationState) {
    const turns = Math.round((tileRotation.settleRotation ?? tileRotation.rotation) / Math.PI);
    tileRotation.rotation = (Math.abs(turns % 2)) * Math.PI;
    tileRotation.angularVelocity = 0;
    tileRotation.settleRotation = undefined;
    tileRotation.waveRotation = undefined;
  }
  const rotationWaves: RotationWave[] = [];
  return {
    startRotationWave(center: Point, positions: readonly TileHitArea[], reducedMotion: boolean) {
      if (reducedMotion) return;
      const distances = positions.map(p => Math.hypot(p.x - center.x, p.y - center.y));
      const nearest = Math.min(...distances);
      rotationWaves.push({
        elapsed: 0,
        turns: settings.waveTurns,
        arrivalTimes: distances.map(distance => rotationWaveArrival(distance - nearest, settings.waveSlowdown)),
        visited: new Set(),
      });
    },
    applyDrag(from: Point, to: Point, seconds: number, visited: Set<number>, reducedMotion: boolean, positions: readonly TileHitArea[] = TILES) {
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const distance = Math.hypot(dx, dy);
      if (distance < 0.00001) return false;
      const direction = Math.sign(Math.abs(dx) >= Math.abs(dy) ? dx : -dy);
      // One velocity-dependent kick per contacted model, with extra energy only
      // for acceleration or reversal. Slow continuous movement cannot refill the
      // same minimum impulse on every pointer event and spin indefinitely.
      const speed = Math.min(100, 20 + distance / Math.max(seconds, 0.001) * 3)
        * direction * settings.dragStrength;
      let changed = false;
      for (const index of tilesAlongDrag(from, to, positions)) {
        const tileRotation = tileRotations[index];
        if (reducedMotion) {
          if (visited.has(index)) continue;
          visited.add(index);
          settleTile(tileRotation);
          tileRotation.rotation = tileRotation.rotation === 0 ? Math.PI : 0;
        } else {
          // Weight the impulse by the actual distance inside this tile's disk.
          // Sparse pointer events must not transfer a whole long swipe to each tile.
          const center = positions[index];
          const along = ((center.x - from.x) * dx + (center.y - from.y) * dy) / distance;
          const perpendicular = ((center.x - from.x) * dy - (center.y - from.y) * dx) / distance;
          const halfChord = Math.sqrt(Math.max(0, (HIT_RADIUS * (center.scale ?? 1)) ** 2 - perpendicular ** 2));
          const contact = Math.max(0, Math.min(distance, along + halfChord) - Math.max(0, along - halfChord));
          if (!contact) continue;
          if (!visited.has(index) || Math.sign(tileRotation.lastDragVelocity ?? 0) !== direction) {
            tileRotation.angularVelocity = speed;
            tileRotation.lastDragVelocity = speed;
          } else if (Math.abs(speed) > Math.abs(tileRotation.lastDragVelocity ?? 0)) {
            tileRotation.angularVelocity += speed - (tileRotation.lastDragVelocity ?? 0);
            tileRotation.lastDragVelocity = speed;
          }
          visited.add(index);
          tileRotation.rotation += direction * contact * 0.3 * settings.dragStrength;
          tileRotation.settleRotation = undefined;
          tileRotation.waveRotation = undefined;
        }
        changed = true;
      }
      return changed;
    },
    advance(delta: number) {
      if (delta <= 0) return false;
      const rotationDelta = delta * ROTATION_PLAYBACK_RATE * settings.motionSpeed;
      let changed = false;
      for (const rotationWave of rotationWaves) {
        rotationWave.elapsed += delta * settings.waveTravelSpeed;
        rotationWave.arrivalTimes.forEach((arrival, index) => {
          if (rotationWave.elapsed < arrival || rotationWave.visited.has(index)) return;
          rotationWave.visited.add(index);
          const tileRotation = tileRotations[index];
          tileRotation.waveRotation = {
            startRotation: tileRotation.rotation,
            endRotation: Math.round(tileRotation.rotation / Math.PI) * Math.PI
              + rotationWave.turns * 2 * Math.PI,
            elapsed: 0,
          };
          tileRotation.angularVelocity = 0;
          tileRotation.settleRotation = undefined;
          changed = true;
        });
      }
      for (let i = rotationWaves.length - 1; i >= 0; i--) if (rotationWaves[i].visited.size === tileRotations.length) rotationWaves.splice(i, 1);
      for (const tileRotation of tileRotations) {
        if (tileRotation.waveRotation) {
          changed = true;
          const spin = tileRotation.waveRotation;
          spin.elapsed = Math.min(
            WAVE_SPIN_DURATION,
            spin.elapsed + delta * ROTATION_PLAYBACK_RATE * settings.waveRotationSpeed,
          );
          const progress = spin.elapsed / WAVE_SPIN_DURATION;
          tileRotation.rotation = spin.startRotation
            + (spin.endRotation - spin.startRotation) * rotationWaveProgress(progress);
          if (progress === 1) settleTile(tileRotation);
          continue;
        }
        if (tileRotation.angularVelocity === 0 && tileRotation.settleRotation === undefined) continue;
        changed = true;
        let remaining = rotationDelta;
        if (tileRotation.settleRotation === undefined) {
          const coast = Math.min(remaining, Math.max(
            0,
            Math.log(Math.abs(tileRotation.angularVelocity) / SETTLE_SPEED) / FRICTION,
          ));
          const decay = Math.exp(-FRICTION * coast);
          tileRotation.rotation += tileRotation.angularVelocity * (1 - decay) / FRICTION;
          tileRotation.angularVelocity *= decay;
          remaining -= coast;
          if (remaining <= 1e-9) continue;
          tileRotation.settleRotation = Math.round(
            (tileRotation.rotation + tileRotation.angularVelocity / SPRING) / Math.PI,
          ) * Math.PI;
        }
        // Exact critically damped solution keeps 30/60/120 Hz rotation consistent.
        const offset = tileRotation.rotation - tileRotation.settleRotation;
        const impulse = tileRotation.angularVelocity + SPRING * offset;
        const decay = Math.exp(-SPRING * remaining);
        tileRotation.rotation = tileRotation.settleRotation + (offset + impulse * remaining) * decay;
        tileRotation.angularVelocity = (tileRotation.angularVelocity - SPRING * impulse * remaining) * decay;
        if (Math.abs(tileRotation.rotation - tileRotation.settleRotation) < 0.001
          && Math.abs(tileRotation.angularVelocity) < 0.01) settleTile(tileRotation);
      }
      return changed;
    },
    renderPose(index: number) {
      const tileRotation = tileRotations[index];
      const halfTurns = Math.round(tileRotation.rotation / Math.PI);
      const model: TileModel = Math.abs(halfTurns % 2) ? 'smiley' : 'flower';
      const localAngle = tileRotation.rotation - halfTurns * Math.PI;
      return { model, rotationX: localAngle + MODEL_REST_ROTATION[model] * Math.cos(localAngle) ** 2 };
    },
    settle() { rotationWaves.length = 0; tileRotations.forEach(settleTile); },
    reset() {
      rotationWaves.length = 0;
      for (const tileRotation of tileRotations) {
        tileRotation.rotation = 0;
        tileRotation.angularVelocity = 0;
        tileRotation.settleRotation = undefined;
        tileRotation.waveRotation = undefined;
        tileRotation.lastDragVelocity = undefined;
      }
    },
  };
}

export function createTileInteraction(
  canvas: HTMLCanvasElement, enabled: () => boolean, reducedMotion: () => boolean, onChange: () => void,
  settings: RotationSettings = createRotationSettings(),
) {
  const rotation = createTileRotation(settings);
  const holdLayout = createHoldLayout();
  const events = new AbortController();
  const options = { signal: events.signal };
  const pointers = new Map<number, PointerState>();

  function artworkPoint(event: PointerEvent): Point {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width - 0.5) * REFERENCE_WIDTH,
      y: (0.5 - (event.clientY - rect.top) / rect.height) * REFERENCE_HEIGHT,
    };
  }
  function releasePointer(id: number, startWave = false) {
    const pointer = pointers.get(id);
    if (startWave && pointer?.mode === 'hold') {
      rotation.startRotationWave(pointer.position, holdLayout.tileLayouts, reducedMotion());
    }
    pointers.delete(id);
    holdLayout.release(id);
    onChange();
    canvas.classList.toggle('is-painting', pointers.size > 0);
    if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
  }
  function release() { for (const id of [...pointers.keys()]) releasePointer(id); }
  canvas.addEventListener('pointerdown', event => {
    if (!enabled() || pointers.has(event.pointerId) || event.button !== 0) return;
    event.preventDefault();
    const startPosition = artworkPoint(event);
    let tileIndex = -1;
    let distance = Infinity;
    holdLayout.tileLayouts.forEach((tileLayout, index) => {
      const nextDistance = Math.hypot(
        startPosition.x - tileLayout.x,
        startPosition.y - tileLayout.y,
      );
      if (nextDistance < 0.98 * tileLayout.scale && nextDistance < distance) {
        distance = nextDistance;
        tileIndex = index;
      }
    });
    pointers.set(event.pointerId, {
      position: startPosition,
      startPosition,
      clientX: event.clientX,
      clientY: event.clientY,
      time: event.timeStamp,
      age: 0,
      mode: 'pending',
      tileIndex,
      visited: new Set(),
    });
    canvas.setPointerCapture(event.pointerId);
    canvas.classList.add('is-painting');
  }, options);
  canvas.addEventListener('pointermove', event => {
    const pointer = pointers.get(event.pointerId);
    if (!pointer) return;
    if (!enabled()) return release();
    if (event.buttons === 0) return releasePointer(event.pointerId);
    const next = artworkPoint(event);
    if (pointer.mode === 'hold') {
      holdLayout.move(event.pointerId, next);
      pointer.position = next;
      pointer.time = event.timeStamp;
      onChange();
      return;
    }
    if (pointer.mode !== 'drag') {
      if (Math.hypot(event.clientX - pointer.clientX, event.clientY - pointer.clientY) < 8) return;
      holdLayout.release(event.pointerId);
      pointer.mode = 'drag';
      pointer.position = pointer.startPosition;
    }
    if (rotation.applyDrag(
      pointer.position,
      next,
      (event.timeStamp - pointer.time) / 1000,
      pointer.visited,
      reducedMotion(),
      holdLayout.tileLayouts,
    )) onChange();
    pointer.position = next;
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
    ...rotation,
    release,
    tileLayouts: holdLayout.tileLayouts,
    advance(delta: number) {
      for (const [id, pointer] of pointers) {
        if (pointer.mode !== 'pending' || pointer.tileIndex < 0) continue;
        pointer.age += delta;
        if (pointer.age >= 0.38) {
          pointer.mode = 'hold';
          holdLayout.hold(id, pointer.tileIndex);
          pointer.position = {
            x: TILES[pointer.tileIndex].x,
            y: TILES[pointer.tileIndex].y,
          };
        }
      }
      const rotationChanged = rotation.advance(delta);
      const layoutChanged = holdLayout.advance(delta, reducedMotion());
      return rotationChanged || layoutChanged;
    },
    settle() { rotation.settle(); holdLayout.reset(); },
    reset() { release(); rotation.reset(); holdLayout.reset(); onChange(); },
    dispose() { release(); events.abort(); },
  };
}
