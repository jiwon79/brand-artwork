import { test, expect } from 'vitest';
import { foregroundGlassShape, glassBodyWidthAt } from '../../../pages/rose-glass/deformation';
import { outlinePoint } from './outline-demo';
import { nearestEdge } from './edge-distance';
import { inspectPixel } from './pixel-inspection';
import { scenePoint } from './glass-view';

test('the distance line reaches the closest point of the actual tapered and sheared contour', () => {
  for (const [u, v] of [[.6, 0], [-.5, .65], [.2, -.9], [1.15, .35], [0, 0]]) {
    const nearest = nearestEdge(u, v);
    const edgeV = nearest.boundary.y / foregroundGlassShape.height;
    const edgeU = (nearest.boundary.x - nearest.boundary.y * foregroundGlassShape.shear) / glassBodyWidthAt(2, edgeV);
    expect(Math.abs(edgeU) ** foregroundGlassShape.exponent + Math.abs(edgeV) ** foregroundGlassShape.exponent).toBeCloseTo(1, 10);
    let denseMinimum = Infinity;
    for (let i = 0; i < 16384; i++) {
      const edge = outlinePoint(i / 16384 * 2 * Math.PI, foregroundGlassShape.exponent, 3);
      denseMinimum = Math.min(denseMinimum, Math.hypot(edge.x - nearest.point.x, edge.y - nearest.point.y));
    }
    expect(nearest.distance).toBeLessThanOrEqual(denseMinimum + .00001);
    expect(nearest.distance).toBeGreaterThan(denseMinimum - .001);
  }
});

test('the shader distance agrees near the contour and its central approximation is distinguished', () => {
  expect(nearestEdge(1, 0).distance).toBeLessThan(.00001);
  expect(nearestEdge(0, 1).distance).toBeLessThan(.00001);
  for (const u of [-.99, .99]) {
    const exact = nearestEdge(u, 0).distance;
    expect(Math.abs(inspectPixel(u, 0).distance - exact) / exact).toBeLessThan(.02);
  }
  expect(inspectPixel(1.1, 0).distance).toBeLessThan(0);
  expect(nearestEdge(1.1, 0).distance).toBeGreaterThan(0);
  expect(Number.isFinite(nearestEdge(0, 0).distance)).toBe(true);
  expect(inspectPixel(0, 0).distance).toBeGreaterThan(nearestEdge(0, 0).distance * 10);
});

test('picking an enlarged distance preview maps back to the same artwork point', () => {
  const width = 180, height = 220, zoom = 1.7;
  const scale = Math.min(width / 590, height / 1280) * zoom;
  const point = nearestEdge(.6, -.3).point;
  const screenX = width / 2 + (foregroundGlassShape.x + point.x - 295) * scale;
  const screenY = height / 2 + (foregroundGlassShape.y + point.y - 640) * scale;
  const picked = scenePoint(screenX, screenY, width, height, zoom);
  expect(picked.x).toBeCloseTo(foregroundGlassShape.x + point.x, 10);
  expect(picked.y).toBeCloseTo(foregroundGlassShape.y + point.y, 10);
});
