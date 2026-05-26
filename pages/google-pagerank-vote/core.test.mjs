import test from 'node:test';
import assert from 'node:assert/strict';

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

  assert.equal(mask.contains(mask.cx - unit * 0.8, mask.cy), true, 'left stroke should be inside the G');
  assert.equal(mask.contains(mask.cx, mask.cy), false, 'center counter should remain empty');
  assert.equal(mask.contains(mask.cx + unit * 0.55, mask.cy), true, 'horizontal bar should be inside the G');
  assert.equal(mask.contains(mask.cx + unit * 0.88, mask.cy - unit * 0.12), false, 'right-side notch should stay open');
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

  assert.ok(loops.length >= 35 && loops.length <= 55, `expected 35-55 loops, got ${loops.length}`);
  assert.ok(graph.edgeCount >= loops.length - 1, `expected enough contact edges, got ${graph.edgeCount}`);
  assert.equal(schedule.length, loops.length);
  assert.equal(schedule.every((time) => Number.isFinite(time)), true, 'every loop should receive an activation time');

  for (const loop of loops) {
    const insideCount = loop.samples.filter((point) => mask.contains(point.x, point.y)).length;
    assert.ok(insideCount / loop.samples.length > 0.74, `loop ${loop.id} should mostly stay inside the G mask`);
  }
});

test('character belt breaks tokens into individually spaced glyphs', () => {
  const belt = buildCharacterBelt(['LINK'], 12, 96);

  assert.deepEqual(
    belt.slice(0, 8).map((glyph) => glyph.char),
    ['L', 'I', 'N', 'K', 'L', 'I', 'N', 'K']
  );
  assert.equal(belt[0].tokenIndex, 0);
  assert.equal(belt[3].tokenIndex, 0);
  assert.equal(belt[0].distance, 0);
  assert.equal(belt[1].distance, 12);
  assert.equal(belt[2].distance, 24);
  assert.equal(belt[3].distance, 36);
});

test('fitted character belt spaces measured glyphs across the whole loop', () => {
  const widths = { W: 20, I: 4, D: 14, E: 12 };
  const belt = buildFittedCharacterBelt(['WIDE'], widths, 86, 0, 6);

  assert.equal(belt.length, 3);
  assert.deepEqual(
    belt.map((glyph) => glyph.char),
    ['W', 'I', 'D'],
  );

  const gaps = belt.map((glyph, index) => {
    const next = belt[(index + 1) % belt.length];
    return index === belt.length - 1
      ? 86 - glyph.distance + next.distance
      : next.distance - glyph.distance;
  });

  assert.equal(gaps.every((gap) => gap >= widths.W + 6), true);
});

test('grouped word character belt keeps words close while rotating letters individually', () => {
  const widths = { V: 12, O: 13, T: 10, E: 11, R: 12, A: 12, N: 13, K: 12, W: 16, B: 12 };
  const belt = buildGroupedWordCharacterBelt(['VOTE', 'RANK', 'WEB'], widths, 200, 0, 1, 18);

  assert.deepEqual(
    belt.map((glyph) => glyph.char),
    ['V', 'O', 'T', 'E', 'R', 'A', 'N', 'K', 'W', 'E', 'B'],
  );

  const firstWordStart = belt[0].distance - belt[0].width / 2;
  const firstWordEnd = belt[3].distance + belt[3].width / 2;
  const secondWordStart = belt[4].distance - belt[4].width / 2;
  const lastWordEnd = belt[10].distance + belt[10].width / 2;

  assert.equal(firstWordStart, 0);
  assert.ok(belt[1].distance - belt[0].distance < 15);
  assert.ok(secondWordStart - firstWordEnd >= 18);
  assert.ok(200 - lastWordEnd + firstWordStart >= 18);
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

  assert.equal(painted, 2);
  assert.equal(belt[0].paintColor, '#4285F4');
  assert.equal(belt[1].paintColor, '#4285F4');
  assert.equal(belt[2].paintColor, undefined);

  const repainted = paintGlyphsInBrush(
    belt,
    positions,
    { x: 10, y: 10, radius: 9, color: '#EA4335' },
  );

  assert.equal(repainted, 2);
  assert.equal(belt[0].paintColor, '#EA4335');
  assert.equal(belt[1].paintColor, '#EA4335');
});
