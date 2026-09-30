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
const FRAME_RING_SAMPLE_COUNT = 720;
const DEFAULT_ARTWORK_ID = 'main';
const ARTWORK_ID_PATTERN = /^[a-z0-9]{10}$/;

type Point = { x: number; y: number };
type Bounds = { left: number; top: number; width: number; height: number };
type FrameRingSample = Point & { frame: number; angle: number };
type EyePositionAnchor = Point & { frame: number };
type FrameScaleAnchor = { frame: number; scale: number };
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
  gazeOrigins: EyePositionAnchor[];
  displayScales: FrameScaleAnchor[];
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

function lerp(start: number, end: number, ratio: number): number {
  return start + (end - start) * ratio;
}

function wrapFramePosition(position: number): number {
  return ((position % 1) + 1) % 1;
}

function shortestFramePositionDelta(target: number, current: number): number {
  return ((target - current + 1.5) % 1) - 0.5;
}

function surroundingAnchors<T extends { frame: number }>(anchors: T[], frame: number): [T, T] {
  const endIndex = anchors.findIndex((anchor) => anchor.frame >= frame);
  const end = anchors[Math.max(endIndex, 0)] ?? anchors[anchors.length - 1];
  const start = anchors[Math.max(endIndex - 1, 0)] ?? anchors[0];
  if (!start || !end) throw new Error('Cursor Cat calibration is empty');
  return [start, end];
}

function frameEyePosition(index: number): Point {
  const [start, end] = surroundingAnchors(eyePositionAnchors, index);
  const range = end.frame - start.frame;
  const localProgress = range === 0 ? 0 : (index - start.frame) / range;

  return {
    x: lerp(start.x, end.x, localProgress),
    y: lerp(start.y, end.y, localProgress),
  };
}

function frameScale(index: number): number {
  const [start, end] = surroundingAnchors(frameScaleAnchors, index);
  const range = end.frame - start.frame;
  const localProgress = range === 0 ? 0 : (index - start.frame) / range;
  return lerp(start.scale, end.scale, localProgress);
}

function frameLookAngle(index: number): number {
  return -(index / FRAME_COUNT) * Math.PI * 2;
}

function shortestAngleDistance(first: number, second: number): number {
  return Math.abs(Math.atan2(Math.sin(first - second), Math.cos(first - second)));
}

function catImageBounds(): Bounds {
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
let targetFramePosition = 0;
let displayFramePosition = 0;
let displayedFrame = 0;
let previousRenderTime = 0;
let pointerPosition: Point | null = null;
let frameRingLayoutKey = '';
let frameRingSamples: FrameRingSample[] = [];
let eyePositionAnchors: EyePositionAnchor[] = [];
let frameScaleAnchors: FrameScaleAnchor[] = [];

function displayFrame(index: number): void {
  const nextIndex = ((Math.round(index) % FRAME_COUNT) + FRAME_COUNT) % FRAME_COUNT;
  if (nextIndex === displayedFrame && cat.src.endsWith(sources[nextIndex] ?? '')) return;

  displayedFrame = nextIndex;
  const scale = frameScale(nextIndex);
  cat.style.setProperty(
    '--frame-scale',
    String(scale),
  );
  cat.src = decodedFrames[nextIndex]?.src ?? sources[nextIndex] ?? sources[0];
}

function selectFrameForPointer(clientX: number, clientY: number): number {
  const bounds = catImageBounds();
  const projectionY = bounds.top + bounds.height * POINTER_CENTER_Y_RATIO;
  const centerX = bounds.left + bounds.width * 0.5;

  if (Math.abs(clientX - centerX) + Math.abs(clientY - projectionY) < 1) {
    return Math.round(targetFramePosition * FRAME_COUNT) % FRAME_COUNT;
  }

  let bestFrame = displayedFrame;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < FRAME_COUNT; index += 1) {
    const eyePosition = frameEyePosition(index);
    const eyeX = bounds.left + bounds.width * eyePosition.x;
    const eyeY = bounds.top + bounds.height * eyePosition.y;
    const pointerAngle = Math.atan2(clientY - eyeY, clientX - eyeX);
    const lookAngle = frameLookAngle(index);
    const distance = shortestAngleDistance(pointerAngle, lookAngle);

    if (distance < bestDistance) {
      bestDistance = distance;
      bestFrame = index;
    }
  }

  return bestFrame;
}

function framePositionForPointer(clientX: number, clientY: number): number {
  return selectFrameForPointer(clientX, clientY) / FRAME_COUNT;
}

