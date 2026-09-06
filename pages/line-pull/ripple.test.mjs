import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFrameLoop } from './frame-loop.ts';
import { boundaryPoint, linePoint, surfacePoint } from './geometry.ts';
import { advanceRipple, createReleaseRipple, rippleOffset, ripplePoint, RIPPLE_DURATION } from './ripple.ts';

const input = { x: 360, originY: 437, travel: 340, lineGap: 56, width: 720, strength: 1 };
const model = {
  width: 720, height: 1280, lineGap: 56, surfaceCurvature: 0.022,
  lensStrength: 0.2, horizontalLens: 0.27, boundaryEase: 0.65, boundaryCreep: 0.02, apexSpacing: 0.16,
};
const near = (a, b, epsilon = 1e-8) => assert.ok(Math.abs(a - b) < epsilon, `${a} != ${b}`);

test('release amplitude grows with the pull but is bounded; taps and disabled waves stay quiet', () => {
  for (const travel of [-3.9, 0, 3.9]) assert.equal(createReleaseRipple({ ...input, travel }), null);
  assert.equal(createReleaseRipple({ ...input, strength: 0 }), null);
  let previous = 0;
  for (const travel of [4, 28, 56, 140, 340, 2000, 10000]) {
    const wave = createReleaseRipple({ ...input, travel });
    assert.ok(Math.abs(wave.amplitude) >= previous);
    assert.ok(Math.abs(wave.amplitude) <= input.lineGap * 0.22);
    previous = Math.abs(wave.amplitude);
    near(wave.amplitude, -createReleaseRipple({ ...input, travel: -travel }).amplitude);
  }
});

test('the pulse starts at the release X and travels outward symmetrically, not in place', () => {
  const wave = createReleaseRipple(input);
  for (const age of [0.08, 0.2, 0.4, 0.6]) {
    const current = { ...wave, age };
    for (const distance of [0, 20, 80, 160, 320, 600]) {
      near(rippleOffset(current, wave.x - distance), rippleOffset(current, wave.x + distance));
      if (distance >= wave.speed * age) assert.equal(rippleOffset(current, wave.x + distance), 0);
    }
    const distance = wave.speed * (age - 0.08);
    assert.ok(Math.abs(rippleOffset(current, wave.x + distance)) > 0.1, 'outgoing front disappeared');
  }
  assert.equal(rippleOffset({ ...wave, age: 0.4 }, wave.x), 0, 'the source must stop ringing');
});

test('wave starts and ends at zero and cannot linger after its fixed lifetime', () => {
  const wave = createReleaseRipple(input);
  for (const x of [-1000, 0, 360, 720, 10000]) {
    assert.equal(rippleOffset(wave, x), 0);
    assert.equal(rippleOffset({ ...wave, age: RIPPLE_DURATION }, x), 0);
    assert.ok(Math.abs(rippleOffset({ ...wave, age: RIPPLE_DURATION - 1e-6 }, x)) < 1e-8);
  }
  assert.equal(advanceRipple(wave, RIPPLE_DURATION), null);
  assert.equal(advanceRipple(wave, 10), null);
  assert.equal(advanceRipple(null, 1 / 60), null);
});

test('projection is identity without a wave and preserves vertical ordering and closed seams', () => {
  const point = { x: 120, y: 437 };
  assert.equal(ripplePoint(point), point);
  for (const gap of [42, 56, 120]) {
    for (const offset of [-gap * 0.22, gap * 0.22]) {
      const column = { offset, centerY: 437, spread: gap * 1.8 };
      let lastY = -Infinity;
      for (let y = 0; y <= 1280; y += 0.2) {
        const warped = ripplePoint({ x: 120, y }, column);
        assert.equal(warped.x, 120);
        assert.ok(warped.y > lastY, 'nearby lines must not cross');
        lastY = warped.y;
      }
      assert.deepEqual(ripplePoint(point, column), ripplePoint({ ...point }, column));
    }
  }
});

test('ripple keeps both pull directions and nearly closed reveal boundaries ordered', () => {
  for (const direction of [-1, 1]) for (const travel of [0, 0.001, 1, 56, 340]) {
    const pull = { originY: 437, apexX: 360, apexY: 437 + direction * travel };
    const wave = { ...createReleaseRipple({ ...input, travel: direction * 340 }), age: 0.2 };
    for (let x = 0; x <= 720; x += 24) {
      const center = surfacePoint(model, pull, x, pull.originY);
      const column = { offset: rippleOffset(wave, center.x), centerY: center.y, spread: wave.spread };
      const upper = ripplePoint(boundaryPoint(model, pull, x), column);
      const lower = ripplePoint(linePoint(model, pull, pull.originY, x), column);
      const neighbor = ripplePoint(linePoint(model, pull, pull.originY - direction * 56, x), column);
      assert.ok(direction * (lower.y - upper.y) >= -1e-8, 'clip reversed');
      assert.ok(direction * (upper.y - neighbor.y) >= -1e-8, 'boundary crossed its neighbor');
      if (travel === 0) near(upper.y, lower.y);
    }
  }
});

test('one frame loop runs the remaining wave, then sleeps; cancellation wakes no extra loop', () => {
  const queue = [];
  let wave = createReleaseRipple(input), now = 0, frames = 0;
  const render = createFrameLoop(dt => {
    wave = advanceRipple(wave, dt);
    frames++;
    return !!wave;
  }, callback => queue.push(callback), () => now);
  render();
  while (queue.length && frames < 100) { now += 1000 / 60; queue.shift()(now); }
  assert.equal(wave, null);
  assert.equal(queue.length, 0);
  assert.ok(frames >= 47 && frames <= 49);
  wave = createReleaseRipple(input);
  render();
  wave = null; // A new pointer, resize, cancel, blur, or reduced-motion change clears it.
  render();
  assert.equal(queue.length, 1);
  now += 1000 / 60;
  queue.shift()(now);
  assert.equal(queue.length, 0);
});
