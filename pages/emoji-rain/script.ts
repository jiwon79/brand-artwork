const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const cursorEl = document.getElementById('cursor') as HTMLDivElement;
const flashEl = document.getElementById('swipe-flash') as HTMLDivElement;
const introEl = document.getElementById('intro') as HTMLDivElement;

// ─── Constants ────────────────────────────────────────────────────────────────
const GRAVITY         = 0.27;  // halved from 0.55
const GRAVITY_SIDE    = 1.2;
const GRAVITY_SIDE_Y  = 0.05;
const REPULSION_DIST  = 130;
const REPULSION_FORCE = 0.6;
const WALL_REP_DIST   = 80;
const WALL_REP_FORCE  = 0.8;

// ─── Emoji data ───────────────────────────────────────────────────────────────
const NEW_DEFS = [
  { e: '🫪', c: '#FF6B6B' },
  { e: '🦣', c: '#8B6F47' },
  { e: '🩰', c: '#FFB3C6' },
  { e: '🫯', c: '#FFD93D' },
  { e: '🌊', c: '#4FC3F7' },
  { e: '📦', c: '#A5D6A7' },
  { e: '🐋', c: '#5C6BC0' },
  { e: '🎺', c: '#FFA726' },
] as const;

const REG_EMOJIS = [
  '😀','😃','😄','😁','😆','😅','😂','🤣','😊','😇',
  '🙂','🙃','😉','😌','😍','🥰','😘','😗','😙','😚',
  '😋','😛','😝','😜','🤪','🤨','🧐','🤓','😎','🥸',
  '😏','😒','😞','😔','😟','😕','🙁','☹️','😣','😖',
  '😫','😩','🥺','😢','😭','😤','😠','😡','🤬','🤯',
];

// ─── State ────────────────────────────────────────────────────────────────────
let W = 0, H = 0;
let gx = 0, gy = GRAVITY;
let repulse = false;

// 3 gravity modes: down | side | repulsion
type GravityMode = 'down' | 'side' | 'repulsion';
let gravMode: GravityMode = 'down';

const particles: EmojiParticle[] = [];

// ─── EmojiParticle ────────────────────────────────────────────────────────────
class EmojiParticle {
  x: number;
  y: number;
  emoji: string;
  isNew: boolean;
  color: string;
  size: number;
  mass: number;
  bounce: number;
  friction: number;
  vx: number;
  vy: number;
  angle: number;
  angVel: number;
  opacity: number;
  settled: boolean;
  settleTimer: number;

  constructor(x: number, y: number, emoji: string, isNew: boolean, color = '') {
    this.x = x;
    this.y = y;
    this.emoji = emoji;
    this.isNew = isNew;
    this.color = color;
    this.size = isNew ? 70 + Math.random() * 20 : 28 + Math.random() * 14;
    this.mass = isNew ? 2.5 : 1.0;
    this.bounce = 0.35 + Math.random() * 0.20;
    this.friction = 0.80 + Math.random() * 0.10;
    this.vx = (Math.random() - 0.5) * 4;
    this.vy = 1 + Math.random() * 2;
    this.angle = Math.random() * Math.PI * 2;
    this.angVel = (Math.random() - 0.5) * 0.15;
    this.opacity = 0;
    this.settled = false;
    this.settleTimer = 0;
  }

  get r(): number {
    return this.size * 0.58;
  }

