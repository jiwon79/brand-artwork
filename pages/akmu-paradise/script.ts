const flowerModules = import.meta.glob<string>('./assets/flowers/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
});
const FLOWER_IMAGES: string[] = Object.keys(flowerModules)
  .sort()
  .map((key) => flowerModules[key]);

const SPAWN_DISTANCE = 10;
const CLUSTER_COUNT = 4;
const CLUSTER_SPREAD = 32;

const canvas = document.getElementById('canvas') as HTMLDivElement;
const hint = document.getElementById('hint') as HTMLDivElement;

let isDragging = false;
let lastSpawnPos: { x: number; y: number } | null = null;
let hintHidden = false;

function randomBetween(a: number, b: number): number {
  return a + Math.random() * (b - a);
}

function spawnOne(x: number, y: number): void {
  const size = randomBetween(22, 52);
  const ox = randomBetween(-CLUSTER_SPREAD, CLUSTER_SPREAD);
  const oy = randomBetween(-CLUSTER_SPREAD, CLUSTER_SPREAD);
  const rotStart = randomBetween(-180, 180);
  const rotEnd = randomBetween(-15, 15);
  const delay = randomBetween(0, 0.12);

  const wrapper = document.createElement('div');
  wrapper.className = 'flower-wrapper';
  wrapper.style.position = 'absolute';
  wrapper.style.left = (x - size / 2 + ox) + 'px';
  wrapper.style.top = (y - size / 2 + oy) + 'px';
  wrapper.style.width = size + 'px';
  wrapper.style.height = size + 'px';
  wrapper.style.setProperty('--rot-start', rotStart + 'deg');
  wrapper.style.setProperty('--rot-end', rotEnd + 'deg');
  wrapper.style.transformOrigin = 'center bottom';
  wrapper.style.animation = `bloom 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) ${delay}s both`;
  wrapper.style.pointerEvents = 'none';

  // 흰 글로우 — 약하게
  const glow = document.createElement('div');
  const glowSize = size * 1.15;
  glow.style.cssText = `
    position: absolute;
    top: 50%; left: 50%;
    transform: translate(-50%, -50%);
    width: ${glowSize}px;
    height: ${glowSize}px;
    background: radial-gradient(ellipse, rgba(255,255,255,0.2) 0%, rgba(255,255,255,0) 70%);
    border-radius: 50%;
    pointer-events: none;
  `;

  // 그림자 타원
  const shadow = document.createElement('div');
  const shadowW = size * 0.7;
  const shadowH = size * 0.18;
  shadow.style.cssText = `
    position: absolute;
    bottom: -${shadowH * 0.3}px;
    left: 50%;
    transform: translateX(-50%);
    width: ${shadowW}px;
    height: ${shadowH}px;
    background: radial-gradient(ellipse, rgba(0,0,0,0.28) 0%, rgba(0,0,0,0) 100%);
    border-radius: 50%;
    pointer-events: none;
  `;

  const img = document.createElement('img');
  img.className = 'flower-img';
  const idx = Math.floor(Math.random() * FLOWER_IMAGES.length);
  img.src = FLOWER_IMAGES[idx];
  img.style.cssText = `
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  `;

  wrapper.appendChild(glow);
  wrapper.appendChild(shadow);
  wrapper.appendChild(img);

  wrapper.addEventListener('animationend', () => {
    wrapper.style.opacity = '1';
    wrapper.style.transform = `rotate(${rotEnd}deg)`;
    wrapper.style.animation = `sway ${randomBetween(2.5, 5)}s ease-in-out ${randomBetween(0, 2)}s infinite`;
  });

  canvas.appendChild(wrapper);
}

function spawnFlower(x: number, y: number): void {
  for (let i = 0; i < CLUSTER_COUNT; i++) spawnOne(x, y);
}

function getDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function hideHint(): void {
  if (!hintHidden) {
    hint.classList.add('hidden');
    hintHidden = true;
  }
}

canvas.addEventListener('mousedown', (e) => {
  isDragging = true;
  lastSpawnPos = { x: e.clientX, y: e.clientY };
  spawnFlower(e.clientX, e.clientY);
  hideHint();
});

canvas.addEventListener('mousemove', (e) => {
  if (!isDragging) return;
  const pos = { x: e.clientX, y: e.clientY };
  if (!lastSpawnPos || getDistance(lastSpawnPos, pos) >= SPAWN_DISTANCE) {
    spawnFlower(e.clientX, e.clientY);
    lastSpawnPos = pos;
  }
});

canvas.addEventListener('mouseup', () => { isDragging = false; });
canvas.addEventListener('mouseleave', () => { isDragging = false; });

canvas.addEventListener('touchstart', (e) => {
  e.preventDefault();
  isDragging = true;
  const t = e.touches[0];
  lastSpawnPos = { x: t.clientX, y: t.clientY };
  spawnFlower(t.clientX, t.clientY);
  hideHint();
}, { passive: false });

canvas.addEventListener('touchmove', (e) => {
  e.preventDefault();
  if (!isDragging) return;
  const t = e.touches[0];
  const pos = { x: t.clientX, y: t.clientY };
  if (!lastSpawnPos || getDistance(lastSpawnPos, pos) >= SPAWN_DISTANCE) {
    spawnFlower(t.clientX, t.clientY);
    lastSpawnPos = pos;
  }
}, { passive: false });

canvas.addEventListener('touchend', () => { isDragging = false; });
