import GUI from 'lil-gui';

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

const PAD = 20;
const RESTITUTION      = 0.25;
const FRICTION         = 0.80;
const COLLISION_PASSES = 8;
const EMOJI_FONT = `"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;

// ─── GUI 파라미터 ──────────────────────────────────────────────────────────────
const params = {
  gravity:       0.5,
  newEmojiSize:  0.12,
  faceEmojiSize: 0.05,
};

const NEW_DEFS: { e: string; c: string }[] = [
  { e: '🫍', c: '#8B6F47' },
  { e: '🫈', c: '#CE93D8' },
  { e: '🪎', c: '#FFD93D' },
  { e: '🫯', c: '#FFA726' },
  { e: '🛘', c: '#4FC3F7' },
  { e: '🪊', c: '#A5D6A7' },
  { e: '🫪', c: '#FF6B6B' },
];
const FACE_EMOJIS = [
  '😀','😃','😄','😁','😆','😅','😂','🤣','😊','😇',
  '🙂','🙃','😉','😌','😍','🥰','😘','😗','😙','😚',
  '😋','😛','😝','😜','🤪','🤨','🧐','🤓','😎','🥸',
  '😏','😒','😞','😔','😟','😕','🙁','☹️','😣','😖',
  '😫','😩','🥺','😢','😭','😤','😠','😡','🤬','🤯',
];

// ─── 박스 ─────────────────────────────────────────────────────────────────────
const DPR = window.devicePixelRatio || 1;
let W = 0, H = 0, OX = 0, OY = 0;

function resize() {
  const vw = window.innerWidth  - PAD * 2;
  const vh = window.innerHeight - PAD * 2;
  if (vw / vh > 4 / 5) { H = vh; W = Math.floor(H * 4 / 5); }
  else                  { W = vw; H = Math.floor(W * 5 / 4); }
  OX = Math.floor((window.innerWidth  - W) / 2);
  OY = Math.floor((window.innerHeight - H) / 2);

  canvas.width        = window.innerWidth  * DPR;
  canvas.height       = window.innerHeight * DPR;
  canvas.style.width  = window.innerWidth  + 'px';
  canvas.style.height = window.innerHeight + 'px';
  ctx.scale(DPR, DPR);
}
resize();
window.addEventListener('resize', resize);

// ─── 중력 / 반발 모드 ─────────────────────────────────────────────────────────
let gx = 0, gy = 0.5;
let repulseMode = false;

const REPULSION_DIST       = 130;
const REPULSION_FORCE      = 0.6;
const WALL_REPULSION_DIST  = 80;
const WALL_REPULSION_FORCE = 0.8;
const REPULSE_DAMP         = 0.94;

// ─── 방향 표시 오버레이 ───────────────────────────────────────────────────────
interface DirOverlay { emoji: string; alpha: number; }
let dirOverlay: DirOverlay | null = null;

const DIR_INFO: Record<string, { emoji: string; flashColor: string; kick: [number, number] }> = {
  down:  { emoji: '⬇️', flashColor: 'rgba(255,213,79,0.5)',  kick: [ 0,  5] },
  up:    { emoji: '⬆️', flashColor: 'rgba(77,182,172,0.5)',  kick: [ 0, -5] },
  right: { emoji: '➡️', flashColor: 'rgba(255,167,38,0.5)',  kick: [ 5,  0] },
  left:  { emoji: '⬅️', flashColor: 'rgba(79,195,247,0.5)', kick: [-5,  0] },
};

// ─── 파티클 ───────────────────────────────────────────────────────────────────
interface Particle {
  emoji: string;
  isNew: boolean;
  color: string;
  x: number; y: number;
  vx: number; vy: number;
  r: number;
  size: number;
  rand: number;   // 스폰 시 랜덤 배율 (0.75 ~ 1.25)
  opacity: number;
}
const particles: Particle[] = [];

function spawnEmoji(emoji: string, isNew: boolean, color: string) {
  const rand = 0.75 + Math.random() * 0.5; // 0.75 ~ 1.25
  const size = isNew
    ? Math.floor(W * params.newEmojiSize  * rand)
    : Math.floor(W * params.faceEmojiSize * rand);
  // 충돌 반지름을 시각 크기보다 약간 크게
  const r = size * (isNew ? 0.70 : 0.62);
  const x = OX + r + Math.random() * (W - r * 2);
  const y = OY - r;
  particles.push({
    emoji, isNew, color, x, y,
    vx: (Math.random() - 0.5) * 2,
    vy: Math.random() + 0.5,
    r, size, rand, opacity: 0,
  });
}

// ─── 물리 ────────────────────────────────────────────────────────────────────
// 기준 반지름 (척력 크기 스케일 기준) — face 이모지 평균 r
const baseR = () => W * params.faceEmojiSize * 0.62;

function applyRepulsion() {
  for (let i = 0; i < particles.length; i++) {
    const a = particles[i];
    const wallScale = a.r / baseR();
    const distL = a.x - OX,        distR = (OX + W) - a.x;
    const distT = a.y - OY,        distB = (OY + H) - a.y;
    if (distL < WALL_REPULSION_DIST) a.vx += WALL_REPULSION_FORCE * wallScale * (1 - distL / WALL_REPULSION_DIST);
    if (distR < WALL_REPULSION_DIST) a.vx -= WALL_REPULSION_FORCE * wallScale * (1 - distR / WALL_REPULSION_DIST);
    if (distT < WALL_REPULSION_DIST) a.vy += WALL_REPULSION_FORCE * wallScale * (1 - distT / WALL_REPULSION_DIST);
    if (distB < WALL_REPULSION_DIST) a.vy -= WALL_REPULSION_FORCE * wallScale * (1 - distB / WALL_REPULSION_DIST);

    for (let j = i + 1; j < particles.length; j++) {
      const b  = particles[j];
      const dx = b.x - a.x, dy = b.y - a.y;
      const d  = Math.sqrt(dx * dx + dy * dy) || 0.001;
      if (d >= REPULSION_DIST) continue;
      const nx = dx / d, ny = dy / d;
      // 두 파티클 크기의 평균으로 스케일
      const sizeScale = (a.r + b.r) / (baseR() * 2);
      const f = REPULSION_FORCE * sizeScale * (1 - d / REPULSION_DIST);
      a.vx -= nx * f;  a.vy -= ny * f;
      b.vx += nx * f;  b.vy += ny * f;
    }
  }
}

function step() {
  for (const p of particles) {
    p.vx += gx;
    p.vy += gy;
    p.x  += p.vx;
    p.y  += p.vy;
    p.opacity = Math.min(1, p.opacity + 0.08);
  }

  if (repulseMode) {
    applyRepulsion();
    for (const p of particles) { p.vx *= REPULSE_DAMP; p.vy *= REPULSE_DAMP; }
  }

  for (let pass = 0; pass < COLLISION_PASSES; pass++) {
    for (let i = 0; i < particles.length; i++) {
      const a = particles[i];
      if (a.x - a.r < OX)     { a.x = OX + a.r;     a.vx =  Math.abs(a.vx) * RESTITUTION; }
      if (a.x + a.r > OX + W) { a.x = OX + W - a.r; a.vx = -Math.abs(a.vx) * RESTITUTION; }
      if (a.y - a.r < OY)     { a.y = OY + a.r;      a.vy =  Math.abs(a.vy) * RESTITUTION; }
      if (a.y + a.r > OY + H) {
        a.y  = OY + H - a.r;
        a.vy = -Math.abs(a.vy) * RESTITUTION;
        a.vx *= FRICTION;
      }

      for (let j = i + 1; j < particles.length; j++) {
        const b  = particles[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const d2 = dx * dx + dy * dy;
        const minD = a.r + b.r;
        if (d2 >= minD * minD) continue;

        const d  = Math.sqrt(d2) || 0.001;
        const nx = dx / d, ny = dy / d;
        const overlap = (minD - d) * 0.5;
        a.x -= nx * overlap;  a.y -= ny * overlap;
        b.x += nx * overlap;  b.y += ny * overlap;

        const dvDot = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (dvDot < 0) {
          const imp = dvDot * (1 + RESTITUTION) * 0.5;
          a.vx += imp * nx;  a.vy += imp * ny;
          b.vx -= imp * nx;  b.vy -= imp * ny;
        }
      }
    }
  }

  // 방향 오버레이 페이드아웃
  if (dirOverlay) {
    dirOverlay.alpha -= 0.025;
    if (dirOverlay.alpha <= 0) dirOverlay = null;
  }
}

// ─── 그리기 ───────────────────────────────────────────────────────────────────
function draw() {
  ctx.fillStyle = '#E8DDD0';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  ctx.roundRect(OX, OY, W, H, 16);
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(OX, OY, W, H, 16);
  ctx.clip();

  for (const p of particles) {
    ctx.save();
    ctx.globalAlpha = p.opacity;
    ctx.translate(p.x, p.y);

    if (p.isNew) {
      const grd = ctx.createRadialGradient(
        -p.r * 0.3, -p.r * 0.3, p.r * 0.05,
         0,          0,          p.r
      );
      grd.addColorStop(0,    'rgba(255,255,255,0.85)');
      grd.addColorStop(0.45, p.color + 'cc');
      grd.addColorStop(1.0,  p.color);
      ctx.beginPath();
      ctx.arc(0, 0, p.r, 0, Math.PI * 2);
      ctx.fillStyle = grd;
      ctx.fill();
    }

    // 신규 이모지는 원 안에 들어오도록 폰트 크기 조정
    const fontSize = p.isNew ? Math.floor(p.r * 1.1) : p.size;
    ctx.font         = `${fontSize}px ${EMOJI_FONT}`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle    = '#000';
    ctx.fillText(p.emoji, 0, 0);
    ctx.restore();
  }

  // 방향 이모지 오버레이
  if (dirOverlay) {
    const sz = Math.floor(W * 0.28 / 4);
    ctx.save();
    ctx.globalAlpha = Math.min(dirOverlay.alpha, 1);
    ctx.font         = `${sz}px ${EMOJI_FONT}`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle    = '#000';
    ctx.fillText(dirOverlay.emoji, OX + W / 2, OY + H / 2);
    ctx.restore();
  }

  ctx.restore();
}

function loop() {
  step();
  draw();
  requestAnimationFrame(loop);
}

// ─── GUI ──────────────────────────────────────────────────────────────────────
function refreshParticleSizes() {
  for (const p of particles) {
    p.size = Math.floor(W * (p.isNew ? params.newEmojiSize : params.faceEmojiSize) * p.rand);
    p.r    = p.size * (p.isNew ? 0.70 : 0.62);
  }
}

const gui = new GUI({ title: '설정' });
gui.add(params, 'gravity', 0.1, 3.0, 0.05).name('중력').onChange((v: number) => {
  const mag = Math.sqrt(gx * gx + gy * gy) || 1;
  gx = gx / mag * v;
  gy = gy / mag * v;
});
gui.add(params, 'newEmojiSize',  0.05, 0.4, 0.005).name('큰 이모지 크기').onChange(refreshParticleSizes);
gui.add(params, 'faceEmojiSize', 0.02, 0.2, 0.005).name('작은 이모지 크기').onChange(refreshParticleSizes);

// ─── 스폰 큐 ─────────────────────────────────────────────────────────────────
function buildQueue() {
  const reg  = [...FACE_EMOJIS].sort(() => Math.random() - 0.5).map(e => ({ e, isNew: false, c: '' }));
  const newE = [...NEW_DEFS   ].sort(() => Math.random() - 0.5).map(d => ({ e: d.e, isNew: true, c: d.c }));
  const q: { e: string; isNew: boolean; c: string }[] = [];
  const stepN = Math.ceil(reg.length / newE.length);
  let ri = 0, ni = 0;
  while (ri < reg.length || ni < newE.length) {
    for (let k = 0; k < stepN && ri < reg.length; k++) q.push(reg[ri++]);
    if (ni < newE.length) q.push(newE[ni++]);
  }
  return q;
}

const queue = buildQueue();
let qi = 0;
setInterval(() => {
  if (qi < queue.length) { const item = queue[qi++]; spawnEmoji(item.e, item.isNew, item.c); }
}, 80);

loop();

// ─── flash 유틸 ───────────────────────────────────────────────────────────────
const flashEl = document.getElementById('flash')!;
function showFlash(color: string) {
  flashEl.style.transition = 'none';
  flashEl.style.background = color;
  flashEl.style.opacity    = '1';
  requestAnimationFrame(() => {
    flashEl.style.transition = 'opacity 0.5s ease-out';
    flashEl.style.opacity    = '0';
  });
}

// ─── 스와이프 ─────────────────────────────────────────────────────────────────
let ptX = 0, ptY = 0, ptT = 0;

function swipeStart(x: number, y: number) { ptX = x; ptY = y; ptT = Date.now(); }

function swipeEnd(x: number, y: number, isTouch: boolean) {
  const dx = x - ptX, dy = y - ptY;
  const dt = Date.now() - ptT;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < (isTouch ? 40 : 50) || dt > (isTouch ? 500 : 800)) return;

  const G = params.gravity;
  let dir: string;
  if (Math.abs(dx) >= Math.abs(dy)) {
    dir = dx < 0 ? 'left' : 'right';
    gx = dx < 0 ? -G : G;  gy = 0;
  } else {
    dir = dy < 0 ? 'up' : 'down';
    gx = 0;  gy = dy < 0 ? -G : G;
  }
  repulseMode = false;

  const info = DIR_INFO[dir];
  const [kx, ky] = info.kick;
  for (const p of particles) { p.vx += kx; p.vy += ky; }

  showFlash(info.flashColor);
  dirOverlay = { emoji: info.emoji, alpha: 2.0 }; // 1.0 표시 후 페이드
}

canvas.addEventListener('mousedown',  e => swipeStart(e.clientX, e.clientY));
canvas.addEventListener('mouseup',    e => swipeEnd(e.clientX, e.clientY, false));
canvas.addEventListener('touchstart', e => { e.preventDefault(); const t = e.touches[0]; swipeStart(t.clientX, t.clientY); }, { passive: false });
canvas.addEventListener('touchend',   e => { e.preventDefault(); const t = e.changedTouches[0]; swipeEnd(t.clientX, t.clientY, true); }, { passive: false });

// ─── 더블클릭 / 더블탭 → 척력 토글 ─────────────────────────────────────────
function toggleRepulse() {
  repulseMode = !repulseMode;
  if (repulseMode) {
    gx = 0; gy = 0;
    for (const p of particles) {
      p.vx += (Math.random() - 0.5) * 6;
      p.vy += (Math.random() - 0.5) * 6;
    }
    showFlash('rgba(186,104,200,0.5)');
  } else {
    gx = 0; gy = params.gravity;
  }
}

let lastClick = 0;
function onTap(isTap: boolean) {
  if (!isTap) return;
  const now = Date.now();
  if (now - lastClick < 350) { toggleRepulse(); lastClick = 0; }
  else                        { lastClick = now; }
}

canvas.addEventListener('mouseup', e => {
  const dx = e.clientX - ptX, dy = e.clientY - ptY;
  onTap(Math.sqrt(dx * dx + dy * dy) < 10);
});
canvas.addEventListener('touchend', e => {
  if (e.changedTouches.length !== 1) return;
  const dx = e.changedTouches[0].clientX - ptX;
  const dy = e.changedTouches[0].clientY - ptY;
  onTap(Math.sqrt(dx * dx + dy * dy) < 20);
}, { passive: true });
