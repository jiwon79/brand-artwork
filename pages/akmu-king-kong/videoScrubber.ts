const PAUSE_THRESHOLD = 0.05;
const MAX_DISTANCE = 0.5;
const MAX_RATE = 2.0;

export function updatePlaybackRate(
  videoEl: HTMLVideoElement,
  distance: number,
  handsDetected: boolean,
): number {
  if (!handsDetected || distance < PAUSE_THRESHOLD) {
    if (!videoEl.paused) videoEl.pause();
    return 0;
  }

  const rate = Math.min((distance / MAX_DISTANCE) * MAX_RATE, MAX_RATE);

  videoEl.playbackRate = Math.max(0.0625, rate);
  if (videoEl.paused) videoEl.play();

  return rate;
}
