import GUI from 'lil-gui';

// ── Config ───────────────────────────────────────────────
const CELL    = 35;
const GAP     = 0.5;
const STEP    = CELL + GAP;
const MAX_N   = 4;
const MAX_R   = CELL / 2;
const BRUSH_R = 80;
const HOLD_MS = 2000;
const DECAY   = 0.9601;

type FalloffKey = 'quadratic' | 'linear' | 'cubic' | 'sqrt' | 'gaussian' | 'cosine' | 'smoothstep';

const falloffFns: Record<FalloffKey, (t: number, dist: number) => number> = {
  linear:     (t)       => MAX_N * t,
  quadratic:  (t)       => MAX_N * t * t,
  cubic:      (t)       => MAX_N * t * t * t,
  sqrt:       (t)       => MAX_N * Math.sqrt(t),
  gaussian:   (_, dist) => MAX_N * Math.exp(-(dist * dist) / (2 * (BRUSH_R * 0.4) ** 2)),
  cosine:     (t)       => MAX_N * (Math.cos((1 - t) * Math.PI) + 1) / 2,
  smoothstep: (t)       => MAX_N * t * t * (3 - 2 * t),
};

const params = {
  falloff: 'quadratic' as FalloffKey,
  bgColor: '#ffffff',
  cellColor: '#1c1c1e',
};

// ── DOM ───────────────────────────────────────────────────
const canvas   = document.getElementById('c') as HTMLCanvasElement;
const ctx      = canvas.getContext('2d') as CanvasRenderingContext2D;
const hint     = document.getElementById('hint') as HTMLElement;
const ring     = document.getElementById('cursor-ring') as HTMLElement;
const clearBtn = document.getElementById('clear-btn') as HTMLButtonElement;

// ── DPR setup ────────────────────────────────────────────
let dpr = 1;

function setupCanvas(): void {
  dpr = window.devicePixelRatio || 1;
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.width  = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width  = w + 'px';
  canvas.style.height = h + 'px';
  ctx.scale(dpr, dpr);
}

function logicalW(): number { return canvas.width  / dpr; }
function logicalH(): number { return canvas.height / dpr; }

// ── Corner grid ──────────────────────────────────────────
let cW: number;
let cH: number;
let cornerN: Float32Array;
let cornerTime: Float64Array;

function initGrid(): void {
  cW = Math.ceil(logicalW() / STEP) + 3;
  cH = Math.ceil(logicalH() / STEP) + 3;
  cornerN    = new Float32Array(cW * cH);
  cornerTime = new Float64Array(cW * cH);
  cornerTime.fill(-Infinity);
}

function ci(x: number, y: number): number {
  return y * cW + x;
}

// ── Apply brush (logical coords) ─────────────────────────
function applyBrush(bx: number, by: number): void {
  const now = performance.now();

  const minCx = Math.max(0, Math.floor((bx - BRUSH_R) / STEP));
  const maxCx = Math.min(cW - 1, Math.ceil((bx + BRUSH_R) / STEP));
  const minCy = Math.max(0, Math.floor((by - BRUSH_R) / STEP));
  const maxCy = Math.min(cH - 1, Math.ceil((by + BRUSH_R) / STEP));

  for (let cy = minCy; cy <= maxCy; cy++) {
    for (let cx = minCx; cx <= maxCx; cx++) {
      const px = cx * STEP;
      const py = cy * STEP;
      const dx = px - bx;
      const dy = py - by;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist >= BRUSH_R) continue;

      const t = 1 - dist / BRUSH_R;
      const target = falloffFns[params.falloff](t, dist);
      const idx = ci(cx, cy);

      if (target > cornerN[idx]) {
        cornerN[idx]    = target;
        cornerTime[idx] = now;
      } else if (target > 0) {
        cornerTime[idx] = now;
      }
    }
  }
}

// ── Decay ─────────────────────────────────────────────────
function decayCorners(now: number): void {
  for (let i = 0; i < cornerN.length; i++) {
    if (cornerN[i] <= 0.005) { cornerN[i] = 0; continue; }

    const elapsed = now - cornerTime[i];
    if (elapsed > HOLD_MS) {
      cornerN[i] *= DECAY;
      if (cornerN[i] < 0.005) cornerN[i] = 0;
    }
  }
}

