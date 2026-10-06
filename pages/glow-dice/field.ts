import * as THREE from 'three';

export type Cell = { x: number; y: number; seed: number; orientation: THREE.Quaternion };
export type Point = { x: number; y: number };
export const FIELD_HEIGHT = 18;
const SETTLE_DURATION = 0.65;
const SPIN_RAMP = 0.16;
const BRUSH_RADIUS = 0.9;
const SAMPLES = 6;
const QUARTER_TURN = Math.PI / 2;

export function random(seed: number) {
  const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453123;
  return value - Math.floor(value);
}

export function faceOrientation(face: number, twist = 0) {
  const rotations = [[0, 0], [QUARTER_TURN, 0], [0, -QUARTER_TURN], [0, QUARTER_TURN], [-QUARTER_TURN, 0], [0, Math.PI]];
  const [x, y] = rotations[face - 1];
  const orientation = new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, 0));
  return orientation.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), twist * QUARTER_TURN));
}

export function createField(width: number, height = FIELD_HEIGHT): Cell[] {
  const cells: Cell[] = [];
  const columns = Math.ceil(width) + 2;
  const rows = Math.ceil(height) + 2;
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const x = column - (columns - 1) / 2;
      const y = row - (rows - 1) / 2;
      const seed = random((column + 71) * 13 + (row + 21) * 97);
      cells.push({ x, y, seed, orientation: faceOrientation(1) });
    }
  }
  return cells;
}

