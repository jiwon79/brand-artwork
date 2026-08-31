import { CURSOR_CAT_ASSET_BASE_URL } from './config';
import { createStepper } from '../../common/stepper';

const FRAME_COUNT = 120;
const QUARTER_FRAME_COUNT = FRAME_COUNT / 4;
const TOP_FRAME = QUARTER_FRAME_COUNT;
const LEFT_FRAME = QUARTER_FRAME_COUNT * 2;
const BOTTOM_FRAME = QUARTER_FRAME_COUNT * 3;
const POINTER_CENTER_Y_RATIO = 0.46;
const FRAME_RESPONSE = 0.34;
const MAX_RENDER_DELTA = 64;
const DEBUG_ARC_SAMPLE_COUNT = 720;
const DEFAULT_ARTWORK_ID = 'main';
const ARTWORK_ID_PATTERN = /^[a-z0-9]{10}$/;

type Point = { x: number; y: number };
type Bounds = { left: number; top: number; width: number; height: number };
type DebugArcSample = Point & { frame: number; angle: number };
type GazeOriginAnchor = Point & { frame: number };
type DisplayScaleAnchor = { frame: number; scale: number };
type ProcessStage = 'angle' | 'frame' | 'final';

const PROCESS_STEPS = [
  { id: 'angle', label: 'Angle' },
  { id: 'frame', label: 'Frame' },
  { id: 'final', label: 'Final' },
] as const;

interface CursorCatManifest {
  schemaVersion: 1;
  id: string;
  version: string;
  name: string;
  alt: string;
  ariaLabel: string;
  frameCount: number;
  framePattern: string;
  gazeOrigins: GazeOriginAnchor[];
  displayScales: DisplayScaleAnchor[];
}

type ElementConstructor<T extends HTMLElement> = new () => T;

