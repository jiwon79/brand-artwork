const PAUSE_THRESHOLD = 0.25;
const RESUME_THRESHOLD = 0.35;
const MAX_DISTANCE = 0.8;
const MAX_RATE = 2.0;
const HAND_LOST_GRACE_MS = 300;
const DISTANCE_SMOOTH = 0.15;
const RATE_UPDATE_INTERVAL_MS = 200;

let playing = false;
let lastHandTime = 0;
let lastRateUpdate = 0;
let smoothDist = 0;
let appliedRate = 0;

export function updatePlaybackRate(
  videoEl: HTMLVideoElement,
  distance: number,
  handDetected: boolean,
): number {
  const now = performance.now();
  if (handDetected) lastHandTime = now;

  const handActive = handDetected || (now - lastHandTime) < HAND_LOST_GRACE_MS;
  const targetDist = handActive ? distance : 0;
  smoothDist += (targetDist - smoothDist) * DISTANCE_SMOOTH;

  const wantPlay = smoothDist >= (playing ? PAUSE_THRESHOLD : RESUME_THRESHOLD);

  if (wantPlay) {
    const rate = Math.max(0.25, Math.min((smoothDist / MAX_DISTANCE) * MAX_RATE, MAX_RATE));

    if (!playing) {
      playing = true;
      appliedRate = rate;
      videoEl.playbackRate = rate;
      lastRateUpdate = now;
      videoEl.play().catch(() => {});
    } else if (now - lastRateUpdate >= RATE_UPDATE_INTERVAL_MS) {
      appliedRate = rate;
      videoEl.playbackRate = rate;
      lastRateUpdate = now;
    }

    return appliedRate;
  }

  if (playing) {
    playing = false;
    smoothDist = 0;
    appliedRate = 0;
    videoEl.pause();
  }

  return 0;
}
