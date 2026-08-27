const CIRCLE_FRAME_COUNT = 96;

const circlePointers = Array.from({ length: CIRCLE_FRAME_COUNT }, (_, index) => {
  const angle = -(index / CIRCLE_FRAME_COUNT) * Math.PI * 2;

  return {
    id: `C${String(index + 1).padStart(2, '0')}`,
    group: 'circle',
    index,
    total: CIRCLE_FRAME_COUNT,
    x: Math.cos(angle),
    y: Math.sin(angle),
    src: `./assets/cat-frames/frame-${String(index + 1).padStart(3, '0')}.webp`,
  };
});

const generatedPointers = [
  { id: 'CENTER', x: 0, y: 0, src: './assets/cat-generated-cross/center.webp' },
  { id: 'R25', x: 0.25, y: 0, src: './assets/cat-generated-cross/right-25.webp' },
  { id: 'R50', x: 0.5, y: 0, src: './assets/cat-generated-cross/right-50.webp' },
  { id: 'R75', x: 0.75, y: 0, src: './assets/cat-generated-cross/right-75.webp' },
  { id: 'L25', x: -0.25, y: 0, src: './assets/cat-generated-cross/left-25.webp' },
  { id: 'L50', x: -0.5, y: 0, src: './assets/cat-generated-cross/left-50.webp' },
  { id: 'L75', x: -0.75, y: 0, src: './assets/cat-generated-cross/left-75.webp' },
  { id: 'U25', x: 0, y: -0.25, src: './assets/cat-generated-cross/up-25.webp' },
  { id: 'U50', x: 0, y: -0.5, src: './assets/cat-generated-cross/up-50.webp' },
  { id: 'U75', x: 0, y: -0.75, src: './assets/cat-generated-cross/up-75.webp' },
  { id: 'D25', x: 0, y: 0.25, src: './assets/cat-generated-cross/down-25.webp' },
  { id: 'D50', x: 0, y: 0.5, src: './assets/cat-generated-cross/down-50.webp' },
  { id: 'D75', x: 0, y: 0.75, src: './assets/cat-generated-cross/down-75.webp' },
].map((pointer, index, pointers) => ({
  ...pointer,
  group: 'generated',
  index,
  total: pointers.length,
}));

const imagePointers = [...circlePointers, ...generatedPointers];
const stage = document.getElementById('cat-stage');
const cat = document.getElementById('cat-frame');
const instruction = document.getElementById('instruction');
const sequenceName = document.getElementById('sequence-name');
const frameNumber = document.getElementById('frame-number');
const frameTotal = document.getElementById('frame-total');
const debugLayer = document.getElementById('pointer-debug');
const debugMarkers = new Map();

let ready = false;
let hasInteracted = false;
let activePointer = generatedPointers[0];
let debugEnabled = new URLSearchParams(window.location.search).has('debug');

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
  sequenceName.textContent = pointer.group === 'circle' ? 'C' : 'P';
  frameNumber.textContent = pointer.id;
  frameTotal.textContent = String(pointer.total);

  for (const [candidate, marker] of debugMarkers) {
    marker.classList.toggle('is-active', candidate === pointer);
  }
}

function trackPointer(event) {
  if (!ready) return;

  updateFrame(nearestImagePointer(pointerPosition(event)));

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
  if (enabled) layoutDebugMarkers();
}

async function preloadFrames() {
  let loaded = 0;

  await Promise.all(
    imagePointers.map(({ src }) => new Promise((resolve) => {
      const image = new Image();
      const settle = () => {
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

stage.addEventListener('pointermove', trackPointer);
stage.addEventListener('pointerdown', trackPointer);
window.addEventListener('resize', layoutDebugMarkers);
window.addEventListener('keydown', (event) => {
  if (event.key.toLowerCase() === 'd') setDebugMode(!debugEnabled);
});

void preloadFrames();
