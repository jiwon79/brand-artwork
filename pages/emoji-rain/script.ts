import RAPIER from '@dimforge/rapier2d-compat';
import GUI from 'lil-gui';

// ─── DOM ──────────────────────────────────────────────────────────────────────
const canvas  = document.getElementById('canvas')      as HTMLCanvasElement;
const ctx     = canvas.getContext('2d')!;
const cursorEl = document.getElementById('cursor')     as HTMLDivElement;
const flashEl  = document.getElementById('swipe-flash') as HTMLDivElement;
const introEl  = document.getElementById('intro')       as HTMLDivElement;

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

// ─── Physics constants ────────────────────────────────────────────────────────
// GRAV_SCALE converts "pixels per frame" to "pixels per second²" at 60 fps.
// Rapier integrates with dt = 1/60 s, so: accel_per_frame = accel_px_s2 / 3600.
const GRAV_SCALE     = 60 * 60;
const GRAV_STRENGTH  = 0.8;
const LINEAR_DAMPING = 1.83;  // exp(-1.83/60) ≈ 0.97 per frame
const ANG_DAMPING    = 3.0;
const RESTITUTION    = 0.1;
const FRICTION       = 0.5;
const WALL_T         = 50;    // wall slab thickness (px)

const REPULSION_DIST  = 130;
const REPULSION_ACCEL = 0.6 * GRAV_SCALE;
const WALL_REP_DIST   = 80;
const WALL_REP_ACCEL  = 0.8 * GRAV_SCALE;

// ─── State ────────────────────────────────────────────────────────────────────
let W = 0, H = 0;

type GravityMode = 'down' | 'up' | 'side' | 'repulsion';
let gravMode: GravityMode = 'down';
let gravSideDir: 'left' | 'right' = 'right';
let repulse = false;

// ─── GUI ──────────────────────────────────────────────────────────────────────
const params = { emojiSizeRatio: 1.0 };

// ─── Rapier ───────────────────────────────────────────────────────────────────
let world: RAPIER.World;
let wallHandles: RAPIER.RigidBodyHandle[] = [];

interface EmojiBody {
  emoji:   string;
  isNew:   boolean;
  color:   string;
  size:    number;                    // visual font size (px)
  handle:  RAPIER.RigidBodyHandle;
  opacity: number;
}
const emojiBodies: EmojiBody[] = [];

// px/frame → px/s
const toVel = (pxf: number) => pxf * 60;

// ─── Walls ────────────────────────────────────────────────────────────────────
function createWalls(): void {
  for (const h of wallHandles) {
    const b = world.getRigidBody(h);
    if (b) world.removeRigidBody(b);
  }
  wallHandles = [];

  const add = (cx: number, cy: number, hw: number, hh: number) => {
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(cx, cy)
    );
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(hw, hh).setFriction(FRICTION).setRestitution(RESTITUTION),
      body
    );
    wallHandles.push(body.handle);
  };

  add(W / 2,       H + WALL_T / 2, W / 2 + WALL_T, WALL_T / 2); // bottom
  add(W / 2,          -WALL_T / 2, W / 2 + WALL_T, WALL_T / 2); // top
  add(   -WALL_T / 2, H / 2,       WALL_T / 2, H / 2 + WALL_T); // left
  add(W + WALL_T / 2, H / 2,       WALL_T / 2, H / 2 + WALL_T); // right
}

