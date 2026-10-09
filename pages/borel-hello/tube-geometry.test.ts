import { expect, test } from 'vitest';
import { composeText } from './lettering';
import { preparePen } from './pen-geometry';
import { createPenPlayback, strokeState } from './pen-playback';
import { samplePen } from './test-pen-quality';
import { catalog, shaper } from './test-font';
import { createTubeFrames, createTubePaths, dot, sampleTube, subtract, TUBE_SCALE, tubeRing, tubeTangent, type TubePath } from './tube-geometry';

for (const text of ['hello', 'jiwon', 'my name is jiwon', 'tttsss', 'Hello, world!\n2026', 'ij', 'fdbxk', '']) {
  test(`3D follows the same authored XY path, nib width and frame schedule: ${text || 'empty'}`, () => {
    const lettering = composeText(text, shaper, catalog), pens = lettering.strokes.map(preparePen);
    const before = JSON.stringify(pens), origin = [3100, -400] as const;
    const tubes = createTubePaths(pens, origin), playback = createPenPlayback(pens);
    expect(tubes).toHaveLength(pens.length);
    for (const [index, path] of tubes.entries()) {
      expect(path.length).toBe(pens[index].length);
      for (const [i, point] of path.points.entries()) {
        const original = pens[index].points[i];
        expect(point.center[0]).toBe((original.x - origin[0]) * TUBE_SCALE);
        expect(point.center[1]).toBe((origin[1] - original.y) * TUBE_SCALE);
        expect(point.radius).toBe(original.radius * TUBE_SCALE);
        expect(point.distance).toBe(original.distance);
        expect(Number.isFinite(point.center[2])).toBe(true);
      }
      // Rewinding uses the same exact moving endpoint as forward playback.
      const times = [1, .7, .35, .01, 0, .8].map(fraction => fraction * playback.duration);
      for (const time of times) {
        const state = strokeState(playback.strokes[index], time);
        const actual = sampleTube(path, state.written).point, expected = samplePen(pens[index], state.written);
        expect(actual.center[0]).toBeCloseTo((expected.x - origin[0]) * TUBE_SCALE, 8);
        expect(actual.center[1]).toBeCloseTo((origin[1] - expected.y) * TUBE_SCALE, 8);
        expect(actual.radius).toBeCloseTo(expected.radius * TUBE_SCALE, 8);
      }
    }
    expect(JSON.stringify(pens)).toBe(before);
  });
}

test('every cross-section is circular and perpendicular to the local 3D tangent, including a turnback', () => {
  const [path] = createTubePaths([preparePen({ d: 'M0 0C0 200 200 200 200 0L200 -100L200 0', width: 90 })], [0, 0]);
  for (let i = 0; i < path.points.length; i++) {
    const tangent = tubeTangent(path, i);
    expect(Math.hypot(...tangent)).toBeCloseTo(1, 8);
    for (const weight of [.5, 1, 1.5]) {
      const ring = tubeRing(path.points[i], tangent, weight);
      for (const vertex of ring) {
        const radial = subtract(vertex.position, path.points[i].center);
        expect(Math.hypot(...radial)).toBeCloseTo(path.points[i].radius * weight, 8);
        expect(dot(radial, tangent)).toBeCloseTo(0, 8);
        expect(Math.hypot(...vertex.normal)).toBeCloseTo(1, 8);
      }
      expect(ring[0].position[0]).toBeCloseTo(ring[ring.length - 1].position[0], 8);
      expect(ring[0].position[1]).toBeCloseTo(ring[ring.length - 1].position[1], 8);
      expect(ring[0].position[2]).toBeCloseTo(ring[ring.length - 1].position[2], 8);
    }
  }
});

test('separate crossing strokes occupy different planes along their full length, without a local bump', () => {
  const pens = [preparePen({ d: 'M-300 0L300 0', width: 88 }), preparePen({ d: 'M0 -300L0 300', width: 88 })];
  const [first, second] = createTubePaths(pens, [0, 0]);
  expect(sampleTube(first, 300).point.center[2]).toBe(0);
  expect(sampleTube(second, 300).point.center[2]).toBeGreaterThan(.132);
  expect(second.points.every(point => point.center[2] === second.points[0].center[2])).toBe(true);
});

