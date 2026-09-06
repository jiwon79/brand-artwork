import assert from 'node:assert/strict';
import { test } from 'node:test';
import { boundaryPoint, crossingTimes, linePoint, sampleXs } from './geometry.ts';
import { canKeepOpening, isNestedSlot, layerGap, lineRows, MAX_NESTED_DEPTH, pointInOpening, visibleOpeningHeight } from './layers.ts';

const model = {
  width: 720, height: 1280, lineGap: 56, lineWidth: 3, surfaceCurvature: 0.022,
  lensStrength: 0.2, horizontalLens: 0.27, boundaryEase: 0.65, boundaryCreep: 0.02, apexSpacing: 0.16,
};
const rect = (left, top, right, bottom) => [
  { x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom },
];
const polygonFor = (surface, pull) => {
  const xs = sampleXs(surface, pull);
  return [...xs.map(x => boundaryPoint(surface, pull, x)),
    ...[...xs].reverse().map(x => linePoint(surface, pull, pull.originY, x))];
};

test('nested content is deterministic per slot, sparse, and bounded in depth', () => {
  for (let depth = 0; depth < MAX_NESTED_DEPTH; depth++) {
    for (let row = -10; row <= 10; row++) assert.equal(isNestedSlot(row, depth), isNestedSlot(row + 3, depth));
    assert.deepEqual([0, 1, 2].map(row => isNestedSlot(row, depth)), [false, true, false]);
  }
  for (let row = -10; row <= 10; row++) assert.equal(isNestedSlot(row, MAX_NESTED_DEPTH), false);
});

test('each inner grid stays aligned to its own phase and covers the visible screen', () => {
  for (const height of [320, 844, 1280, 2160]) for (let depth = 0; depth <= MAX_NESTED_DEPTH; depth++) {
    const gap = layerGap(56, depth);
    for (const phase of [-1000, 31.36, 255, 5000]) {
      const rows = lineRows(height, gap, phase);
      assert.ok(rows[0].baseY <= -gap * 3);
      assert.ok(rows.at(-1).baseY >= height + gap * 3);
      assert.equal(new Set(rows.map(row => row.row)).size, rows.length);
      rows.forEach(row => assert.equal(row.baseY, phase + row.row * gap));
    }
    assert.ok(gap >= 32 && gap <= 56);
  }
});

test('opening hit tests follow the folded polygon, not its bounding rectangle', () => {
  const polygon = [{ x: 0, y: 100 }, { x: 720, y: 100 }, { x: 720, y: 200 }, { x: 360, y: 600 }, { x: 0, y: 200 }];
  assert.equal(pointInOpening(polygon, { x: 360, y: 500 }), true);
  assert.equal(pointInOpening(polygon, { x: 20, y: 500 }), false);
  assert.equal(pointInOpening(polygon, { x: 360, y: 101 }, 4), false);
  assert.equal(pointInOpening(polygon, { x: 360, y: 110 }, 4), true);
  assert.equal(pointInOpening([], { x: 360, y: 110 }), false);
  assert.equal(pointInOpening([...polygon].reverse(), { x: 360, y: 500 }), true);
});

test('pinning requires usable space after clipping by every ancestor and the viewport', () => {
  const child = rect(0, -100, 720, 600);
  const parent = rect(0, 200, 720, 270);
  const grandparent = rect(0, 220, 720, 1000);
  assert.equal(visibleOpeningHeight(child, 360, 500), 500);
  assert.equal(visibleOpeningHeight(child, 360, 1280, [parent, grandparent]), 50);
  assert.equal(canKeepOpening(child, 360, 1280, 48), true);
  assert.equal(canKeepOpening(child, 360, 1280, 48, [parent]), false);
  assert.equal(canKeepOpening(rect(0, 1400, 720, 1800), 360, 1280, 48), false);
  assert.equal(canKeepOpening(child, 800, 1280, 48), false);
});

test('curved pull pockets support both directions and edge grabs', () => {
  for (const direction of [-1, 1]) for (const apexX of [0, 1, 360, 719, 720]) {
    const pull = { originY: 500, apexX, apexY: 500 + direction * 340 };
    const polygon = polygonFor(model, pull);
    assert.equal(canKeepOpening(polygon, apexX, 1280, layerGap(56, 1)), true);
    const upper = boundaryPoint(model, pull, apexX), lower = linePoint(model, pull, 500, apexX);
    assert.equal(pointInOpening(polygon, { x: apexX, y: (upper.y + lower.y) / 2 }), true);
  }
});

test('retain the later curve intersection when the earlier one is outside the parent opening', () => {
  const from = { x: 0, y: 439 }, to = { x: 720, y: 439 };
  const times = crossingTimes(model, from, to, 437);
  assert.equal(times.length, 2);
  const parent = rect(360, 400, 720, 500);
  const visible = times.filter(t => pointInOpening(parent, { x: 720 * t, y: 439 }, 4));
  assert.deepEqual(visible, [times[1]]);
});
