import { initCamera } from './camera';
import { initHandTracker, drawHandLandmarks } from './handTracker';
import type { HandResults } from './handTracker';
import { createRotationDetector } from './rotationDetector';
import { scrubVideo } from './videoScrubber';
import { updateUI } from './ui';

// DOM elements
const uploadZone = document.getElementById('upload-zone')!;
const mainArea = document.getElementById('main-area')!;
const fileInput = document.getElementById('file-input') as HTMLInputElement;
const webcamVideo = document.getElementById('webcam-video') as HTMLVideoElement;
const overlayCanvas = document.getElementById('overlay-canvas') as HTMLCanvasElement;
const playbackVideo = document.getElementById('playback-video') as HTMLVideoElement;
const errorMsg = document.getElementById('error-msg')!;

const overlayCtx = overlayCanvas.getContext('2d')!;
const rotationDetector = createRotationDetector();

// ── Upload handling ──

uploadZone.addEventListener('click', () => fileInput.click());

uploadZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  uploadZone.classList.add('dragover');
});

uploadZone.addEventListener('dragleave', () => {
  uploadZone.classList.remove('dragover');
});

uploadZone.addEventListener('drop', (e) => {
  e.preventDefault();
  uploadZone.classList.remove('dragover');
  const file = e.dataTransfer?.files[0];
  if (file && file.type.startsWith('video/')) {
    loadVideo(file);
  }
});

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (file) loadVideo(file);
});

// ── Video loading ──

function loadVideo(file: File) {
  const url = URL.createObjectURL(file);
  playbackVideo.src = url;

  playbackVideo.addEventListener(
    'loadeddata',
    () => {
      // Force first frame to render
      playbackVideo.currentTime = 0;
      startApp();
    },
    { once: true },
  );

  playbackVideo.addEventListener(
    'error',
    () => showError('지원하지 않는 영상 형식입니다'),
    { once: true },
  );
}

function showError(msg: string) {
  errorMsg.textContent = msg;
  errorMsg.style.display = 'block';
}

// ── App start ──

async function startApp() {
  uploadZone.style.display = 'none';
  mainArea.style.display = 'flex';

  const { sendFrame } = initHandTracker(onResults);

  try {
    await initCamera(webcamVideo);
  } catch (err: any) {
    showError(err.message);
  }

  async function loop() {
    try {
      await sendFrame(webcamVideo);
    } catch {
      // silent fail — frame drop allowed
    }
    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);
}

// ── Hand tracking results ──

function onResults(results: HandResults) {
  const landmarks = results.multiHandLandmarks?.[0] ?? null;
  const handDetected = !!landmarks;

  // Sync canvas size to webcam resolution
  overlayCanvas.width = webcamVideo.videoWidth || 640;
  overlayCanvas.height = webcamVideo.videoHeight || 480;

  // Draw webcam frame directly on canvas for pixel-perfect landmark alignment
  overlayCtx.drawImage(webcamVideo, 0, 0, overlayCanvas.width, overlayCanvas.height);

  if (landmarks) {
    drawHandLandmarks(overlayCtx, landmarks);
  }

  // Rotation
  const { accumulated, angle } = rotationDetector.update(landmarks);

  // Scrub
  const currentTime = scrubVideo(playbackVideo, accumulated) ?? 0;

  // UI
  updateUI({
    angle,
    accumulated,
    currentTime,
    duration: playbackVideo.duration || 0,
    handDetected,
  });
}
