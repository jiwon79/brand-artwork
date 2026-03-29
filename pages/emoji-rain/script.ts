const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

const PAD = 20;
const RESTITUTION      = 0.25;
const FRICTION         = 0.80;
const COLLISION_PASSES = 8;
const EMOJI_FONT = `"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;

const NEW_DEFS: { e: string; c: string }[] = [
  { e: '🫪', c: '#FF6B6B' },
  { e: '🦣', c: '#8B6F47' },
  { e: '🩰', c: '#FFB3C6' },
  { e: '🫯', c: '#FFD93D' },
  { e: '🌊', c: '#4FC3F7' },
  { e: '📦', c: '#A5D6A7' },
  { e: '🐋', c: '#5C6BC0' },
  { e: '🎺', c: '#FFA726' },
];
const FACE_EMOJIS = [
  '😀','😃','😄','😁','😆','😅','😂','🤣','😊','😇',
  '🙂','🙃','😉','😌','😍','🥰','😘','😗','😙','😚',
  '😋','😛','😝','😜','🤪','🤨','🧐','🤓','😎','🥸',
  '😏','😒','😞','😔','😟','😕','🙁','☹️','😣','😖',
  '😫','😩','🥺','😢','😭','😤','😠','😡','🤬','🤯',
];

// ─── 박스 ─────────────────────────────────────────────────────────────────────
let W = 0, H = 0, OX = 0, OY = 0;
function resize() {
  const vw = window.innerWidth  - PAD * 2;
  const vh = window.innerHeight - PAD * 2;
  if (vw / vh > 4 / 5) { H = vh; W = Math.floor(H * 4 / 5); }
  else                  { W = vw; H = Math.floor(W * 5 / 4); }
  OX = Math.floor((window.innerWidth  - W) / 2);
  OY = Math.floor((window.innerHeight - H) / 2);
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
}
resize();
window.addEventListener('resize', resize);

// ─── 중력 / 반발 모드 ─────────────────────────────────────────────────────────
let gx = 0, gy = 0.9;
let repulseMode = false;

const REPULSION_DIST       = 130;
const REPULSION_FORCE      = 0.6;
const WALL_REPULSION_DIST  = 80;
const WALL_REPULSION_FORCE = 0.8;
const REPULSE_DAMP         = 0.94;

// ─── 파티클 ───────────────────────────────────────────────────────────────────
interface Particle {
  emoji: string;
  isNew: boolean;
  color: string;
  x: number; y: number;
  vx: number; vy: number;
  r: number;
  size: number;
  opacity: number;
}
const particles: Particle[] = [];

function spawnEmoji(emoji: string, isNew: boolean, color: string) {
  const size = isNew ? Math.floor(W * 0.19) : Math.floor(W * 0.082);
  const r    = size * (isNew ? 0.62 : 0.52);
  const x    = OX + r + Math.random() * (W - r * 2);
  const y    = OY - r;
  particles.push({
    emoji, isNew, color, x, y,
    vx: (Math.random() - 0.5) * 2,
    vy: Math.random() + 0.5,
    r, size, opacity: 0,
  });
}

// ─── 충돌 & 물리 ──────────────────────────────────────────────────────────────
function applyRepulsion() {
  // 파티클 간 척력 — 1회/프레임, 충돌 패스 밖에서
  for (let i = 0; i < particles.length; i++) {
    const a = particles[i];
    // 벽 척력
    const distL = a.x - OX,  distR = (OX + W) - a.x;
    const distT = a.y - OY,  distB = (OY + H) - a.y;
    if (distL < WALL_REPULSION_DIST) a.vx += WALL_REPULSION_FORCE * (1 - distL / WALL_REPULSION_DIST);
    if (distR < WALL_REPULSION_DIST) a.vx -= WALL_REPULSION_FORCE * (1 - distR / WALL_REPULSION_DIST);
    if (distT < WALL_REPULSION_DIST) a.vy += WALL_REPULSION_FORCE * (1 - distT / WALL_REPULSION_DIST);
    if (distB < WALL_REPULSION_DIST) a.vy -= WALL_REPULSION_FORCE * (1 - distB / WALL_REPULSION_DIST);

    // 파티클 간 척력
    for (let j = i + 1; j < particles.length; j++) {
      const b  = particles[j];
      const dx = b.x - a.x, dy = b.y - a.y;
      const d  = Math.sqrt(dx * dx + dy * dy) || 0.001;
      if (d >= REPULSION_DIST) continue;
      const nx = dx / d, ny = dy / d;
      const f  = REPULSION_FORCE * (1 - d / REPULSION_DIST);
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

  // 위치 보정 + 충돌
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
      // 컬러 원형 테두리
      ctx.beginPath();
      ctx.arc(0, 0, p.r, 0, Math.PI * 2);
      ctx.strokeStyle = p.color;
      ctx.lineWidth   = Math.max(2, p.r * 0.12);
      ctx.stroke();
    }

    ctx.font         = `${p.size}px ${EMOJI_FONT}`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle    = '#000';
    ctx.fillText(p.emoji, 0, 0);
    ctx.restore();
  }

  ctx.restore();
}

function loop() {
  step();
  draw();
  requestAnimationFrame(loop);
}

// ─── 스폰 큐 ─────────────────────────────────────────────────────────────────
function buildQueue() {
  const reg  = [...FACE_EMOJIS].sort(() => Math.random() - 0.5).map(e => ({ e, isNew: false, c: '' }));
  const newE = [...NEW_DEFS   ].sort(() => Math.random() - 0.5).map(d => ({ e: d.e, isNew: true, c: d.c }));
  const q: { e: string; isNew: boolean; c: string }[] = [];
  const step = Math.ceil(reg.length / newE.length);
  let ri = 0, ni = 0;
  while (ri < reg.length || ni < newE.length) {
    for (let k = 0; k < step && ri < reg.length; k++) q.push(reg[ri++]);
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

// ─── 스와이프 ─────────────────────────────────────────────────────────────────
let ptX = 0, ptY = 0, ptT = 0;

function swipeStart(x: number, y: number) { ptX = x; ptY = y; ptT = Date.now(); }
function swipeEnd(x: number, y: number, isTouch: boolean) {
  const dx = x - ptX, dy = y - ptY;
  const dt = Date.now() - ptT;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < (isTouch ? 40 : 50) || dt > (isTouch ? 500 : 800)) return;

  const G = 0.9;
  if (Math.abs(dx) >= Math.abs(dy)) {
    gx = dx < 0 ? -G : G;  gy = 0;
  } else {
    gx = 0;  gy = dy < 0 ? -G : G;
  }
  repulseMode = false;

  // 기존 파티클에 킥
  const kick = 5;
  const kx = gx * kick, ky = gy * kick;
  for (const p of particles) { p.vx += kx; p.vy += ky; }
}

canvas.addEventListener('mousedown',  e => swipeStart(e.clientX, e.clientY));
canvas.addEventListener('mouseup',    e => swipeEnd(e.clientX, e.clientY, false));
canvas.addEventListener('touchstart', e => { e.preventDefault(); const t = e.touches[0]; swipeStart(t.clientX, t.clientY); }, { passive: false });
canvas.addEventListener('touchend',   e => { e.preventDefault(); const t = e.changedTouches[0]; swipeEnd(t.clientX, t.clientY, true); }, { passive: false });

// ─── 더블클릭 / 더블탭 → 척력 토글 ─────────────────────────────────────────
const flashEl = document.getElementById('flash')!;

function showFlash(color: string) {
  flashEl.style.transition = 'none';
  flashEl.style.background = color;
  flashEl.style.opacity    = '0.35';
  requestAnimationFrame(() => {
    flashEl.style.transition = 'opacity 0.5s ease-out';
    flashEl.style.opacity    = '0';
  });
}

function toggleRepulse() {
  repulseMode = !repulseMode;
  if (repulseMode) {
    gx = 0; gy = 0;
    for (const p of particles) {
      p.vx += (Math.random() - 0.5) * 6;
      p.vy += (Math.random() - 0.5) * 6;
    }
    showFlash('rgba(186,104,200,1)');
  } else {
    gx = 0; gy = 0.9;
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
  onTap(Math.sqrt(dx*dx+dy*dy) < 10);
});
canvas.addEventListener('touchend', e => {
  if (e.changedTouches.length !== 1) return;
  const dx = e.changedTouches[0].clientX - ptX;
  const dy = e.changedTouches[0].clientY - ptY;
  onTap(Math.sqrt(dx*dx+dy*dy) < 20);
}, { passive: true });
