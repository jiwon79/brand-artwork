import GUI from 'lil-gui';

// ── Constants ────────────────────────────────────────────
const W = 360;
const H = 640;
const GRAVITY = 280; // px/s²
const DURATION_MS = 12000;

// ── DOM ──────────────────────────────────────────────────
const canvas = document.getElementById('scene') as HTMLCanvasElement;
const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
const hook = document.getElementById('hook') as HTMLDivElement;
const jdi = document.getElementById('jdi') as HTMLDivElement;
const jdiKr = document.getElementById('jdi-kr') as HTMLDivElement;
const timerEl = document.getElementById('timer') as HTMLDivElement;
const debugEl = document.getElementById('debug') as HTMLDivElement;
const playBtn = document.getElementById('btn-play') as HTMLButtonElement;
const resetBtn = document.getElementById('btn-reset') as HTMLButtonElement;
const debugBtn = document.getElementById('btn-debug') as HTMLButtonElement;

debugEl.style.whiteSpace = 'pre-line';

let DEBUG = false;

// ── Words as angled platforms ────────────────────────────
type Word = {
  text: string;
  cx: number;
  cy: number;
  angle: number; // degrees
  font: string;
  width: number;
  p1: { x: number; y: number };
  p2: { x: number; y: number };
  normal: { x: number; y: number };
};

const words: Word[] = [
  { text: 'failures', cx: 130, cy: 175, angle:  18, font: 'italic 26px Georgia, serif', width: 0, p1: { x: 0, y: 0 }, p2: { x: 0, y: 0 }, normal: { x: 0, y: 0 } },
  { text: 'become',   cx: 230, cy: 295, angle: -22, font: 'italic 26px Georgia, serif', width: 0, p1: { x: 0, y: 0 }, p2: { x: 0, y: 0 }, normal: { x: 0, y: 0 } },
  { text: 'the',      cx: 110, cy: 415, angle:  25, font: 'italic 28px Georgia, serif', width: 0, p1: { x: 0, y: 0 }, p2: { x: 0, y: 0 }, normal: { x: 0, y: 0 } },
  { text: 'road',     cx: 245, cy: 530, angle: -20, font: 'italic 30px Georgia, serif', width: 0, p1: { x: 0, y: 0 }, p2: { x: 0, y: 0 }, normal: { x: 0, y: 0 } },
];

function measureWords(): void {
  for (const w of words) {
    ctx.font = w.font;
    const m = ctx.measureText(w.text);
    w.width = m.width;
    const a = (w.angle * Math.PI) / 180;
    const half = w.width / 2;
    w.p1 = { x: w.cx - Math.cos(a) * half, y: w.cy - Math.sin(a) * half };
    w.p2 = { x: w.cx + Math.cos(a) * half, y: w.cy + Math.sin(a) * half };
    w.normal = { x: Math.sin(a), y: -Math.cos(a) };
  }
}
measureWords();

// ── Ball physics ─────────────────────────────────────────
const ball = {
  x: 105,
  y: -20,
  vx: 0,
  vy: 0,
  r: 7,
  onPlatform: -1,
  t: 0,
};

const trail: { x: number; y: number }[] = [];

function resetPhysics(): void {
  ball.x = 105;
  ball.y = -20;
  ball.vx = 0;
  ball.vy = 0;
  ball.onPlatform = -1;
  ball.t = 0;
  trail.length = 0;
  trail.push({ x: ball.x, y: ball.y });
}

function pointToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = ((px - ax) * dx + (py - ay) * dy) / len2;
  const tClamped = Math.max(0, Math.min(1, t));
  const cx = ax + tClamped * dx;
  const cy = ay + tClamped * dy;
  const ddx = px - cx;
  const ddy = py - cy;
  return { dist: Math.sqrt(ddx * ddx + ddy * ddy), t: tClamped, tRaw: t, cx, cy };
}

function checkLanding(): void {
  if (ball.onPlatform >= 0) return;

  let bestI = -1;
  let bestDist = Infinity;
  let bestRes: ReturnType<typeof pointToSegment> | null = null;

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const r = pointToSegment(ball.x, ball.y, w.p1.x, w.p1.y, w.p2.x, w.p2.y);
    if (r.dist < ball.r + 2 && r.t > 0.02 && r.t < 0.98) {
      const dx = ball.x - r.cx;
      const dy = ball.y - r.cy;
      const nDot = dx * w.normal.x + dy * w.normal.y;
      if (nDot >= -ball.r * 0.8) {
        if (r.dist < bestDist) {
          bestDist = r.dist;
          bestI = i;
          bestRes = r;
        }
      }
    }
  }

  if (bestI >= 0 && bestRes) {
    const w = words[bestI];
    ball.onPlatform = bestI;
    ball.t = bestRes.t;
    ball.x = bestRes.cx + w.normal.x * ball.r;
    ball.y = bestRes.cy + w.normal.y * ball.r;
    const along = { x: w.p2.x - w.p1.x, y: w.p2.y - w.p1.y };
    const aLen = Math.sqrt(along.x * along.x + along.y * along.y);
    const aHat = { x: along.x / aLen, y: along.y / aLen };
    const vAlong = ball.vx * aHat.x + ball.vy * aHat.y;
    ball.vx = aHat.x * vAlong;
    ball.vy = aHat.y * vAlong;
  }
}

