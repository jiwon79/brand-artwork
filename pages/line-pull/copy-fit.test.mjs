import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fitCopyInOpenings } from './copy-fit.ts';
import { boundaryPoint, copyLayout, linePoint, sampleXs } from './geometry.ts';
import { pointInOpening } from './layers.ts';

const model = {
  width: 1265, height: 860, lineGap: 48.16, lineWidth: 3, surfaceCurvature: 0.022,
  lensStrength: 0.2, horizontalLens: 0.27, boundaryEase: 0.65, boundaryCreep: 0.02, apexSpacing: 0.16,
};
const metrics = { x: -1.8, y: -0.55, width: 3.6, height: 1.95 };
const rect = (left, top, right, bottom) => [
  { x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom },
];
const polygonFor = (surface, pull) => {
  const xs = sampleXs(surface, pull);
  return [...xs.map(x => boundaryPoint(surface, pull, x)),
    ...[...xs].reverse().map(x => linePoint(surface, pull, pull.originY, x))];
};
function assertContained(layout, bounds, polygons, width, height) {
  const left = layout.x + bounds.x * layout.fontSize * layout.scaleX;
  const top = layout.y + bounds.y * layout.fontSize;
  const right = left + bounds.width * layout.fontSize * layout.scaleX;
  const bottom = top + bounds.height * layout.fontSize;
  assert.ok(left >= 0 && right <= width && top >= 0 && bottom <= height);
  for (let i = 0; i <= 24; i++) for (const y of [top, bottom]) {
    const point = { x: left + (right - left) * i / 24, y };
    for (const polygon of polygons) assert.ok(pointInOpening(polygon, point), JSON.stringify({ point, layout }));
  }
}

test('fit the entire multiline copy inside both clips, not the full viewport', () => {
  const parent = rect(0, 200, 1265, 450), child = rect(0, 300, 1265, 800);
  const desired = copyLayout(model, { originY: 330, apexX: 630, apexY: 700 }, 2);
  assert.ok(desired.fontSize * metrics.height > 150, 'the old layout clips');
  const fitted = fitCopyInOpenings(desired, metrics, [parent, child], 1265, 860, 12);
  assert.equal(fitted.x, 1265 / 2);
  assert.ok(fitted.fontSize > 60 && fitted.fontSize < 65);
  assertContained(fitted, metrics, [parent, child], 1265, 860);
});

test('check intermediate folded-edge peaks and either polygon winding', () => {
  const parent = rect(0, 100, 1265, 800);
  const child = [{ x: 0, y: 200 }, { x: 632.5, y: 370 }, { x: 1265, y: 200 },
    { x: 1265, y: 700 }, { x: 632.5, y: 600 }, { x: 0, y: 700 }];
  const desired = { x: 632.5, y: 250, fontSize: 190, lineHeight: 157.7, scaleX: 1.12 };
  const fitted = fitCopyInOpenings(desired, metrics, [parent, child], 1265, 860, 12);
  assertContained(fitted, metrics, [parent, child], 1265, 860);
  assert.deepEqual(fitCopyInOpenings(desired, metrics, [parent, [...child].reverse()], 1265, 860, 12), fitted);
});

test('fit real curved pockets, upward pulls, off-center grabs, and mobile viewports', () => {
  for (const [width, height] of [[390, 844], [720, 1280], [1265, 860]]) {
    const surface = { ...model, width, height };
    for (const direction of [-1, 1]) for (const fraction of [0.05, 0.5, 0.95]) {
      const outerPull = { originY: direction > 0 ? 200 : height - 200, apexX: width * fraction,
        apexY: direction > 0 ? height - 40 : 40 };
      const outer = polygonFor({ ...surface, lineGap: 56 }, outerPull);
      const innerPull = { originY: outerPull.originY + direction * 60, apexX: width * (1 - fraction),
        apexY: outerPull.apexY };
      const inner = polygonFor(surface, innerPull);
      for (const bounds of [metrics, { x: -2.1, y: -0.55, width: 4.2, height: 1.12 }]) {
        const layout = fitCopyInOpenings(copyLayout(surface, innerPull, 2), bounds, [outer, inner], width, height, 12);
        assert.equal(layout.x, width / 2);
        assert.ok(layout.fontSize > 20, 'readable inner copy after opening');
        assertContained(layout, bounds, [outer, inner], width, height);
      }
    }
  }
});

test('copy grows then plateaus as a centered opening is pulled further', () => {
  const outer = polygonFor({ ...model, lineGap: 56 }, { originY: 255, apexX: 632.5, apexY: 750 });
  let previous = 0;
  for (const distance of [20, 40, 80, 140, 250, 400, 900, 2000]) {
    const pull = { originY: 330, apexX: 632.5, apexY: 330 + distance };
    const inner = polygonFor(model, pull);
    const layout = fitCopyInOpenings(copyLayout(model, pull, 2), metrics, [outer, inner], 1265, 860, 12);
    assert.ok(layout.fontSize >= previous - 0.02, `${layout.fontSize} < ${previous}`);
    previous = layout.fontSize;
  }
});

test('empty or invisible openings never produce invalid text coordinates', () => {
  const desired = copyLayout(model, { originY: 300, apexX: 600, apexY: 600 }, 2);
  for (const polygons of [[[]], [rect(0, 1000, 1265, 1200)], [rect(0, 100, 300, 600)]]) {
    const fitted = fitCopyInOpenings(desired, metrics, polygons, 1265, 860, 12);
    assert.equal(fitted.fontSize, 0);
    assert.ok(Object.values(fitted).every(Number.isFinite));
  }
});
