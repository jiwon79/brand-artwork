import assert from 'node:assert/strict';
import { test } from 'node:test';
import { boundaryPoint, crossingTime, lensProgress, linePoint, restY, sampleXs } from './geometry.ts';

const surface = {
  width: 720, height: 1280, lineGap: 70, surfaceCurvature: 0.022,
  lensStrength: 0.2, horizontalLens: 0.27, boundaryEase: 0.65,
  boundaryCreep: 0.02, apexSpacing: 0.16,
};
const near = (a, b, epsilon = 1e-6) => assert.ok(Math.abs(a - b) <= epsilon, `${a} != ${b}`);
const pullAt = (distance, x = 440, originY = 437) => ({
  originY, apexX: x, apexY: restY(surface, x, originY) + distance,
});

test('upper boundary approaches its neighbor, then creeps with it without crossing', () => {
  for (const direction of [-1, 1]) {
    let lastGap = Infinity;
    for (const distance of [0.01, 35, 70, 140, 210, 340, 700, 2100]) {
      const pull = pullAt(direction * distance);
      const boundary = boundaryPoint(surface, pull, pull.apexX).y;
      const neighbor = linePoint(surface, pull, pull.originY - direction * surface.lineGap, pull.apexX).y;
      const gap = direction * (boundary - neighbor);
      assert.ok(gap >= -1e-9 && gap <= lastGap + 1e-9);
      lastGap = gap;
    }
    const a = boundaryPoint(surface, pullAt(direction * 340), 440).y;
    const b = boundaryPoint(surface, pullAt(direction * 2100), 440).y;
    assert.ok(Math.abs(a - b) < 4, 'long pull must not send the upper boundary flying');
  }
});

test('every reached line keeps a distinct, ordered tip in both directions', () => {
  for (const direction of [-1, 1]) {
    for (const distance of [70, 210, 340, 700, 2100]) {
      const pull = pullAt(direction * distance);
      let previous = linePoint(surface, pull, pull.originY, pull.apexX).y;
      for (let i = 1; i <= 35; i++) {
        const y = linePoint(surface, pull, pull.originY + direction * i * surface.lineGap, pull.apexX).y;
        assert.ok(direction * (y - previous) >= 11, 'tips must not collapse to one point');
        previous = y;
      }
    }
  }
});

test('main tip stays in pointer coordinates at every x and at unlimited heights', () => {
  for (const x of [0, 1, 27, 360, 440, 719, 720]) {
    for (const distance of [-5000, -340, -70, -1, 0, 1, 70, 340, 5000]) {
      const pull = pullAt(distance, x);
      const tip = linePoint(surface, pull, pull.originY, x);
      near(tip.x, x);
      near(tip.y, pull.apexY);
      assert.ok(sampleXs(surface, pull).includes(x));
    }
  }
});

test('lens strength never decreases as pull distance grows', () => {
  let previous = 0;
  for (let distance = 0; distance <= 5000; distance += 5) {
    const strength = lensProgress(surface, pullAt(distance));
    assert.ok(strength >= previous && strength <= 1);
    near(strength, lensProgress(surface, pullAt(-distance)));
    previous = strength;
  }
});

test('neighboring lines acquire and release their bend continuously', () => {
  for (const direction of [-1, 1]) {
    for (let distance = 0; distance < 600; distance += 0.5) {
      for (let i = 1; i < 6; i++) {
        const y = 437 + direction * i * 70;
        const before = linePoint(surface, pullAt(direction * distance), y, 440).y;
        const after = linePoint(surface, pullAt(direction * (distance + 0.001)), y, 440).y;
        assert.ok(Math.abs(after - before) < 0.003, 'newly reached line jumped');
      }
    }
  }
});

test('hit testing finds fast diagonal and horizontal crossings of curved lines', () => {
  near(crossingTime(surface, { x: 360, y: 400 }, { x: 360, y: 600 }, 437), 0.185);
  assert.equal(crossingTime(surface, { x: 360, y: 400 }, { x: 360, y: 410 }, 437), null);
  for (const [from, to] of [
    [{ x: 0, y: 300 }, { x: 700, y: 900 }],
    [{ x: 700, y: 900 }, { x: 0, y: 300 }],
    [{ x: 0, y: 439 }, { x: 360, y: 439 }],
  ]) {
    const t = crossingTime(surface, from, to, 437);
    assert.ok(t > 0 && t <= 1);
    near(from.y + (to.y - from.y) * t, restY(surface, from.x + (to.x - from.x) * t, 437));
  }
});
