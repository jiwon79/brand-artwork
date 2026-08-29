import GUI from './vendor/lil-gui.esm.min.js';

const UPPER_ARC_FRAME_COUNT = 49;
const LOWER_ARC_FRAME_COUNT = 49;
const RADIAL_FRAME_COUNT = 24;
const POINTER_PADDING_RATIO = 0.15;
const FACE_CENTER_Y_RATIO = 0.47;
const MIN_TRANSITION_FRAME_RATE = 48;
const MAX_TRANSITION_FRAME_RATE = 144;
const FULL_SPEED_PATH_DISTANCE = 48;
const MAX_RENDER_DELTA = 100;
const ASSET_VERSION = '20260829-13';
const RIGHT_REFERENCE_SRC = `./assets/source/cat-reference-right-9x16.png?v=${ASSET_VERSION}`;
const LEFT_REFERENCE_SRC = `./assets/source/cat-reference-left-9x16.png?v=${ASSET_VERSION}`;

const centerPointer = {
  id: 'CENTER',
  group: 'center',
  index: 0,
  total: 1,
  x: 0,
  y: 0,
  src: `./assets/cat-center.webp?v=${ASSET_VERSION}`,
};

const upperArcPointers = Array.from({ length: UPPER_ARC_FRAME_COUNT }, (_, index) => {
  const progress = index / (UPPER_ARC_FRAME_COUNT - 1);
  const angle = -progress * Math.PI;
  const isRightEndpoint = index === 0;
  const isLeftEndpoint = index === UPPER_ARC_FRAME_COUNT - 1;

  return {
    id: `U${String(index + 1).padStart(2, '0')}`,
    group: 'upper',
    index,
    total: UPPER_ARC_FRAME_COUNT,
    x: Math.cos(angle),
    y: Math.sin(angle),
    src: isRightEndpoint
      ? RIGHT_REFERENCE_SRC
      : isLeftEndpoint
        ? LEFT_REFERENCE_SRC
        : `./assets/cat-upper-frames/frame-${String(index + 1).padStart(3, '0')}.webp?v=${ASSET_VERSION}`,
  };
});

const lowerArcPointers = Array.from({ length: LOWER_ARC_FRAME_COUNT - 2 }, (_, index) => {
  const sourceIndex = index + 1;
  const progress = sourceIndex / (LOWER_ARC_FRAME_COUNT - 1);
  const angle = Math.PI * (1 - progress);

  return {
    id: `L${String(sourceIndex + 1).padStart(2, '0')}`,
    group: 'lower',
    index: sourceIndex,
    total: LOWER_ARC_FRAME_COUNT,
    x: Math.cos(angle),
    y: Math.sin(angle),
    src: `./assets/cat-lower-frames/frame-${String(sourceIndex + 1).padStart(3, '0')}.webp?v=${ASSET_VERSION}`,
  };
});

function createRadialPointers(side, xDirection, yDirection, idPrefix) {
  return Array.from({ length: RADIAL_FRAME_COUNT - 2 }, (_, index) => {
    const sourceIndex = index + 1;
    const progress = sourceIndex / (RADIAL_FRAME_COUNT - 1);

    return {
      id: `${idPrefix}${String(sourceIndex + 1).padStart(2, '0')}`,
      group: `center-${side}`,
      index: sourceIndex,
      total: RADIAL_FRAME_COUNT,
      x: xDirection * progress,
      y: yDirection * progress,
      src: `./assets/cat-center-${side}-frames/frame-${String(sourceIndex + 1).padStart(3, '0')}.webp?v=${ASSET_VERSION}`,
    };
  });
}

const centerRightPointers = createRadialPointers('right', 1, 0, 'HR');
const centerLeftPointers = createRadialPointers('left', -1, 0, 'HL');
const centerTopPointers = createRadialPointers('top', 0, -1, 'VT');
const centerBottomPointers = createRadialPointers('bottom', 0, 1, 'VB');

const imagePointers = [
  centerPointer,
  ...centerRightPointers,
  ...centerLeftPointers,
  ...centerTopPointers,
  ...centerBottomPointers,
  ...upperArcPointers,
  ...lowerArcPointers,
];

const rightPointer = upperArcPointers[0];
const topPointer = upperArcPointers[(UPPER_ARC_FRAME_COUNT - 1) / 2];
const leftPointer = upperArcPointers[UPPER_ARC_FRAME_COUNT - 1];
const bottomPointer = lowerArcPointers.find((pointer) => (
  pointer.index === (LOWER_ARC_FRAME_COUNT - 1) / 2
));
const pointerNeighbors = new Map(imagePointers.map((pointer) => [pointer, new Set()]));

function connectPointerPath(path) {
  for (let index = 1; index < path.length; index += 1) {
    const previous = path[index - 1];
    const current = path[index];
    pointerNeighbors.get(previous).add(current);
    pointerNeighbors.get(current).add(previous);
  }
}

connectPointerPath(upperArcPointers);
connectPointerPath([leftPointer, ...lowerArcPointers, rightPointer]);
connectPointerPath([centerPointer, ...centerRightPointers, rightPointer]);
connectPointerPath([centerPointer, ...centerLeftPointers, leftPointer]);
connectPointerPath([centerPointer, ...centerTopPointers, topPointer]);
connectPointerPath([centerPointer, ...centerBottomPointers, bottomPointer]);

const stage = document.getElementById('cat-stage');
const cat = document.getElementById('cat-frame');
const debugLayer = document.getElementById('pointer-debug');
const debugMarkers = new Map();
const decodedImages = new Map();
const guiState = { debugPoints: false };
const gui = new GUI({ title: 'Cat Cursor' });

