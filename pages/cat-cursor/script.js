const SEQUENCE_CONFIG = {
  circle: {
    count: 96,
    label: 'C',
    path: (index) => `./assets/cat-frames/frame-${String(index + 1).padStart(3, '0')}.webp`,
  },
  horizontal: {
    count: 73,
    label: 'H',
    path: (index) => `./assets/cat-horizontal-frames/frame-${String(index + 1).padStart(3, '0')}.webp`,
  },
  vertical: {
    count: 73,
    label: 'V',
    path: (index) => `./assets/cat-vertical-frames/frame-${String(index + 1).padStart(3, '0')}.webp`,
  },
};

const SEQUENCE_HYSTERESIS = 0.12;
const FOLLOW_EASING = 0.16;

const stage = document.getElementById('cat-stage');
const catLayers = [
  document.getElementById('cat-frame'),
  document.getElementById('cat-frame-transition'),
];
const instruction = document.getElementById('instruction');
const sequenceName = document.getElementById('sequence-name');
const frameNumber = document.getElementById('frame-number');
const frameTotal = document.getElementById('frame-total');

const framePaths = Object.fromEntries(
  Object.entries(SEQUENCE_CONFIG).map(([name, config]) => [
    name,
    Array.from({ length: config.count }, (_, index) => config.path(index)),
  ]),
);
const allFramePaths = Object.values(framePaths).flat();

let ready = false;
let hasInteracted = false;
let currentSequence = 'horizontal';
let currentFrame = Math.floor(SEQUENCE_CONFIG.horizontal.count / 2);
let activeLayerIndex = 0;
const targetPoint = { x: 0, y: 0 };
const currentPoint = { x: 0, y: 0 };

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function wrap01(value) {
  return ((value % 1) + 1) % 1;
}

function normalizedOffset(delta, negativeExtent, positiveExtent) {
  const extent = delta < 0 ? negativeExtent : positiveExtent;
  return clamp(delta / Math.max(extent, 1), -1, 1);
}

async function preloadFrames() {
  let loaded = 0;

  await Promise.all(
    allFramePaths.map((src) => new Promise((resolve) => {
      const image = new Image();
      const settle = () => {
        loaded += 1;
        instruction.textContent = `프레임 준비 중 ${Math.round((loaded / allFramePaths.length) * 100)}%`;
        resolve();
      };

      image.onload = settle;
      image.onerror = settle;
      image.src = src;
    })),
  );

  ready = true;
  updateFrame(currentSequence, currentFrame);
  instruction.textContent = '커서를 움직여 보세요';
  stage.classList.add('is-ready');
}

function trackPointer(event) {
  if (!ready) return;

  const stageBounds = stage.getBoundingClientRect();
  const catBounds = catLayers[activeLayerIndex].getBoundingClientRect();
  const faceX = catBounds.left + catBounds.width * 0.5;
  const faceY = catBounds.top + catBounds.height * 0.32;

  targetPoint.x = normalizedOffset(
    event.clientX - faceX,
    faceX - stageBounds.left,
    stageBounds.right - faceX,
  );
  targetPoint.y = normalizedOffset(
    event.clientY - faceY,
    faceY - stageBounds.top,
    stageBounds.bottom - faceY,
  );

  if (!hasInteracted) {
    hasInteracted = true;
    stage.classList.add('has-interacted');
  }
}

function sequenceScores(point) {
  return {
    circle: Math.abs(Math.hypot(point.x, point.y) - 1),
    horizontal: Math.abs(point.y),
    vertical: Math.abs(point.x),
  };
}

function chooseSequence(point) {
  const scores = sequenceScores(point);
  const closestSequence = Object.entries(scores).reduce(
    (closest, entry) => (entry[1] < closest[1] ? entry : closest),
  )[0];

  if (scores[currentSequence] <= scores[closestSequence] + SEQUENCE_HYSTERESIS) {
    return currentSequence;
  }

  return closestSequence;
}

function frameForPoint(sequence, point) {
  const lastFrame = SEQUENCE_CONFIG[sequence].count - 1;

  if (sequence === 'circle') {
    const phase = wrap01(-Math.atan2(point.y, point.x) / (Math.PI * 2));
    return Math.round(phase * SEQUENCE_CONFIG.circle.count) % SEQUENCE_CONFIG.circle.count;
  }

  if (sequence === 'horizontal') {
    return Math.round(((1 - point.x) * 0.5) * lastFrame);
  }

  return Math.round(((point.y + 1) * 0.5) * lastFrame);
}

function updateFrame(sequence, frame) {
  const sequenceChanged = sequence !== currentSequence;

  if (sequenceChanged) {
    const incomingLayerIndex = 1 - activeLayerIndex;
    const outgoingLayer = catLayers[activeLayerIndex];
    const incomingLayer = catLayers[incomingLayerIndex];

    incomingLayer.src = framePaths[sequence][frame];
    incomingLayer.classList.add('is-visible');
    outgoingLayer.classList.remove('is-visible');
    activeLayerIndex = incomingLayerIndex;
  } else {
    catLayers[activeLayerIndex].src = framePaths[sequence][frame];
  }

  currentSequence = sequence;
  currentFrame = frame;
  sequenceName.textContent = SEQUENCE_CONFIG[sequence].label;
  frameNumber.textContent = String(frame + 1).padStart(2, '0');
  frameTotal.textContent = String(SEQUENCE_CONFIG[sequence].count);
}

function animate() {
  currentPoint.x += (targetPoint.x - currentPoint.x) * FOLLOW_EASING;
  currentPoint.y += (targetPoint.y - currentPoint.y) * FOLLOW_EASING;

  const nextSequence = chooseSequence(currentPoint);
  const nextFrame = frameForPoint(nextSequence, currentPoint);

  if (ready && (nextSequence !== currentSequence || nextFrame !== currentFrame)) {
    updateFrame(nextSequence, nextFrame);
  }

  requestAnimationFrame(animate);
}

stage.addEventListener('pointermove', trackPointer);
stage.addEventListener('pointerdown', trackPointer);

void preloadFrames();
requestAnimationFrame(animate);
