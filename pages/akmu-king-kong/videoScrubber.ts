import type { AudioPlayer } from './audioPlayer';

const PAUSE_THRESHOLD = 0.05;
const RESUME_THRESHOLD = 0.08;
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
    if (!playing) {
      playing = true;
      videoEl.playbackRate = 1;
      videoEl.play().catch(() => {});
      audioPlayer?.play(videoEl.currentTime, 1);
    }
    return 1;
  }

  if (playing) {
    playing = false;
    smoothDist = 0;
    videoEl.pause();
    audioPlayer?.stop();
  }

  return 0;
}
