import { expect, test } from 'vitest';
import * as THREE from 'three';
import { createField, DiceReveal, faceOrientation, TURN_DURATION } from './field';
import { sampleLetter } from './letter';

test('portrait and landscape fields fill the camera with an extra boundary row', () => {
  for (const width of [8, 10, 28.3, 43]) {
    const field = createField(width);
    expect(Math.max(...field.map(cell => cell.x))).toBeGreaterThanOrEqual(width / 2);
    expect(Math.max(...field.map(cell => cell.y))).toBeGreaterThan(9);
    expect(Math.min(...field.map(cell => cell.y))).toBeLessThan(-9);
    expect(field.every(cell => Math.abs(cell.orientation.length() - 1) < 1e-10)).toBe(true);
  }
});

test('wave starts at the drag origin and all centers stay fixed through settlement', () => {
  const cells = createField(10);
  const reveal = new DiceReveal(cells, 10, 18);
  const origin = cells[100];
  reveal.begin(origin.x, origin.y, 0);
  expect(reveal.isMoving(0)).toBe(true);
  expect(reveal.states[100].arrival).toBe(0);
  expect(reveal.states[0].arrival).toBeGreaterThan(0.5);
  const target = new THREE.Object3D();
  for (const time of [0, 0.2, 1, 3, 5, 10]) {
    cells.forEach((cell, index) => {
      reveal.pose(index, time, target);
      expect(target.position.toArray()).toEqual([cell.x, cell.y, 0]);
      expect(target.scale.toArray()).toEqual([1, 1, 1]);
      expect(target.quaternion.length()).toBeCloseTo(1, 10);
    });
  }
  cells.forEach((_, index) => {
    expect(reveal.pose(index, 10, target)).toBe(1);
    expect(target.quaternion.angleTo(reveal.states[index].target)).toBeLessThan(1e-7);
  });
  expect(reveal.isMoving(10)).toBe(false);
});

test('drag points advance the wave without restarting spinning cells', () => {
  const cells = createField(10);
  const reveal = new DiceReveal(cells, 10, 18);
  reveal.begin(cells[0].x, cells[0].y, 0);
  const last = cells.length - 1;
  const arrival = reveal.states[last].arrival;
  reveal.spread(cells[last].x, cells[last].y, 0.1);
  expect(reveal.states[0].arrival).toBe(0);
  expect(reveal.states[last].arrival).toBeLessThan(arrival);
  expect(reveal.states[last].arrival).toBe(0.1);
});

test('restarting mid-turn preserves pose and light; reset restores the initial wall', () => {
  const cells = createField(10);
  const reveal = new DiceReveal(cells, 10, 18);
  const a = new THREE.Object3D();
  const b = new THREE.Object3D();
  reveal.begin(0, 0, 0);
  const light = reveal.pose(100, 2.5, a);
  reveal.begin(2, 4, 2.5);
  expect(reveal.pose(100, 2.5, b)).toBeCloseTo(light, 10);
  expect(a.quaternion.angleTo(b.quaternion)).toBeLessThan(1e-7);
  reveal.reset();
  expect(reveal.pose(100, 20, b)).toBe(0);
  expect(b.quaternion.angleTo(cells[100].orientation)).toBeLessThan(1e-7);
  expect(reveal.active).toBe(false);
});

test('arrival and final pose are continuous and reduced motion settles immediately', () => {
  const reveal = new DiceReveal(createField(10), 10, 18);
  const a = new THREE.Object3D();
  const b = new THREE.Object3D();
  reveal.begin(0, 0, 0);
  for (const t of [reveal.states[100].arrival, reveal.states[100].arrival + TURN_DURATION]) {
    reveal.pose(100, t - 0.00001, a);
    reveal.pose(100, t + 0.00001, b);
    expect(a.quaternion.angleTo(b.quaternion)).toBeLessThan(0.001);
  }
  reveal.begin(0, 0, 50, true);
  expect(reveal.pose(100, 50, a)).toBeCloseTo(1, 10);
  expect(a.quaternion.angleTo(reveal.states[100].target)).toBeLessThan(1e-7);
});

test('luminance selects fewer pips at letter boundaries and six in the stroke', () => {
  const cells = createField(10);
  const samples = cells.map(cell => sampleLetter(cell.x, cell.y, 10, 18));
  expect(sampleLetter(2.5, 0, 10, 18)).toEqual({ luminance: 1, face: 6 });
  expect(sampleLetter(0, 0, 10, 18)).toEqual({ luminance: 0, face: 1 });
  expect(sampleLetter(-2.5, 0, 10, 18)).toEqual({ luminance: 0, face: 1 });
  expect(new Set(samples.map(sample => sample.face)).size).toBeGreaterThanOrEqual(4);
  expect(samples.some(sample => sample.luminance > 0 && sample.luminance < 1)).toBe(true);
});

test('each selected value rotates its actual modeled face toward the viewer', () => {
  const normals = [
    [0, 0, 1], [0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, -1, 0], [0, 0, -1],
  ];
  normals.forEach((normal, index) => {
    for (let twist = 0; twist < 4; twist++) {
      const front = new THREE.Vector3(...normal).applyQuaternion(faceOrientation(index + 1, twist));
      expect(front.distanceTo(new THREE.Vector3(0, 0, 1))).toBeLessThan(1e-10);
    }
  });
});
