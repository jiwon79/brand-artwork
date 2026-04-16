const PAUSE_THRESHOLD = 0.05;
const RESUME_THRESHOLD = 0.08;
const MAX_DISTANCE = 0.5;
const MAX_RATE = 2.0;

let playing = false;
let playPromise: Promise<void> | null = null;

export function updatePlaybackRate(
  videoEl: HTMLVideoElement,
  distance: number,
  handDetected: boolean,
): number {
  const wantPlay = handDetected && distance >= (playing ? PAUSE_THRESHOLD : RESUME_THRESHOLD);

  if (wantPlay) {
    const rate = Math.min((distance / MAX_DISTANCE) * MAX_RATE, MAX_RATE);
    videoEl.playbackRate = Math.max(0.25, rate);
    videoEl.volume = Math.min(rate, 1.0);

    if (!playing) {
      playing = true;
      playPromise = videoEl.play().catch(() => {});
    }

    return rate;
  }

  if (playing) {
    playing = false;
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
