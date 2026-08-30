const FRAME_COUNT = 61;
const MIDPOINT_FRAME = (FRAME_COUNT - 1) / 2;
const LOWER_PROJECTION_Y_RATIO = 0.48;
const SECOND_QUARTER_SCALE = 0.993;
const KEYBOARD_STEP = 2 / (FRAME_COUNT - 1);
const FRAME_RESPONSE = 0.34;
const MAX_RENDER_DELTA = 64;

type Point = { x: number; y: number };

const GAZE_ORIGINS: [Point, Point, Point] = [
  { x: 0.69, y: 0.46 },
  { x: 0.51, y: 0.33 },
  { x: 0.29, y: 0.46 },
];

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

function lerp(start: number, end: number, progress: number): number {
  return start + (end - start) * progress;
}

function frameGazeOrigin(index: number): Point {
  const isFirstQuarter = index <= MIDPOINT_FRAME;
  const start = isFirstQuarter ? GAZE_ORIGINS[0] : GAZE_ORIGINS[1];
  const end = isFirstQuarter ? GAZE_ORIGINS[1] : GAZE_ORIGINS[2];
  const localProgress = isFirstQuarter
    ? index / MIDPOINT_FRAME
    : (index - MIDPOINT_FRAME) / MIDPOINT_FRAME;

  return {
    x: lerp(start.x, end.x, localProgress),
    y: lerp(start.y, end.y, localProgress),
  };
}

function angularDistance(first: number, second: number): number {
  return Math.abs(Math.atan2(Math.sin(first - second), Math.cos(first - second)));
}

function catLayoutBounds(): { left: number; top: number; width: number; height: number } {
  const transformed = cat.getBoundingClientRect();
  const width = cat.offsetWidth;
  const height = cat.offsetHeight;

  return {
    left: transformed.left - (width - transformed.width) * 0.5,
    top: transformed.bottom - height,
    width,
    height,
  };
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
  cat.style.setProperty(
    '--frame-scale',
    String(nextIndex > MIDPOINT_FRAME ? SECOND_QUARTER_SCALE : 1),
  );
  cat.src = decodedFrames[nextIndex]?.src ?? sources[nextIndex] ?? sources[0];
}

function pointerProgress(clientX: number, clientY: number): number {
  const bounds = catLayoutBounds();
  const projectionY = bounds.top + bounds.height * LOWER_PROJECTION_Y_RATIO;
  const centerX = bounds.left + bounds.width * 0.5;

  if (Math.abs(clientX - centerX) + Math.abs(clientY - projectionY) < 1) {
    return targetProgress;
  }

  // Only the generated upper semicircle exists. Positions below the face are
  // projected to the closest horizontal endpoint instead of inventing poses.
  if (clientY > projectionY) {
    if (Math.abs(clientX - centerX) < 1) return targetProgress;
    return clientX < centerX ? 1 : 0;
  }

  let bestFrame = renderedFrame;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < FRAME_COUNT; index += 1) {
    const origin = frameGazeOrigin(index);
    const originX = bounds.left + bounds.width * origin.x;
    const originY = bounds.top + bounds.height * origin.y;
    const pointerAngle = Math.atan2(clientY - originY, clientX - originX);
    const gazeAngle = -(index / (FRAME_COUNT - 1)) * Math.PI;
    const distance = angularDistance(pointerAngle, gazeAngle);

    if (distance < bestDistance) {
      bestDistance = distance;
      bestFrame = index;
    }
  }

  return bestFrame / (FRAME_COUNT - 1);
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
