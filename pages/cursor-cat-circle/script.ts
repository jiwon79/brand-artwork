const FRAME_COUNT = 120;
const QUARTER_FRAME_COUNT = FRAME_COUNT / 4;
const TOP_FRAME = QUARTER_FRAME_COUNT;
const LEFT_FRAME = QUARTER_FRAME_COUNT * 2;
const BOTTOM_FRAME = QUARTER_FRAME_COUNT * 3;
const POINTER_CENTER_Y_RATIO = 0.46;
const SECOND_QUARTER_SCALE = 0.993;
const KEYBOARD_STEP = 2 / FRAME_COUNT;
const FRAME_RESPONSE = 0.34;
const MAX_RENDER_DELTA = 64;
const DEBUG_ARC_SAMPLE_COUNT = 720;
const FRAME_ASSET_VERSION = 3;

type Point = { x: number; y: number };
type Bounds = { left: number; top: number; width: number; height: number };
type DebugArcSample = Point & { frame: number; angle: number };

const GAZE_ORIGINS: [Point, Point, Point, Point, Point] = [
  { x: 0.69, y: 0.46 },
  { x: 0.51, y: 0.33 },
  { x: 0.29, y: 0.46 },
  { x: 0.43, y: 0.77 },
  { x: 0.69, y: 0.46 },
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

function lerp(start: number, end: number, progress: number): number {
  return start + (end - start) * progress;
}

function wrapProgress(progress: number): number {
  return ((progress % 1) + 1) % 1;
}

function wrappedProgressDelta(target: number, current: number): number {
  return ((target - current + 1.5) % 1) - 0.5;
}

function frameGazeOrigin(index: number): Point {
  const quarter = Math.floor(index / QUARTER_FRAME_COUNT);
  const start = GAZE_ORIGINS[quarter] ?? GAZE_ORIGINS[0];
  const end = GAZE_ORIGINS[quarter + 1] ?? GAZE_ORIGINS[1];
  const localProgress = (index % QUARTER_FRAME_COUNT) / QUARTER_FRAME_COUNT;

  return {
    x: lerp(start.x, end.x, localProgress),
    y: lerp(start.y, end.y, localProgress),
  };
}

function frameGazeAngle(index: number): number {
  return -(index / FRAME_COUNT) * Math.PI * 2;
}

function angularDistance(first: number, second: number): number {
  return Math.abs(Math.atan2(Math.sin(first - second), Math.cos(first - second)));
}

function catLayoutBounds(): Bounds {
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
  return `/pages/cursor-cat-circle/assets/circle-frames/frame-${frame}.webp?v=${FRAME_ASSET_VERSION}`;
}

const stage = requiredElement('cat-stage', HTMLElement);
const cat = requiredElement('cat-frame', HTMLImageElement);
const debugCanvas = requiredElement('debug-canvas', HTMLCanvasElement);
const loadingStatus = requiredElement('loading-status', HTMLElement);
const debugContext = debugCanvas.getContext('2d');
if (!debugContext) throw new Error('Cursor Cat Circle requires a 2D debug canvas');

const sources = Array.from({ length: FRAME_COUNT }, (_, index) => frameSource(index));
const decodedFrames: HTMLImageElement[] = [];
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

let ready = false;
let debugEnabled = new URLSearchParams(window.location.search).get('debug') === '1';
let targetProgress = 0;
let renderedProgress = 0;
let renderedFrame = 0;
let previousRenderTime = 0;
let pointerPosition: Point | null = null;
let debugLayoutKey = '';
let debugArcSamples: DebugArcSample[] = [];

function showFrame(index: number): void {
  const nextIndex = ((Math.round(index) % FRAME_COUNT) + FRAME_COUNT) % FRAME_COUNT;
  if (nextIndex === renderedFrame && cat.src.endsWith(sources[nextIndex] ?? '')) return;

  renderedFrame = nextIndex;
  const scale = nextIndex <= TOP_FRAME
    ? 1
    : nextIndex <= LEFT_FRAME
      ? SECOND_QUARTER_SCALE
      : lerp(SECOND_QUARTER_SCALE, 1, (nextIndex - LEFT_FRAME) / (FRAME_COUNT - LEFT_FRAME));
  cat.style.setProperty(
    '--frame-scale',
    String(scale),
  );
  cat.src = decodedFrames[nextIndex]?.src ?? sources[nextIndex] ?? sources[0];
}

function pointerFrame(clientX: number, clientY: number): number {
  const bounds = catLayoutBounds();
  const projectionY = bounds.top + bounds.height * POINTER_CENTER_Y_RATIO;
  const centerX = bounds.left + bounds.width * 0.5;

  if (Math.abs(clientX - centerX) + Math.abs(clientY - projectionY) < 1) {
    return Math.round(targetProgress * FRAME_COUNT) % FRAME_COUNT;
  }

  let bestFrame = renderedFrame;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < FRAME_COUNT; index += 1) {
    const origin = frameGazeOrigin(index);
    const originX = bounds.left + bounds.width * origin.x;
    const originY = bounds.top + bounds.height * origin.y;
    const pointerAngle = Math.atan2(clientY - originY, clientX - originX);
    const gazeAngle = frameGazeAngle(index);
    const distance = angularDistance(pointerAngle, gazeAngle);

    if (distance < bestDistance) {
      bestDistance = distance;
      bestFrame = index;
    }
  }

  return bestFrame;
}

