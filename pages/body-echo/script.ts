import { ArtworkRenderer } from './artwork-renderer';
import { DESIGN_HEIGHT, DESIGN_WIDTH, settings } from './config';
import { DragDissolve } from './drag-dissolve';
import { buildSolidPoints, loadLineAssets } from './geometry';
import { createTuningGui } from './gui';
import { InteractionController } from './interaction-controller';
import { clamp } from './math';
import { setupRenderStageControls } from './render-stages';
import { BodyEchoRuntime } from './runtime';
import type { DebugApi } from './types';

// Composition root: create surfaces, wire modules, load assets, and run frames.
const canvas = document.getElementById('artwork') as HTMLCanvasElement;
const loading = document.getElementById('loading') as HTMLDivElement;
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
    loadLineAssets(),
    solidImage.decode().then(() => buildSolidPoints(solidImage)),
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
  const previewPoint = {
    x: DESIGN_WIDTH * 0.5,
    y: DESIGN_HEIGHT * 0.76,
  };
  setupRenderStageControls((stage) => {
    if (stage === 2) interaction.previewPull(previewPoint);
    else if (stage === 3 || stage === 4) interaction.previewRelease(previewPoint);
    else interaction.reset();
  });
  const debugWindow = window as Window & { __bodyEcho?: DebugApi };
  debugWindow.__bodyEcho = interaction.debugApi();
  cancelAnimationFrame(animationFrame);
  animationFrame = requestAnimationFrame(renderFrame);
}

initializeBodyEcho().catch((reason: unknown) => {
  showError(reason instanceof Error ? reason.message : 'Body Echo could not start.');
});