function physicsStep(dt: number): void {
  if (ball.onPlatform >= 0) {
    const w = words[ball.onPlatform];
    const along = { x: w.p2.x - w.p1.x, y: w.p2.y - w.p1.y };
    const aLen = Math.sqrt(along.x * along.x + along.y * along.y);
    const aHat = { x: along.x / aLen, y: along.y / aLen };

    const gAlong = aHat.y * GRAVITY;
    let vAlong = ball.vx * aHat.x + ball.vy * aHat.y;
    vAlong += gAlong * dt;

    ball.vx = aHat.x * vAlong;
    ball.vy = aHat.y * vAlong;

    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;

    const r = pointToSegment(ball.x, ball.y, w.p1.x, w.p1.y, w.p2.x, w.p2.y);
    ball.t = r.tRaw;

    if (r.tRaw >= 1.0 || r.tRaw <= 0.0) {
      ball.onPlatform = -1;
    } else {
      ball.x = r.cx + w.normal.x * ball.r;
      ball.y = r.cy + w.normal.y * ball.r;
    }
  } else {
    ball.vy += GRAVITY * dt;
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;
    checkLanding();
  }

  const last = trail[trail.length - 1];
  if (!last || Math.abs(last.x - ball.x) > 0.5 || Math.abs(last.y - ball.y) > 0.5) {
    trail.push({ x: ball.x, y: ball.y });
  }
}

// ── Asphalt texture & masks ──────────────────────────────
const asphalt = document.createElement('canvas');
asphalt.width = W;
asphalt.height = H;
(function buildAsphalt() {
  const aCtx = asphalt.getContext('2d') as CanvasRenderingContext2D;
  aCtx.fillStyle = '#1c1c1c';
  aCtx.fillRect(0, 0, W, H);
  const img = aCtx.getImageData(0, 0, W, H);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 50;
    d[i] = Math.max(0, Math.min(255, 28 + n));
    d[i + 1] = Math.max(0, Math.min(255, 28 + n));
    d[i + 2] = Math.max(0, Math.min(255, 30 + n));
    d[i + 3] = 255;
  }
  aCtx.putImageData(img, 0, 0);
  for (let i = 0; i < 200; i++) {
    aCtx.fillStyle = `rgba(${(Math.random() * 40) | 0}, ${(Math.random() * 40) | 0}, ${(Math.random() * 40) | 0}, 0.4)`;
    aCtx.beginPath();
    aCtx.arc(Math.random() * W, Math.random() * H, Math.random() * 4, 0, Math.PI * 2);
    aCtx.fill();
  }
})();

const mask = document.createElement('canvas');
mask.width = W;
mask.height = H;
const mCtx = mask.getContext('2d') as CanvasRenderingContext2D;

const roadCanvas = document.createElement('canvas');
roadCanvas.width = W;
roadCanvas.height = H;
const rCtx = roadCanvas.getContext('2d') as CanvasRenderingContext2D;

function paintTrailToMask(): void {
  if (trail.length < 2) return;
  mCtx.clearRect(0, 0, W, H);
  mCtx.strokeStyle = 'rgba(0,0,0,1)';
  mCtx.lineWidth = 22;
  mCtx.lineCap = 'round';
  mCtx.lineJoin = 'round';
  mCtx.beginPath();
  mCtx.moveTo(trail[0].x, trail[0].y);
  for (let i = 1; i < trail.length; i++) {
    mCtx.lineTo(trail[i].x, trail[i].y);
  }
  mCtx.stroke();
}

function buildRoad(): void {
  rCtx.clearRect(0, 0, W, H);
  rCtx.drawImage(mask, 0, 0);
  rCtx.globalCompositeOperation = 'source-in';
  rCtx.drawImage(asphalt, 0, 0);
  rCtx.globalCompositeOperation = 'source-over';
}

// ── Rendering ────────────────────────────────────────────
function drawWord(w: Word, opacity: number): void {
  ctx.save();
  ctx.translate(w.cx, w.cy);
  ctx.rotate((w.angle * Math.PI) / 180);
  ctx.font = w.font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = `rgba(10,10,10,${opacity})`;
  ctx.fillText(w.text, 0, 0);
  ctx.restore();

  if (DEBUG) {
    ctx.strokeStyle = 'rgba(255,0,0,0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(w.p1.x, w.p1.y);
    ctx.lineTo(w.p2.x, w.p2.y);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(0,200,0,0.6)';
    ctx.beginPath();
    ctx.moveTo(w.cx, w.cy);
    ctx.lineTo(w.cx + w.normal.x * 18, w.cy + w.normal.y * 18);
    ctx.stroke();
  }
}

