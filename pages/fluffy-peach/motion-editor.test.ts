import { expect, test } from 'vitest';
import {
  defaultTracks, deleteKeyframe, motionPeriod, moveKeyframe,
  parseMotionPreset, sampleTrack, setKeyframe,
} from './motion-editor';

test('edited motion passes smoothly through keys and rejoins at the loop seam', () => {
  const period = motionPeriod(120);
  const tracks = defaultTracks(period);
  setKeyframe(tracks, 'response', 60, 1.8, period);
  setKeyframe(tracks, 'response', 160, 0.7, period);
  expect(sampleTrack(tracks.response, 60, period)).toBeCloseTo(1.8);
  expect(sampleTrack(tracks.response, 160, period)).toBeCloseTo(0.7);
  const incoming = (1 - sampleTrack(tracks.response, period - 0.001, period)) / 0.001;
  const outgoing = (sampleTrack(tracks.response, 0.001, period) - 1) / 0.001;
  expect(incoming).toBeCloseTo(outgoing, 5);
  setKeyframe(tracks, 'response', 0, 1.2, period);
  expect(tracks.response[tracks.response.length - 1].value).toBe(1.2);
  expect(sampleTrack(tracks.response, period, period)).toBe(1.2);
});

test('keyframes move, delete, and load only for their matching shape and loop', () => {
  const period = motionPeriod(120);
  const tracks = defaultTracks(period);
  setKeyframe(tracks, 'lift', 60, 25, period);
  expect(moveKeyframe(tracks, 'lift', 60, 80, period)).toBe(80);
  expect(tracks.lift.map((key) => key.frame)).toEqual([0, 80, period]);
  const preset = { version: 1, shape: 'star', period, tracks };
  expect(parseMotionPreset(preset, 'star', period)?.lift[1]).toEqual({ frame: 80, value: 25 });
  expect(parseMotionPreset(preset, 'bean', period)).toBeNull();
  expect(parseMotionPreset({ ...preset, tracks: { ...tracks, lift: [{ frame: 0, value: 0 }, { frame: period, value: 25 }] } }, 'star', period)).toBeNull();
  deleteKeyframe(tracks, 'lift', 80, period);
  expect(tracks.lift.map((key) => key.frame)).toEqual([0, period]);
});
