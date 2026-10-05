import { expect, test } from 'vitest';
import * as THREE from 'three';
import { createField, DicePaint, faceOrientation } from './field';

function drawing(width = 10) { return new DicePaint(createField(width), width, 18); }
const target = new THREE.Object3D();

test('the initial wall fills the viewport with dark, stationary one faces', () => {
  for (const width of [8, 28.3]) {
    const paint = drawing(width);
    expect(Math.max(...paint.states.map(state => state.cell.x))).toBeGreaterThanOrEqual(width / 2);
    paint.states.forEach((state, index) => {
      expect(state.face).toBe(1);
      expect(state.luminance).toBe(0);
      expect(paint.pose(index, 100, target)).toBe(0);
      expect(target.quaternion.angleTo(faceOrientation(1))).toBeLessThan(1e-7);
    });
    expect(paint.isMoving(100)).toBe(false);
  }
});

test('a swept segment covers the whole drag without rotating untouched cells', () => {
  const paint = drawing();
  paint.beginStroke(0);
  paint.paint({ x: -4, y: 0.5 }, { x: 4, y: 0.5 }, 0, { x: 15, y: 0 });
  const line = paint.states.filter(state => state.cell.y === 0.5 && Math.abs(state.cell.x) < 4);
  expect(line.every(state => state.luminance > 0.95 && state.face === 6)).toBe(true);
  expect(paint.states.filter(state => Math.abs(state.cell.y - 0.5) > 1.5).every(state => state.luminance === 0)).toBe(true);
  for (const time of [0, 0.3, 1, 3, 10]) {
    paint.states.forEach((state, index) => {
      paint.pose(index, time, target);
      expect(target.position.toArray()).toEqual([state.cell.x, state.cell.y, 0]);
      expect(target.scale.toArray()).toEqual([1, 1, 1]);
      expect(target.quaternion.length()).toBeCloseTo(1, 10);
      if (state.luminance === 0) expect(target.quaternion.angleTo(faceOrientation(1))).toBeLessThan(1e-7);
    });
  }
  expect(paint.isMoving(10)).toBe(false);
});

test('freehand corners and curves accumulate the user path with softer boundary pips', () => {
  const paint = drawing();
  const points = [{ x: -3, y: 5 }, { x: 3, y: 5 }, { x: 3, y: -3 }, { x: 2, y: -4 }, { x: 0, y: -5 }, { x: -2, y: -4 }];
  paint.beginStroke(0);
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1]; const b = points[index];
    paint.paint(a, b, index * 0.1, { x: (b.x - a.x) * 5, y: (b.y - a.y) * 5 });
  }
  expect(paint.states.find(state => state.cell.x === 0.5 && state.cell.y === 0.5)!.luminance).toBe(0);
  expect(paint.states.some(state => state.face > 1 && state.face < 6)).toBe(true);
  const ink = paint.states.map(state => state.luminance);
  paint.beginStroke(1);
  paint.paint({ x: -4, y: -7 }, { x: -4, y: 7 }, 1, { x: 0, y: 10 });
  paint.states.forEach((state, index) => expect(state.luminance).toBeGreaterThanOrEqual(ink[index]));
  expect(paint.states.filter(state => state.cell.x === -4.5 && Math.abs(state.cell.y) < 6).every(state => state.luminance > 0.5)).toBe(true);
});

test('rolling follows drag direction and faster strokes have stronger angular motion', () => {
  const variants = [[2, 0], [40, 0], [-40, 0], [0, -40]].map(([x, y]) => {
    const paint = drawing();
    paint.beginStroke(0);
    paint.paint({ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }, 0, { x, y });
    return paint;
  });
  const states = variants.map(paint => paint.states.find(state => state.cell.x === 0.5 && state.cell.y === 0.5)!);
  expect(states[1].turns).toBeGreaterThan(states[0].turns);
  expect(states[1].axis.toArray()).toEqual([-0, 1, 0]);
  expect(states[2].axis.y).toBe(-1);
  expect(states[3].axis.x).toBe(1);
  expect(states[3].axis.y).toBe(0);
  expect(states[1].turns / (states[1].finish - 0.405)).toBeGreaterThan(states[0].turns / (states[0].finish - 0.405));
});

