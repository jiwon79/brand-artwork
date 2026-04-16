const TURNS_FOR_FULL_PLAYBACK = 3;

function accumulatedToTime(accumulated: number, duration: number): number {
  const t = (accumulated / (360 * TURNS_FOR_FULL_PLAYBACK)) * duration;
  return Math.max(0, Math.min(duration, t));
}

export function scrubVideo(
  videoEl: HTMLVideoElement,
  accumulatedDeg: number,
): number | null {
  const duration = videoEl.duration;
  if (!duration || isNaN(duration)) return null;

  const targetTime = accumulatedToTime(accumulatedDeg, duration);
  videoEl.currentTime = targetTime;
  return targetTime;
}
