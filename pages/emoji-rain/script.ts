const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

const PAD = 20;
const GRAVITY     = 0.9;   // px/frame²
const RESTITUTION = 0.25;
const FRICTION    = 0.75;
const COLLISION_PASSES = 8;

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
window.addEventListener('resize', () => { resize(); });

// ─── 이모지 목록 ──────────────────────────────────────────────────────────────
const NEW_EMOJIS  = ['🫪','🦣','🩰','🫯','🌊','📦','🐋','🎺'];
const FACE_EMOJIS = [
  '😀','😃','😄','😁','😆','😅','😂','🤣','😊','😇',
  '🙂','🙃','😉','😌','😍','🥰','😘','😗','😙','😚',
  '😋','😛','😝','😜','🤪','🤨','🧐','🤓','😎','🥸',
  '😏','😒','😞','😔','😟','😕','🙁','☹️','😣','😖',
  '😫','😩','🥺','😢','😭','😤','😠','😡','🤬','🤯',
];
const EMOJI_FONT = `"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;

// ─── 파티클 ───────────────────────────────────────────────────────────────────
interface Particle {
  emoji:   string;
  x: number; y: number;
  vx: number; vy: number;
  r: number;       // 충돌 반지름
  size: number;    // 폰트 크기
  angle: number;
  va: number;      // 각속도
  opacity: number;
}

const particles: Particle[] = [];

function spawnEmoji(emoji: string, isNew: boolean) {
  const size = isNew ? Math.floor(W * 0.15) : Math.floor(W * 0.082);
  const r    = size * 0.52;
  const x    = OX + r + Math.random() * (W - r * 2);
  const y    = OY - r;
  particles.push({
    emoji, x, y,
    vx: (Math.random() - 0.5) * 2,
    vy: Math.random() * 1 + 0.5,
    r, size,
    angle: Math.random() * Math.PI * 2,
    va: (Math.random() - 0.5) * 0.08,
    opacity: 0,
  });
}

// ─── 충돌 ────────────────────────────────────────────────────────────────────
function resolveCollisions() {
  for (let pass = 0; pass < COLLISION_PASSES; pass++) {
    for (let i = 0; i < particles.length; i++) {
      const a = particles[i];

      // 벽
      if (a.x - a.r < OX)      { a.x = OX + a.r;      a.vx =  Math.abs(a.vx) * RESTITUTION; }
      if (a.x + a.r > OX + W)  { a.x = OX + W - a.r;  a.vx = -Math.abs(a.vx) * RESTITUTION; }
      if (a.y - a.r < OY)      { a.y = OY + a.r;       a.vy =  Math.abs(a.vy) * RESTITUTION; }
      if (a.y + a.r > OY + H)  {
        a.y  = OY + H - a.r;
        a.vy = -Math.abs(a.vy) * RESTITUTION;
        a.vx *= FRICTION;
        a.va *= FRICTION;
      }

      // 파티클 간 충돌
      for (let j = i + 1; j < particles.length; j++) {
        const b  = particles[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const d  = Math.sqrt(dx * dx + dy * dy);
        const minD = a.r + b.r;
        if (d >= minD || d === 0) continue;

        const nx = dx / d, ny = dy / d;
        const overlap = (minD - d) * 0.5;
        a.x -= nx * overlap;  a.y -= ny * overlap;
        b.x += nx * overlap;  b.y += ny * overlap;

        const dvx = b.vx - a.vx, dvy = b.vy - a.vy;
        const dot  = dvx * nx + dvy * ny;
        if (dot >= 0) continue;

        const imp = dot * (1 + RESTITUTION) * 0.5;
        a.vx += imp * nx;  a.vy += imp * ny;
        b.vx -= imp * nx;  b.vy -= imp * ny;
      }
    }
  }
}

// ─── 그리기 ───────────────────────────────────────────────────────────────────
function draw() {
  ctx.fillStyle = '#E8DDD0';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // 흰색 박스
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  ctx.roundRect(OX, OY, W, H, 16);
  ctx.fill();

  // 박스 밖으로 나가는 이모지 클리핑
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(OX, OY, W, H, 16);
  ctx.clip();

  for (const p of particles) {
    ctx.save();
    ctx.globalAlpha = p.opacity;
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);
    ctx.font      = `${p.size}px ${EMOJI_FONT}`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#000';
    ctx.fillText(p.emoji, 0, 0);
    ctx.restore();
  }

  ctx.restore();
}

// ─── 루프 ────────────────────────────────────────────────────────────────────
function loop() {
  for (const p of particles) {
    p.vy += GRAVITY;
    p.x  += p.vx;
    p.y  += p.vy;
    p.angle   += p.va;
    p.opacity  = Math.min(1, p.opacity + 0.08);
  }
  resolveCollisions();
  draw();
  requestAnimationFrame(loop);
}

// ─── 스폰 큐 ─────────────────────────────────────────────────────────────────
function buildQueue() {
  const reg  = [...FACE_EMOJIS].sort(() => Math.random() - 0.5).map(e => ({ e, isNew: false }));
  const newE = [...NEW_EMOJIS ].sort(() => Math.random() - 0.5).map(e => ({ e, isNew: true  }));
  const q: { e: string; isNew: boolean }[] = [];
  const step = Math.ceil(reg.length / newE.length);
  let ri = 0, ni = 0;
  while (ri < reg.length || ni < newE.length) {
    for (let k = 0; k < step && ri < reg.length; k++) q.push(reg[ri++]);
    if (ni < newE.length) q.push(newE[ni++]);
  }
  return q;
}

let queue = buildQueue();
let qi = 0;
setInterval(() => {
  if (qi < queue.length) {
    const item = queue[qi++];
    spawnEmoji(item.e, item.isNew);
  }
}, 80);

loop();