  update(): void {
    this.opacity = Math.min(1, this.opacity + 0.05);
    this.angle += this.angVel;
    this.angVel *= 0.98;

    if (repulse) {
      // Wall repulsion forces
      if (this.x < WALL_REP_DIST)
        this.vx += WALL_REP_FORCE * (1 - this.x / WALL_REP_DIST);
      if (this.x > W - WALL_REP_DIST)
        this.vx -= WALL_REP_FORCE * (1 - (W - this.x) / WALL_REP_DIST);
      if (this.y < WALL_REP_DIST)
        this.vy += WALL_REP_FORCE * (1 - this.y / WALL_REP_DIST);
      if (this.y > H - WALL_REP_DIST)
        this.vy -= WALL_REP_FORCE * (1 - (H - this.y) / WALL_REP_DIST);
      this.vx *= 0.94;
      this.vy *= 0.94;
      this.x += this.vx;
      this.y += this.vy;
    } else if (!this.settled) {
      this.vx += gx;
      this.vy += gy;
      this.x += this.vx;
      this.y += this.vy;
    }

    // Boundary collisions — all 4 walls
    const r = this.r;

    if (this.x - r < 0) {
      this.x = r;
      const abs = Math.abs(this.vx);
      this.vx = abs < 1.2 ? 0 : abs * this.bounce;
      this.vy *= this.friction;
    } else if (this.x + r > W) {
      this.x = W - r;
      const abs = Math.abs(this.vx);
      this.vx = abs < 1.2 ? 0 : -abs * this.bounce;
      this.vy *= this.friction;
    }

    if (this.y - r < 0) {
      this.y = r;
      const abs = Math.abs(this.vy);
      this.vy = abs < 1.2 ? 0 : abs * this.bounce;
      this.vx *= this.friction;
    } else if (this.y + r > H) {
      this.y = H - r;
      const abs = Math.abs(this.vy);
      this.vy = abs < 1.2 ? 0 : -abs * this.bounce;
      this.vx *= this.friction;
    }

  }

  draw(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.globalAlpha = this.opacity;
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);

    if (this.isNew) {
      const r = this.size / 2;
      const grd = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.05, 0, 0, r);
      grd.addColorStop(0, 'rgba(255,255,255,0.75)');
      grd.addColorStop(0.45, this.color + 'cc');
      grd.addColorStop(1.0, this.color);
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fillStyle = grd;
      ctx.fill();
      ctx.font = `${Math.floor(this.size * 0.52)}px serif`;
    } else {
      ctx.font = `${Math.floor(this.size)}px serif`;
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.emoji, 0, 2);
    ctx.restore();
  }
}

// ─── Collision resolution (3 substeps) ───────────────────────────────────────
// Settled particles are treated as immovable walls.
// Low-energy approach is absorbed (so resting particles can settle);
// high-energy approach bounces. Settled particles are never woken up.
function resolveCollisions(): void {
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const a = particles[i];
        const b = particles[j];
        if (a.settled && b.settled) continue;

        const dx = b.x - a.x, dy = b.y - a.y;
        const distSq = dx * dx + dy * dy;
        const minD = a.r + b.r;
        if (distSq >= minD * minD) continue;

        const dist = Math.sqrt(distSq) || 0.0001;
        const overlap = minD - dist;
        const nx = dx / dist, ny = dy / dist;
        // nx,ny: unit vector from A → B

        if (a.settled) {
          // A is an immovable wall — only push B
          b.x += nx * overlap;
          b.y += ny * overlap;
          // B's velocity component toward A is negative (B moving in -n direction)
          const approach = b.vx * nx + b.vy * ny;
          if (approach < 0) {
            if (Math.abs(approach) < 1.5) {
              b.vx -= approach * nx; // absorb: zero out approach component
              b.vy -= approach * ny;
            } else {
              b.vx -= (1 + 0.2) * approach * nx; // bounce
              b.vy -= (1 + 0.2) * approach * ny;
              b.settleTimer = 0;
            }
          }
        } else if (b.settled) {
          // B is an immovable wall — only push A
          a.x -= nx * overlap;
          a.y -= ny * overlap;
          // A's velocity component toward B is positive (A moving in +n direction)
          const approach = a.vx * nx + a.vy * ny;
          if (approach > 0) {
            if (Math.abs(approach) < 1.5) {
              a.vx -= approach * nx; // absorb
              a.vy -= approach * ny;
            } else {
              a.vx -= (1 + 0.2) * approach * nx; // bounce
              a.vy -= (1 + 0.2) * approach * ny;
              a.settleTimer = 0;
            }
          }
        } else {
          // Both moving — standard symmetric collision
          const tm = a.mass + b.mass;
          a.x -= nx * overlap * (b.mass / tm);
          a.y -= ny * overlap * (b.mass / tm);
          b.x += nx * overlap * (a.mass / tm);
          b.y += ny * overlap * (a.mass / tm);

          const dvx = b.vx - a.vx, dvy = b.vy - a.vy;
          const approach = dvx * nx + dvy * ny;
          if (approach >= 0) continue;

          const imp = -(1 + 0.2) * approach / tm;
          a.vx -= imp * b.mass * nx;
          a.vy -= imp * b.mass * ny;
          b.vx += imp * a.mass * nx;
          b.vy += imp * a.mass * ny;
          a.settleTimer = 0;
          b.settleTimer = 0;
        }
      }
    }
  }
}

