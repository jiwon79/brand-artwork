import { readFileSync } from 'node:fs';
import { test, expect } from 'vitest';
import { renderMarkdown, documentLink } from '../../reader/markdown';
import { scenePoint } from './glass-view';
import { GlassBodyMotion } from '../../../pages/rose-glass/interaction';
import { applyDeformation, invertDeformation } from '../../../pages/rose-glass/deformation';
import { reliefSample } from './relief-demo';
import { inspectInverse } from './inverse-debug';

test('Rose Glass renders its own Markdown with the material and drag demo slots', () => {
  const path = '/docs/artworks/rose-glass/architecture.md';
  const source = readFileSync(new URL('./architecture.md', import.meta.url), 'utf8');
  const html = renderMarkdown(source, {}, path);
  expect(html).toContain('<!-- interactive-demo: material -->');
  expect(html).toContain('<!-- interactive-demo: drag -->');
  expect(html).toContain('<!-- interactive-demo: relief -->');
  expect(html).toContain('<strong>안팎 판별값 f</strong>');
  expect(html).toContain('<strong>혼합 비율 w</strong>');
  expect(html).not.toContain('**');
  expect(documentLink('./index.html', path)).toBe('./');
  expect(documentLink('../../../pages/rose-glass/shader.ts', path)).toBe('https://github.com/jiwon79/studio/blob/main/pages/rose-glass/shader.ts');
});

test('the relief uses the foreground shader height and the separate artistic lighting normal', () => {
  const center = reliefSample(0, 0), edge = reliefSample(1, 0), middle = reliefSample(0.5, 0);
  expect(center.depth).toBe(1); expect(center.height).toBe(225);
  expect(edge.depth).toBe(0); expect(edge.height).toBe(100);
  expect(middle.height).toBeGreaterThan(edge.height);
  expect(middle.height).toBeLessThan(center.height);
  expect(center.normal.x).toBe(0); expect(center.normal.y).toBe(0);
  expect(center.normal.z).toBeCloseTo(1);
  expect(middle.normal.length()).toBeCloseTo(1);
  expect(edge.normal.z).toBeGreaterThan(0);
});

test('pointer mapping keeps the composition center and preserves distances at different aspect ratios', () => {
  expect(scenePoint(200, 250, 400, 500)).toEqual({ x: 295, y: 640 });
  const wide = scenePoint(450, 250, 800, 500);
  const narrow = scenePoint(250, 250, 400, 500);
  expect(wide).toEqual(narrow);
});

test('the demo pull carries the material point and recovers after release', () => {
  const motion = new GlassBodyMotion();
  const point = { x: 122, y: 0 };
  expect(motion.grab(-1, { x: 420, y: 645 })).toBe(true);
  motion.move(-1, { x: 600, y: 580 });
  const settings = { softness: 1.1, indentationDepth: 1, recovery: 1, stretchLimit: 430 };
  for (let i = 0; i < 90; i++) motion.step(1 / 60, 85, 1, settings, false);
  const carried = applyDeformation(point, motion);
  expect(carried.x).toBeGreaterThan(point.x + 100);
  const original = invertDeformation(carried, motion);
  expect(original.x).toBeCloseTo(point.x, 2);
  expect(original.y).toBeCloseTo(point.y, 2);
  motion.release(-1, false);
  for (let i = 0; i < 360; i++) motion.step(1 / 60, 85, 1, settings, false);
  expect(motion.mode).toBe('idle');
  expect(applyDeformation(point, motion)).toEqual(point);
});

test('inverse debug traces the same solver and reconstructs the selected scene point', () => {
  const motion = new GlassBodyMotion();
  motion.grab(-1, { x: 420, y: 645 }); motion.move(-1, { x: 600, y: 580 });
  for (let i = 0; i < 90; i++) motion.step(1 / 60, 85, 1, { softness: 1.1, indentationDepth: 1, recovery: 1, stretchLimit: 430 }, false);
  const result = inspectInverse({ x: 410, y: 645 }, motion);
  expect(result.steps).toHaveLength(20);
  expect(result.steps[0].fieldIndex).toBe(3);
  expect(result.steps[result.steps.length - 1].fieldIndex).toBe(0);
  expect(result.source).toEqual(invertDeformation(result.target, motion));
  expect(result.steps[0].error.x).toBeCloseTo(result.steps[0].forward.x - result.steps[0].target.x);
  expect(result.residual).toBeLessThan(0.001);
  const still = inspectInverse({ x: 410, y: 645 }, new GlassBodyMotion());
  expect(still.steps).toHaveLength(0);
  expect(still.source).toEqual(still.target);
});