// ── Draw one cell ─────────────────────────────────────────
function nToRadius(n: number): number {
  return (n / MAX_N) * MAX_R;
}

function drawCell(
  x: number, y: number,
  nTL: number, nTR: number, nBR: number, nBL: number
): void {
  const rTL = nToRadius(nTL);
  const rTR = nToRadius(nTR);
  const rBR = nToRadius(nBR);
  const rBL = nToRadius(nBL);
  const r = x + CELL;
  const b = y + CELL;

  ctx.beginPath();
  ctx.moveTo(x + rTL, y);
  ctx.lineTo(r - rTR, y);
  rTR > 0 ? ctx.arcTo(r, y, r, y + rTR, rTR) : ctx.lineTo(r, y);
  ctx.lineTo(r, b - rBR);
  rBR > 0 ? ctx.arcTo(r, b, r - rBR, b, rBR) : ctx.lineTo(r, b);
  ctx.lineTo(x + rBL, b);
  rBL > 0 ? ctx.arcTo(x, b, x, b - rBL, rBL) : ctx.lineTo(x, b);
  ctx.lineTo(x, y + rTL);
  rTL > 0 ? ctx.arcTo(x, y, x + rTL, y, rTL) : ctx.lineTo(x, y);
  ctx.closePath();
}

// ── Render loop ───────────────────────────────────────────
function render(now: number): void {
  decayCorners(now);

  ctx.clearRect(0, 0, logicalW(), logicalH());
  ctx.fillStyle = params.bgColor;
  ctx.fillRect(0, 0, logicalW(), logicalH());
  ctx.fillStyle = params.cellColor;

  const cols = cW - 1;
  const rows = cH - 1;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      drawCell(
        c * STEP, r * STEP,
        cornerN[ci(c,   r  )],
        cornerN[ci(c+1, r  )],
        cornerN[ci(c+1, r+1)],
        cornerN[ci(c,   r+1)]
      );
      ctx.fill();
    }
  }

  requestAnimationFrame(render);
}

// ── Cursor ring ───────────────────────────────────────────
function moveCursor(x: number, y: number): void {
  const d = BRUSH_R * 2;
  ring.style.left   = x + 'px';
  ring.style.top    = y + 'px';
  ring.style.width  = d + 'px';
  ring.style.height = d + 'px';
}

// ── Events ────────────────────────────────────────────────
let isDown = false;

function onDown(x: number, y: number): void {
  isDown = true;
  moveCursor(x, y);
  applyBrush(x, y);
  hint.classList.add('hidden');
}

function onMove(x: number, y: number): void {
  moveCursor(x, y);
  if (isDown) applyBrush(x, y);
}

function onUp(): void {
  isDown = false;
}

canvas.addEventListener('mousedown',  (e: MouseEvent) => onDown(e.clientX, e.clientY));
canvas.addEventListener('mousemove',  (e: MouseEvent) => onMove(e.clientX, e.clientY));
canvas.addEventListener('mouseup',    onUp);
canvas.addEventListener('mouseleave', onUp);

canvas.addEventListener('touchstart', (e: TouchEvent) => {
  e.preventDefault();
  onDown(e.touches[0].clientX, e.touches[0].clientY);
}, { passive: false });

canvas.addEventListener('touchmove', (e: TouchEvent) => {
  e.preventDefault();
  onMove(e.touches[0].clientX, e.touches[0].clientY);
}, { passive: false });

canvas.addEventListener('touchend', (e: TouchEvent) => {
  e.preventDefault();
  onUp();
}, { passive: false });

canvas.addEventListener('touchcancel', (e: TouchEvent) => {
  e.preventDefault();
  onUp();
}, { passive: false });

clearBtn.addEventListener('click', () => {
  cornerN.fill(0);
  cornerTime.fill(-Infinity);
  hint.classList.remove('hidden');
});

window.addEventListener('resize', () => {
  setupCanvas();
  initGrid();
});

// ── GUI ───────────────────────────────────────────────────
const gui = new GUI({ title: 'options' });
gui.add(params, 'falloff', Object.keys(falloffFns) as FalloffKey[]).name('falloff');
gui.addColor(params, 'bgColor').name('background');
gui.addColor(params, 'cellColor').name('cell color');

// ── Boot ─────────────────────────────────────────────────
setupCanvas();
initGrid();
requestAnimationFrame(render);
