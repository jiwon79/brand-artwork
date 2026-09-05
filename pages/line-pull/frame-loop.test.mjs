import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFrameLoop } from './frame-loop.ts';

test('bursty input renders once per frame and does not spin while idle', () => {
  const queue = [], steps = [];
  const invalidate = createFrameLoop(dt => { steps.push(dt); return false; }, callback => queue.push(callback), () => 0);
  for (let i = 0; i < 100; i++) invalidate();
  assert.equal(queue.length, 1);
  queue.shift()(16);
  assert.deepEqual(steps, [0.016]);
  assert.equal(queue.length, 0);
});

test('spring frames and new input share one pending frame', () => {
  const queue = [], steps = [];
  const invalidate = createFrameLoop(dt => { steps.push(dt); return steps.length < 3; }, callback => queue.push(callback), () => 0);
  invalidate();
  queue.shift()(16);
  invalidate();invalidate();
  assert.equal(queue.length, 1);
  queue.shift()(32);
  queue.shift()(48);
  assert.deepEqual(steps, [0.016, 0.016, 0.016]);
  assert.equal(queue.length, 0);
});

test('waking from idle does not integrate the whole idle period', () => {
  const queue = [], steps = [];let now = 0;
  const invalidate = createFrameLoop(dt => { steps.push(dt); return false; }, callback => queue.push(callback), () => now);
  invalidate();queue.shift()(16);
  now = 10000;
  invalidate();queue.shift()(10016);
  assert.deepEqual(steps, [0.016, 0.016]);
});