// ─── Settle detection (runs after all collisions resolved) ───────────────────
// Must run AFTER resolveCollisions so that absorbed velocities are visible here.
// If settle ran inside update(), gravity-induced vy (0.27) would reset the timer
// before collision absorption could zero it out.
function settleParticles(): void {
  if (repulse) return;
  for (const p of particles) {
    if (p.settled) continue;
    if (Math.abs(p.vx) < 0.2 && Math.abs(p.vy) < 0.2) {
      p.settleTimer++;
      if (p.settleTimer > 40) {
        p.settled = true;
        p.vx = 0;
        p.vy = 0;
      }
    } else {
      p.settleTimer = 0;
    }
  }
}

// ─── Repulsion between particles ─────────────────────────────────────────────
function applyRepulsion(): void {
  for (let i = 0; i < particles.length; i++) {
    for (let j = i + 1; j < particles.length; j++) {
      const a = particles[i];
      const b = particles[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.0001;
      if (dist >= REPULSION_DIST) continue;
      const f = REPULSION_FORCE * (1 - dist / REPULSION_DIST);
      const nx = dx / dist;
      const ny = dy / dist;
      a.vx -= nx * f / a.mass;
      a.vy -= ny * f / a.mass;
      b.vx += nx * f / b.mass;
      b.vy += ny * f / b.mass;
    }
  }
}

// ─── Mode management ─────────────────────────────────────────────────────────
function setMode(mode: GravityMode, sideDir?: 'left' | 'right'): void {
  gravMode = mode;
  repulse = mode === 'repulsion';

  switch (mode) {
    case 'down':
      gx = 0;
      gy = GRAVITY;
      break;
    case 'side':
      gx = sideDir === 'left' ? -GRAVITY_SIDE : GRAVITY_SIDE;
      gy = GRAVITY_SIDE_Y;
      break;
    case 'repulsion':
      gx = 0;
      gy = 0;
      break;
  }
}

// ─── Gravity shift (swipe) ────────────────────────────────────────────────────
function shiftGravity(dir: 'left' | 'right'): void {
  setMode('side', dir);
  const kick = 4 + Math.random() * 3;
  for (const p of particles) {
    p.vx += dir === 'left' ? -kick : kick;
    p.settled = false;
    p.settleTimer = 0;
  }
  showFlash(dir === 'left' ? 'rgba(79,195,247,0.35)' : 'rgba(255,167,38,0.35)');
}

// ─── Repulsion toggle (double-tap) ────────────────────────────────────────────
function toggleRepulsion(): void {
  if (gravMode === 'repulsion') {
    // Exit repulsion → back to down gravity
    setMode('down');
  } else {
    setMode('repulsion');
    for (const p of particles) {
      p.settled = false;
      p.settleTimer = 0;
      p.vx += (Math.random() - 0.5) * 10;
      p.vy += (Math.random() - 0.5) * 10;
    }
    showFlash('rgba(186,104,200,0.35)');
  }
}

// ─── Flash overlay ────────────────────────────────────────────────────────────
function showFlash(color: string): void {
  flashEl.style.transition = 'none';
  flashEl.style.background = color;
  flashEl.style.opacity = '1';
  requestAnimationFrame(() => {
    flashEl.style.transition = 'opacity 0.5s ease-out';
    flashEl.style.opacity = '0';
  });
}

// ─── Launch queue ─────────────────────────────────────────────────────────────
interface QueueItem {
  e: string;
  isNew: boolean;
  c: string;
}

function buildQueue(): QueueItem[] {
  const reg = [...REG_EMOJIS]
    .sort(() => Math.random() - 0.5)
    .map(e => ({ e, isNew: false, c: '' }));
  const newOnes = [...NEW_DEFS]
    .sort(() => Math.random() - 0.5)
    .map(d => ({ e: d.e, isNew: true, c: d.c }));

  const queue: QueueItem[] = [];
  const insertEvery = Math.ceil(reg.length / newOnes.length); // ~7
  let ri = 0;
  let ni = 0;

  while (ri < reg.length || ni < newOnes.length) {
    for (let k = 0; k < insertEvery && ri < reg.length; k++) {
      queue.push(reg[ri++]);
    }
    if (ni < newOnes.length) {
      queue.push(newOnes[ni++]);
    }
  }

  return queue;
}

function launchParticle(item: QueueItem): void {
  const approxSize = item.isNew ? 80 : 35;
  const approxR = approxSize * 0.58;
  const px = approxR + Math.random() * (W - 2 * approxR);
  particles.push(new EmojiParticle(px, -approxR * 2, item.e, item.isNew, item.c));
}

function startLaunch(): void {
  const queue = buildQueue();
  let idx = 0;
  const timer = setInterval(() => {
    if (idx >= queue.length) {
      clearInterval(timer);
      return;
    }
    launchParticle(queue[idx++]);
  }, 60);
}

// ─── Background ───────────────────────────────────────────────────────────────
function drawBackground(): void {
  ctx.fillStyle = '#FFF8F0';
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  ctx.strokeStyle = 'rgba(255, 140, 50, 0.07)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= W; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
  for (let y = 0; y <= H; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }
  ctx.restore();
}

// ─── Main loop ────────────────────────────────────────────────────────────────
function loop(): void {
  drawBackground();

  for (const p of particles) p.update();
  resolveCollisions();
  if (repulse) applyRepulsion();
  settleParticles();
  for (const p of particles) p.draw(ctx);

  requestAnimationFrame(loop);
}

// ─── Resize (4:5 aspect ratio) ───────────────────────────────────────────────
function resize(): void {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // Fit 4:5 portrait ratio within viewport
  if (vw / vh > 4 / 5) {
    H = vh;
    W = Math.floor(H * 4 / 5);
  } else {
    W = vw;
    H = Math.floor(W * 5 / 4);
  }

  canvas.width = W;
  canvas.height = H;
}
window.addEventListener('resize', resize);
resize();

// ─── Intro sequence ───────────────────────────────────────────────────────────
function startIntro(): void {
  setTimeout(() => {
    introEl.classList.add('fade-out');
    setTimeout(() => {
      introEl.style.display = 'none';
      startLaunch();
    }, 400);
  }, 1800);
}

// ─── Interaction ──────────────────────────────────────────────────────────────
let pointerStartX = 0;
let pointerStartY = 0;
let pointerStartTime = 0;
let lastTapTime = 0;

function onPointerDown(x: number, y: number): void {
  pointerStartX = x;
  pointerStartY = y;
  pointerStartTime = Date.now();
}

function onPointerUp(x: number, y: number, isTouch: boolean): void {
  const dx = x - pointerStartX;
  const dy = y - pointerStartY;
  const dt = Date.now() - pointerStartTime;

  const swipeThreshold = isTouch ? 40 : 50;
  const timeLimit = isTouch ? 500 : 1000;

  if (Math.abs(dx) >= swipeThreshold && Math.abs(dx) > Math.abs(dy) && dt < timeLimit) {
    shiftGravity(dx < 0 ? 'left' : 'right');
    return;
  }

  // Tap/click → double-tap detection
  if (Math.abs(dx) < 10 && Math.abs(dy) < 10) {
    const now = Date.now();
    if (now - lastTapTime < 350) {
      toggleRepulsion();
      lastTapTime = 0;
    } else {
      lastTapTime = now;
    }
  }
}

// Desktop
canvas.addEventListener('mousedown', (e) => onPointerDown(e.clientX, e.clientY));
canvas.addEventListener('mouseup', (e) => onPointerUp(e.clientX, e.clientY, false));

// Mobile
canvas.addEventListener('touchstart', (e) => {
  e.preventDefault();
  const t = e.touches[0];
  onPointerDown(t.clientX, t.clientY);
}, { passive: false });

canvas.addEventListener('touchend', (e) => {
  e.preventDefault();
  const t = e.changedTouches[0];
  onPointerUp(t.clientX, t.clientY, true);
}, { passive: false });

// Custom cursor (desktop only)
let cursorVisible = false;
document.addEventListener('mousemove', (e) => {
  cursorEl.style.left = e.clientX + 'px';
  cursorEl.style.top = e.clientY + 'px';
  if (!cursorVisible) {
    cursorVisible = true;
    cursorEl.style.opacity = '1';
  }
});

// ─── Boot ────────────────────────────────────────────────────────────────────
loop();
startIntro();
