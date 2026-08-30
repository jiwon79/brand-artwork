const FRAME_COUNT = 61;
const FACE_CENTER_X_RATIO = 0.5;
const FACE_CENTER_Y_RATIO = 0.48;
const KEYBOARD_STEP = 2 / (FRAME_COUNT - 1);
const FRAME_RESPONSE = 0.34;
const MAX_RENDER_DELTA = 64;

type ElementConstructor<T extends HTMLElement> = new () => T;

function requiredElement<T extends HTMLElement>(
  id: string,
  constructor: ElementConstructor<T>,
): T {
  const element = document.getElementById(id);
  if (!(element instanceof constructor)) {
    throw new Error(`Cursor Cat Circle requires #${id}`);
  }
  return element;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function frameSource(index: number): string {
  const frame = String(index + 1).padStart(3, '0');
  return `/pages/cursor-cat-circle/assets/upper-arc-frames/frame-${frame}.webp`;
}

const stage = requiredElement('cat-stage', HTMLElement);
const cat = requiredElement('cat-frame', HTMLImageElement);
const loadingStatus = requiredElement('loading-status', HTMLElement);
const sources = Array.from({ length: FRAME_COUNT }, (_, index) => frameSource(index));
const decodedFrames: HTMLImageElement[] = [];
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

let ready = false;
let targetProgress = 0;
let renderedProgress = 0;
let renderedFrame = 0;
let previousRenderTime = 0;

function showFrame(index: number): void {
  const nextIndex = clamp(index, 0, FRAME_COUNT - 1);
  if (nextIndex === renderedFrame && cat.src.endsWith(sources[nextIndex] ?? '')) return;

  renderedFrame = nextIndex;
  cat.src = decodedFrames[nextIndex]?.src ?? sources[nextIndex] ?? sources[0];
}

function pointerProgress(clientX: number, clientY: number): number {
  const bounds = cat.getBoundingClientRect();
  const faceX = bounds.left + bounds.width * FACE_CENTER_X_RATIO;
  const faceY = bounds.top + bounds.height * FACE_CENTER_Y_RATIO;
  const deltaX = clientX - faceX;
  const deltaY = clientY - faceY;

  if (Math.abs(deltaX) + Math.abs(deltaY) < 1) return targetProgress;

  // Only the generated upper semicircle exists. Positions below the face are
  // projected to the closest horizontal endpoint instead of inventing poses.
  if (deltaY > 0) {
    if (Math.abs(deltaX) < 1) return targetProgress;
    return deltaX < 0 ? 1 : 0;
  }

  const angle = Math.atan2(deltaY, deltaX);
  return clamp(-angle / Math.PI, 0, 1);
}

function updatePointer(event: PointerEvent): void {
  if (!ready) return;
  targetProgress = pointerProgress(event.clientX, event.clientY);

  if (reducedMotion.matches) {
    renderedProgress = targetProgress;
    showFrame(Math.round(renderedProgress * (FRAME_COUNT - 1)));
  }
}

function updateKeyboard(event: KeyboardEvent): void {
  if (!ready || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;

  event.preventDefault();
  targetProgress = clamp(
    targetProgress + (event.key === 'ArrowLeft' ? KEYBOARD_STEP : -KEYBOARD_STEP),
    0,
    1,
  );
}

function render(time: number): void {
  const delta = previousRenderTime === 0
    ? 16.67
    : Math.min(time - previousRenderTime, MAX_RENDER_DELTA);
  previousRenderTime = time;

  if (ready && !reducedMotion.matches) {
    const response = 1 - Math.pow(1 - FRAME_RESPONSE, delta / 16.67);
    renderedProgress += (targetProgress - renderedProgress) * response;

    if (Math.abs(targetProgress - renderedProgress) < 0.0005) {
      renderedProgress = targetProgress;
    }

    showFrame(Math.round(renderedProgress * (FRAME_COUNT - 1)));
  }

  requestAnimationFrame(render);
}

async function loadFrame(source: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.decoding = 'async';
  image.src = source;
  await image.decode();
  return image;
}

async function initialize(): Promise<void> {
  try {
    await cat.decode();
    stage.classList.add('is-poster-ready');

    const frames = await Promise.all(sources.map(loadFrame));
    decodedFrames.push(...frames);
    ready = true;
    stage.classList.add('is-ready');
    stage.setAttribute('aria-busy', 'false');
    loadingStatus.textContent = '이미지 로딩 완료';
  } catch (error) {
    stage.classList.add('is-error', 'is-poster-ready');
    stage.setAttribute('aria-busy', 'false');
    loadingStatus.textContent = '이미지를 불러오지 못했습니다.';
    console.error(error);
  }
}

stage.addEventListener('pointermove', updatePointer, { passive: true });
stage.addEventListener('pointerdown', updatePointer, { passive: true });
stage.addEventListener('keydown', updateKeyboard);
requestAnimationFrame(render);
void initialize();
