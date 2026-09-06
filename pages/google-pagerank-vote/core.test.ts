import { expect, test } from 'vitest';

import {
  buildCharacterBelt,
  buildFittedCharacterBelt,
  buildGroupedWordCharacterBelt,
  buildContactGraph,
  createGoogleGMask,
  createPropagationSchedule,
  generateLoops,
  paintGlyphsInBrush,
} from './core.js';

test('Google G mask preserves the counter, right opening, and inner bar', () => {
  const mask = createGoogleGMask(1080, 1920);
  const unit = mask.size / 2;

  expect(mask.contains(mask.cx - unit * 0.8, mask.cy), 'left stroke should be inside the G').toBe(true);
  expect(mask.contains(mask.cx, mask.cy), 'center counter should remain empty').toBe(false);
  expect(mask.contains(mask.cx + unit * 0.55, mask.cy), 'horizontal bar should be inside the G').toBe(true);
  expect(mask.contains(mask.cx + unit * 0.88, mask.cy - unit * 0.12), 'right-side notch should stay open').toBe(false);
});

test('generated loops fill the G and produce a connected propagation graph', () => {
  const mask = createGoogleGMask(1080, 1920);
  const loops = generateLoops({
    width: 1080,
    height: 1920,
    seed: 8421,
    targetCount: 45,
    mask,
  });
  const graph = buildContactGraph(loops, mask.scale * 22);
  const schedule = createPropagationSchedule(loops, graph, 0);

  expect(loops.length >= 35 && loops.length <= 55, `expected 35-55 loops, got ${loops.length}`).toBeTruthy();
  expect(graph.edgeCount, `expected enough contact edges, got ${graph.edgeCount}`).toBeGreaterThanOrEqual(loops.length - 1);
  expect(schedule.length).toBe(loops.length);
  expect(schedule.every((time) => Number.isFinite(time)), 'every loop should receive an activation time').toBe(true);

  for (const loop of loops) {
    const insideCount = loop.samples.filter((point: { x: number; y: number }) => mask.contains(point.x, point.y)).length;
    expect(insideCount / loop.samples.length, `loop ${loop.id} should mostly stay inside the G mask`).toBeGreaterThan(0.74);
  }
});

test('character belt breaks tokens into individually spaced glyphs', () => {
  const belt = buildCharacterBelt(['LINK'], 12, 96);

  expect(belt.slice(0, 8).map((glyph) => glyph.char)).toStrictEqual(['L', 'I', 'N', 'K', 'L', 'I', 'N', 'K']);
  expect(belt[0].tokenIndex).toBe(0);
  expect(belt[3].tokenIndex).toBe(0);
  expect(belt[0].distance).toBe(0);
  expect(belt[1].distance).toBe(12);
  expect(belt[2].distance).toBe(24);
  expect(belt[3].distance).toBe(36);
});

test('fitted character belt spaces measured glyphs across the whole loop', () => {
  const widths = { W: 20, I: 4, D: 14, E: 12 };
  const belt = buildFittedCharacterBelt(['WIDE'], widths, 86, 0, 6);

  expect(belt.length).toBe(3);
  expect(belt.map((glyph) => glyph.char)).toStrictEqual(['W', 'I', 'D']);

  const gaps = belt.map((glyph, index) => {
    const next = belt[(index + 1) % belt.length];
    return index === belt.length - 1
      ? 86 - glyph.distance + next.distance
      : next.distance - glyph.distance;
  });

  expect(gaps.every((gap) => gap >= widths.W + 6)).toBe(true);
});

test('grouped word character belt keeps words close while rotating letters individually', () => {
  const widths = { V: 12, O: 13, T: 10, E: 11, R: 12, A: 12, N: 13, K: 12, W: 16, B: 12 };
  const belt = buildGroupedWordCharacterBelt(['VOTE', 'RANK', 'WEB'], widths, 200, 0, 1, 18);

  expect(belt.map((glyph) => glyph.char)).toStrictEqual(['V', 'O', 'T', 'E', 'R', 'A', 'N', 'K', 'W', 'E', 'B']);

  const firstWordStart = belt[0].distance - belt[0].width / 2;
  const firstWordEnd = belt[3].distance + belt[3].width / 2;
  const secondWordStart = belt[4].distance - belt[4].width / 2;
  const lastWordEnd = belt[10].distance + belt[10].width / 2;

  expect(firstWordStart).toBe(0);
  expect(belt[1].distance - belt[0].distance).toBeLessThan(15);
  expect(secondWordStart - firstWordEnd).toBeGreaterThanOrEqual(18);
  expect(200 - lastWordEnd + firstWordStart).toBeGreaterThanOrEqual(18);
});

test('drag brush colors touched glyphs and overwrites previous paint', () => {
  const belt = buildCharacterBelt(['LINK'], 12, 60);
  const positions = [
    { x: 10, y: 10 },
    { x: 14, y: 12 },
    { x: 42, y: 10 },
    { x: 80, y: 10 },
    { x: 96, y: 10 },
  ];

  const painted = paintGlyphsInBrush(
    belt,
    positions,
    { x: 12, y: 11, radius: 7, color: '#4285F4' },
  );

  expect(painted).toBe(2);
  expect(belt[0].paintColor).toBe('#4285F4');
  expect(belt[1].paintColor).toBe('#4285F4');
  expect(belt[2].paintColor).toBe(undefined);

  const repainted = paintGlyphsInBrush(
    belt,
    positions,
    { x: 10, y: 10, radius: 9, color: '#EA4335' },
  );

  expect(repainted).toBe(2);
  expect(belt[0].paintColor).toBe('#EA4335');
  expect(belt[1].paintColor).toBe('#EA4335');
});
