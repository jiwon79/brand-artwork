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
let gx = 0, gy = 0.9;   // 현재 중력 벡터
let repulseMode = false;

const REPULSE_DIST  = 120;
const REPULSE_FORCE = 0.55;
const WALL_REP_DIST = 80;
const WALL_REP_FORCE = 0.45;
const DAMP = 0.995;      // 반발 모드 속도 감쇠

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
function step() {
  for (const p of particles) {
    if (repulseMode) {
      // 벽 척력
      let fx = 0, fy = 0;
      const distL = p.x - OX,       distR = OX + W - p.x;
      const distT = p.y - OY,       distB = OY + H - p.y;
      if (distL < WALL_REP_DIST) fx += WALL_REP_FORCE * (1 - distL / WALL_REP_DIST);
      if (distR < WALL_REP_DIST) fx -= WALL_REP_FORCE * (1 - distR / WALL_REP_DIST);
      if (distT < WALL_REP_DIST) fy += WALL_REP_FORCE * (1 - distT / WALL_REP_DIST);
      if (distB < WALL_REP_DIST) fy -= WALL_REP_FORCE * (1 - distB / WALL_REP_DIST);
      p.vx = (p.vx + fx) * DAMP;
      p.vy = (p.vy + fy) * DAMP;
    } else {
      p.vx += gx;
      p.vy += gy;
    }
    p.x += p.vx;
    p.y += p.vy;
    p.opacity = Math.min(1, p.opacity + 0.08);
  }

  // 파티클 간 척력 (repulse 모드) + 충돌 해소
  for (let pass = 0; pass < COLLISION_PASSES; pass++) {
    for (let i = 0; i < particles.length; i++) {
      const a = particles[i];

      // 벽 충돌
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

        if (repulseMode && d2 < REPULSE_DIST * REPULSE_DIST) {
          const d  = Math.sqrt(d2) || 0.001;
          const nx = dx / d, ny = dy / d;
          const f  = REPULSE_FORCE * (1 - d / REPULSE_DIST);
          a.vx -= nx * f;  a.vy -= ny * f;
          b.vx += nx * f;  b.vy += ny * f;
        }

        if (d2 < minD * minD) {
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

// ─── 더블클릭 → 척력 토글 ────────────────────────────────────────────────────
let lastClick = 0;
canvas.addEventListener('mouseup', () => {
  const now = Date.now();
  if (now - lastClick < 350) {
    repulseMode = !repulseMode;
    if (!repulseMode) { gx = 0; gy = 0.9; }
    else {
      // 정지 상태에서 살짝 흩어지게
      for (const p of particles) {
        p.vx += (Math.random() - 0.5) * 4;
        p.vy += (Math.random() - 0.5) * 4;
      }
    }
    lastClick = 0;
  } else {
    lastClick = now;
  }
});
canvas.addEventListener('touchend', e => {
  if (e.changedTouches.length !== 1) return;
  const now = Date.now();
  const dx = e.changedTouches[0].clientX - ptX;
  const dy = e.changedTouches[0].clientY - ptY;
  if (Math.sqrt(dx*dx+dy*dy) > 20) return; // 스와이프면 무시
  if (now - lastClick < 350) {
    repulseMode = !repulseMode;
    if (!repulseMode) { gx = 0; gy = 0.9; }
    else {
      for (const p of particles) {
        p.vx += (Math.random() - 0.5) * 4;
        p.vy += (Math.random() - 0.5) * 4;
      }
    }
    lastClick = 0;
  } else {
    lastClick = now;
  }
}, { passive: true });
