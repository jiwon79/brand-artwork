import { expect, test } from 'vitest';
import { boneChannels, fitBoneFrames, fittedBoneTracks, parseBoneTracks, sampleBoneTracks, setBoneKey } from './bone-animation';
import { BONE_LOOP_FRAMES, createBoneMotion, legacyVariantClip, migrateOriginalEdits, retimeBoneEdits, upgradeVariantEdits, PREVIOUS_BONE_LOOP_FRAMES, VARIANT_MOTION_REVISION } from './bone-motion';
import { BoneRig } from './bone-rig';
import { restSurface } from './bone-surface';
import { motionFrames } from './motion-data';
import { sampleTrack } from './motion-editor';
import { variants } from './variants';

const fitted = fitBoneFrames(motionFrames.map((frame) => frame.radii));
const { clips, previousClips, timeMaps } = createBoneMotion(fitted);
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
  for (const frame of [24, 60, 84]) {
    const actual = sampleBoneTracks(clips.original, frame, period);
    actual.forEach((bone, index) => {
      expect(bone.dx).toBeCloseTo(fitted[frame][index].dx, 5);
      expect(bone.dy).toBeCloseTo(fitted[frame][index].dy, 5);
    });
  }
  const returning = sampleBoneTracks(clips.original, 120, period);
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
  const intermediate = migrateOriginalEdits(previous, fitted, previousClips.original);
  const migrated = retimeBoneEdits(intermediate, previousClips.original, clips.original, timeMaps.original);
  expect(sampleTrack(migrated[2].dy, 24, period)
    - sampleTrack(clips.original[2].dy, 24, period)).toBeCloseTo(12);
  const oldDefaults = fittedBoneTracks(fitted);
  expect(sampleTrack(migrated[3].dx, 42, period) - sampleTrack(clips.original[3].dx, 42, period))
    .toBeCloseTo(sampleTrack(previous[3].dx, 42, 238) - sampleTrack(oldDefaults[3].dx, 42, 238));
  expect(previous).toEqual(before);
  expect(migrated[1]).toEqual(clips.original[1]);
});

test('strong flutter preserves surface orientation throughout every variant loop', () => {
  const baseline = motionFrames[0].radii.map((_, index) =>
    motionFrames.reduce((sum, frame) => sum + frame.radii[index], 0) / motionFrames.length);
  const rest = new Float32Array(3), output = new Float32Array(9), epsilon = 0.25;
  for (const { id } of variants) {
    if (id === 'original') continue;
    const rig = new BoneRig(id);
    const points = Array.from({ length: 6 * 32 }, (_, index) => {
      const radius = Math.floor(index / 32) / 5, angle = index % 32 / 32 * Math.PI * 2;
      restSurface(id, radius * Math.cos(angle), radius * Math.sin(angle), 0, baseline, rest);
      const x = rest[0], y = rest[1];
      return { x, y, weights: [rig.weightsFor(x, y), rig.weightsFor(x + epsilon, y), rig.weightsFor(x, y + epsilon)] };
    });
    let minimum = Infinity;
    for (let frame = 0; frame < period; frame += 2) {
      rig.setPose(sampleBoneTracks(clips[id], frame, period));
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

test('variant upgrade replaces saved defaults while retaining authored offsets and deleted keys', () => {
  for (const shape of ['bean', 'flower', 'star', 'wave'] as const) {
    const previous = legacyVariantClip(shape);
    expect(upgradeVariantEdits(previous, shape, previousClips[shape])).toEqual(previousClips[shape]);
    setBoneKey(previous, 2, 'dy', 24, sampleTrack(previous[2].dy, 24, PREVIOUS_BONE_LOOP_FRAMES) + 8, PREVIOUS_BONE_LOOP_FRAMES);
    previous[3].dx = previous[3].dx.filter((key) => key.frame !== 42);
    const before = structuredClone(previous), legacy = legacyVariantClip(shape);
    const upgraded = upgradeVariantEdits(previous, shape, previousClips[shape]);
    expect(sampleTrack(upgraded[2].dy, 24, PREVIOUS_BONE_LOOP_FRAMES)
      - sampleTrack(previousClips[shape][2].dy, 24, PREVIOUS_BONE_LOOP_FRAMES)).toBeCloseTo(8);
    expect(sampleTrack(upgraded[3].dx, 42, PREVIOUS_BONE_LOOP_FRAMES)
      - sampleTrack(previousClips[shape][3].dx, 42, PREVIOUS_BONE_LOOP_FRAMES))
      .toBeCloseTo(sampleTrack(previous[3].dx, 42, PREVIOUS_BONE_LOOP_FRAMES)
        - sampleTrack(legacy[3].dx, 42, PREVIOUS_BONE_LOOP_FRAMES));
    const retimed = retimeBoneEdits(upgraded, previousClips[shape], clips[shape], timeMaps[shape]);
    const editedAt = Math.round(timeMaps[shape].newAtOld(24));
    expect(sampleTrack(retimed[2].dy, editedAt, period)
      - sampleTrack(clips[shape][2].dy, editedAt, period)).toBeCloseTo(8);
    expect(previous).toEqual(before);
    expect(upgradeVariantEdits(upgraded, shape, previousClips[shape], VARIANT_MOTION_REVISION)).toEqual(upgraded);
  }
  expect(upgradeVariantEdits(clips.original, 'original', clips.original)).toBe(clips.original);
});

test('six-second time maps keep the first original flutter intact and compress quieter frames', () => {
  expect(period / 24).toBe(6);
  expect(timeMaps.original.oldAtNew(60)).toBeCloseTo(60);
  expect(timeMaps.original.oldAtNew(96)).toBeCloseTo(119);
  for (const { id } of variants) {
    const map = timeMaps[id];
    expect(map.oldAtNew(period)).toBe(PREVIOUS_BONE_LOOP_FRAMES);
    expect(map.newAtOld(PREVIOUS_BONE_LOOP_FRAMES)).toBe(period);
    const durations = Array.from({ length: PREVIOUS_BONE_LOOP_FRAMES }, (_, frame) =>
      map.newAtOld(frame + 1) - map.newAtOld(frame));
    expect(Math.min(...durations)).toBeLessThan(0.7);
    expect(durations.every((duration) => duration > 0 && duration <= 1.01)).toBe(true);
  }
});

test('existing 180-frame bone edits keep their offsets after shortening the loop', () => {
  for (const { id } of variants) {
    const saved = structuredClone(previousClips[id]);
    const oldFrame = 60, bone = 2, offset = 9;
    setBoneKey(saved, bone, 'dy', oldFrame,
      sampleTrack(saved[bone].dy, oldFrame, PREVIOUS_BONE_LOOP_FRAMES) + offset,
      PREVIOUS_BONE_LOOP_FRAMES);
    const oldSnapshot = structuredClone(saved);
    const migrated = retimeBoneEdits(saved, previousClips[id], clips[id], timeMaps[id]);
    const frame = Math.round(timeMaps[id].newAtOld(oldFrame));
    expect(sampleTrack(migrated[bone].dy, frame, period)
      - sampleTrack(clips[id][bone].dy, frame, period)).toBeCloseTo(offset);
    expect(migrated[bone].dy[migrated[bone].dy.length - 1]?.frame).toBe(period);
    expect(saved).toEqual(oldSnapshot);
  }
});