function requiredElement<T extends HTMLElement>(
  id: string,
  constructor: ElementConstructor<T>,
): T {
  const element = document.getElementById(id);
  if (!(element instanceof constructor)) {
    throw new Error(`Cursor Cat requires #${id}`);
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

function anchorPair<T extends { frame: number }>(anchors: T[], frame: number): [T, T] {
  const endIndex = anchors.findIndex((anchor) => anchor.frame >= frame);
  const end = anchors[Math.max(endIndex, 0)] ?? anchors[anchors.length - 1];
  const start = anchors[Math.max(endIndex - 1, 0)] ?? anchors[0];
  if (!start || !end) throw new Error('Cursor Cat calibration is empty');
  return [start, end];
}

function frameGazeOrigin(index: number): Point {
  const [start, end] = anchorPair(gazeOriginAnchors, index);
  const range = end.frame - start.frame;
  const localProgress = range === 0 ? 0 : (index - start.frame) / range;

  return {
    x: lerp(start.x, end.x, localProgress),
    y: lerp(start.y, end.y, localProgress),
  };
}

function frameDisplayScale(index: number): number {
  const [start, end] = anchorPair(displayScaleAnchors, index);
  const range = end.frame - start.frame;
  const localProgress = range === 0 ? 0 : (index - start.frame) / range;
  return lerp(start.scale, end.scale, localProgress);
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

function artworkIdFromPath(): string | null {
  const parts = window.location.pathname.split('/').filter(Boolean);
  const pageIndex = parts.lastIndexOf('cursor-cat');
  const candidate = parts[pageIndex + 1];

  if (!candidate || candidate === 'index.html') return DEFAULT_ARTWORK_ID;
  return ARTWORK_ID_PATTERN.test(candidate) ? candidate : null;
}

function manifestUrl(artworkId: string): string {
  return `${CURSOR_CAT_ASSET_BASE_URL.replace(/\/$/, '')}/${artworkId}/manifest.json`;
}

function frameSource(manifest: CursorCatManifest, index: number): string {
  const frame = String(index + 1).padStart(3, '0');
  const path = manifest.framePattern.replace('{frame}', frame);
  const baseUrl = CURSOR_CAT_ASSET_BASE_URL.replace(/\/$/, '');
  return `${baseUrl}/${manifest.id}/${path}?v=${encodeURIComponent(manifest.version)}`;
}

function anchorsAreValid(
  anchors: Array<{ frame: number } & Record<string, unknown>> | undefined,
  valueKeys: string[],
): boolean {
  return Array.isArray(anchors)
    && anchors.length >= 2
    && anchors[0]?.frame === 0
    && anchors[anchors.length - 1]?.frame === FRAME_COUNT
    && anchors.every((anchor, index) => (
      Number.isInteger(anchor.frame)
      && anchor.frame >= 0
      && anchor.frame <= FRAME_COUNT
      && (index === 0 || anchor.frame > (anchors[index - 1]?.frame ?? -1))
      && valueKeys.every((key) => Number.isFinite(anchor[key]))
    ));
}

function validateManifest(
  value: unknown,
  expectedId: string,
): asserts value is CursorCatManifest {
  const manifest = value as Partial<CursorCatManifest> | null;
  if (
    manifest?.schemaVersion !== 1
    || manifest.id !== expectedId
    || typeof manifest.version !== 'string'
    || typeof manifest.name !== 'string'
    || typeof manifest.alt !== 'string'
    || typeof manifest.ariaLabel !== 'string'
    || manifest.frameCount !== FRAME_COUNT
    || manifest.framePattern !== 'frame-{frame}.webp'
    || !anchorsAreValid(manifest.gazeOrigins, ['x', 'y'])
    || !anchorsAreValid(manifest.displayScales, ['scale'])
    || manifest.gazeOrigins?.every((anchor) => (
      anchor.x >= 0 && anchor.x <= 1 && anchor.y >= 0 && anchor.y <= 1
    )) !== true
    || manifest.displayScales?.every((anchor) => (
      anchor.scale > 0 && anchor.scale <= 2
    )) !== true
  ) {
    throw new Error('Invalid Cursor Cat manifest');
  }
}

const stage = requiredElement('cat-stage', HTMLElement);
const cat = requiredElement('cat-frame', HTMLImageElement);
const debugCanvas = requiredElement('debug-canvas', HTMLCanvasElement);
const loadingStatus = requiredElement('loading-status', HTMLElement);
const debugContext = (() => {
  const context = debugCanvas.getContext('2d');
  if (!context) throw new Error('Cursor Cat requires a 2D debug canvas');
  return context;
})();

let sources: string[] = [];
const decodedFrames: HTMLImageElement[] = [];
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

let ready = false;
let debugEnabled = new URLSearchParams(window.location.search).get('debug') === '1';
let processStage: ProcessStage = 'final';
let targetProgress = 0;
let renderedProgress = 0;
let renderedFrame = 0;
let previousRenderTime = 0;
let pointerPosition: Point | null = null;
let debugLayoutKey = '';
let debugArcSamples: DebugArcSample[] = [];
let gazeOriginAnchors: GazeOriginAnchor[] = [];
let displayScaleAnchors: DisplayScaleAnchor[] = [];

function showFrame(index: number): void {
  const nextIndex = ((Math.round(index) % FRAME_COUNT) + FRAME_COUNT) % FRAME_COUNT;
  if (nextIndex === renderedFrame && cat.src.endsWith(sources[nextIndex] ?? '')) return;

  renderedFrame = nextIndex;
  const scale = frameDisplayScale(nextIndex);
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
  }
}

function setProcessStage(nextStage: ProcessStage): void {
  processStage = nextStage;
  stage.dataset.processStage = nextStage;
  stage.classList.toggle('has-process-overlay', nextStage !== 'final');

  if (nextStage === 'final' && !debugEnabled) {
    debugContext.clearRect(0, 0, debugCanvas.width, debugCanvas.height);
  }
}

function setDebugEnabled(enabled: boolean, updateUrl = false): void {
  debugEnabled = enabled;
  stage.classList.toggle('is-debug', enabled);
  debugCanvas.setAttribute('aria-hidden', String(!enabled));

  if (!enabled && processStage === 'final') {
    debugContext.clearRect(0, 0, debugCanvas.width, debugCanvas.height);
  }

  if (updateUrl) {
    const url = new URL(window.location.href);
    if (enabled) url.searchParams.set('debug', '1');
    else url.searchParams.delete('debug');
    window.history.replaceState(null, '', url);
  }
}

function debugArcGeometry(bounds: Bounds): { center: Point; radius: number } {
  const stageBounds = stage.getBoundingClientRect();
  const center = {
    x: bounds.left + bounds.width * 0.5,
    y: bounds.top + bounds.height * POINTER_CENTER_Y_RATIO,
  };
  const radius = Math.min(
    Math.min(stageBounds.width, stageBounds.height) * 0.38,
    Math.max(80, center.y - 86),
  );
  return {
    center,
    radius,
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

function processPointer(frame: number, bounds: Bounds, radius: number): Point {
  if (pointerPosition) return pointerPosition;
  const origin = screenGazeOrigin(frame, bounds);
  const angle = frameGazeAngle(frame);
  return {
    x: origin.x + Math.cos(angle) * radius,
    y: origin.y + Math.sin(angle) * radius,
  };
}

function drawPointerRay(origin: Point, pointer: Point): void {
  debugContext.save();
  debugContext.setLineDash([5, 5]);
  debugContext.beginPath();
  debugContext.moveTo(origin.x, origin.y);
  debugContext.lineTo(pointer.x, pointer.y);
  debugContext.strokeStyle = 'rgba(13, 153, 255, 0.82)';
  debugContext.lineWidth = 1.5;
  debugContext.stroke();
  debugContext.restore();
  drawCircle(pointer, 5, '#0d99ff', false);
}

function drawAngleProcess(targetFrame: number, bounds: Bounds): void {
  const { radius } = debugArcGeometry(bounds);
  const origin = screenGazeOrigin(targetFrame, bounds);
  const pointer = processPointer(targetFrame, bounds, radius);
  const pointerAngle = Math.atan2(pointer.y - origin.y, pointer.x - origin.x);
  const arcRadius = Math.min(42, Math.max(26, Math.hypot(
    pointer.x - origin.x,
    pointer.y - origin.y,
  ) * 0.16));

  debugContext.beginPath();
  debugContext.moveTo(origin.x, origin.y);
  debugContext.lineTo(origin.x + Math.min(radius, 90), origin.y);
  debugContext.strokeStyle = 'rgba(22, 22, 22, 0.24)';
  debugContext.lineWidth = 1;
  debugContext.stroke();

  drawPointerRay(origin, pointer);

  debugContext.beginPath();
  debugContext.arc(origin.x, origin.y, arcRadius, 0, pointerAngle, pointerAngle < 0);
  debugContext.strokeStyle = '#161616';
  debugContext.lineWidth = 2;
  debugContext.stroke();

  drawCircle(origin, 4, '#161616');
}

function drawFrameProcess(targetFrame: number, bounds: Bounds): void {
  const { radius } = debugArcGeometry(bounds);
  const origin = screenGazeOrigin(targetFrame, bounds);
  const pointer = processPointer(targetFrame, bounds, radius);

  drawDebugArc(targetFrame, bounds);
  drawGazeRay(targetFrame, bounds, radius, 'rgba(22, 22, 22, 0.8)');
  drawPointerRay(origin, pointer);
  drawCircle(origin, 4, '#0d99ff');
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
  const y = stage.clientWidth <= 560 ? 72 : 12;

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
  if ((!debugEnabled && processStage === 'final') || !ready) return;
  prepareDebugCanvas();

  const bounds = catLayoutBounds();
  const targetFrame = Math.round(targetProgress * FRAME_COUNT) % FRAME_COUNT;

  if (!debugEnabled) {
    if (processStage === 'angle') drawAngleProcess(targetFrame, bounds);
    else if (processStage === 'frame') drawFrameProcess(targetFrame, bounds);
    return;
  }

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
  } catch {
    throw new Error(`Could not decode cursor-cat frame: ${source}`);
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
    const artworkId = artworkIdFromPath();
    if (!artworkId) throw new Error('Invalid Cursor Cat artwork ID');

    const response = await fetch(manifestUrl(artworkId), {
      cache: artworkId === DEFAULT_ARTWORK_ID ? 'no-store' : 'force-cache',
    });
    if (!response.ok) {
      throw new Error(`Could not load Cursor Cat manifest: ${response.status}`);
    }

    const manifest: unknown = await response.json();
    validateManifest(manifest, artworkId);
    gazeOriginAnchors = manifest.gazeOrigins;
    displayScaleAnchors = manifest.displayScales;
    sources = Array.from(
      { length: FRAME_COUNT },
      (_, index) => frameSource(manifest, index),
    );
    stage.setAttribute('aria-label', manifest.ariaLabel);
    cat.alt = manifest.alt;
    cat.src = sources[0] ?? '';
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
createStepper<ProcessStage>({
  steps: PROCESS_STEPS,
  initialStep: 'final',
  ariaLabel: 'Cursor Cat 원리 단계',
  urlParameter: 'stage',
  onChange: setProcessStage,
});
setDebugEnabled(debugEnabled);
requestAnimationFrame(render);
void initialize();
