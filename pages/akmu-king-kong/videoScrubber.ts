import type { AudioPlayer } from './audioPlayer';

const PAUSE_THRESHOLD = 0.05;
const RESUME_THRESHOLD = 0.08;
const MAX_DISTANCE = 0.5;
const MAX_RATE = 2.0;
const HAND_LOST_GRACE_MS = 300;
const DISTANCE_SMOOTH = 0.15;

let playing = false;
let lastHandTime = 0;
let smoothDist = 0;
let audioPlayer: AudioPlayer | null = null;

export function setAudioPlayer(player: AudioPlayer) {
  audioPlayer = player;
}

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

    // Video is muted — rate change is cheap (no audio resampling)
    videoEl.playbackRate = rate;

    // Audio via Web Audio — AudioParam is sample-accurate, no glitch
    audioPlayer?.setRate(rate);
    audioPlayer?.setVolume(Math.min(rate, 1.0));

    if (!playing) {
      playing = true;
      videoEl.play().catch(() => {});
      audioPlayer?.play(videoEl.currentTime, rate);
    }

    return rate;
  }

  if (playing) {
    playing = false;
    smoothDist = 0;
    videoEl.pause();
    audioPlayer?.stop();
  }

  return 0;
}
