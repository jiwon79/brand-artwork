import { expect, test } from 'vitest';
import { boundaryPoint, crossingTimes, linePoint, sampleXs, type Point, type Pull, type Surface } from './geometry';
import { canKeepOpening, isNestedSlot, layerGap, lineRows, MAX_LAYERS, messageForSlot, pointInOpening, returnLayerChain, visibleOpeningHeight } from './layers';

type ReturningLayer = Parameters<typeof returnLayerChain>[0];
const returningLayer = (parent: ReturningLayer | null = null, pinned = true) => ({
  parent, dirty: false,
  pull: { pinned, returning: false, velocityY: 23, apexX: 360, apexY: 700, targetY: 720 },
});

test('releasing an inner layer starts both springs together without jumping their geometry', () => {
  const outer = returningLayer(), inner = returningLayer(outer, false);
  returnLayerChain(inner);
  for (const layer of [outer, inner]) {
    expect(layer.dirty).toBe(true);
    expect(layer.pull).toStrictEqual({
      pinned: false, returning: true, velocityY: 0, apexX: 360, apexY: 700, targetY: 720,
    });
  }
});

test('a deeper release also unpins every ancestor', () => {
  const outer = returningLayer(), inner = returningLayer(outer), deepest = returningLayer(inner, false);
  returnLayerChain(deepest);
  for (const layer of [outer, inner, deepest]) {
    expect(layer.pull.returning).toBe(true);
    expect(layer.pull.pinned).toBe(false);
    expect(layer.pull.velocityY).toBe(0);
    expect(layer.dirty).toBe(true);
  }
});

test('returning a chain leaves inactive layers inactive and does not touch other pockets', () => {
  const outer = returningLayer(), inactive = { parent: outer, pull: null, dirty: false };
  const inner = returningLayer(inactive, false), unrelated = returningLayer();
  returnLayerChain(inner);
  expect(inactive.pull).toBe(null);
  expect(inactive.dirty).toBe(false);
  expect(outer.pull.returning).toBe(true);
  expect(unrelated.pull.pinned).toBe(true);
  expect(unrelated.pull.returning).toBe(false);
  expect(unrelated.dirty).toBe(false);
});

const model = {
  width: 720, height: 1280, lineGap: 56, lineWidth: 3, surfaceCurvature: 0.022,
  lensStrength: 0.2, horizontalLens: 0.27, boundaryEase: 0.65, boundaryCreep: 0.02, apexSpacing: 0.16,
};
const rect = (left: number, top: number, right: number, bottom: number): Point[] => [
  { x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom },
];
const polygonFor = (surface: Surface, pull: Pull): Point[] => {
  const xs = sampleXs(surface, pull);
  return [...xs.map(x => boundaryPoint(surface, pull, x)),
    ...[...xs].reverse().map(x => linePoint(surface, pull, pull.originY, x))];
};

test('nested content is deterministic per slot, sparse, and bounded in depth', () => {
  expect(MAX_LAYERS).toBe(2);
  for (let depth = 0; depth < MAX_LAYERS - 1; depth++) {
    for (let row = -10; row <= 10; row++) expect(isNestedSlot(row, depth)).toBe(isNestedSlot(row + 3, depth));
    expect([0, 1, 2].map(row => isNestedSlot(row, depth))).toStrictEqual([false, true, false]);
  }
  for (let depth = MAX_LAYERS - 1; depth <= 5; depth++) {
    for (let row = -10; row <= 10; row++) expect(isNestedSlot(row, depth)).toBe(false);
  }
});

test('outer slots repeat greeting, hidden inner grid, and closing phrase in a fixed order', () => {
  for (let cycle = -10; cycle <= 10; cycle++) {
    expect(messageForSlot(cycle * 3, 0)).toStrictEqual(['안녕하세요']);
    expect(messageForSlot(cycle * 3 + 1, 0)).toStrictEqual([]);
    expect(messageForSlot(cycle * 3 + 2, 0)).toStrictEqual(['잘부탁드립니다']);
  }
});

