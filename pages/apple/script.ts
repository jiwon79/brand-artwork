import GUI from 'lil-gui';

// ── Config ───────────────────────────────────────────────
const CELL      = 35;
const GAP       = 0.5;
const STEP      = CELL + GAP;
const SUPER_N   = 5;          // fixed Apple squircle exponent
const HOLD_MS   = 2000;
const DECAY     = 0.9601;

type FalloffKey = 'quadratic' | 'linear' | 'cubic' | 'sqrt' | 'gaussian' | 'cosine' | 'smoothstep';

const falloffFns: Record<FalloffKey, (t: number, dist: number, brushR: number) => number> = {
  linear:     (t)               => params.maxR * t,
  quadratic:  (t)               => params.maxR * t * t,
  cubic:      (t)               => params.maxR * t * t * t,
  sqrt:       (t)               => params.maxR * Math.sqrt(t),
  gaussian:   (_, dist, brushR) => params.maxR * Math.exp(-(dist * dist) / (2 * (brushR * 0.4) ** 2)),
  cosine:     (t)               => params.maxR * (Math.cos((1 - t) * Math.PI) + 1) / 2,
  smoothstep: (t)               => params.maxR * t * t * (3 - 2 * t),
};

const params = {
  falloff: 'quadratic' as FalloffKey,
  brushSize: 80,
  maxR: CELL / 2,
  radiusCurve: 0.4,
  bgColor: '#ffffff',
  cellColor: '#1c1c1e',
};

// ── DOM ───────────────────────────────────────────────────
const canvas   = document.getElementById('c') as HTMLCanvasElement;
const ctx      = canvas.getContext('2d') as CanvasRenderingContext2D;
const hint     = document.getElementById('hint') as HTMLElement;
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

  const brushR = params.brushSize;
  const minCx = Math.max(0, Math.floor((bx - brushR) / STEP));
  const maxCx = Math.min(cW - 1, Math.ceil((bx + brushR) / STEP));
  const minCy = Math.max(0, Math.floor((by - brushR) / STEP));
  const maxCy = Math.min(cH - 1, Math.ceil((by + brushR) / STEP));

  for (let cy = minCy; cy <= maxCy; cy++) {
    for (let cx = minCx; cx <= maxCx; cx++) {
      const px = cx * STEP;
      const py = cy * STEP;
      const dx = px - bx;
      const dy = py - by;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist >= brushR) continue;

      const t = 1 - dist / brushR;
      const target = falloffFns[params.falloff](t, dist, brushR);
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
function decayCells(now: number): void {
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
// cornerN already stores radius in px — apply power curve for contrast
function cornerRadius(r: number): number {
  return Math.pow(r / params.maxR, params.radiusCurve) * params.maxR;
}

// Parametric superellipse corner: |x|^SUPER_N + |y|^SUPER_N = r^SUPER_N
// cx,cy = corner vertex; d1 = direction corner→start; d2 = direction corner→end
const SQUIRCLE_STEPS = 10;
function squircleCorner(
  cx: number, cy: number,
  d1x: number, d1y: number,
  d2x: number, d2y: number,
  r: number
): void {
  const acx = cx + (d1x + d2x) * r;
  const acy = cy + (d1y + d2y) * r;
  const exp = 2 / SUPER_N;
  for (let i = 1; i <= SQUIRCLE_STEPS; i++) {
    const t = (i / SQUIRCLE_STEPS) * (Math.PI / 2);
    const u = Math.cos(t) ** exp;
    const v = Math.sin(t) ** exp;
    // Sweep from -d2 axis to -d1 axis around the arc center
    ctx.lineTo(acx - r * (u * d2x + v * d1x), acy - r * (u * d2y + v * d1y));
  }
}

function drawCell(
  x: number, y: number,
  nTL: number, nTR: number, nBR: number, nBL: number
): void {
  const rTL = cornerRadius(nTL);
  const rTR = cornerRadius(nTR);
  const rBR = cornerRadius(nBR);
  const rBL = cornerRadius(nBL);
  const R = x + CELL;
  const B = y + CELL;

  ctx.beginPath();
  ctx.moveTo(x + rTL, y);

  ctx.lineTo(R - rTR, y);
  rTR > 0 ? squircleCorner(R, y,  -1,  0,  0,  1, rTR) : ctx.lineTo(R, y);

  ctx.lineTo(R, B - rBR);
  rBR > 0 ? squircleCorner(R, B,   0, -1, -1,  0, rBR) : ctx.lineTo(R, B);

  ctx.lineTo(x + rBL, B);
  rBL > 0 ? squircleCorner(x, B,   1,  0,  0, -1, rBL) : ctx.lineTo(x, B);

  ctx.lineTo(x, y + rTL);
  rTL > 0 ? squircleCorner(x, y,   0,  1,  1,  0, rTL) : ctx.lineTo(x, y);

  ctx.closePath();
}

// ── Render loop ───────────────────────────────────────────
function render(now: number): void {
  decayCells(now);

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

// ── Events ────────────────────────────────────────────────
let isDown = false;

function onDown(x: number, y: number): void {
  isDown = true;
  applyBrush(x, y);
  hint.classList.add('hidden');
}

function onMove(x: number, y: number): void {
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
gui.add(params, 'brushSize', 20, 200, 1).name('brush size');
gui.add(params, 'maxR', 1, CELL / 2, 0.5).name('max radius');
gui.add(params, 'radiusCurve', 0.1, 2.0, 0.05).name('radius curve');
gui.addColor(params, 'bgColor').name('background');
gui.addColor(params, 'cellColor').name('cell color');

// ── Boot ─────────────────────────────────────────────────
setupCanvas();
initGrid();
requestAnimationFrame(render);
