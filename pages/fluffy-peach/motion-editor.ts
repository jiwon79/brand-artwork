import type { VariantId } from './variants';

export const MOTION_FPS = 24;
export const EDITOR_STORAGE_KEY = 'fluffy-peach.motion-editor.v1';

export type TrackId = 'response' | 'sway' | 'lift' | 'tilt';
export type Keyframe = { frame: number; value: number };
export type MotionTracks = Record<TrackId, Keyframe[]>;
export type MotionPreset = { version: 1; shape: VariantId; period: number; tracks: MotionTracks };

export const trackSpecs: Record<TrackId, {
  label: string; min: number; max: number; step: number; initial: number; unit: string;
}> = {
  response: { label: '형태 반응', min: 0, max: 2, step: 0.05, initial: 1, unit: '×' },
  sway: { label: '좌우 이동', min: -80, max: 80, step: 1, initial: 0, unit: 'px' },
  lift: { label: '높이', min: -80, max: 80, step: 1, initial: 0, unit: 'px' },
  tilt: { label: '기울기', min: -30, max: 30, step: 1, initial: 0, unit: '°' },
};

export const trackIds = Object.keys(trackSpecs) as TrackId[];

export function motionPeriod(frameCount: number) {
  return Math.max(2, (frameCount - 1) * 2);
}

export function defaultTracks(period: number): MotionTracks {
  return Object.fromEntries(trackIds.map((id) => [id, [
    { frame: 0, value: trackSpecs[id].initial },
    { frame: period, value: trackSpecs[id].initial },
  ]])) as MotionTracks;
}

function clampValue(id: TrackId, value: number) {
  const spec = trackSpecs[id];
  return Math.min(spec.max, Math.max(spec.min, value));
}

export function setKeyframe(tracks: MotionTracks, id: TrackId, frame: number, value: number, period: number) {
  const keyFrame = Math.min(period, Math.max(0, Math.round(frame)));
  const keyValue = clampValue(id, value);
  const keys = tracks[id];
  if (keyFrame === 0 || keyFrame === period) {
    keys[0].value = keyValue;
    keys[keys.length - 1].value = keyValue;
    return;
  }
  const existing = keys.find((key) => key.frame === keyFrame);
  if (existing) existing.value = keyValue;
  else keys.push({ frame: keyFrame, value: keyValue });
  keys.sort((a, b) => a.frame - b.frame);
}

export function deleteKeyframe(tracks: MotionTracks, id: TrackId, frame: number, period: number) {
  if (frame <= 0 || frame >= period) return;
  tracks[id] = tracks[id].filter((key) => key.frame !== frame);
}

export function moveKeyframe(tracks: MotionTracks, id: TrackId, from: number, to: number, period: number) {
  if (from <= 0 || from >= period) return from;
  const key = tracks[id].find((candidate) => candidate.frame === from);
  if (!key) return from;
  const next = Math.min(period - 1, Math.max(1, Math.round(to)));
  if (next === from) return from;
  deleteKeyframe(tracks, id, from, period);
  setKeyframe(tracks, id, next, key.value, period);
  return next;
}

// Shape-preserving Hermite interpolation passes smoothly through authored keys.
function tangent(keys: readonly Keyframe[], index: number) {
  if (index === 0 || index === keys.length - 1) return 0;
  const before = (keys[index].value - keys[index - 1].value) / (keys[index].frame - keys[index - 1].frame);
  const after = (keys[index + 1].value - keys[index].value) / (keys[index + 1].frame - keys[index].frame);
  if (before * after <= 0) return 0;
  return 2 * before * after / (before + after);
}

export function sampleTrack(keys: readonly Keyframe[], frame: number, period: number) {
  const position = ((frame % period) + period) % period;
  let left = 0;
  while (left < keys.length - 2 && position > keys[left + 1].frame) left++;
  const first = keys[left], second = keys[left + 1];
  const duration = second.frame - first.frame;
  const t = (position - first.frame) / duration;
  const t2 = t * t, t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * first.value
    + (t3 - 2 * t2 + t) * duration * tangent(keys, left)
    + (-2 * t3 + 3 * t2) * second.value
    + (t3 - t2) * duration * tangent(keys, left + 1);
}

export function parseMotionPreset(input: unknown, shape: VariantId, period: number): MotionTracks | null {
  if (!input || typeof input !== 'object') return null;
  const preset = input as Partial<MotionPreset>;
  if (preset.version !== 1 || preset.shape !== shape || preset.period !== period || !preset.tracks) return null;
  const result = defaultTracks(period);
  for (const id of trackIds) {
    const keys = preset.tracks[id];
    if (!Array.isArray(keys) || keys.length < 2 || keys.length > period + 1) return null;
    if (keys[0]?.frame !== 0 || keys[keys.length - 1]?.frame !== period) return null;
    if (keys[0].value !== keys[keys.length - 1].value) return null;
    let previous = -1;
    for (const key of keys) {
      if (!key || !Number.isInteger(key.frame) || key.frame <= previous || key.frame > period
        || !Number.isFinite(key.value) || key.value < trackSpecs[id].min || key.value > trackSpecs[id].max) return null;
      previous = key.frame;
    }
    result[id] = keys.map((key) => ({ frame: key.frame, value: key.value }));
  }
  return result;
}