test('the name appears only inside the second layer, never after repeated outer pulls', () => {
  const messages = new Set();
  for (let row = -30; row <= 30; row++) {
    expect(messageForSlot(row, 0).includes('이지원입니다')).toBe(false);
    expect(messageForSlot(row, 1)).toStrictEqual(['이지원입니다']);
    for (const depth of [0, 1]) for (const message of messageForSlot(row, depth)) messages.add(message);
  }
  expect([...messages].sort()).toStrictEqual(['안녕하세요', '이지원입니다', '잘부탁드립니다'].sort());
});

test('each inner grid stays aligned to its own phase and covers the visible screen', () => {
  for (const height of [320, 844, 1280, 2160]) for (let depth = 0; depth < MAX_LAYERS; depth++) {
    const gap = layerGap(56, depth);
    for (const phase of [-1000, 31.36, 255, 5000]) {
      const rows = lineRows(height, gap, phase);
      expect(rows[0].baseY).toBeLessThanOrEqual(-gap * 3);
      expect(rows[rows.length - 1].baseY).toBeGreaterThanOrEqual(height + gap * 3);
      expect(new Set(rows.map(row => row.row)).size).toBe(rows.length);
      rows.forEach(row => expect(row.baseY).toBe(phase + row.row * gap));
    }
    expect(gap >= 32 && gap <= 56).toBeTruthy();
  }
});

test('opening hit tests follow the folded polygon, not its bounding rectangle', () => {
  const polygon = [{ x: 0, y: 100 }, { x: 720, y: 100 }, { x: 720, y: 200 }, { x: 360, y: 600 }, { x: 0, y: 200 }];
  expect(pointInOpening(polygon, { x: 360, y: 500 })).toBe(true);
  expect(pointInOpening(polygon, { x: 20, y: 500 })).toBe(false);
  expect(pointInOpening(polygon, { x: 360, y: 101 }, 4)).toBe(false);
  expect(pointInOpening(polygon, { x: 360, y: 110 }, 4)).toBe(true);
  expect(pointInOpening([], { x: 360, y: 110 })).toBe(false);
  expect(pointInOpening([...polygon].reverse(), { x: 360, y: 500 })).toBe(true);
});

test('pinning requires usable space after clipping by every ancestor and the viewport', () => {
  const child = rect(0, -100, 720, 600);
  const parent = rect(0, 200, 720, 270);
  const grandparent = rect(0, 220, 720, 1000);
  expect(visibleOpeningHeight(child, 360, 500)).toBe(500);
  expect(visibleOpeningHeight(child, 360, 1280, [parent, grandparent])).toBe(50);
  expect(canKeepOpening(child, 360, 1280, 48)).toBe(true);
  expect(canKeepOpening(child, 360, 1280, 48, [parent])).toBe(false);
  expect(canKeepOpening(rect(0, 1400, 720, 1800), 360, 1280, 48)).toBe(false);
  expect(canKeepOpening(child, 800, 1280, 48)).toBe(false);
});

test('curved pull pockets support both directions and edge grabs', () => {
  for (const direction of [-1, 1]) for (const apexX of [0, 1, 360, 719, 720]) {
    const pull = { originY: 500, apexX, apexY: 500 + direction * 340 };
    const polygon = polygonFor(model, pull);
    expect(canKeepOpening(polygon, apexX, 1280, layerGap(56, 1))).toBe(true);
    const upper = boundaryPoint(model, pull, apexX), lower = linePoint(model, pull, 500, apexX);
    expect(pointInOpening(polygon, { x: apexX, y: (upper.y + lower.y) / 2 })).toBe(true);
  }
});

test('retain the later curve intersection when the earlier one is outside the parent opening', () => {
  const from = { x: 0, y: 439 }, to = { x: 720, y: 439 };
  const times = crossingTimes(model, from, to, 437);
  expect(times.length).toBe(2);
  const parent = rect(360, 400, 720, 500);
  const visible = times.filter(t => pointInOpening(parent, { x: 720 * t, y: 439 }, 4));
  expect(visible).toStrictEqual([times[1]]);
});
