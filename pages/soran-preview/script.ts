// 소란 × loop.design.lab — 인터랙티브 프리뷰
// 3개 핵심 컷을 세로 스크롤로 시연.

// ---------- Scene 1 (cut 6): mouse-followed spotlight ----------
const darkScene = document.getElementById('scene-dark') as HTMLElement;
const spotlight = document.getElementById('spotlight') as HTMLElement;

function updateSpotlight(clientX: number, clientY: number) {
  const rect = darkScene.getBoundingClientRect();
  const x = ((clientX - rect.left) / rect.width) * 100;
  const y = ((clientY - rect.top) / rect.height) * 100;
  spotlight.style.setProperty('--mx', `${x}%`);
  spotlight.style.setProperty('--my', `${y}%`);
}

darkScene.addEventListener('pointerenter', () => darkScene.classList.add('active'));
darkScene.addEventListener('pointermove', (e) => {
  darkScene.classList.add('active');
  updateSpotlight(e.clientX, e.clientY);
});
darkScene.addEventListener('touchstart', (e) => {
  darkScene.classList.add('active');
  const t = e.touches[0];
  if (t) updateSpotlight(t.clientX, t.clientY);
}, { passive: true });
darkScene.addEventListener('touchmove', (e) => {
  const t = e.touches[0];
  if (t) updateSpotlight(t.clientX, t.clientY);
}, { passive: true });

// ---------- Scene 2 (cut 11): figure shrinks as you scroll through ----------
const emptyScene = document.getElementById('scene-empty') as HTMLElement;
const emptyImg = document.getElementById('emptyImg') as HTMLImageElement;

function updateEmpty() {
  const rect = emptyScene.getBoundingClientRect();
  const total = emptyScene.offsetHeight - window.innerHeight;
  if (total <= 0) return;
  // progress: 0 when section just enters, 1 when fully scrolled past
  const progress = Math.max(0, Math.min(1, -rect.top / total));
  const scale = 1 - progress * 0.65; // shrink to 35%
  emptyImg.style.setProperty('--scale', String(scale));
}

window.addEventListener('scroll', updateEmpty, { passive: true });
window.addEventListener('resize', updateEmpty);
updateEmpty();

// ---------- Scene 3 (cut 20): tap to accumulate confetti, then reveal ----------
const finaleStage = document.getElementById('finaleStage') as HTMLElement;
const canvas = document.getElementById('confettiCanvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const progressFill = document.getElementById('progressFill') as HTMLElement;

const TAP_TARGET = 24;
let tapCount = 0;
let revealed = false;

interface Confetti {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  color: string;
  w: number;
  h: number;
  life: number;
}

const COLORS = ['#ff5252', '#ffd54f', '#66bb6a', '#29b6f6', '#ab47bc', '#ffa726', '#ec407a', '#26c6da'];
const confetti: Confetti[] = [];

function sizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
sizeCanvas();
window.addEventListener('resize', sizeCanvas);

function spawnBurst(x: number, y: number, count: number) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 4 + Math.random() * 6;
    confetti.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 4,
      rot: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * 0.4,
      color: COLORS[Math.floor(Math.random() * COLORS.length)]!,
      w: 6 + Math.random() * 6,
      h: 2 + Math.random() * 3,
      life: 1.0,
    });
  }
}

function spawnFinale() {
  const rect = canvas.getBoundingClientRect();
  for (let i = 0; i < 300; i++) {
    confetti.push({
      x: Math.random() * rect.width,
      y: -20 - Math.random() * 200,
      vx: (Math.random() - 0.5) * 3,
      vy: 2 + Math.random() * 4,
      rot: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * 0.3,
      color: COLORS[Math.floor(Math.random() * COLORS.length)]!,
      w: 6 + Math.random() * 8,
      h: 2 + Math.random() * 4,
      life: 1.0,
    });
  }
}

function tick() {
  const rect = canvas.getBoundingClientRect();
  ctx.clearRect(0, 0, rect.width, rect.height);

  for (let i = confetti.length - 1; i >= 0; i--) {
    const c = confetti[i]!;
    c.vy += 0.18; // gravity
    c.vx *= 0.995;
    c.x += c.vx;
    c.y += c.vy;
    c.rot += c.vr;

    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(c.rot);
    ctx.fillStyle = c.color;
    ctx.fillRect(-c.w / 2, -c.h / 2, c.w, c.h);
    ctx.restore();

    if (c.y > rect.height + 40) confetti.splice(i, 1);
  }

  requestAnimationFrame(tick);
}
tick();

function handleTap(clientX: number, clientY: number) {
  if (revealed) return;
  const rect = finaleStage.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  spawnBurst(x, y, 14);
  tapCount++;
  progressFill.style.width = `${Math.min(100, (tapCount / TAP_TARGET) * 100)}%`;

  if (tapCount >= TAP_TARGET && !revealed) {
    revealed = true;
    spawnFinale();
    setTimeout(() => finaleStage.classList.add('revealed'), 400);
  }
}

finaleStage.addEventListener('pointerdown', (e) => handleTap(e.clientX, e.clientY));

// Reset on scroll away
const finaleObserver = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting && revealed) {
      // optional: keep revealed state; do nothing
    }
  }
}, { threshold: 0.3 });
finaleObserver.observe(finaleStage);