// ─── Spawn emoji ──────────────────────────────────────────────────────────────
function addEmoji(x: number, y: number, emoji: string, isNew: boolean, color: string): void {
  const base = isNew
    ? W * (0.175 + Math.random() * 0.05)
    : W * (0.07  + Math.random() * 0.035);
  const size = base * params.emojiSizeRatio;
  const r    = size * 0.58;

  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x, y)
      .setRotation(Math.random() * Math.PI * 2)
      .setLinearDamping(LINEAR_DAMPING)
      .setAngularDamping(ANG_DAMPING)
  );

  body.enableCcd(true);
  body.setLinvel({ x: toVel((Math.random() - 0.5) * 4), y: toVel(1 + Math.random() * 2) }, false);
  body.setAngvel((Math.random() - 0.5) * 9, false);

  const density = (isNew ? 2.5 : 1.0) / (Math.PI * r * r);
  world.createCollider(
    RAPIER.ColliderDesc.ball(r).setRestitution(RESTITUTION).setFriction(FRICTION).setDensity(density),
    body
  );

  emojiBodies.push({ emoji, isNew, color, size, handle: body.handle, opacity: 0 });
}

// ─── Mode / gravity ───────────────────────────────────────────────────────────
function setMode(mode: GravityMode, dir?: 'left' | 'right'): void {
  gravMode = mode;
  repulse  = mode === 'repulsion';
  if (dir) gravSideDir = dir;

  let gx = 0, gy = 0;
  switch (mode) {
    case 'down': gy =  GRAV_STRENGTH; break;
    case 'up':   gy = -GRAV_STRENGTH; break;
    case 'side': gx = gravSideDir === 'left' ? -GRAV_STRENGTH : GRAV_STRENGTH; break;
  }
  world.gravity = { x: gx * GRAV_SCALE, y: gy * GRAV_SCALE };

  for (const e of emojiBodies) world.getRigidBody(e.handle)?.wakeUp();
}

// ─── Repulsion forces (applied before each step) ──────────────────────────────
function applyRepulsionForces(): void {
  // addForce accumulates — must reset each step before re-applying.
  for (const e of emojiBodies) world.getRigidBody(e.handle)?.resetForces(false);

  for (let i = 0; i < emojiBodies.length; i++) {
    const bA = world.getRigidBody(emojiBodies[i].handle);
    if (!bA) continue;
    const pA = bA.translation();
    const mA = bA.mass();

    // Wall repulsion
    let fx = 0, fy = 0;
    if (pA.x < WALL_REP_DIST)     fx += WALL_REP_ACCEL * (1 - pA.x / WALL_REP_DIST);
    if (pA.x > W - WALL_REP_DIST) fx -= WALL_REP_ACCEL * (1 - (W - pA.x) / WALL_REP_DIST);
    if (pA.y < WALL_REP_DIST)     fy += WALL_REP_ACCEL * (1 - pA.y / WALL_REP_DIST);
    if (pA.y > H - WALL_REP_DIST) fy -= WALL_REP_ACCEL * (1 - (H - pA.y) / WALL_REP_DIST);
    if (fx || fy) bA.addForce({ x: fx * mA, y: fy * mA }, true);

    // Inter-particle repulsion
    for (let j = i + 1; j < emojiBodies.length; j++) {
      const bB = world.getRigidBody(emojiBodies[j].handle);
      if (!bB) continue;
      const pB = bB.translation();
      const dx = pB.x - pA.x, dy = pB.y - pA.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.0001;
      if (dist >= REPULSION_DIST) continue;
      const f  = REPULSION_ACCEL * (1 - dist / REPULSION_DIST);
      const nx = dx / dist, ny = dy / dist;
      const mB = bB.mass();
      bA.addForce({ x: -nx * f * mA, y: -ny * f * mA }, true);
      bB.addForce({ x:  nx * f * mB, y:  ny * f * mB }, true);
    }
  }
}

