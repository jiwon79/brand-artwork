import * as THREE from 'three';
import { sampleLetter } from './letter';

export type Cell = { x: number; y: number; seed: number; orientation: THREE.Quaternion };
export const FIELD_HEIGHT = 18;
export const TURN_DURATION = 3.15;
export const SETTLE_DURATION = 0.85;
const REVEAL_DURATION = 0.42;
const SETTLE_SPAN = 5.5;
const SPIN_RAMP = 0.3;
const WAVE_DELAY = 0.115;
const QUARTER_TURN = Math.PI / 2;

export function random(seed: number) {
  const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453123;
  return value - Math.floor(value);
}

export function faceOrientation(face: number, twist = 0) {
  const rotations = [
    [0, 0], [QUARTER_TURN, 0], [0, -QUARTER_TURN],
    [0, QUARTER_TURN], [-QUARTER_TURN, 0], [0, Math.PI],
  ];
  const [x, y] = rotations[face - 1];
  const orientation = new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, 0));
  return orientation.premultiply(new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 0, 1), twist * QUARTER_TURN,
  ));
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
      const orientation = faceOrientation(
        1 + Math.floor(random(seed + 2) * 6), Math.floor(random(seed + 7) * 4),
      );
      const tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(
        Math.sin(seed * 23.1) * 0.07, Math.sin(seed * 51.3) * 0.07, Math.sin(seed * 39.7) * 0.025,
      ));
      cells.push({ x, y, seed, orientation: orientation.premultiply(tilt) });
    }
  }
  return cells;
}

function smooth(value: number) {
  const t = THREE.MathUtils.clamp(value, 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

// Integral of smootherstep: speed ramps in and out, with a steady spin between.
function rampIntegral(value: number) {
  const t = THREE.MathUtils.clamp(value, 0, 1);
  return t ** 6 - 3 * t ** 5 + 2.5 * t ** 4;
}

function spinProgress(local: number, duration: number) {
  const travel = duration - (SPIN_RAMP + SETTLE_DURATION) / 2;
  if (local <= SPIN_RAMP) return SPIN_RAMP * rampIntegral(local / SPIN_RAMP) / travel;
  if (local >= duration - SETTLE_DURATION) {
    return 1 - SETTLE_DURATION * rampIntegral((duration - local) / SETTLE_DURATION) / travel;
  }
  return (local - SPIN_RAMP / 2) / travel;
}

type RevealCell = {
  cell: Cell;
  luminance: number;
  face: number;
  target: THREE.Quaternion;
  from: THREE.Quaternion;
  fromReveal: number;
  arrival: number;
  finish: number;
  axis: THREE.Vector3;
};

/** All dice retain their exact centers. Only their orientation and light change. */
export class DiceReveal {
  readonly states: RevealCell[];
  active = false;
  private spin = new THREE.Quaternion();
  private scratch = new THREE.Object3D();

  constructor(cells: Cell[], private width: number, private height: number) {
    this.states = cells.map(cell => {
      const sample = sampleLetter(cell.x, cell.y, width, height);
      const direction = cell.seed < 0.5 ? -1 : 1;
      return {
        cell, ...sample,
        target: faceOrientation(sample.face, Math.floor(random(cell.seed + 9) * 4)),
        from: cell.orientation.clone(), fromReveal: 0, arrival: Infinity, finish: Infinity,
        axis: random(cell.seed + 16) < 0.6
          ? new THREE.Vector3(direction, 0, 0) : new THREE.Vector3(0, direction, 0),
      };
    });
  }

  begin(x: number, y: number, time: number, instant = false) {
    // Snapshot the current pose before restarting, including mid-turn input.
    this.states.forEach((state, index) => {
      const reveal = this.pose(index, time, this.scratch);
      state.from.copy(this.scratch.quaternion);
      state.fromReveal = reveal;
      state.arrival = instant ? time - TURN_DURATION : time + Math.hypot(state.cell.x - x, state.cell.y - y) * WAVE_DELAY;
      state.finish = time;
    });
    if (!instant) {
      // A dedicated finish slot per die makes the letter accumulate piece by
      // piece, including dice at the same distance from the pointer.
      const queue = [...this.states].sort((a, b) => a.arrival - b.arrival || a.cell.seed - b.cell.seed);
      const gap = Math.max(1 / 60, SETTLE_SPAN / Math.max(1, queue.length - 1));
      let previous = time + TURN_DURATION - gap;
      queue.forEach(state => {
        state.finish = Math.max(state.arrival + TURN_DURATION, previous + gap);
        previous = state.finish;
      });
    }
    this.active = true;
  }

  spread(x: number, y: number, time: number) {
    if (!this.active) return;
    // Additional drag points advance unreached dice without restarting ones
    // already in motion, so even a long drag finishes in a legible letter.
    this.states.forEach(state => {
      if (state.arrival <= time) return;
      state.arrival = Math.min(state.arrival, time + Math.hypot(state.cell.x - x, state.cell.y - y) * WAVE_DELAY);
    });
  }

  reset() {
    this.active = false;
    this.states.forEach(state => {
      state.from.copy(state.cell.orientation);
      state.fromReveal = 0;
      state.arrival = Infinity;
      state.finish = Infinity;
    });
  }

  isMoving(time: number) {
    return this.active && this.states.some(state => time < state.finish);
  }

  /** Resizing must not force an in-progress wall straight to the finished J. */
  reframe(previous: DiceReveal, time: number) {
    if (!previous.active) return;
    if (!previous.isMoving(time)) {
      this.begin(0, 0, time, true);
      return;
    }
    this.active = true;
    this.states.forEach(state => {
      const x = state.cell.x / this.width * previous.width;
      const y = state.cell.y / this.height * previous.height;
      let nearest = previous.states[0];
      let distance = Infinity;
      for (const candidate of previous.states) {
        const next = (candidate.cell.x - x) ** 2 + (candidate.cell.y - y) ** 2;
        if (next < distance) { nearest = candidate; distance = next; }
      }
      state.from.copy(nearest.from);
      state.fromReveal = nearest.fromReveal;
      state.arrival = nearest.arrival;
      state.finish = nearest.finish;
      state.axis.copy(nearest.axis);
    });
  }

  pose(index: number, time: number, target: THREE.Object3D) {
    const state = this.states[index];
    const local = time - state.arrival;
    let reveal = state.fromReveal;
    target.quaternion.copy(state.from);
    if (local > 0) {
      const duration = state.finish - state.arrival;
      const progress = spinProgress(local, duration);
      const turns = Math.max(2, Math.round(duration / 1.6));
      const settling = smooth((time - state.finish + SETTLE_DURATION) / SETTLE_DURATION);
      target.quaternion.slerp(state.target, settling);
      this.spin.setFromAxisAngle(state.axis, Math.PI * 2 * turns * progress);
      target.quaternion.premultiply(this.spin);
      const forming = smooth((time - state.finish + REVEAL_DURATION) / REVEAL_DURATION);
      reveal = state.fromReveal * (1 - smooth(local / 0.45)) + forming;
    }
    target.position.set(state.cell.x, state.cell.y, 0);
    target.scale.setScalar(1);
    target.updateMatrix();
    return reveal;
  }
}
