const PAUSE_THRESHOLD = 0.05;
const RESUME_THRESHOLD = 0.08;
const MAX_DISTANCE = 0.5;
const MAX_RATE = 2.0;
const HAND_LOST_GRACE_MS = 300;
const RATE_CHANGE_THRESHOLD = 0.1;
const DISTANCE_SMOOTH = 0.15;

let playing = false;
let playPromise: Promise<void> | null = null;
let lastHandTime = 0;
let smoothDist = 0;

export function updatePlaybackRate(
  videoEl: HTMLVideoElement,
  distance: number,
  handDetected: boolean,
): number {
  const now = performance.now();
  if (handDetected) lastHandTime = now;

  // Grace period: keep last distance briefly after hand lost
  const handActive = handDetected || (now - lastHandTime) < HAND_LOST_GRACE_MS;
  const targetDist = handActive ? distance : 0;

  // Smooth distance (EMA)
  smoothDist += (targetDist - smoothDist) * DISTANCE_SMOOTH;

  const wantPlay = smoothDist >= (playing ? PAUSE_THRESHOLD : RESUME_THRESHOLD);

  if (wantPlay) {
    const rate = Math.max(0.25, Math.min((smoothDist / MAX_DISTANCE) * MAX_RATE, MAX_RATE));

    // Only update playbackRate when change is meaningful (prevents audio resampling stutter)
    if (Math.abs(videoEl.playbackRate - rate) > RATE_CHANGE_THRESHOLD) {
      videoEl.playbackRate = rate;
    }
    videoEl.volume = Math.min(rate, 1.0);

    if (!playing) {
      playing = true;
      playPromise = videoEl.play().catch(() => {});
    }

    return rate;
  }

  if (playing) {
    playing = false;
    smoothDist = 0;
    const p = playPromise;
    playPromise = null;
    if (p) {
      p.then(() => { if (!playing) videoEl.pause(); });
    } else {
      videoEl.pause();
    }
  }

  return 0;
}
