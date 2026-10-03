import { expect, test } from 'vitest';
import * as THREE from 'three';
import { createField, poseCell } from './field';

test('portrait and landscape fields fill the camera with an extra boundary row', () => {
  for (const width of [8, 10, 28.3, 43]) {
    const field = createField(width);
    expect(Math.max(...field.map(cell => cell.x))).toBeGreaterThanOrEqual(width / 2);
    expect(Math.max(...field.map(cell => cell.y))).toBeGreaterThan(9);
    expect(Math.min(...field.map(cell => cell.y))).toBeLessThan(-9);
    expect(field.every(cell => Math.abs(cell.orientation.length() - 1) < 1e-10)).toBe(true);
  }
});

test('turns are continuous at cycle boundaries and deterministic on reset', () => {
  const a = new THREE.Object3D();
  const b = new THREE.Object3D();
  for (const cell of createField(10).filter((_, index) => index % 17 === 0)) {
    const boundary = (4 - cell.y * 0.108 - cell.x * 0.06 - cell.seed * 0.42) / 0.24;
    poseCell(cell, boundary - 0.00001, [], a);
    poseCell(cell, boundary + 0.00001, [], b);
    expect(a.quaternion.angleTo(b.quaternion)).toBeLessThan(0.001);
    poseCell(cell, 0, [], a);
    poseCell(cell, 1234, [], b);
    poseCell(cell, 0, [], b);
    expect(a.matrix.equals(b.matrix)).toBe(true);
  }
});

test('a touch lifts and turns nearby dice, then returns to the automatic pose', () => {
  const cell = createField(10)[100];
  const ripple = { x: cell.x, y: cell.y, start: 0 };
  const rest = new THREE.Object3D();
  const touched = new THREE.Object3D();
  poseCell(cell, 0.8, [], rest);
  poseCell(cell, 0.8, [ripple], touched);
  expect(touched.position.z).toBeGreaterThan(rest.position.z + 0.2);
  expect(touched.quaternion.angleTo(rest.quaternion)).toBeGreaterThan(0.3);
  poseCell(cell, 3, [], rest);
  poseCell(cell, 3, [ripple], touched);
  expect(rest.matrix.equals(touched.matrix)).toBe(true);
});
