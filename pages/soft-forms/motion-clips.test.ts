import { expect, test } from 'vitest';
import { controlChannels, fitControlFrames, sampleControlTracks } from './motion-fit';
import { LOOP_FRAMES, createMotionClips, PREVIOUS_LOOP_FRAMES } from './motion-clips';
import { DeformationRig } from './deformation-rig';
import { restSurface } from './rest-surface';
import { motionFrames } from './motion-data';
import { sampleTrack } from './motion-track';
import { variants } from './variants';

const fitted = fitControlFrames(motionFrames.map((frame) => frame.radii));
const { clips, timeMaps } = createMotionClips(fitted);
const period = LOOP_FRAMES;

test('each shape has its own valid pose curves with continuous loop positions and velocities', () => {
  for (const { id } of variants) {
    for (const control of clips[id]) for (const channel of controlChannels) {
      const track = control[channel], epsilon = 0.0001;
      const at = sampleTrack(track, 0, period);
      expect(sampleTrack(track, period, period)).toBe(at);
      const before = (at - sampleTrack(track, period - epsilon, period)) / epsilon;
      const after = (sampleTrack(track, epsilon, period) - at) / epsilon;
      expect(Math.abs(before - after)).toBeLessThan(0.001);
    }
  }
  const signatures = variants.map(({ id }) => JSON.stringify(sampleControlTracks(clips[id], 24, period)));
  expect(new Set(signatures).size).toBe(5);
});

test('original retains the forward flutter and returns along a new trajectory', () => {
  for (const frame of [24, 60, 84]) {
    const actual = sampleControlTracks(clips.original, frame, period);
    actual.forEach((control, index) => {
      expect(control.dx).toBeCloseTo(fitted[frame][index].dx, 5);
      expect(control.dy).toBeCloseTo(fitted[frame][index].dy, 5);
    });
  }
  const returning = sampleControlTracks(clips.original, 120, period);
  const replay = fitted[58];
  const distance = Math.sqrt(returning.reduce((sum, control, index) => sum
    + (control.dx - replay[index].dx) ** 2 + (control.dy - replay[index].dy) ** 2, 0) / returning.length);
  expect(distance).toBeGreaterThan(8);
});

test('strong flutter preserves surface orientation throughout every variant loop', () => {
  const baseline = motionFrames[0].radii.map((_, index) =>
    motionFrames.reduce((sum, frame) => sum + frame.radii[index], 0) / motionFrames.length);
  const rest = new Float32Array(3), output = new Float32Array(9), epsilon = 0.25;
  for (const { id } of variants) {
    if (id === 'original') continue;
    const rig = new DeformationRig(id);
    const points = Array.from({ length: 6 * 32 }, (_, index) => {
      const radius = Math.floor(index / 32) / 5, angle = index % 32 / 32 * Math.PI * 2;
      restSurface(id, radius * Math.cos(angle), radius * Math.sin(angle), 0, baseline, rest);
      const x = rest[0], y = rest[1];
      return { x, y, weights: [rig.weightsFor(x, y), rig.weightsFor(x + epsilon, y), rig.weightsFor(x, y + epsilon)] };
    });
    let minimum = Infinity;
    for (let frame = 0; frame < period; frame += 2) {
      rig.setPose(sampleControlTracks(clips[id], frame, period));
      for (const { x, y, weights } of points) {
        rig.skinPoint(x, y, 0, weights[0], output, 0);
        rig.skinPoint(x + epsilon, y, 0, weights[1], output, 3);
        rig.skinPoint(x, y + epsilon, 0, weights[2], output, 6);
        const determinant = ((output[3] - output[0]) * (output[7] - output[1])
          - (output[6] - output[0]) * (output[4] - output[1])) / (epsilon * epsilon);
        minimum = Math.min(minimum, determinant);
      }
    }
    expect(minimum, `${id} surface folds or collapses`).toBeGreaterThan(0.08);
  }
});

test('six-second time maps keep the first original flutter intact and compress quieter frames', () => {
  expect(period / 24).toBe(6);
  expect(timeMaps.original.oldAtNew(60)).toBeCloseTo(60);
  expect(timeMaps.original.oldAtNew(96)).toBeCloseTo(119);
  for (const { id } of variants) {
    const map = timeMaps[id];
    expect(map.oldAtNew(period)).toBe(PREVIOUS_LOOP_FRAMES);
    expect(map.newAtOld(PREVIOUS_LOOP_FRAMES)).toBe(period);
    const durations = Array.from({ length: PREVIOUS_LOOP_FRAMES }, (_, frame) =>
      map.newAtOld(frame + 1) - map.newAtOld(frame));
    expect(Math.min(...durations)).toBeLessThan(0.7);
    expect(durations.every((duration) => duration > 0 && duration <= 1.01)).toBe(true);
  }
});
