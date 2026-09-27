import { expect, test } from 'vitest';
import { boneChannels, fitBoneFrames, fittedBoneTracks, parseBoneTracks, sampleBoneTracks, setBoneKey } from './bone-animation';
import { BONE_LOOP_FRAMES, createBoneClips, migrateOriginalEdits } from './bone-motion';
import { motionFrames } from './motion-data';
import { sampleTrack } from './motion-editor';
import { variants } from './variants';

const fitted = fitBoneFrames(motionFrames.map((frame) => frame.radii));
const clips = createBoneClips(fitted);
const period = BONE_LOOP_FRAMES;

test('each shape has its own valid pose curves with continuous loop positions and velocities', () => {
  for (const { id } of variants) {
    const preset = { version: 3, shape: id, period, bones: clips[id] };
    expect(parseBoneTracks(preset, period, id)).toEqual(clips[id]);
    expect(parseBoneTracks(preset, period, id === 'bean' ? 'star' : 'bean')).toBeNull();
    for (const bone of clips[id]) for (const channel of boneChannels) {
      const track = bone[channel], epsilon = 0.0001;
      const at = sampleTrack(track, 0, period);
      expect(sampleTrack(track, period, period)).toBe(at);
      const before = (at - sampleTrack(track, period - epsilon, period)) / epsilon;
      const after = (sampleTrack(track, epsilon, period) - at) / epsilon;
      expect(Math.abs(before - after)).toBeLessThan(0.001);
    }
  }
  const signatures = variants.map(({ id }) => JSON.stringify(sampleBoneTracks(clips[id], 24, period)));
  expect(new Set(signatures).size).toBe(5);
});

test('original retains the forward flutter and returns along a new trajectory', () => {
  for (const frame of [24, 60, 96]) {
    const actual = sampleBoneTracks(clips.original, frame, period);
    actual.forEach((bone, index) => {
      expect(bone.dx).toBeCloseTo(fitted[frame][index].dx, 5);
      expect(bone.dy).toBeCloseTo(fitted[frame][index].dy, 5);
    });
  }
  const returning = sampleBoneTracks(clips.original, 150, period);
  const replay = fitted[58];
  const distance = Math.sqrt(returning.reduce((sum, bone, index) => sum
    + (bone.dx - replay[index].dx) ** 2 + (bone.dy - replay[index].dy) ** 2, 0) / returning.length);
  expect(distance).toBeGreaterThan(8);
});

test('migration preserves edited offsets and leaves the old bone preset untouched', () => {
  const previous = fittedBoneTracks(fitted);
  const oldValue = previous[2].dy.find((key) => key.frame === 24)!.value;
  setBoneKey(previous, 2, 'dy', 24, oldValue + 12, 238);
  previous[3].dx = previous[3].dx.filter((key) => key.frame !== 42);
  const before = structuredClone(previous);
  const migrated = migrateOriginalEdits(previous, fitted, clips.original);
  expect(sampleTrack(migrated[2].dy, 24, period)
    - sampleTrack(clips.original[2].dy, 24, period)).toBeCloseTo(12);
  const oldDefaults = fittedBoneTracks(fitted);
  expect(sampleTrack(migrated[3].dx, 42, period) - sampleTrack(clips.original[3].dx, 42, period))
    .toBeCloseTo(sampleTrack(previous[3].dx, 42, 238) - sampleTrack(oldDefaults[3].dx, 42, 238));
  expect(previous).toEqual(before);
  expect(migrated[1]).toEqual(clips.original[1]);
});