// ─── Swipe / gestures ─────────────────────────────────────────────────────────
function shiftGravity(dir: 'left' | 'right' | 'up' | 'down'): void {
  const kick = toVel(4 + Math.random() * 3);

  if (dir === 'left' || dir === 'right') {
    setMode('side', dir);
    const kx = dir === 'left' ? -kick : kick;
    for (const e of emojiBodies) {
      const b = world.getRigidBody(e.handle);
      if (!b) continue;
      const v = b.linvel();
      b.setLinvel({ x: v.x + kx, y: v.y }, true);
    }
    showFlash(dir === 'left' ? 'rgba(79,195,247,0.35)' : 'rgba(255,167,38,0.35)');
  } else {
    setMode(dir === 'up' ? 'up' : 'down');
    const ky = dir === 'up' ? -kick : kick;
    for (const e of emojiBodies) {
      const b = world.getRigidBody(e.handle);
      if (!b) continue;
      const v = b.linvel();
      b.setLinvel({ x: v.x, y: v.y + ky }, true);
    }
    showFlash(dir === 'up' ? 'rgba(77,182,172,0.35)' : 'rgba(255,213,79,0.35)');
  }
}

function toggleRepulsion(): void {
  if (gravMode === 'repulsion') {
    setMode('down');
  } else {
    setMode('repulsion');
    for (const e of emojiBodies) {
      const b = world.getRigidBody(e.handle);
      if (!b) continue;
      const v = b.linvel();
      b.setLinvel({
        x: v.x + toVel((Math.random() - 0.5) * 10),
        y: v.y + toVel((Math.random() - 0.5) * 10),
      }, true);
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

// ─── Draw ─────────────────────────────────────────────────────────────────────
function drawBackground(): void {
  ctx.fillStyle = '#FFF8F0';
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  ctx.strokeStyle = 'rgba(255, 140, 50, 0.07)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= W; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 0; y <= H; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  ctx.restore();
}

function drawEmoji(e: EmojiBody, x: number, y: number, angle: number): void {
  ctx.save();
  ctx.globalAlpha = e.opacity;
  ctx.translate(x, y);
  ctx.rotate(angle);

  const EMOJI_FONTS = `"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;

  if (e.isNew) {
    const r = e.size / 2;
    const grd = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.05, 0, 0, r);
    grd.addColorStop(0,   'rgba(255,255,255,0.75)');
    grd.addColorStop(0.45, e.color + 'cc');
    grd.addColorStop(1.0,  e.color);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = grd;
    ctx.fill();
    ctx.font = `${Math.floor(e.size * 0.52)}px ${EMOJI_FONTS}`;
  } else {
    ctx.font = `${Math.floor(e.size)}px ${EMOJI_FONTS}`;
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#1a1a1a';
  ctx.fillText(e.emoji, 0, 2);
  ctx.restore();
}

// ─── Main loop ────────────────────────────────────────────────────────────────
function loop(): void {
  if (repulse) applyRepulsionForces();
  world.step();

  drawBackground();

  for (const e of emojiBodies) {
    e.opacity = Math.min(1, e.opacity + 0.05);
    const body = world.getRigidBody(e.handle);
    if (!body) continue;
    const pos = body.translation();
    const rot = body.rotation();
    drawEmoji(e, pos.x, pos.y, rot);
  }

  requestAnimationFrame(loop);
}

// ─── Resize ───────────────────────────────────────────────────────────────────
function resize(): void {
  const PAD = 30;
  const vw  = document.documentElement.clientWidth  - PAD * 2;
  const vh  = document.documentElement.clientHeight - PAD * 2;

  if (vw / vh > 4 / 5) { H = vh; W = Math.floor(H * 4 / 5); }
  else { W = vw; H = Math.floor(W * 5 / 4); if (H > vh) { H = vh; W = Math.floor(H * 4 / 5); } }

  canvas.width  = W;
  canvas.height = H;

  if (world) createWalls();
}
window.addEventListener('resize', resize);

// ─── Launch queue ─────────────────────────────────────────────────────────────
interface QueueItem { e: string; isNew: boolean; c: string; }

function buildQueue(): QueueItem[] {
  const reg     = [...REG_EMOJIS].sort(() => Math.random() - 0.5).map(e => ({ e, isNew: false, c: '' }));
  const newOnes = [...NEW_DEFS].sort(() => Math.random() - 0.5).map(d => ({ e: d.e, isNew: true, c: d.c }));
  const queue: QueueItem[] = [];
  const step = Math.ceil(reg.length / newOnes.length);
  let ri = 0, ni = 0;
  while (ri < reg.length || ni < newOnes.length) {
    for (let k = 0; k < step && ri < reg.length; k++) queue.push(reg[ri++]);
    if (ni < newOnes.length) queue.push(newOnes[ni++]);
  }
  return queue;
}

function launchParticle(item: QueueItem): void {
  const approxSize = item.isNew ? W * 0.2 : W * 0.085;
  const approxR    = approxSize * 0.58 * params.emojiSizeRatio;
  const px = approxR + Math.random() * (W - 2 * approxR);
  addEmoji(px, -approxR * 2, item.e, item.isNew, item.c);
}

function startLaunch(): void {
  const queue = buildQueue();
  let idx = 0;
  const timer = setInterval(() => {
    if (idx >= queue.length) { clearInterval(timer); return; }
    launchParticle(queue[idx++]);
  }, 60);
}

// ─── Intro ────────────────────────────────────────────────────────────────────
function startIntro(): void {
  setTimeout(() => {
    introEl.classList.add('fade-out');
    setTimeout(() => { introEl.style.display = 'none'; startLaunch(); }, 400);
  }, 1800);
}

// ─── Interaction ──────────────────────────────────────────────────────────────
let pointerStartX = 0, pointerStartY = 0, pointerStartTime = 0, lastTapTime = 0;

function onPointerDown(x: number, y: number): void {
  pointerStartX = x; pointerStartY = y; pointerStartTime = Date.now();
}

function onPointerUp(x: number, y: number, isTouch: boolean): void {
  const dx = x - pointerStartX, dy = y - pointerStartY;
  const dt = Date.now() - pointerStartTime;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist >= (isTouch ? 40 : 50) && dt < (isTouch ? 500 : 1000)) {
    if (Math.abs(dx) >= Math.abs(dy)) shiftGravity(dx < 0 ? 'left' : 'right');
    else shiftGravity(dy < 0 ? 'up' : 'down');
    return;
  }

  if (dist < 10) {
    const now = Date.now();
    if (now - lastTapTime < 350) { toggleRepulsion(); lastTapTime = 0; }
    else lastTapTime = now;
  }
}

canvas.addEventListener('mousedown',  (e) => onPointerDown(e.clientX, e.clientY));
canvas.addEventListener('mouseup',    (e) => onPointerUp(e.clientX, e.clientY, false));
canvas.addEventListener('touchstart', (e) => { e.preventDefault(); const t = e.touches[0]; onPointerDown(t.clientX, t.clientY); }, { passive: false });
canvas.addEventListener('touchend',   (e) => { e.preventDefault(); const t = e.changedTouches[0]; onPointerUp(t.clientX, t.clientY, true); }, { passive: false });

let cursorVisible = false;
document.addEventListener('mousemove', (e) => {
  cursorEl.style.left = e.clientX + 'px';
  cursorEl.style.top  = e.clientY + 'px';
  if (!cursorVisible) { cursorVisible = true; cursorEl.style.opacity = '1'; }
});

// ─── Boot ─────────────────────────────────────────────────────────────────────
async function boot(): Promise<void> {
  resize();

  await RAPIER.init();
  world = new RAPIER.World({ x: 0, y: GRAV_STRENGTH * GRAV_SCALE });
  // Tell Rapier that 1 "meter" = ~50 pixels (avg body size).
  // This scales internal tolerances (contact error, sleep thresholds, CCD prediction)
  // proportionally so they make sense in pixel-space instead of meter-space.
  world.lengthUnit = 50;
  createWalls();

  const gui = new GUI({ title: '설정' });
  gui.add(params, 'emojiSizeRatio', 0.5, 2.0, 0.1).name('이모지 크기');

  loop();
  startIntro();
}

boot();
