import * as THREE from 'three';
import { sampleLetter } from './letter';

export type Cell = { x: number; y: number; seed: number; orientation: THREE.Quaternion };
export const FIELD_HEIGHT = 18;
export const TURN_DURATION = 3.15;
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

type RevealCell = {
  cell: Cell;
  luminance: number;
  face: number;
  target: THREE.Quaternion;
  from: THREE.Quaternion;
  fromReveal: number;
  arrival: number;
  axis: THREE.Vector3;
};

/** All dice retain their exact centers. Only their orientation and light change. */
export class DiceReveal {
  readonly states: RevealCell[];
  active = false;
  private spin = new THREE.Quaternion();
  private scratch = new THREE.Object3D();

  constructor(cells: Cell[], width: number, height: number) {
    this.states = cells.map(cell => {
      const sample = sampleLetter(cell.x, cell.y, width, height);
      const direction = cell.seed < 0.5 ? -1 : 1;
      return {
        cell, ...sample,
        target: faceOrientation(sample.face, Math.floor(random(cell.seed + 9) * 4)),
        from: cell.orientation.clone(), fromReveal: 0, arrival: Infinity,
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
    });
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
    });
  }

  isMoving(time: number) {
    return this.active && this.states.some(state => time < state.arrival + TURN_DURATION);
  }

  pose(index: number, time: number, target: THREE.Object3D) {
    const state = this.states[index];
    const local = time - state.arrival;
    let reveal = state.fromReveal;
    target.quaternion.copy(state.from);
    if (local > 0) {
      const progress = smooth(local / TURN_DURATION);
      target.quaternion.slerp(state.target, progress);
      this.spin.setFromAxisAngle(state.axis, Math.PI * 4 * progress);
      target.quaternion.premultiply(this.spin);
      const forming = smooth((local - TURN_DURATION * 0.65) / (TURN_DURATION * 0.35));
      reveal = state.fromReveal * (1 - smooth(local / 0.45)) + forming;
    }
    target.position.set(state.cell.x, state.cell.y, 0);
    target.scale.setScalar(1);
    target.updateMatrix();
    return reveal;
  }
}
