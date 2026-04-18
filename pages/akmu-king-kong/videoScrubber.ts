const PAUSE_THRESHOLD = 0.1;
const RESUME_THRESHOLD = 0.15;
const MAX_DISTANCE = 0.8;
const MAX_RATE = 2.0;
const HAND_LOST_GRACE_MS = 300;
const DISTANCE_SMOOTH = 0.15;

let playing = false;
let lastHandTime = 0;
let smoothDist = 0;

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

    videoEl.playbackRate = rate;

    if (!playing) {
      playing = true;
      videoEl.play().catch(() => {});
    }

    return rate;
  }

  if (playing) {
    playing = false;
    smoothDist = 0;
    videoEl.pause();
  }

  return 0;
}
