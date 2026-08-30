import GUI from 'lil-gui';
import { CURSOR_CAT_ASSET_BASE_URL } from './config';

const POINTER_PADDING_RATIO = 0.15;
const FACE_CENTER_Y_RATIO = 0.47;
const DEFAULT_TRANSITION_FRAME_RATE = 36;
const MAX_DISTANCE_FRAME_RATE_MULTIPLIER = 3;
const FULL_SPEED_PATH_DISTANCE = 48;
const MAX_RENDER_DELTA = 100;
const DEFAULT_ANIMAL_ID = 'main';
const ANIMAL_ID_PATTERN = /^[a-z0-9]{10}$/;

interface ManifestAssets {
  poster: string;
  center: string;
  left: string;
  right: string;
  upper: string;
  lower: string;
  centerLeft: string;
  centerRight: string;
  centerTop: string;
  centerBottom: string;
}

interface CursorAnimalManifest {
  schemaVersion: 1;
  id: string;
  version: string;
  name: string;
  alt: string;
  ariaLabel: string;
  frameCounts: {
    arc: number;
    radial: number;
  };
  assets: ManifestAssets;
}

interface Point {
  x: number;
  y: number;
}

interface ImagePointer extends Point {
  id: string;
  group: string;
  src: string;
  index?: number;
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

const stage = requiredElement('cat-stage', HTMLElement);
const animal = requiredElement('animal-frame', HTMLImageElement);
const loadingStatus = requiredElement('loading-status', HTMLElement);
const debugLayer = requiredElement('pointer-debug', HTMLElement);
const debugMarkers = new Map<ImagePointer, HTMLElement>();
const decodedImages = new Map<string, HTMLImageElement>();
const guiState = {
  debugPoints: new URLSearchParams(window.location.search).has('debug'),
  frameRate: DEFAULT_TRANSITION_FRAME_RATE,
};
const gui = new GUI({ title: 'Cursor Animal' });

let imagePointers: ImagePointer[] = [];
let pointerNeighbors = new Map<ImagePointer, Set<ImagePointer>>();
let activePointer: ImagePointer | null = null;
let targetPointer: ImagePointer | null = null;
let ready = false;
let pointerDirty = false;
let targetPoint: Point = { x: 0, y: 0 };
let lastRenderTime = 0;
let transitionStepBudget = 0;

function animalIdFromPath(): string | null {
  const parts = window.location.pathname.split('/').filter(Boolean);
  const pageIndex = parts.lastIndexOf('cursor-cat');
  const candidate = parts[pageIndex + 1];

  if (!candidate || candidate === 'index.html') return DEFAULT_ANIMAL_ID;
  return ANIMAL_ID_PATTERN.test(candidate) ? candidate : null;
}

function manifestUrl(animalId: string): string {
  return `${CURSOR_CAT_ASSET_BASE_URL.replace(/\/$/, '')}/${animalId}/manifest.json`;
}

function assetUrl(manifest: CursorAnimalManifest, path: string): string {
  const baseUrl = CURSOR_CAT_ASSET_BASE_URL.replace(/\/$/, '');
  return `${baseUrl}/${manifest.id}/${path}?v=${encodeURIComponent(manifest.version)}`;
}

function framePath(pattern: string, index: number): string {
  return pattern.replace('{frame}', String(index).padStart(3, '0'));
}

function validateManifest(
  manifest: unknown,
  expectedId: string,
): asserts manifest is CursorAnimalManifest {
  const candidate = manifest as Partial<CursorAnimalManifest> | null;
  const frameCounts = candidate?.frameCounts;
  if (
    candidate?.schemaVersion !== 1
    || candidate.id !== expectedId
    || typeof candidate.version !== 'string'
    || typeof candidate.name !== 'string'
    || typeof candidate.alt !== 'string'
    || typeof candidate.ariaLabel !== 'string'
    || !Number.isInteger(frameCounts?.arc)
    || !Number.isInteger(frameCounts?.radial)
    || !frameCounts
    || frameCounts.arc < 3
    || frameCounts.arc % 2 === 0
    || frameCounts.radial < 3
  ) {
    throw new Error('Invalid cursor-animal manifest');
  }

  const requiredAssets: Array<keyof ManifestAssets> = [
    'poster', 'center', 'left', 'right',
    'upper', 'lower', 'centerLeft', 'centerRight', 'centerTop', 'centerBottom',
  ];
  if (requiredAssets.some((key) => typeof candidate.assets?.[key] !== 'string')) {
    throw new Error('Cursor-animal manifest is missing assets');
  }
}

function createPointerGraph(manifest: CursorAnimalManifest): void {
  const arcFrameCount = manifest.frameCounts.arc;
  const radialFrameCount = manifest.frameCounts.radial;
  const source = (path: string): string => assetUrl(manifest, path);
  const centerPointer: ImagePointer = {
    id: 'CENTER',
    group: 'center',
    x: 0,
    y: 0,
    src: source(manifest.assets.center),
  };

  const upperArcPointers = Array.from({ length: arcFrameCount }, (_, index): ImagePointer => {
    const progress = index / (arcFrameCount - 1);
    const angle = -progress * Math.PI;

    return {
      id: `U${String(index + 1).padStart(2, '0')}`,
      group: 'upper',
      x: Math.cos(angle),
      y: Math.sin(angle),
      src: index === 0
        ? source(manifest.assets.right)
        : index === arcFrameCount - 1
          ? source(manifest.assets.left)
          : source(framePath(manifest.assets.upper, index + 1)),
    };
  });

  const lowerArcPointers = Array.from(
    { length: arcFrameCount - 2 },
    (_, index): ImagePointer => {
    const sourceIndex = index + 1;
    const progress = sourceIndex / (arcFrameCount - 1);
    const angle = Math.PI * (1 - progress);

    return {
      id: `L${String(sourceIndex + 1).padStart(2, '0')}`,
      group: 'lower',
      index: sourceIndex,
      x: Math.cos(angle),
      y: Math.sin(angle),
      src: source(framePath(manifest.assets.lower, sourceIndex + 1)),
    };
    },
  );

  function createRadialPointers(
    side: string,
    xDirection: number,
    yDirection: number,
    idPrefix: string,
    pattern: string,
  ): ImagePointer[] {
    return Array.from({ length: radialFrameCount - 2 }, (_, index): ImagePointer => {
      const sourceIndex = index + 1;
      const progress = sourceIndex / (radialFrameCount - 1);

      return {
        id: `${idPrefix}${String(sourceIndex + 1).padStart(2, '0')}`,
        group: `center-${side}`,
        x: xDirection * progress,
        y: yDirection * progress,
        src: source(framePath(pattern, sourceIndex + 1)),
      };
    });
  }

  const centerRightPointers = createRadialPointers(
    'right', 1, 0, 'HR', manifest.assets.centerRight,
  );
  const centerLeftPointers = createRadialPointers(
    'left', -1, 0, 'HL', manifest.assets.centerLeft,
  );
  const centerTopPointers = createRadialPointers(
    'top', 0, -1, 'VT', manifest.assets.centerTop,
  );
  const centerBottomPointers = createRadialPointers(
    'bottom', 0, 1, 'VB', manifest.assets.centerBottom,
  );

  imagePointers = [
    centerPointer,
    ...centerRightPointers,
    ...centerLeftPointers,
    ...centerTopPointers,
    ...centerBottomPointers,
    ...upperArcPointers,
    ...lowerArcPointers,
  ];
  pointerNeighbors = new Map(imagePointers.map((pointer) => [pointer, new Set()]));

  const rightPointer = upperArcPointers[0];
  const topPointer = upperArcPointers[(arcFrameCount - 1) / 2];
  const leftPointer = upperArcPointers[arcFrameCount - 1];
  const bottomPointer = lowerArcPointers.find((pointer) => (
    pointer.index === (arcFrameCount - 1) / 2
  ));
  if (!rightPointer || !topPointer || !leftPointer || !bottomPointer) {
    throw new Error('Cursor Cat is missing a cardinal pointer');
  }

  function connectPointerPath(path: ImagePointer[]): void {
    for (let index = 1; index < path.length; index += 1) {
      const previous = path[index - 1];
      const current = path[index];
      pointerNeighbors.get(previous)?.add(current);
      pointerNeighbors.get(current)?.add(previous);
    }
  }

  connectPointerPath(upperArcPointers);
  connectPointerPath([leftPointer, ...lowerArcPointers, rightPointer]);
  connectPointerPath([centerPointer, ...centerRightPointers, rightPointer]);
  connectPointerPath([centerPointer, ...centerLeftPointers, leftPointer]);
  connectPointerPath([centerPointer, ...centerTopPointers, topPointer]);
  connectPointerPath([centerPointer, ...centerBottomPointers, bottomPointer]);

  activePointer = centerPointer;
  targetPointer = centerPointer;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function normalizedOffset(
  delta: number,
  negativeExtent: number,
  positiveExtent: number,
): number {
  const extent = delta < 0 ? negativeExtent : positiveExtent;
  return clamp(delta / Math.max(extent, 1), -1, 1);
}

function pointerRadius(stageBounds: DOMRect): number {
  const shortSide = Math.min(stageBounds.width, stageBounds.height);
  return Math.max(shortSide * (0.5 - POINTER_PADDING_RATIO), 1);
}

function pointerPosition(event: PointerEvent): Point {
  const stageBounds = stage.getBoundingClientRect();
  const animalBounds = animal.getBoundingClientRect();
  const faceX = animalBounds.left + animalBounds.width * 0.5;
  const faceY = animalBounds.top + animalBounds.height * FACE_CENTER_Y_RATIO;
  const radius = pointerRadius(stageBounds);

  return {
    x: normalizedOffset(event.clientX - faceX, radius, radius),
    y: normalizedOffset(event.clientY - faceY, radius, radius),
  };
}

function nearestImagePointer(point: Point): ImagePointer {
  const firstPointer = imagePointers[0];
  if (!firstPointer) throw new Error('Cursor Cat has no image pointers');

  return imagePointers.reduce<{ pointer: ImagePointer; distanceSquared: number }>((nearest, pointer) => {
    const dx = point.x - pointer.x;
    const dy = point.y - pointer.y;
    const distanceSquared = dx * dx + dy * dy;

    return distanceSquared < nearest.distanceSquared
      ? { pointer, distanceSquared }
      : nearest;
  }, { pointer: firstPointer, distanceSquared: Number.POSITIVE_INFINITY }).pointer;
}

function pointerPath(start: ImagePointer, target: ImagePointer): ImagePointer[] {
  if (start === target) return [];

  const queue = [start];
  const previous = new Map<ImagePointer, ImagePointer | null>([[start, null]]);

  for (let queueIndex = 0; queueIndex < queue.length; queueIndex += 1) {
    const current = queue[queueIndex];

    for (const neighbor of pointerNeighbors.get(current) ?? []) {
      if (previous.has(neighbor)) continue;
      previous.set(neighbor, current);

      if (neighbor === target) {
        const path = [target];
        let pathPointer = target;

        while (previous.get(pathPointer) !== start) {
          const priorPointer = previous.get(pathPointer);
          if (!priorPointer) return [target];
          pathPointer = priorPointer;
          path.unshift(pathPointer);
        }

        return path;
      }

      queue.push(neighbor);
    }
  }

  return [target];
}

function updateFrame(pointer: ImagePointer): void {
  if (pointer === activePointer && animal.src === pointer.src) return;

  activePointer = pointer;
  animal.src = pointer.src;

  for (const [candidate, marker] of debugMarkers) {
    marker.classList.toggle('is-active', candidate === pointer);
  }
}

function trackPointer(event: PointerEvent): void {
  if (!ready) return;
  targetPoint = pointerPosition(event);
  pointerDirty = true;
}

function screenPosition(pointer: ImagePointer): Point {
  const stageBounds = stage.getBoundingClientRect();
  const animalBounds = animal.getBoundingClientRect();
  const faceX = animalBounds.left + animalBounds.width * 0.5;
  const faceY = animalBounds.top + animalBounds.height * FACE_CENTER_Y_RATIO;
  const radius = pointerRadius(stageBounds);

  return {
    x: faceX - stageBounds.left + pointer.x * radius,
    y: faceY - stageBounds.top + pointer.y * radius,
  };
}

function layoutDebugMarkers(): void {
  for (const [pointer, marker] of debugMarkers) {
    const position = screenPosition(pointer);
    marker.style.left = `${position.x}px`;
    marker.style.top = `${position.y}px`;
  }
}

function createDebugMarkers(): void {
  for (const pointer of imagePointers) {
    const marker = document.createElement('span');
    marker.className = `image-pointer image-pointer--${pointer.group}`;
    marker.dataset.label = pointer.id;
    marker.classList.toggle('is-active', pointer === activePointer);
    debugLayer.append(marker);
    debugMarkers.set(pointer, marker);
  }
  layoutDebugMarkers();
}

function setDebugMode(enabled: boolean): void {
  guiState.debugPoints = enabled;
  debugController.updateDisplay();
  gui.show(enabled);
  stage.classList.toggle('is-debug', enabled);
  if (enabled && ready) layoutDebugMarkers();
}

const debugController = gui.add(guiState, 'debugPoints')
  .name('Debug points')
  .onChange(setDebugMode);
gui.add(guiState, 'frameRate', 12, 120, 1).name('Frame rate');
gui.show(guiState.debugPoints);

async function preloadFrames(): Promise<void> {
  let loadedFrameCount = 0;
  loadingStatus.textContent = `이미지 로딩 중 0 / ${imagePointers.length}`;

  await Promise.all(
    imagePointers.map(({ src }) => new Promise<void>((resolve) => {
      const image = new Image();
      image.decoding = 'async';

      const settle = async (): Promise<void> => {
        try {
          await image.decode();
        } catch {
          // A failed frame must not block the rest of the interaction.
        }
        decodedImages.set(src, image);
        loadedFrameCount += 1;
        loadingStatus.textContent = `이미지 로딩 중 ${loadedFrameCount} / ${imagePointers.length}`;
        resolve();
      };

      image.onload = settle;
      image.onerror = settle;
      image.src = src;
    })),
  );
}

async function initialize(): Promise<void> {
  const animalId = animalIdFromPath();
  if (!animalId) throw new Error('Unknown cursor-animal route');

  const response = await fetch(manifestUrl(animalId), { mode: 'cors' });
  if (!response.ok) throw new Error(`Animal manifest returned ${response.status}`);

  const manifest: unknown = await response.json();
  validateManifest(manifest, animalId);
  createPointerGraph(manifest);

  document.title = manifest.name;
  stage.setAttribute('aria-label', manifest.ariaLabel);
  animal.alt = manifest.alt;
  animal.src = assetUrl(manifest, manifest.assets.poster);
  stage.classList.add('is-poster-ready');

  await preloadFrames();
  ready = true;
  if (!activePointer) throw new Error('Cursor Cat has no active pointer');
  updateFrame(activePointer);
  createDebugMarkers();
  setDebugMode(guiState.debugPoints);
  stage.setAttribute('aria-busy', 'false');
  stage.classList.add('is-ready');
}

function render(timestamp: number): void {
  const frameDelta = lastRenderTime === 0
    ? 0
    : Math.min(timestamp - lastRenderTime, MAX_RENDER_DELTA);
  lastRenderTime = timestamp;

  if (ready && pointerDirty) {
    pointerDirty = false;
    targetPointer = nearestImagePointer(targetPoint);
  }

  if (ready && activePointer && targetPointer && activePointer !== targetPointer) {
    const path = pointerPath(activePointer, targetPointer);
    const distanceRatio = clamp(path.length / FULL_SPEED_PATH_DISTANCE, 0, 1);
    const transitionFrameRate = guiState.frameRate
      * (1 + (MAX_DISTANCE_FRAME_RATE_MULTIPLIER - 1) * distanceRatio);

    transitionStepBudget += (frameDelta * transitionFrameRate) / 1000;

    const stepCount = Math.min(Math.floor(transitionStepBudget), path.length);
    if (stepCount > 0) {
      transitionStepBudget -= stepCount;
      const nextPointer = path[stepCount - 1];
      if (nextPointer) updateFrame(nextPointer);
    }
  } else {
    transitionStepBudget = 0;
  }

  requestAnimationFrame(render);
}

stage.addEventListener('pointermove', trackPointer);
stage.addEventListener('pointerdown', trackPointer);
window.addEventListener('resize', layoutDebugMarkers);
window.addEventListener('keydown', (event) => {
  if (event.key.toLowerCase() === 'd') setDebugMode(!guiState.debugPoints);
});

void initialize().catch((error) => {
  console.error(error);
  stage.setAttribute('aria-busy', 'false');
  loadingStatus.textContent = '이미지를 불러오지 못했습니다';
  stage.classList.add('is-error');
});
requestAnimationFrame(render);
