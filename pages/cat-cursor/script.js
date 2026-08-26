const FRAME_COUNT = 96;
const HOME_FRAME = 80;

const stage = document.getElementById('cat-stage');
const cat = document.getElementById('cat-frame');
const instruction = document.getElementById('instruction');
const frameNumber = document.getElementById('frame-number');

const framePaths = Array.from(
  { length: FRAME_COUNT },
  (_, index) => `./assets/cat-frames/frame-${String(index + 1).padStart(3, '0')}.webp`,
);

let ready = false;
let hasInteracted = false;
let targetPhase = HOME_FRAME / FRAME_COUNT;
let currentPhase = HOME_FRAME / FRAME_COUNT;
let currentFrame = HOME_FRAME;

function wrap01(value) {
  return ((value % 1) + 1) % 1;
}

function circularDelta(from, to) {
  let delta = to - from;
  if (delta > 0.5) delta -= 1;
  if (delta < -0.5) delta += 1;
  return delta;
}

async function preloadFrames() {
  let loaded = 0;

  await Promise.all(
    framePaths.map((src) => new Promise((resolve) => {
      const image = new Image();
      const settle = () => {
        loaded += 1;
        instruction.textContent = `프레임 준비 중 ${Math.round((loaded / FRAME_COUNT) * 100)}%`;
        resolve();
      };

      image.onload = settle;
      image.onerror = settle;
      image.src = src;
    })),
  );

  ready = true;
  cat.src = framePaths[currentFrame];
  instruction.textContent = '커서를 움직여 보세요';
  stage.classList.add('is-ready');
}

function trackPointer(event) {
  if (!ready) return;

  const bounds = cat.getBoundingClientRect();
  const faceX = bounds.left + bounds.width * 0.5;
  const faceY = bounds.top + bounds.height * 0.32;
  const deltaX = event.clientX - faceX;
  const deltaY = event.clientY - faceY;

  if (Math.hypot(deltaX, deltaY) < 32) return;

  targetPhase = wrap01(-Math.atan2(deltaY, deltaX) / (Math.PI * 2));

  if (!hasInteracted) {
    hasInteracted = true;
    stage.classList.add('has-interacted');
  }
}

function animate() {
  currentPhase = wrap01(currentPhase + circularDelta(currentPhase, targetPhase) * 0.22);
  const nextFrame = Math.round(currentPhase * FRAME_COUNT) % FRAME_COUNT;

  if (nextFrame !== currentFrame && ready) {
    currentFrame = nextFrame;
    cat.src = framePaths[currentFrame];
    frameNumber.textContent = String(currentFrame + 1).padStart(2, '0');
  }

  requestAnimationFrame(animate);
}

stage.addEventListener('pointermove', trackPointer);
stage.addEventListener('pointerdown', trackPointer);

void preloadFrames();
requestAnimationFrame(animate);
