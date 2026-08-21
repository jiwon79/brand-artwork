import { ArtworkRenderer } from './artwork-renderer';
import { settings } from './config';
import { DragDissolve } from './drag-dissolve';
import { buildSolidPoints, loadLineAssets } from './geometry';
import { createTuningGui } from './gui';
import { InteractionController } from './interaction-controller';
import { clamp } from './math';
import { BodyEchoRuntime } from './runtime';
import type { DebugApi } from './types';

// Composition root: create surfaces, wire modules, load assets, and run frames.
const canvas = document.getElementById('artwork') as HTMLCanvasElement;
const loading = document.getElementById('loading') as HTMLDivElement;
const loadingLabel = document.getElementById('loading-label') as HTMLSpanElement;
const loadingDescription = document.getElementById('loading-description') as HTMLSpanElement;
const loadingProgress = document.getElementById('loading-progress') as HTMLDivElement;
const loadingStageItems = Array.from(
  document.querySelectorAll<HTMLElement>('[data-loading-stage]'),
);
const error = document.getElementById('error') as HTMLDivElement;
const screenCtx = canvas.getContext('2d', { alpha: false });
if (!screenCtx) throw new Error('2D canvas is not supported.');

const artworkCanvas = document.createElement('canvas');
const artworkCtx = artworkCanvas.getContext('2d');
if (!artworkCtx) throw new Error('Offscreen 2D canvas is not supported.');

const runtime = new BodyEchoRuntime();
const drag = new DragDissolve(runtime, canvas, artworkCtx);
const renderer = new ArtworkRenderer(
  runtime,
  drag,
  screenCtx,
  artworkCanvas,
  artworkCtx,
);
const tuningGui = createTuningGui();
const interaction = new InteractionController(runtime, drag, canvas, tuningGui);
let animationFrame = 0;
let isFirstFrame = true;
let displayedLoadingProgress = 0;
let targetLoadingProgress = 0;
let loadingProgressTimer: number | undefined;
let resolveLoadingProgress: () => void;
const loadingStages = [
  { label: '01 · LINE', description: 'SVG의 선 구조를 준비합니다' },
  { label: '02 · CHROMATIC', description: 'RGB 채널에 간격을 만듭니다' },
  { label: '03 · WAVE', description: '접촉점에서 파동을 확장합니다' },
  { label: '04 · DISSOLVE', description: '파동이 지난 선을 입자로 분해합니다' },
] as const;
const loadingProgressComplete = new Promise<void>((resolve) => {
  resolveLoadingProgress = resolve;
});

function advanceLoadingProgress(): void {
  loadingProgressTimer = undefined;
  if (displayedLoadingProgress >= targetLoadingProgress) return;

  displayedLoadingProgress += 1;
  const stage = loadingStages[displayedLoadingProgress - 1];
  loading.dataset.stage = String(displayedLoadingProgress);
  loadingLabel.textContent = stage.label;
  loadingDescription.textContent = stage.description;
  loadingProgress.setAttribute('aria-valuenow', String(displayedLoadingProgress));
  loadingProgress.style.setProperty(
    '--loading-progress',
    `${(displayedLoadingProgress / loadingStages.length) * 100}%`,
  );
  loadingStageItems.forEach((item, index) => {
    item.classList.toggle('complete', index + 1 < displayedLoadingProgress);
    item.classList.toggle('active', index + 1 === displayedLoadingProgress);
  });

  if (displayedLoadingProgress === loadingStages.length) {
    window.setTimeout(resolveLoadingProgress, 520);
    return;
  }
  if (displayedLoadingProgress < targetLoadingProgress) {
    loadingProgressTimer = window.setTimeout(advanceLoadingProgress, 420);
  }
}

function queueLoadingProgress(loaded: number, total: number): void {
  const readyStage = Math.min(
    loadingStages.length,
    Math.ceil((loaded / total) * loadingStages.length),
  );
  targetLoadingProgress = Math.max(targetLoadingProgress, readyStage);
  if (loadingProgressTimer === undefined && displayedLoadingProgress < targetLoadingProgress) {
    if (displayedLoadingProgress === 0) advanceLoadingProgress();
    else loadingProgressTimer = window.setTimeout(advanceLoadingProgress, 420);
  }
}

function resize(): void {
  const pixelRatio = clamp(window.devicePixelRatio || 1, 1, 2);
  const width = Math.max(1, Math.round(window.innerWidth * pixelRatio));
  const height = Math.max(1, Math.round(window.innerHeight * pixelRatio));
  canvas.width = width;
  canvas.height = height;
  artworkCanvas.width = width;
  artworkCanvas.height = height;
  runtime.resizeView(width, height);
  screenCtx.imageSmoothingEnabled = true;
  artworkCtx.imageSmoothingEnabled = true;
}

function renderFrame(timestamp: number): void {
  const now = timestamp * 0.001;
  runtime.lastNow = now;
  renderer.render(now);
  if (isFirstFrame) {
    isFirstFrame = false;
    loading.classList.add('hidden');
    loading.addEventListener('transitionend', () => loading.remove(), { once: true });
    window.setTimeout(() => loading.remove(), 240);
  }
  interaction.updateLifecycle(now);
  animationFrame = requestAnimationFrame(renderFrame);
}

async function loadArtworkAssets(): Promise<void> {
  const solidImage = new Image();
  solidImage.decoding = 'async';
  solidImage.src = new URL('./assets/figure-source-start.png', import.meta.url).href;
  const [lineGeometry, solidPoints] = await Promise.all([
    loadLineAssets(queueLoadingProgress),
    solidImage.decode().then(() => buildSolidPoints(solidImage)),
    loadingProgressComplete,
  ]);
  runtime.echoLineGeometry = lineGeometry;
  runtime.solidPoints = solidPoints;
}

function applyReducedMotionPreference(): void {
  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  settings.idleMotion = 0.16;
  settings.drift = 15;
  settings.sweepDuration = 4.5;
}

function showError(message: string): void {
  loading.remove();
  error.textContent = message;
  error.classList.add('show');
}

async function initializeBodyEcho(): Promise<void> {
  resize();
  await loadArtworkAssets();
  applyReducedMotionPreference();
  interaction.bind(showError, resize);
  const debugWindow = window as Window & { __bodyEcho?: DebugApi };
  debugWindow.__bodyEcho = interaction.debugApi();
  cancelAnimationFrame(animationFrame);
  animationFrame = requestAnimationFrame(renderFrame);
}

initializeBodyEcho().catch((reason: unknown) => {
  showError(reason instanceof Error ? reason.message : 'Body Echo could not start.');
});