function drawBall(opacity: number): void {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.25)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 2;
  ctx.fillStyle = `rgba(10,10,10,${opacity})`;
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ── Timeline ─────────────────────────────────────────────
let startTime: number | null = null;
let lastFrameTime: number | null = null;
let raf: number | null = null;
let playing = false;
let wordsOpacity = 1;
let ballOpacity = 0;
let morphT = 0;

function frame(ts: number): void {
  if (startTime === null) {
    startTime = ts;
    lastFrameTime = ts;
  }
  const elapsed = ts - startTime;
  const dt = Math.min(0.033, (ts - (lastFrameTime ?? ts)) / 1000);
  lastFrameTime = ts;

  timerEl.textContent = `${(elapsed / 1000).toFixed(2).padStart(5, '0')}s / 12.00s`;

  if (elapsed < 1000) {
    hook.style.opacity = '1';
    ballOpacity = 0;
    wordsOpacity = 1;
  } else if (elapsed < 2000) {
    const k = (elapsed - 1000) / 1000;
    hook.style.opacity = `${1 - k}`;
    ballOpacity = k;
  } else if (elapsed < 9000) {
    hook.style.opacity = '0';
    ballOpacity = 1;
    const steps = 4;
    for (let i = 0; i < steps; i++) {
      physicsStep(dt / steps);
    }
    paintTrailToMask();
  } else if (elapsed < 10000) {
    const k = (elapsed - 9000) / 1000;
    ballOpacity = 1 - k;
    wordsOpacity = 1 - k;
  } else if (elapsed < 11500) {
    morphT = (elapsed - 10000) / 1500;
    ballOpacity = 0;
    wordsOpacity = 0;
  } else if (elapsed < DURATION_MS) {
    const k = (elapsed - 11500) / 500;
    morphT = 1;
    jdi.style.opacity = '1';
    jdiKr.style.opacity = `${k}`;
  } else {
    morphT = 1;
    jdi.style.opacity = '1';
    jdiKr.style.opacity = '1';
    playing = false;
    timerEl.textContent = '12.00s / 12.00s';
    renderScene();
    return;
  }

  renderScene();
  if (playing) raf = requestAnimationFrame(frame);
}

function renderScene(): void {
  ctx.clearRect(0, 0, W, H);

  if (morphT < 0.001) {
    buildRoad();
    ctx.drawImage(roadCanvas, 0, 0);
  } else if (morphT < 1) {
    buildRoad();
    ctx.globalAlpha = 1 - morphT;
    ctx.drawImage(roadCanvas, 0, 0);
    ctx.globalAlpha = 1;
  }

  if (wordsOpacity > 0) {
    for (const w of words) drawWord(w, wordsOpacity);
  }

  if (ballOpacity > 0) {
    drawBall(ballOpacity);
  }

  if (DEBUG) {
    debugEl.textContent =
      `pos: ${ball.x.toFixed(0)}, ${ball.y.toFixed(0)}\n` +
      `vel: ${ball.vx.toFixed(0)}, ${ball.vy.toFixed(0)}\n` +
      `on platform: ${ball.onPlatform}\n` +
      `t: ${ball.t.toFixed(2)}\n` +
      `trail: ${trail.length} pts`;
  } else {
    debugEl.textContent = '';
  }
}

function play(): void {
  if (playing) return;
  reset();
  playing = true;
  startTime = null;
  lastFrameTime = null;
  raf = requestAnimationFrame(frame);
}

function reset(): void {
  if (raf !== null) cancelAnimationFrame(raf);
  playing = false;
  startTime = null;
  resetPhysics();
  mCtx.clearRect(0, 0, W, H);
  morphT = 0;
  wordsOpacity = 1;
  ballOpacity = 0;
  hook.style.opacity = '1';
  jdi.style.opacity = '0';
  jdiKr.style.opacity = '0';
  timerEl.textContent = '00.00s / 12.00s';
  renderScene();
}

function toggleDebug(): void {
  DEBUG = !DEBUG;
  renderScene();
}

playBtn.addEventListener('click', play);
resetBtn.addEventListener('click', reset);
debugBtn.addEventListener('click', toggleDebug);

// ── lil-gui: word position controls ──────────────────────
const gui = new GUI({ title: 'Word Positions' });
for (const w of words) {
  const folder = gui.addFolder(w.text);
  const onChange = () => {
    measureWords();
    if (!playing) renderScene();
  };
  folder.add(w, 'cx', 0, W, 1).onChange(onChange);
  folder.add(w, 'cy', 0, H, 1).onChange(onChange);
  folder.add(w, 'angle', -45, 45, 1).onChange(onChange);
}

reset();
