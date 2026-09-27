export const MOTION_FPS = 24;
export const DEFAULT_PLAYBACK_SPEED = 1;
export type Keyframe = { frame: number; value: number };

export function motionPeriod(frameCount: number) {
  return Math.max(2, (frameCount - 1) * 2);
}

// Shape-preserving Hermite interpolation passes smoothly through authored keys.
function tangent(keys: readonly Keyframe[], index: number) {
  if (index === 0 || index === keys.length - 1) {
    if (keys.length < 3) return 0;
    const last = keys[keys.length - 1], previous = keys[keys.length - 2];
    const before = (last.value - previous.value) / (last.frame - previous.frame);
    const after = (keys[1].value - keys[0].value) / (keys[1].frame - keys[0].frame);
    return before * after <= 0 ? 0 : 2 * before * after / (before + after);
  }
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