function smooth(value: number) {
  const t = THREE.MathUtils.clamp(value, 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function rampIntegral(value: number) {
  const t = THREE.MathUtils.clamp(value, 0, 1);
  return t ** 6 - 3 * t ** 5 + 2.5 * t ** 4;
}

function spinTravel(local: number, duration: number) {
  const travel = duration - (SPIN_RAMP + SETTLE_DURATION) / 2;
  if (local <= SPIN_RAMP) return SPIN_RAMP * rampIntegral(local / SPIN_RAMP);
  if (local >= duration - SETTLE_DURATION) return travel - SETTLE_DURATION * rampIntegral((duration - local) / SETTLE_DURATION);
  return local - SPIN_RAMP / 2;
}

type PaintCell = {
  cell: Cell; coverage: Float32Array; luminance: number; face: number;
  target: THREE.Quaternion; from: THREE.Quaternion; fromReveal: number;
  arrival: number; finish: number; axis: THREE.Vector3; turns: number; spinRate: number; stroke: number;
};

/** Brush segments accumulate a coverage mask. Dice keep their centers while
 * the drawn coverage chooses the actual front face and emission. */
export class DicePaint {
  readonly states: PaintCell[];
  active = false;
  private stroke = 0;
  private lastFinish = 0;
  private spin = new THREE.Quaternion();
  private scratch = new THREE.Object3D();

  constructor(cells: Cell[], private width: number, private height: number) {
    this.states = cells.map(cell => ({
      cell, coverage: new Float32Array(SAMPLES * SAMPLES), luminance: 0, face: 1,
      target: cell.orientation.clone(), from: cell.orientation.clone(), fromReveal: 0,
      arrival: Infinity, finish: Infinity, axis: new THREE.Vector3(0, 1, 0), turns: 1, spinRate: 0, stroke: -1,
    }));
  }

  beginStroke(time: number) { this.stroke++; this.lastFinish = time; }

  paint(a: Point, b: Point, time: number, velocity: Point, instant = false, radius = BRUSH_RADIUS, middleDuration?: number) {
    const coreRadius = radius * (0.55 / BRUSH_RADIUS);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    const projection = (x: number, y: number) => lengthSquared
      ? THREE.MathUtils.clamp(((x - a.x) * dx + (y - a.y) * dy) / lengthSquared, 0, 1) : 0;
    const distance = (x: number, y: number) => {
      const t = projection(x, y);
      return Math.hypot(x - a.x - dx * t, y - a.y - dy * t);
    };
    const speed = Math.hypot(velocity.x, velocity.y);
    const strength = THREE.MathUtils.clamp(Math.log1p(speed / 6) / Math.log(9), 0, 1);
    const direction = speed > 0.001 ? velocity : lengthSquared > 0 ? { x: dx, y: dy } : { x: 1, y: 0 };
    const axis = new THREE.Vector3(-direction.y, direction.x, 0).normalize();
    const touched = this.states.filter(state => distance(state.cell.x, state.cell.y) < radius + 0.56)
      .sort((left, right) => projection(left.cell.x, left.cell.y) - projection(right.cell.x, right.cell.y));

    touched.forEach(state => {
      let covered = 0;
      let added = false;
      for (let row = 0; row < SAMPLES; row++) {
        for (let column = 0; column < SAMPLES; column++) {
          const index = row * SAMPLES + column;
          const x = state.cell.x + ((column + 0.5) / SAMPLES - 0.5) * 0.78;
          const y = state.cell.y + ((row + 0.5) / SAMPLES - 0.5) * 0.78;
          const ink = 1 - smooth((distance(x, y) - coreRadius) / (radius - coreRadius));
          added ||= ink > 0;
          state.coverage[index] = Math.max(state.coverage[index], ink);
          covered += state.coverage[index];
        }
      }
      if (!added) return;
      const luminance = covered / state.coverage.length;
      // A pass updates coverage without restarting the same die at every sample.
      // A later stroke rolls it again from its exact current pose and brightness.
      if (state.stroke !== this.stroke || time >= state.finish) {
        state.fromReveal = this.pose(this.states.indexOf(state), time, this.scratch);
        state.from.copy(this.scratch.quaternion);
        state.axis.copy(axis);
        state.turns = 1 + Math.round(strength * 2);
        state.arrival = time;
        const naturalDuration = 1.25 + strength * 0.7;
        // Gesture velocity fixes angular speed; the control changes only cruise time.
        state.spinRate = state.turns / (naturalDuration - (SPIN_RAMP + SETTLE_DURATION) / 2);
        const duration = middleDuration === undefined ? naturalDuration
          : SPIN_RAMP + Math.max(0, middleDuration) + SETTLE_DURATION;
        state.finish = instant ? time : Math.max(time + duration, this.lastFinish + 0.018);
        this.lastFinish = state.finish;
        state.stroke = this.stroke;
      }
      state.luminance = luminance;
      state.face = 1 + Math.round(luminance * 5);
      state.target.copy(faceOrientation(state.face, Math.floor(random(state.cell.seed + 9) * 4)));
      if (instant) state.finish = time;
      this.active = true;
    });
  }

  settle(time: number) {
    this.states.forEach(state => { if (state.luminance > 0) state.finish = time; });
  }

  reset() {
    this.active = false;
    this.states.forEach(state => {
      state.coverage.fill(0);
      state.luminance = 0;
      state.face = 1;
      state.target.copy(state.cell.orientation);
      state.from.copy(state.cell.orientation);
      state.fromReveal = 0;
      state.arrival = state.finish = Infinity;
      state.stroke = -1;
    });
  }

  isMoving(time: number) {
    return this.states.some(state => state.luminance > 0 && time < state.finish);
  }

  reframe(previous: DicePaint, time: number) {
    this.active = previous.active;
    this.stroke = previous.stroke;
    this.lastFinish = previous.lastFinish;
    this.states.forEach(state => {
      const x = state.cell.x / this.width * previous.width;
      const y = state.cell.y / this.height * previous.height;
      let nearest = previous.states[0];
      let distance = Infinity;
      for (const candidate of previous.states) {
        const next = (candidate.cell.x - x) ** 2 + (candidate.cell.y - y) ** 2;
        if (next < distance) { nearest = candidate; distance = next; }
      }
      state.coverage.set(nearest.coverage);
      state.luminance = nearest.luminance;
      state.face = nearest.face;
      state.target.copy(nearest.target);
      state.from.copy(nearest.from);
      state.fromReveal = nearest.fromReveal;
      state.arrival = nearest.arrival;
      state.finish = nearest.finish;
      state.axis.copy(nearest.axis);
      state.turns = nearest.turns;
      state.spinRate = nearest.spinRate;
      state.stroke = nearest.stroke;
    });
    if (!previous.isMoving(time)) this.settle(time);
  }

  pose(index: number, time: number, target: THREE.Object3D) {
    const state = this.states[index];
    const local = time - state.arrival;
    let reveal = state.fromReveal;
    target.quaternion.copy(state.from);
    if (state.luminance > 0 && time >= state.finish) {
      target.quaternion.copy(state.target);
      reveal = 1;
    } else if (local > 0) {
      const duration = state.finish - state.arrival;
      const settling = smooth((time - state.finish + SETTLE_DURATION) / SETTLE_DURATION);
      target.quaternion.slerp(state.target, settling);
      const totalTurns = state.spinRate * spinTravel(duration, duration);
      // Absorb the fractional last turn during the fixed settling window so the
      // selected face lands exactly, without changing the middle angular speed.
      const turns = state.spinRate * spinTravel(local, duration)
        - (totalTurns - Math.round(totalTurns)) * settling;
      this.spin.setFromAxisAngle(state.axis, Math.PI * 2 * turns);
      target.quaternion.premultiply(this.spin);
      reveal = state.fromReveal + (1 - state.fromReveal) * smooth(local / 0.6);
    }
    target.position.set(state.cell.x, state.cell.y, 0);
    target.scale.setScalar(1);
    target.updateMatrix();
    return reveal;
  }
}
