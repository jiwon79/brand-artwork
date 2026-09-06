import { expect, test } from 'vitest';
import { createFrameLoop } from './frame-loop.ts';

test('bursty input renders once per frame and does not spin while idle', () => {
  const queue = [], steps = [];
  const invalidate = createFrameLoop(dt => { steps.push(dt); return false; }, callback => queue.push(callback), () => 0);
  for (let i = 0; i < 100; i++) invalidate();
  expect(queue.length).toBe(1);
  queue.shift()(16);
  expect(steps).toStrictEqual([0.016]);
  expect(queue.length).toBe(0);
});

test('spring frames and new input share one pending frame', () => {
  const queue = [], steps = [];
  const invalidate = createFrameLoop(dt => { steps.push(dt); return steps.length < 3; }, callback => queue.push(callback), () => 0);
  invalidate();
  queue.shift()(16);
  invalidate();invalidate();
  expect(queue.length).toBe(1);
  queue.shift()(32);
  queue.shift()(48);
  expect(steps).toStrictEqual([0.016, 0.016, 0.016]);
  expect(queue.length).toBe(0);
});

test('waking from idle does not integrate the whole idle period', () => {
  const queue = [], steps = [];let now = 0;
  const invalidate = createFrameLoop(dt => { steps.push(dt); return false; }, callback => queue.push(callback), () => now);
  invalidate();queue.shift()(16);
  now = 10000;
  invalidate();queue.shift()(10016);
  expect(steps).toStrictEqual([0.016, 0.016]);
});
