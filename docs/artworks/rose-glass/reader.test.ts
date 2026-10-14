import { readFileSync } from 'node:fs';
import { test, expect } from 'vitest';
import { renderMarkdown, documentLink } from '../../reader/markdown';
import { scenePoint } from './glass-view';
import { GlassBodyMotion } from '../../../pages/rose-glass/interaction';
import { applyDeformation, invertDeformation } from '../../../pages/rose-glass/deformation';

test('Rose Glass renders its own Markdown with the material and drag demo slots', () => {
  const path = '/docs/artworks/rose-glass/architecture.md';
  const source = readFileSync(new URL('./architecture.md', import.meta.url), 'utf8');
  const html = renderMarkdown(source, {}, path);
  expect(html).toContain('<!-- interactive-demo: material -->');
  expect(html).toContain('<!-- interactive-demo: drag -->');
  expect(documentLink('./index.html', path)).toBe('./');
  expect(documentLink('../../../pages/rose-glass/shader.ts', path)).toBe('https://github.com/jiwon79/studio/blob/main/pages/rose-glass/shader.ts');
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
