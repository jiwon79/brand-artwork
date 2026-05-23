import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCharacterBelt,
  buildContactGraph,
  createGoogleGMask,
  createPropagationSchedule,
  generateLoops,
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
