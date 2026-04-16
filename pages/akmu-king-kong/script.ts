import { initCamera } from './camera';
import { initHandTracker, drawHandLandmarks, drawPinchLine } from './handTracker';
import type { HandResults, Landmark } from './handTracker';
import { OneEuroFilter } from './oneEuroFilter';
import { computePinchDistance } from './distanceDetector';
import { updatePlaybackRate } from './videoScrubber';
import { updateUI } from './ui';

// DOM
const startOverlay = document.getElementById('start-overlay')!;
const startBtn = document.getElementById('start-btn')!;
const webcamVideo = document.getElementById('webcam-video') as HTMLVideoElement;
const overlayCanvas = document.getElementById('overlay-canvas') as HTMLCanvasElement;
const playbackVideo = document.getElementById('playback-video') as HTMLVideoElement;
const errorMsg = document.getElementById('error-msg')!;

const ctx = overlayCanvas.getContext('2d')!;

// ── Landmark smoothing (One Euro Filter per landmark × x,y) ──

const LANDMARK_COUNT = 21;
const landmarkFilters = Array.from({ length: LANDMARK_COUNT }, () => ({
  x: new OneEuroFilter(0.7, 0.01, 1.0),
  y: new OneEuroFilter(0.7, 0.01, 1.0),
}));

function smoothLandmarks(raw: Landmark[], ts: number): Landmark[] {
  return raw.map((l, i) => ({
    x: landmarkFilters[i].x.filter(l.x, ts),
    y: landmarkFilters[i].y.filter(l.y, ts),
    z: l.z,
  }));
}

function resetFilters() {
  for (const f of landmarkFilters) {
    f.x.reset();
    f.y.reset();
  }
}

// ── Start button ──

startBtn.addEventListener('click', startApp);

async function startApp() {
  startOverlay.style.display = 'none';

  const { sendFrame } = initHandTracker(onResults);

  try {
    await initCamera(webcamVideo);
  } catch (err: any) {
    errorMsg.textContent = err.message;
    errorMsg.style.display = 'block';
    return;
  }

  async function loop() {
    try {
      await sendFrame(webcamVideo);
    } catch {
      // silent fail
    }
    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);
}

// ── Rendering helpers ──

function computeContainFit(
  canvasW: number,
  canvasH: number,
  videoW: number,
  videoH: number,
) {
  const vAspect = videoW / videoH;
  const cAspect = canvasW / canvasH;

  if (vAspect > cAspect) {
    const dw = canvasW;
    const dh = canvasW / vAspect;
    return { dx: 0, dy: (canvasH - dh) / 2, dw, dh };
  }
  const dh = canvasH;
  const dw = canvasH * vAspect;
  return { dx: (canvasW - dw) / 2, dy: 0, dw, dh };
}

function transformLandmarks(
  landmarks: Landmark[],
  dx: number,
  dy: number,
  dw: number,
  dh: number,
  cw: number,
  ch: number,
): Landmark[] {
  return landmarks.map((l) => ({
    x: (dx + l.x * dw) / cw,
    y: (dy + l.y * dh) / ch,
    z: l.z,
  }));
}

// ── Hand tracking results ──

function onResults(results: HandResults) {
  const multiLandmarks = results.multiHandLandmarks;

  const cw = overlayCanvas.clientWidth;
  const ch = overlayCanvas.clientHeight;
  overlayCanvas.width = cw;
  overlayCanvas.height = ch;

  const vw = webcamVideo.videoWidth || 640;
  const vh = webcamVideo.videoHeight || 480;

  const { dx, dy, dw, dh } = computeContainFit(cw, ch, vw, vh);

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, cw, ch);
  ctx.drawImage(webcamVideo, dx, dy, dw, dh);

  const rawLandmarks = multiLandmarks?.[0] ?? null;

  // Smooth landmarks (reset filters when hand lost)
  let landmarks: Landmark[] | null = null;
  if (rawLandmarks) {
    const ts = performance.now() / 1000;
    landmarks = smoothLandmarks(rawLandmarks, ts);
  } else {
    resetFilters();
  }

  if (landmarks) {
    const transformed = transformLandmarks(landmarks, dx, dy, dw, dh, cw, ch);
    drawHandLandmarks(ctx, transformed);
    drawPinchLine(ctx, transformed);
  }

  const { distance, handDetected } = computePinchDistance(landmarks);
  const rate = updatePlaybackRate(playbackVideo, distance, handDetected);

  updateUI({
    distance,
    rate,
    currentTime: playbackVideo.currentTime,
    duration: playbackVideo.duration || 0,
    handDetected,
  });
}