function updatePointer(event: PointerEvent): void {
  pointerPosition = { x: event.clientX, y: event.clientY };
  if (!ready) return;
  targetFramePosition = framePositionForPointer(event.clientX, event.clientY);

  if (reducedMotion.matches) {
    displayFramePosition = targetFramePosition;
    displayFrame(Math.round(displayFramePosition * FRAME_COUNT));
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

function frameRingGeometry(bounds: Bounds): { center: Point; radius: number } {
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

function rebuildFrameRing(bounds: Bounds): void {
  const { center, radius } = frameRingGeometry(bounds);
  const layoutKey = [
    center.x.toFixed(2), center.y.toFixed(2), radius.toFixed(2),
    bounds.width.toFixed(2), bounds.height.toFixed(2),
  ].join(':');

  if (layoutKey === frameRingLayoutKey) return;
  frameRingLayoutKey = layoutKey;
  frameRingSamples = Array.from({ length: FRAME_RING_SAMPLE_COUNT + 1 }, (_, index) => {
    const angle = -(index / FRAME_RING_SAMPLE_COUNT) * Math.PI * 2;
    const x = center.x + Math.cos(angle) * radius;
    const y = center.y + Math.sin(angle) * radius;
    return { x, y, angle, frame: selectFrameForPointer(x, y) };
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
    frameRingLayoutKey = '';
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

function screenEyePosition(frame: number, bounds: Bounds): Point {
  const eyePosition = frameEyePosition(frame);
  return {
    x: bounds.left + bounds.width * eyePosition.x,
    y: bounds.top + bounds.height * eyePosition.y,
  };
}

function drawLookDirection(frame: number, bounds: Bounds, radius: number, color: string): void {
  const eyePosition = screenEyePosition(frame, bounds);
  const angle = frameLookAngle(frame);
  debugContext.beginPath();
  debugContext.moveTo(eyePosition.x, eyePosition.y);
  debugContext.lineTo(
    eyePosition.x + Math.cos(angle) * radius,
    eyePosition.y + Math.sin(angle) * radius,
  );
  debugContext.strokeStyle = color;
  debugContext.lineWidth = 1.5;
  debugContext.stroke();
}

function processPointer(frame: number, bounds: Bounds, radius: number): Point {
  if (pointerPosition) return pointerPosition;
  const eyePosition = screenEyePosition(frame, bounds);
  const angle = frameLookAngle(frame);
  return {
    x: eyePosition.x + Math.cos(angle) * radius,
    y: eyePosition.y + Math.sin(angle) * radius,
  };
}

function drawPointerDirection(eyePosition: Point, pointer: Point): void {
  debugContext.save();
  debugContext.setLineDash([5, 5]);
  debugContext.beginPath();
  debugContext.moveTo(eyePosition.x, eyePosition.y);
  debugContext.lineTo(pointer.x, pointer.y);
  debugContext.strokeStyle = 'rgba(13, 153, 255, 0.82)';
  debugContext.lineWidth = 1.5;
  debugContext.stroke();
  debugContext.restore();
  drawCircle(pointer, 5, '#0d99ff', false);
}

function drawAngleProcess(targetFrame: number, bounds: Bounds): void {
  const { radius } = frameRingGeometry(bounds);
  const eyePosition = screenEyePosition(targetFrame, bounds);
  const pointer = processPointer(targetFrame, bounds, radius);
  const pointerAngle = Math.atan2(pointer.y - eyePosition.y, pointer.x - eyePosition.x);
  const arcRadius = Math.min(42, Math.max(26, Math.hypot(
    pointer.x - eyePosition.x,
    pointer.y - eyePosition.y,
  ) * 0.16));

  debugContext.beginPath();
  debugContext.moveTo(eyePosition.x, eyePosition.y);
  debugContext.lineTo(eyePosition.x + Math.min(radius, 90), eyePosition.y);
  debugContext.strokeStyle = 'rgba(22, 22, 22, 0.24)';
  debugContext.lineWidth = 1;
  debugContext.stroke();

  drawPointerDirection(eyePosition, pointer);

  debugContext.beginPath();
  debugContext.arc(eyePosition.x, eyePosition.y, arcRadius, 0, pointerAngle, pointerAngle < 0);
  debugContext.strokeStyle = '#161616';
  debugContext.lineWidth = 2;
  debugContext.stroke();

  drawCircle(eyePosition, 4, '#161616');
}

function drawFrameProcess(targetFrame: number, bounds: Bounds): void {
  const { radius } = frameRingGeometry(bounds);
  const eyePosition = screenEyePosition(targetFrame, bounds);
  const pointer = processPointer(targetFrame, bounds, radius);

  drawFrameRing(targetFrame, bounds);
  drawLookDirection(targetFrame, bounds, radius, 'rgba(22, 22, 22, 0.8)');
  drawPointerDirection(eyePosition, pointer);
  drawCircle(eyePosition, 4, '#0d99ff');
}

function drawFrameRing(targetFrame: number, bounds: Bounds): void {
  rebuildFrameRing(bounds);

  for (let index = 1; index < frameRingSamples.length; index += 1) {
    const previous = frameRingSamples[index - 1];
    const current = frameRingSamples[index];
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
      const { center, radius } = frameRingGeometry(bounds);
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

  const { center, radius } = frameRingGeometry(bounds);
  debugContext.fillStyle = 'rgba(34, 42, 51, 0.72)';
  debugContext.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
  debugContext.textAlign = 'center';
  debugContext.textBaseline = 'middle';

  for (const frame of [0, 15, 30, 45, 60, 75, 90, 105]) {
    const angle = frameLookAngle(frame);
    const x = center.x + Math.cos(angle) * (radius + 18);
    const y = center.y + Math.sin(angle) * (radius + 18);
    debugContext.fillText(String(frame + 1).padStart(3, '0'), x, y);
  }
}

function drawDebugHud(targetFrame: number): void {
  const targetAngle = (targetFrame / FRAME_COUNT) * 360;
  const displayedAngle = (displayedFrame / FRAME_COUNT) * 360;
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
    ['DISPLAYED', `${String(displayedFrame + 1).padStart(3, '0')} / 120   ${displayedAngle.toFixed(1)}°`],
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

  const bounds = catImageBounds();
  const targetFrame = Math.round(targetFramePosition * FRAME_COUNT) % FRAME_COUNT;

  if (!debugEnabled) {
    if (processStage === 'angle') drawAngleProcess(targetFrame, bounds);
    else if (processStage === 'frame') drawFrameProcess(targetFrame, bounds);
    return;
  }

  const { radius } = frameRingGeometry(bounds);
  const targetEyePosition = screenEyePosition(targetFrame, bounds);
  const displayedEyePosition = screenEyePosition(displayedFrame, bounds);

  drawFrameRing(targetFrame, bounds);
  drawLookDirection(displayedFrame, bounds, radius, 'rgba(255, 59, 114, 0.72)');
  drawLookDirection(targetFrame, bounds, radius, 'rgba(13, 153, 255, 0.9)');

  if (pointerPosition) {
    debugContext.save();
    debugContext.setLineDash([4, 4]);
    debugContext.beginPath();
    debugContext.moveTo(targetEyePosition.x, targetEyePosition.y);
    debugContext.lineTo(pointerPosition.x, pointerPosition.y);
    debugContext.strokeStyle = 'rgba(13, 153, 255, 0.72)';
    debugContext.lineWidth = 1;
    debugContext.stroke();
    debugContext.restore();
    drawCircle(pointerPosition, 5, '#0d99ff', false);
  }

  drawCircle(displayedEyePosition, 5, '#ff3b72', false);
  drawCircle(targetEyePosition, 4, '#0d99ff');
  drawDebugHud(targetFrame);
}

function render(time: number): void {
  const delta = previousRenderTime === 0
    ? 16.67
    : Math.min(time - previousRenderTime, MAX_RENDER_DELTA);
  previousRenderTime = time;

  if (ready && !reducedMotion.matches) {
    const response = 1 - Math.pow(1 - FRAME_RESPONSE, delta / 16.67);
    const framePositionDelta = shortestFramePositionDelta(targetFramePosition, displayFramePosition);
    displayFramePosition = wrapFramePosition(displayFramePosition + framePositionDelta * response);

    if (Math.abs(framePositionDelta) < 0.0005) {
      displayFramePosition = targetFramePosition;
    }

    displayFrame(Math.round(displayFramePosition * FRAME_COUNT));
  }

  drawDebug();

  requestAnimationFrame(render);
}

async function loadFrame(
  source: string,
  fetchPriority: 'high' | 'auto' = 'auto',
): Promise<HTMLImageElement> {
  const image = new Image();
  image.decoding = 'async';
  image.fetchPriority = fetchPriority;
  image.src = source;
  try {
    await image.decode();
  } catch {
    throw new Error(`Could not decode cursor-cat frame: ${source}`);
  }
  return image;
}

async function loadFrames(
  frameSources: string[],
  concurrency = 8,
  onProgress?: (loadedCount: number) => void,
): Promise<HTMLImageElement[]> {
  const frames = new Array<HTMLImageElement>(frameSources.length);
  let nextIndex = 0;
  let loadedCount = 0;

  async function loadNext(): Promise<void> {
    while (nextIndex < frameSources.length) {
      const index = nextIndex;
      nextIndex += 1;
      const source = frameSources[index];
      if (!source) continue;
      frames[index] = await loadFrame(source);
      loadedCount += 1;
      onProgress?.(loadedCount);
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
    eyePositionAnchors = manifest.gazeOrigins;
    frameScaleAnchors = manifest.displayScales;
    sources = Array.from(
      { length: FRAME_COUNT },
      (_, index) => frameSource(manifest, index),
    );
    stage.setAttribute('aria-label', manifest.ariaLabel);
    cat.alt = manifest.alt;
    loadingStatus.textContent = 'Loading 0%';
    const firstSource = sources[0];
    if (!firstSource) throw new Error('Cursor Cat requires frame 001');
    const firstFrame = await loadFrame(firstSource, 'high');
    cat.src = firstFrame.src;
    await cat.decode();
    loadingStatus.textContent = `Loading ${Math.round(100 / FRAME_COUNT)}%`;

    const frames = await loadFrames(sources.slice(1), 8, (loadedCount) => {
      const progress = Math.round(((loadedCount + 1) / FRAME_COUNT) * 100);
      loadingStatus.textContent = `Loading ${progress}%`;
    });
    decodedFrames.push(firstFrame, ...frames);
    ready = true;
    stage.classList.add('is-ready');
    stage.setAttribute('aria-busy', 'false');
    loadingStatus.textContent = '이미지 로딩 완료';
  } catch (error) {
    stage.classList.add('is-error');
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