test('a retraced stem separates gradually across the complete stroke instead of rising and falling at the overlap', () => {
  const [returning] = createTubePaths([preparePen({ d: 'M0 0L0 500L0 0', width: 88 })], [0, 0]);
  // 150% weight gives two radii of .066. Inspect a substantial parallel overlap.
  expect(sampleTube(returning, 750).point.center[2] - sampleTube(returning, 250).point.center[2]).toBeGreaterThan(.132);
  const slopes = returning.points.slice(1).map((point, i) => {
    const previous = returning.points[i];
    expect(point.center[2]).toBeGreaterThanOrEqual(previous.center[2]);
    return (point.center[2] - previous.center[2]) / ((point.distance - previous.distance) * TUBE_SCALE);
  });
  expect(Math.max(...slopes.slice(1).map((slope, i) => Math.abs(slope - slopes[i])))).toBeLessThan(.1);
});

test('separate dot cylinders retain the existing delayed, growing dot schedule', () => {
  const playback = createPenPlayback(composeText('jiwon', shaper, catalog).strokes.map(preparePen));
  const dots = playback.strokes.filter(stroke => stroke.dot);
  expect(dots).toHaveLength(2);
  expect(dots[1].start).toBeGreaterThan(dots[0].end);
  for (const stroke of dots) {
    expect(strokeState(stroke, stroke.start).pressure).toBe(0);
    expect(strokeState(stroke, (stroke.start + stroke.end) / 2).pressure).toBeCloseTo(.5, 6);
    expect(strokeState(stroke, stroke.end).pressure).toBe(1);
  }
});

for (const text of ['hello', 'jiwon', 'my name is jiwon', 'tttsss', 'abcdefghijklmnopqrstuvwxyz', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ 0123456789']) {
  test(`depth separates nonlocal returns at 150% weight and has no isolated peaks: ${text}`, () => {
    const pens = composeText(text, shaper, catalog).strokes.map(preparePen);
    const paths = createTubePaths(pens, [0, 0]);
    let group = -1, offset = 0, minimumClearance = Infinity;
    const samples: { center: [number, number, number]; radius: number; distance: number; group: number }[] = [];
    for (const [index, path] of paths.entries()) {
      if (pens[index].retrace || path.length <= .1) continue;
      const previous = paths[index - 1], from = previous?.points[previous.points.length - 1];
      if (from && Math.hypot(...subtract(from.center, path.points[0].center)) < 1e-6) offset += previous.length;
      else { group++; offset = 0; }
      for (let i = 1; i < path.points.length; i++) {
        const a = path.points[i];
        expect(a.center[2]).toBeGreaterThanOrEqual(path.points[i - 1].center[2] - 1e-12);
      }
      for (const a of path.points) {
        for (const b of samples) {
          // Adjacent samples describe one bend. This check concerns two
          // distinct passages through the same area, including stem returns.
          if (group === b.group && a.distance + offset - b.distance < Math.max(a.radius, b.radius) / TUBE_SCALE * 6) continue;
          const separation = Math.hypot(...subtract(a.center, b.center));
          minimumClearance = Math.min(minimumClearance, separation / ((a.radius + b.radius) * 1.5));
        }
        samples.push({ ...a, distance: a.distance + offset, group });
      }
    }
    expect(minimumClearance).toBeGreaterThan(1.02);
  });
}

test('transported rings do not flip as a smooth curve passes through the depth axis', () => {
  const path: TubePath = { length: 480, points: Array.from({ length: 81 }, (_, i) => {
    const angle = (i - 40) / 50;
    return { center: [Math.cos(angle) * .3, 0, Math.sin(angle) * .3], radius: .04, distance: i * 6 };
  }) };
  const [frames] = createTubeFrames([path]);
  for (let i = 1; i < frames.length; i++) {
    expect(dot(frames[i].normal, frames[i - 1].normal)).toBeGreaterThan(.999);
    expect(dot(frames[i].normal, frames[i].tangent)).toBeCloseTo(0, 10);
  }
});

test('a connected stroke boundary shares exactly one ring frame', () => {
  const paths = createTubePaths([
    preparePen({ d: 'M0 0C100 0 200 100 300 100', width: 80 }),
    preparePen({ d: 'M300 100C400 100 500 200 600 200', width: 80 }),
  ], [0, 0]);
  const frames = createTubeFrames(paths), end = frames[0][frames[0].length - 1];
  expect(end).toEqual(frames[1][0]);
  expect(tubeRing(paths[0].points[paths[0].points.length - 1], end.tangent, 1, 24, end.normal))
    .toEqual(tubeRing(paths[1].points[0], frames[1][0].tangent, 1, 24, frames[1][0].normal));
});
