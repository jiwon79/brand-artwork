const UPPER_ARC_FRAME_COUNT = 49;
const LOWER_ARC_FRAME_COUNT = 49;
const ASSET_VERSION = '20260828-7';

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

  return {
    id: `U${String(index + 1).padStart(2, '0')}`,
    group: 'upper',
    index,
    total: UPPER_ARC_FRAME_COUNT,
    x: Math.cos(angle),
    y: Math.sin(angle),
    src: `./assets/cat-upper-frames/frame-${String(index + 1).padStart(3, '0')}.webp?v=${ASSET_VERSION}`,
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

const imagePointers = [centerPointer, ...upperArcPointers, ...lowerArcPointers];
const stage = document.getElementById('cat-stage');
const cat = document.getElementById('cat-frame');
const instruction = document.getElementById('instruction');
const sequenceName = document.getElementById('sequence-name');
const frameNumber = document.getElementById('frame-number');
const frameTotal = document.getElementById('frame-total');
const debugLayer = document.getElementById('pointer-debug');
const debugToggle = document.getElementById('debug-toggle');
const debugMarkers = new Map();
const decodedImages = new Map();

let ready = false;
let hasInteracted = false;
let activePointer = centerPointer;
let debugEnabled = new URLSearchParams(window.location.search).has('debug');
let pointerDirty = false;
let targetPoint = { x: 0, y: 0 };

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function normalizedOffset(delta, negativeExtent, positiveExtent) {
  const extent = delta < 0 ? negativeExtent : positiveExtent;
  return clamp(delta / Math.max(extent, 1), -1, 1);
}

function pointerPosition(event) {
  const stageBounds = stage.getBoundingClientRect();
  const catBounds = cat.getBoundingClientRect();
  const faceX = catBounds.left + catBounds.width * 0.5;
  const faceY = catBounds.top + catBounds.height * 0.32;

  return {
    x: normalizedOffset(
      event.clientX - faceX,
      faceX - stageBounds.left,
      stageBounds.right - faceX,
    ),
    y: normalizedOffset(
      event.clientY - faceY,
      faceY - stageBounds.top,
      stageBounds.bottom - faceY,
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

function updateFrame(pointer) {
  if (pointer === activePointer && cat.src.endsWith(pointer.src.slice(1))) return;

  activePointer = pointer;
  cat.src = pointer.src;
  sequenceName.textContent = pointer.group === 'center'
    ? 'P'
    : pointer.group === 'upper' ? 'U' : 'L';
  frameNumber.textContent = pointer.id;
  frameTotal.textContent = String(pointer.total);

  for (const [candidate, marker] of debugMarkers) {
    marker.classList.toggle('is-active', candidate === pointer);
  }
}

function trackPointer(event) {
  if (!ready) return;

  targetPoint = pointerPosition(event);
  pointerDirty = true;

  if (!hasInteracted) {
    hasInteracted = true;
    stage.classList.add('has-interacted');
  }
}

function screenPosition(pointer) {
  const stageBounds = stage.getBoundingClientRect();
  const catBounds = cat.getBoundingClientRect();
  const faceX = catBounds.left + catBounds.width * 0.5;
  const faceY = catBounds.top + catBounds.height * 0.32;
  const xExtent = pointer.x < 0 ? faceX - stageBounds.left : stageBounds.right - faceX;
  const yExtent = pointer.y < 0 ? faceY - stageBounds.top : stageBounds.bottom - faceY;

  return {
    x: faceX - stageBounds.left + pointer.x * xExtent,
    y: faceY - stageBounds.top + pointer.y * yExtent,
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
  debugEnabled = enabled;
  stage.classList.toggle('is-debug', enabled);
  debugToggle.setAttribute('aria-pressed', String(enabled));
  debugToggle.textContent = enabled ? 'Points on' : 'Points off';
  if (enabled) layoutDebugMarkers();
}

async function preloadFrames() {
  let loaded = 0;

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
        loaded += 1;
        instruction.textContent = `프레임 준비 중 ${Math.round((loaded / imagePointers.length) * 100)}%`;
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
  setDebugMode(debugEnabled);
  instruction.textContent = '커서를 움직여 보세요';
  stage.classList.add('is-ready');
}

function render() {
  if (ready && pointerDirty) {
    pointerDirty = false;
    updateFrame(nearestImagePointer(targetPoint));
  }

  requestAnimationFrame(render);
}

stage.addEventListener('pointermove', trackPointer);
stage.addEventListener('pointerdown', trackPointer);
debugToggle.addEventListener('pointerdown', (event) => event.stopPropagation());
debugToggle.addEventListener('click', () => setDebugMode(!debugEnabled));
window.addEventListener('resize', layoutDebugMarkers);
window.addEventListener('keydown', (event) => {
  if (event.key.toLowerCase() === 'd') setDebugMode(!debugEnabled);
});

void preloadFrames();
requestAnimationFrame(render);