let ready = false;
let activePointer = centerPointer;
let targetPointer = centerPointer;
let pointerDirty = false;
let targetPoint = { x: 0, y: 0 };
let lastRenderTime = 0;
let transitionStepBudget = 0;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function normalizedOffset(delta, negativeExtent, positiveExtent) {
  const extent = delta < 0 ? negativeExtent : positiveExtent;
  return clamp(delta / Math.max(extent, 1), -1, 1);
}

function pointerRadius(stageBounds) {
  const shortSide = Math.min(stageBounds.width, stageBounds.height);
  return Math.max(shortSide * (0.5 - POINTER_PADDING_RATIO), 1);
}

function pointerPosition(event) {
  const stageBounds = stage.getBoundingClientRect();
  const catBounds = cat.getBoundingClientRect();
  const faceX = catBounds.left + catBounds.width * 0.5;
  const faceY = catBounds.top + catBounds.height * FACE_CENTER_Y_RATIO;
  const radius = pointerRadius(stageBounds);

  return {
    x: normalizedOffset(
      event.clientX - faceX,
      radius,
      radius,
    ),
    y: normalizedOffset(
      event.clientY - faceY,
      radius,
      radius,
    ),
  };
}

function nearestImagePointer(point) {
  return imagePointers.reduce((nearest, pointer) => {
    const dx = point.x - pointer.x;
    const dy = point.y - pointer.y;
    const distanceSquared = dx * dx + dy * dy;

    return distanceSquared < nearest.distanceSquared
      ? { pointer, distanceSquared }
      : nearest;
  }, { pointer: imagePointers[0], distanceSquared: Number.POSITIVE_INFINITY }).pointer;
}

function pointerPath(start, target) {
  if (start === target) return [];

  const queue = [start];
  const previous = new Map([[start, null]]);

  for (let queueIndex = 0; queueIndex < queue.length; queueIndex += 1) {
    const current = queue[queueIndex];

    for (const neighbor of pointerNeighbors.get(current)) {
      if (previous.has(neighbor)) continue;
      previous.set(neighbor, current);

      if (neighbor === target) {
        const path = [target];
        let pathPointer = target;

        while (previous.get(pathPointer) !== start) {
          pathPointer = previous.get(pathPointer);
          path.unshift(pathPointer);
        }

        return path;
      }

      queue.push(neighbor);
    }
  }

  return [target];
}

function updateFrame(pointer) {
  if (pointer === activePointer && cat.src.endsWith(pointer.src.slice(1))) return;

  activePointer = pointer;
  cat.src = pointer.src;

  for (const [candidate, marker] of debugMarkers) {
    marker.classList.toggle('is-active', candidate === pointer);
  }
}

function trackPointer(event) {
  if (!ready) return;

  targetPoint = pointerPosition(event);
  pointerDirty = true;
}

function screenPosition(pointer) {
  const stageBounds = stage.getBoundingClientRect();
  const catBounds = cat.getBoundingClientRect();
  const faceX = catBounds.left + catBounds.width * 0.5;
  const faceY = catBounds.top + catBounds.height * FACE_CENTER_Y_RATIO;
  const radius = pointerRadius(stageBounds);

  return {
    x: faceX - stageBounds.left + pointer.x * radius,
    y: faceY - stageBounds.top + pointer.y * radius,
  };
}

function layoutDebugMarkers() {
  for (const [pointer, marker] of debugMarkers) {
    const position = screenPosition(pointer);
    marker.style.left = `${position.x}px`;
    marker.style.top = `${position.y}px`;
  }
}

function createDebugMarkers() {
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

function setDebugMode(enabled) {
  stage.classList.toggle('is-debug', enabled);
  if (enabled) layoutDebugMarkers();
}

gui.add(guiState, 'debugPoints')
  .name('Debug points')
  .onChange(setDebugMode);

async function preloadFrames() {
  await Promise.all(
    imagePointers.map(({ src }) => new Promise((resolve) => {
      const image = new Image();
      image.decoding = 'async';

      const settle = async () => {
        try {
          await image.decode();
        } catch {
          // A failed frame must not block the rest of the interaction.
        }

        decodedImages.set(src, image);
        resolve();
      };

      image.onload = settle;
      image.onerror = settle;
      image.src = src;
    })),
  );

  ready = true;
  updateFrame(activePointer);
  createDebugMarkers();
  setDebugMode(guiState.debugPoints);
  stage.classList.add('is-ready');
}

function render(timestamp) {
  const frameDelta = lastRenderTime === 0
    ? 0
    : Math.min(timestamp - lastRenderTime, MAX_RENDER_DELTA);
  lastRenderTime = timestamp;

  if (ready && pointerDirty) {
    pointerDirty = false;
    targetPointer = nearestImagePointer(targetPoint);
  }

  if (ready && activePointer !== targetPointer) {
    const path = pointerPath(activePointer, targetPointer);
    const distanceRatio = clamp(path.length / FULL_SPEED_PATH_DISTANCE, 0, 1);
    const transitionFrameRate = MIN_TRANSITION_FRAME_RATE
      + (MAX_TRANSITION_FRAME_RATE - MIN_TRANSITION_FRAME_RATE) * distanceRatio;

    transitionStepBudget += (frameDelta * transitionFrameRate) / 1000;

    const stepCount = Math.min(Math.floor(transitionStepBudget), path.length);
    if (stepCount > 0) {
      transitionStepBudget -= stepCount;
      updateFrame(path[stepCount - 1]);
    }
  } else {
    transitionStepBudget = 0;
  }

  requestAnimationFrame(render);
}

stage.addEventListener('pointermove', trackPointer);
stage.addEventListener('pointerdown', trackPointer);
window.addEventListener('resize', layoutDebugMarkers);

void preloadFrames();
requestAnimationFrame(render);
