import { readFileSync } from 'node:fs';
import { test, expect } from 'vitest';
import { ribbonGeometry, shellDistance, SHELL_COUNT } from './demo-geometry';
import { documentLink as resolveLink, renderMarkdown } from '../../reader/markdown';
const sourcePath = '/docs/artworks/soft-forms/architecture.md';
const documentLink = (href: string) => resolveLink(href, sourcePath);
import * as THREE from 'three';
import { findSurface } from './touch-demo';

test('the architecture renders its diagram and embeds demos beneath the relevant explanations', () => {
  const source = readFileSync(new URL('./architecture.md', import.meta.url), 'utf8');
  const html = renderMarkdown(source, { '/docs/assets/fur-shells-and-ribbons.svg': '/assets/fur.svg' }, sourcePath);
  expect(html).toContain('src="/assets/fur.svg"');
  expect(html).toContain('<!-- interactive-demo: shells -->');
  expect(html).toContain('<!-- interactive-demo: ribbons -->');
  expect(html).toContain('<!-- interactive-demo: touch -->');
  expect(html.indexOf('interactive-demo: touch')).toBeLessThan(html.indexOf('2. 몸체 전체'));
  expect(html).not.toContain('\\[');
  expect(html.indexOf('interactive-demo: shells')).toBeLessThan(html.indexOf('리본: 외곽에서 한 가닥이 보이게 하기'));
});

test('screen picks hit the first visible mesh surface and miss empty space', () => {
  const camera = new THREE.OrthographicCamera(-1.8, 1.8, 1.8, -1.8, 0.1, 20);
  camera.position.set(0, 0, 6); camera.lookAt(0, 0, 0);
  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32));
  body.scale.set(1.2, 1, 0.75);
  const center = findSurface(camera, body, 0, 0);
  const edge = findSurface(camera, body, 0.55, 0);
  const outside = findSurface(camera, body, 0.85, 0.7);
  expect(center.hit!.point.z).toBeCloseTo(0.75);
  expect(edge.hit!.point.x).toBeCloseTo(0.99);
  expect(edge.hit!.point.z).toBeLessThan(center.hit!.point.z);
  expect(center.ray.direction.equals(edge.ray.direction)).toBe(true);
  expect(outside.hit).toBeUndefined();
  body.geometry.dispose();
  (body.material as THREE.Material).dispose();
});

test('document links retain their repository location and anchors on the web', () => {
  expect(documentLink('../../../pages/soft-forms/fur-renderer.ts')).toBe('https://github.com/jiwon79/studio/blob/main/pages/soft-forms/fur-renderer.ts');
  expect(documentLink('../../concepts/fur-shells-and-ribbons.md#5')).toBe('https://github.com/jiwon79/studio/blob/main/docs/concepts/fur-shells-and-ribbons.md#5');
  expect(documentLink('./index.html')).toBe('./');
  expect(documentLink('#ribbon-demo')).toBe('#ribbon-demo');
});

test('13 shell positions preserve the artwork endpoints and uniform-spacing comparison', () => {
  expect(SHELL_COUNT).toBe(13);
  expect(shellDistance(0)).toBe(0.5);
  expect(shellDistance(12)).toBe(29.5);
  for (let i = 1; i < 13; i++) {
    expect(shellDistance(i, 1) - shellDistance(i - 1, 1)).toBeCloseTo(29 / 12);
  }
  expect(shellDistance(6, 1.3)).toBeLessThan(shellDistance(6, 1));
  expect(shellDistance(6, 0.4)).toBeGreaterThan(shellDistance(6, 1));
});

test('ribbon projection keeps camera-space width and converges at the tip', () => {
  const straight = ribbonGeometry(0, 0.63, 0);
  const tilted = ribbonGeometry(60, 0.63, 1.2);
  expect(tilted.projectedLength).toBeCloseTo(straight.projectedLength / 2);
  expect(tilted.stations[0].halfWidth).toBe(0.63);
  expect(tilted.stations.map(s => s.t)).toEqual([0, 0.22, 0.48, 0.73, 1]);
  expect(tilted.stations[4].left.x).toBeCloseTo(tilted.tip.x);
  expect(tilted.stations[4].left.y).toBeCloseTo(tilted.tip.y);
  const endOn = ribbonGeometry(90, 0.63, 1.2);
  expect(endOn.fallback).toBe(true);
  expect(endOn.across).toEqual({ x: 1, y: 0 });
  expect(endOn.stations.every(s => Number.isFinite(s.left.x) && Number.isFinite(s.right.y))).toBe(true);
});