test('cells settle sequentially and repeated strokes preserve current orientation and light', () => {
  const paint = drawing();
  paint.beginStroke(0);
  paint.paint({ x: -4, y: 0.5 }, { x: 4, y: 0.5 }, 0, { x: 15, y: 0 });
  const queue = paint.states.filter(state => state.luminance > 0).sort((a, b) => a.finish - b.finish);
  expect(new Set(queue.map(state => state.finish)).size).toBe(queue.length);
  const time = (queue[0].finish + queue[1].finish) / 2;
  const aligned = queue.filter(state => {
    paint.pose(paint.states.indexOf(state), time, target);
    return target.quaternion.angleTo(state.target) < 1e-7;
  });
  expect(aligned).toHaveLength(1);
  const index = paint.states.indexOf(queue[queue.length - 1]);
  const light = paint.pose(index, 0.6, target);
  const orientation = target.quaternion.clone();
  paint.beginStroke(0.6);
  const point = paint.states[index].cell;
  paint.paint(point, point, 0.6, { x: 0, y: -20 });
  expect(paint.pose(index, 0.6, target)).toBeCloseTo(light, 10);
  expect(target.quaternion.angleTo(orientation)).toBeLessThan(1e-7);
  const finish = paint.states[index].finish;
  paint.pose(index, finish - 0.00001, target);
  expect(target.quaternion.angleTo(paint.states[index].target)).toBeLessThan(0.001);
});

test('resize retains both the drawn area and untouched background, including ongoing turns', () => {
  const paint = drawing();
  paint.beginStroke(0);
  paint.paint({ x: -3, y: 2 }, { x: 3, y: 2 }, 0, { x: 10, y: 0 });
  const resized = drawing(12);
  resized.reframe(paint, 0.5);
  expect(resized.isMoving(0.5)).toBe(true);
  expect(resized.states.some(state => state.luminance > 0)).toBe(true);
  expect(resized.states.some(state => state.luminance === 0)).toBe(true);
  resized.reframe(paint, 20);
  expect(resized.isMoving(20)).toBe(false);
  expect(resized.states.filter(state => state.luminance === 0).every(state => state.face === 1)).toBe(true);
});

test('reset erases the drawing and reduced motion lights only the painted area', () => {
  const paint = drawing();
  paint.beginStroke(0);
  paint.paint({ x: 1, y: 0 }, { x: 1, y: 5 }, 0, { x: 0, y: 20 }, true);
  expect(paint.isMoving(0)).toBe(false);
  expect(paint.states.every((state, index) => paint.pose(index, 0, target) === (state.luminance > 0 ? 1 : 0))).toBe(true);
  paint.reset();
  expect(paint.active).toBe(false);
  expect(paint.states.every((state, index) => state.luminance === 0 && paint.pose(index, 20, target) === 0)).toBe(true);
});

test('each selected value rotates its modeled face toward the viewer', () => {
  const normals = [[0, 0, 1], [0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, -1, 0], [0, 0, -1]];
  normals.forEach((normal, index) => {
    for (let twist = 0; twist < 4; twist++) {
      const front = new THREE.Vector3(...normal).applyQuaternion(faceOrientation(index + 1, twist));
      expect(front.distanceTo(new THREE.Vector3(0, 0, 1))).toBeLessThan(1e-10);
    }
  });
});

test('brush thickness changes the painted footprint while retaining feathered edges', () => {
  const narrow = drawing();
  const wide = drawing();
  for (const [paint, radius] of [[narrow, 0.27], [wide, 2.7]] as const) {
    paint.beginStroke(0);
    paint.paint({ x: -4, y: 0.5 }, { x: 4, y: 0.5 }, 0, { x: 15, y: 0 }, true, radius);
  }
  expect(wide.states.filter(state => state.luminance > 0).length).toBeGreaterThan(narrow.states.filter(state => state.luminance > 0).length);
  expect(narrow.states.filter(state => Math.abs(state.cell.y - 0.5) > 1).every(state => state.luminance === 0)).toBe(true);
  expect(wide.states.some(state => Math.abs(state.cell.y - 0.5) >= 2 && state.luminance > 0)).toBe(true);
  expect(wide.states.some(state => state.luminance > 0 && state.luminance < 1)).toBe(true);
});
