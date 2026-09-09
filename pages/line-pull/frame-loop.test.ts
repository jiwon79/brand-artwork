import { expect, test } from 'vitest';
import { createFrameLoop } from './frame-loop';

type FrameCallback = (now: number) => void;
const runNextFrame = (queue: FrameCallback[], now: number) => {
  const callback = queue.shift();
  if (!callback) throw new Error('No frame is queued');
  callback(now);
};

test('bursty input renders once per frame and does not spin while idle', () => {
  const queue: FrameCallback[] = [], steps: number[] = [];
  const invalidate = createFrameLoop(dt => { steps.push(dt); return false; }, callback => queue.push(callback), () => 0);
  for (let i = 0; i < 100; i++) invalidate();
  expect(queue.length).toBe(1);
  runNextFrame(queue, 16);
  expect(steps).toStrictEqual([0.016]);
  expect(queue.length).toBe(0);
});

test('spring frames and new input share one pending frame', () => {
  const queue: FrameCallback[] = [], steps: number[] = [];
  const invalidate = createFrameLoop(dt => { steps.push(dt); return steps.length < 3; }, callback => queue.push(callback), () => 0);
  invalidate();
  runNextFrame(queue, 16);
  invalidate();invalidate();
  expect(queue.length).toBe(1);
  runNextFrame(queue, 32);
  runNextFrame(queue, 48);
  expect(steps).toStrictEqual([0.016, 0.016, 0.016]);
  expect(queue.length).toBe(0);
});

test('waking from idle does not integrate the whole idle period', () => {
  const queue: FrameCallback[] = [], steps: number[] = [];let now = 0;
  const invalidate = createFrameLoop(dt => { steps.push(dt); return false; }, callback => queue.push(callback), () => now);
  invalidate();runNextFrame(queue, 16);
  now = 10000;
  invalidate();runNextFrame(queue, 10016);
  expect(steps).toStrictEqual([0.016, 0.016]);
});
