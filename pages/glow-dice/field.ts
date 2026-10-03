import * as THREE from 'three';

export type Cell = { x: number; y: number; seed: number; orientation: THREE.Quaternion };
export type Ripple = { x: number; y: number; start: number };
export const FIELD_HEIGHT = 18;
const QUARTER_TURN = Math.PI / 2;

export function random(seed: number) {
  const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453123;
  return value - Math.floor(value);
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
      // Six equally likely fronts, followed by an in-plane quarter turn.
      const front = Math.floor(random(seed + 2) * 6);
      const euler = new THREE.Euler(
        front < 4 ? 0 : (front === 4 ? 1 : -1) * QUARTER_TURN,
        front < 4 ? front * QUARTER_TURN : 0, 0,
      );
      const orientation = new THREE.Quaternion().setFromEuler(euler);
      const twist = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 0, 1), Math.floor(random(seed + 7) * 4) * QUARTER_TURN,
      );
      cells.push({ x, y, seed, orientation: orientation.premultiply(twist) });
    }
  }
  return cells;
}

function smooth(value: number) {
  const t = THREE.MathUtils.clamp(value, 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

const euler = new THREE.Euler();
const tilt = new THREE.Quaternion();

/** Traveling turns settle exactly at 90 degrees instead of accumulating drift. */
export function poseCell(cell: Cell, time: number, ripples: readonly Ripple[], target: THREE.Object3D) {
  const phase = time * 0.24 + cell.y * 0.108 + cell.x * 0.06 + cell.seed * 0.42;
  const cycle = Math.floor(phase);
  const progress = phase - cycle;
  const roll = smooth((progress - 0.23) / 0.47);
  const arc = Math.sin(roll * Math.PI);
  const direction = cell.seed > 0.5 ? 1 : -1;
  const axis = random(cell.seed + 16);
  const turn = (cycle + roll) * QUARTER_TURN * direction;
  let rx = axis < 0.62 ? turn : 0;
  let ry = (axis >= 0.62 && axis < 0.9 ? turn : 0) + Math.sin(cell.seed * 51.3) * 0.045;
  let rz = (axis >= 0.9 ? turn : 0) + Math.sin(cell.seed * 39.7) * 0.025 + arc * Math.sin(cell.seed * 73.1) * 0.6;
  let lift = arc * 0.15;

  for (const ripple of ripples) {
    const distance = Math.hypot(cell.x - ripple.x, cell.y - ripple.y);
    const local = time - ripple.start - distance * 0.11;
    if (local <= 0 || local >= 2) continue;
    const envelope = Math.sin(Math.PI * local / 2) ** 2 * Math.exp(-distance * 0.11);
    rx += envelope * Math.sin(local * 5.4) * 0.85;
    ry += envelope * (cell.x - ripple.x) / (distance + 0.1) * 0.58;
    rz += envelope * direction * 0.18;
    lift += envelope * 0.3;
  }
  // Small fixed deviations keep the resting grid from looking perfectly CG-flat.
  rx += Math.sin(cell.seed * 23.1) * 0.035;
  euler.set(rx, ry, rz, 'XYZ');
  tilt.setFromEuler(euler);
  target.quaternion.copy(tilt).multiply(cell.orientation);
  target.position.set(cell.x, cell.y, lift + cell.seed * 0.03);
  target.scale.setScalar(1);
  target.updateMatrix();
}