function pointerProgress(clientX: number, clientY: number): number {
  return pointerFrame(clientX, clientY) / FRAME_COUNT;
}

function updatePointer(event: PointerEvent): void {
  pointerPosition = { x: event.clientX, y: event.clientY };
  if (!ready) return;
  targetProgress = pointerProgress(event.clientX, event.clientY);

  if (reducedMotion.matches) {
    renderedProgress = targetProgress;
    showFrame(Math.round(renderedProgress * FRAME_COUNT));
  }
}

function updateKeyboard(event: KeyboardEvent): void {
  if (event.key.toLowerCase() === 'd') {
    event.preventDefault();
    setDebugEnabled(!debugEnabled, true);
    return;
  }

  if (!ready || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;

  event.preventDefault();
  targetProgress = wrapProgress(
    targetProgress + (event.key === 'ArrowLeft' ? KEYBOARD_STEP : -KEYBOARD_STEP),
  );
}

function setDebugEnabled(enabled: boolean, updateUrl = false): void {
  debugEnabled = enabled;
  stage.classList.toggle('is-debug', enabled);
  debugCanvas.setAttribute('aria-hidden', String(!enabled));

  if (!enabled) debugContext.clearRect(0, 0, debugCanvas.width, debugCanvas.height);

  if (updateUrl) {
    const url = new URL(window.location.href);
    if (enabled) url.searchParams.set('debug', '1');
    else url.searchParams.delete('debug');
    window.history.replaceState(null, '', url);
  }
}

function debugArcGeometry(bounds: Bounds): { center: Point; radius: number } {
  const stageBounds = stage.getBoundingClientRect();
  return {
    center: {
      x: bounds.left + bounds.width * 0.5,
      y: bounds.top + bounds.height * POINTER_CENTER_Y_RATIO,
    },
    radius: Math.min(stageBounds.width, stageBounds.height) * 0.38,
  };
}

function rebuildDebugArc(bounds: Bounds): void {
  const { center, radius } = debugArcGeometry(bounds);
  const layoutKey = [
    center.x.toFixed(2), center.y.toFixed(2), radius.toFixed(2),
    bounds.width.toFixed(2), bounds.height.toFixed(2),
  ].join(':');

  if (layoutKey === debugLayoutKey) return;
  debugLayoutKey = layoutKey;
  debugArcSamples = Array.from({ length: DEBUG_ARC_SAMPLE_COUNT + 1 }, (_, index) => {
    const angle = -(index / DEBUG_ARC_SAMPLE_COUNT) * Math.PI * 2;
    const x = center.x + Math.cos(angle) * radius;
    const y = center.y + Math.sin(angle) * radius;
    return { x, y, angle, frame: pointerFrame(x, y) };
  });
}

function prepareDebugCanvas(): void {
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  const width = stage.clientWidth;
  const height = stage.clientHeight;
  const targetWidth = Math.round(width * pixelRatio);
  const targetHeight = Math.round(height * pixelRatio);

  if (debugCanvas.width !== targetWidth || debugCanvas.height !== targetHeight) {
    debugCanvas.width = targetWidth;
    debugCanvas.height = targetHeight;
    debugLayoutKey = '';
  }

  debugContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  debugContext.clearRect(0, 0, width, height);
}

function drawCircle(point: Point, radius: number, color: string, fill = true): void {
  debugContext.beginPath();
  debugContext.arc(point.x, point.y, radius, 0, Math.PI * 2);
  if (fill) {
    debugContext.fillStyle = color;
    debugContext.fill();
  } else {
    debugContext.strokeStyle = color;
    debugContext.lineWidth = 2;
    debugContext.stroke();
  }
}

function screenGazeOrigin(frame: number, bounds: Bounds): Point {
  const origin = frameGazeOrigin(frame);
  return {
    x: bounds.left + bounds.width * origin.x,
    y: bounds.top + bounds.height * origin.y,
  };
}

function drawGazeRay(frame: number, bounds: Bounds, radius: number, color: string): void {
  const origin = screenGazeOrigin(frame, bounds);
  const angle = frameGazeAngle(frame);
  debugContext.beginPath();
  debugContext.moveTo(origin.x, origin.y);
  debugContext.lineTo(
    origin.x + Math.cos(angle) * radius,
    origin.y + Math.sin(angle) * radius,
  );
  debugContext.strokeStyle = color;
  debugContext.lineWidth = 1.5;
  debugContext.stroke();
}

function drawDebugArc(targetFrame: number, bounds: Bounds): void {
  rebuildDebugArc(bounds);

  for (let index = 1; index < debugArcSamples.length; index += 1) {
    const previous = debugArcSamples[index - 1];
    const current = debugArcSamples[index];
    if (!previous || !current) continue;

    debugContext.beginPath();
    debugContext.moveTo(previous.x, previous.y);
    debugContext.lineTo(current.x, current.y);
    debugContext.strokeStyle = current.frame === targetFrame
      ? 'rgba(13, 153, 255, 0.95)'
      : 'rgba(63, 73, 84, 0.28)';
    debugContext.lineWidth = current.frame === targetFrame ? 5 : 2;
    debugContext.stroke();

    if (current.frame !== previous.frame) {
      const { center, radius } = debugArcGeometry(bounds);
      const innerRadius = radius - 5;
      const outerRadius = radius + 6;
      debugContext.beginPath();
      debugContext.moveTo(
        center.x + Math.cos(current.angle) * innerRadius,
        center.y + Math.sin(current.angle) * innerRadius,
      );
      debugContext.lineTo(
        center.x + Math.cos(current.angle) * outerRadius,
        center.y + Math.sin(current.angle) * outerRadius,
      );
      debugContext.strokeStyle = 'rgba(34, 42, 51, 0.52)';
      debugContext.lineWidth = 1;
      debugContext.stroke();
    }
  }

  const { center, radius } = debugArcGeometry(bounds);
  debugContext.fillStyle = 'rgba(34, 42, 51, 0.72)';
  debugContext.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
  debugContext.textAlign = 'center';
  debugContext.textBaseline = 'middle';

  for (const frame of [0, 15, 30, 45, 60, 75, 90, 105]) {
    const angle = frameGazeAngle(frame);
    const x = center.x + Math.cos(angle) * (radius + 18);
    const y = center.y + Math.sin(angle) * (radius + 18);
    debugContext.fillText(String(frame + 1).padStart(3, '0'), x, y);
  }
}

function drawDebugHud(targetFrame: number): void {
  const targetAngle = (targetFrame / FRAME_COUNT) * 360;
  const renderedAngle = (renderedFrame / FRAME_COUNT) * 360;
  const direction = targetFrame < TOP_FRAME
    ? 'RIGHT → TOP'
    : targetFrame === TOP_FRAME
      ? 'TOP'
      : targetFrame < LEFT_FRAME
        ? 'TOP → LEFT'
        : targetFrame === LEFT_FRAME
          ? 'LEFT'
          : targetFrame < BOTTOM_FRAME
            ? 'LEFT → BOTTOM'
            : targetFrame === BOTTOM_FRAME
              ? 'BOTTOM'
              : 'BOTTOM → RIGHT';
  const lines = [
    ['TARGET', `${String(targetFrame + 1).padStart(3, '0')} / 120   ${targetAngle.toFixed(1)}°`],
    ['RENDERED', `${String(renderedFrame + 1).padStart(3, '0')} / 120   ${renderedAngle.toFixed(1)}°`],
    ['PATH', direction],
    ['TOGGLE', 'D'],
  ];
  const width = Math.min(258, stage.clientWidth - 24);
  const height = 116;
  const x = 12;
  const y = 12;

  debugContext.fillStyle = 'rgba(17, 20, 24, 0.88)';
  debugContext.fillRect(x, y, width, height);
  debugContext.fillStyle = '#ffffff';
  debugContext.font = '600 11px ui-monospace, SFMono-Regular, Menlo, monospace';
  debugContext.textAlign = 'left';
  debugContext.textBaseline = 'top';
  debugContext.fillText('CURSOR CAT · FULL CIRCLE DEBUG', x + 12, y + 10);

  lines.forEach(([label, value], index) => {
    const lineY = y + 33 + index * 18;
    debugContext.fillStyle = 'rgba(255, 255, 255, 0.56)';
    debugContext.fillText(label ?? '', x + 12, lineY);
    debugContext.fillStyle = index === 0 ? '#0d99ff' : index === 1 ? '#ff3b72' : '#ffffff';
    debugContext.fillText(value ?? '', x + 78, lineY);
  });
}

function drawDebug(): void {
  if (!debugEnabled || !ready) return;
  prepareDebugCanvas();

  const bounds = catLayoutBounds();
  const targetFrame = Math.round(targetProgress * FRAME_COUNT) % FRAME_COUNT;
  const { radius } = debugArcGeometry(bounds);
  const targetOrigin = screenGazeOrigin(targetFrame, bounds);
  const renderedOrigin = screenGazeOrigin(renderedFrame, bounds);

  drawDebugArc(targetFrame, bounds);
  drawGazeRay(renderedFrame, bounds, radius, 'rgba(255, 59, 114, 0.72)');
  drawGazeRay(targetFrame, bounds, radius, 'rgba(13, 153, 255, 0.9)');

  if (pointerPosition) {
    debugContext.save();
    debugContext.setLineDash([4, 4]);
    debugContext.beginPath();
    debugContext.moveTo(targetOrigin.x, targetOrigin.y);
    debugContext.lineTo(pointerPosition.x, pointerPosition.y);
    debugContext.strokeStyle = 'rgba(13, 153, 255, 0.72)';
    debugContext.lineWidth = 1;
    debugContext.stroke();
    debugContext.restore();
    drawCircle(pointerPosition, 5, '#0d99ff', false);
  }

  drawCircle(renderedOrigin, 5, '#ff3b72', false);
  drawCircle(targetOrigin, 4, '#0d99ff');
  drawDebugHud(targetFrame);
}

function render(time: number): void {
  const delta = previousRenderTime === 0
    ? 16.67
    : Math.min(time - previousRenderTime, MAX_RENDER_DELTA);
  previousRenderTime = time;

  if (ready && !reducedMotion.matches) {
    const response = 1 - Math.pow(1 - FRAME_RESPONSE, delta / 16.67);
    const progressDelta = wrappedProgressDelta(targetProgress, renderedProgress);
    renderedProgress = wrapProgress(renderedProgress + progressDelta * response);

    if (Math.abs(progressDelta) < 0.0005) {
      renderedProgress = targetProgress;
    }

    showFrame(Math.round(renderedProgress * FRAME_COUNT));
  }

  drawDebug();

  requestAnimationFrame(render);
}

async function loadFrame(source: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.decoding = 'async';
  image.src = source;
  try {
    await image.decode();
  } catch (error) {
    throw new Error(`Could not decode cursor-cat frame: ${source}`, { cause: error });
  }
  return image;
}

async function loadFrames(frameSources: string[], concurrency = 8): Promise<HTMLImageElement[]> {
  const frames = new Array<HTMLImageElement>(frameSources.length);
  let nextIndex = 0;

  async function loadNext(): Promise<void> {
    while (nextIndex < frameSources.length) {
      const index = nextIndex;
      nextIndex += 1;
      const source = frameSources[index];
      if (!source) continue;
      frames[index] = await loadFrame(source);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, frameSources.length) }, loadNext),
  );
  return frames;
}

async function initialize(): Promise<void> {
  try {
    await cat.decode();
    stage.classList.add('is-poster-ready');

    const frames = await loadFrames(sources);
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
window.addEventListener('keydown', updateKeyboard);
setDebugEnabled(debugEnabled);
requestAnimationFrame(render);
void initialize();
