import { expect, test } from 'vitest';
import { fitCopyInOpenings, type CopyBounds } from './copy-fit';
import { openingEdgePoint, copyLayout, bentLinePoint, sampleLineXs, type Point, type Pull, type Surface } from './geometry';
import { pointInOpening } from './layers';

const model = {
  width: 1265, height: 860, lineGap: 48.16, lineWidth: 3, surfaceCurvature: 0.022,
  spreadStrength: 0.2, horizontalSpread: 0.27, openingEdgeEase: 0.65, openingEdgeCreep: 0.02, pullPointSpacing: 0.16,
};
const metrics = { x: -1.8, y: -0.55, width: 3.6, height: 1.95 };
const rect = (left: number, top: number, right: number, bottom: number): Point[] => [
  { x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom },
];
const polygonFor = (surface: Surface, pull: Pull): Point[] => {
  const xs = sampleLineXs(surface, pull);
  return [...xs.map(x => openingEdgePoint(surface, pull, x)),
    ...[...xs].reverse().map(x => bentLinePoint(surface, pull, pull.selectedLineY, x))];
};
function assertContained(
  layout: ReturnType<typeof copyLayout>, bounds: CopyBounds, polygons: readonly Point[][],
  width: number, height: number,
) {
  const left = layout.x + bounds.x * layout.fontSize * layout.scaleX;
  const top = layout.y + bounds.y * layout.fontSize;
  const right = left + bounds.width * layout.fontSize * layout.scaleX;
  const bottom = top + bounds.height * layout.fontSize;
  expect(left >= 0 && right <= width && top >= 0 && bottom <= height).toBeTruthy();
  for (let i = 0; i <= 24; i++) for (const y of [top, bottom]) {
    const point = { x: left + (right - left) * i / 24, y };
    for (const polygon of polygons) expect(pointInOpening(polygon, point), JSON.stringify({ point, layout })).toBeTruthy();
  }
}

test('fit the entire multiline copy inside both clips, not the full viewport', () => {
  const parent = rect(0, 200, 1265, 450), child = rect(0, 300, 1265, 800);
  const desired = copyLayout(model, { selectedLineY: 330, pullX: 630, pullY: 700 }, 2);
  expect(desired.fontSize * metrics.height, 'the old layout clips').toBeGreaterThan(150);
  const fitted = fitCopyInOpenings(desired, metrics, [parent, child], 1265, 860, 12);
  expect(fitted.x).toBe(1265 / 2);
  expect(fitted.fontSize > 60 && fitted.fontSize < 65).toBeTruthy();
  assertContained(fitted, metrics, [parent, child], 1265, 860);
});

test('check intermediate folded-edge peaks and either polygon winding', () => {
  const parent = rect(0, 100, 1265, 800);
  const child = [{ x: 0, y: 200 }, { x: 632.5, y: 370 }, { x: 1265, y: 200 },
    { x: 1265, y: 700 }, { x: 632.5, y: 600 }, { x: 0, y: 700 }];
  const desired = { x: 632.5, y: 250, fontSize: 190, lineHeight: 157.7, scaleX: 1.12 };
  const fitted = fitCopyInOpenings(desired, metrics, [parent, child], 1265, 860, 12);
  assertContained(fitted, metrics, [parent, child], 1265, 860);
  expect(fitCopyInOpenings(desired, metrics, [parent, [...child].reverse()], 1265, 860, 12)).toStrictEqual(fitted);
});

test('fit real curved pockets, upward pulls, off-center grabs, and mobile viewports', () => {
  for (const [width, height] of [[390, 844], [720, 1280], [1265, 860]]) {
    const surface = { ...model, width, height };
    for (const direction of [-1, 1]) for (const fraction of [0.05, 0.5, 0.95]) {
      const outerPull = { selectedLineY: direction > 0 ? 200 : height - 200, pullX: width * fraction,
        pullY: direction > 0 ? height - 40 : 40 };
      const outer = polygonFor({ ...surface, lineGap: 56 }, outerPull);
      const innerPull = { selectedLineY: outerPull.selectedLineY + direction * 60, pullX: width * (1 - fraction),
        pullY: outerPull.pullY };
      const inner = polygonFor(surface, innerPull);
      for (const bounds of [metrics, { x: -2.1, y: -0.55, width: 4.2, height: 1.12 }]) {
        const layout = fitCopyInOpenings(copyLayout(surface, innerPull, 2), bounds, [outer, inner], width, height, 12);
        expect(layout.x).toBe(width / 2);
        expect(layout.fontSize, 'readable inner copy after opening').toBeGreaterThan(20);
        assertContained(layout, bounds, [outer, inner], width, height);
      }
    }
  }
});

test('copy grows then plateaus as a centered opening is pulled further', () => {
  const outer = polygonFor({ ...model, lineGap: 56 }, { selectedLineY: 255, pullX: 632.5, pullY: 750 });
  let previous = 0;
  for (const distance of [20, 40, 80, 140, 250, 400, 900, 2000]) {
    const pull = { selectedLineY: 330, pullX: 632.5, pullY: 330 + distance };
    const inner = polygonFor(model, pull);
    const layout = fitCopyInOpenings(copyLayout(model, pull, 2), metrics, [outer, inner], 1265, 860, 12);
    expect(layout.fontSize, `${layout.fontSize} < ${previous}`).toBeGreaterThanOrEqual(previous - 0.02);
    previous = layout.fontSize;
  }
});

test('empty or invisible openings never produce invalid text coordinates', () => {
  const desired = copyLayout(model, { selectedLineY: 300, pullX: 600, pullY: 600 }, 2);
  for (const polygons of [[[]], [rect(0, 1000, 1265, 1200)], [rect(0, 100, 300, 600)]]) {
    const fitted = fitCopyInOpenings(desired, metrics, polygons, 1265, 860, 12);
    expect(fitted.fontSize).toBe(0);
    expect(Object.values(fitted).every(Number.isFinite)).toBeTruthy();
  }
});

test('long single-line Korean outer copy fits the viewport without following the pointer x', () => {
  for (const width of [320, 390, 720, 1265]) for (const glyphCount of [5, 7]) {
    const surface = { ...model, width };
    const bounds = { x: -glyphCount / 2, y: -0.6, width: glyphCount, height: 1.2 };
    const pull = { selectedLineY: 250, pullX: width / 2, pullY: 650 };
    const expected = fitCopyInOpenings(copyLayout(surface, pull, 1), bounds, [], width, 860, 12);
    assertContained(expected, bounds, [], width, 860);
    for (const pullX of [0, width / 2, width]) {
      expect(fitCopyInOpenings(copyLayout(surface, { ...pull, pullX }, 1), bounds, [], width, 860, 12)).toStrictEqual(expected);
    }
  }
});
