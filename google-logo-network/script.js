'use strict';

const canvas = document.getElementById('c');
const ctx    = canvas.getContext('2d');
const curEl  = document.getElementById('cursor');

// ── CONSTANTS ──
const PER_LETTER = 40;
const N_LETTERS  = 6;
const N          = PER_LETTER * N_LETTERS;
const NEAREST_K  = 3;
const BASE_SPEED = 0.6;
const SPEED_LERP = 0.018;
const MAX_SPD    = 2.5;
const SEARCH_R   = 90;
const SEARCH_R2  = SEARCH_R * SEARCH_R;
const CELL       = SEARCH_R;
const REPEL_R    = 100;
const REPEL_F    = 1.8;

const MAX_OFFSET_X = 40;
const MAX_OFFSET_Y = 40;
const ATTRACT_LER  = 0.06;
const SPRING_LER   = 0.08;

// Google brand colors per letter: G, o, o, g, l, e
const G_RGB = [
  [66,  133, 244],  // G  blue
  [234,  67,  53],  // o  red
  [251, 188,   5],  // o  yellow
  [66,  133, 244],  // g  blue
  [52,  168,  83],  // l  green
  [234,  67,  53],  // e  red
];
const DOT_COLORS  = G_RGB.map(([r, g, b]) => `rgb(${r},${g},${b})`);

let W, H;
let px, py, vx, vy, baseSpd, homeIdx;
let mask, letterPx, letterCx, letterCy, letterMinX, letterMaxX;
let lox, loy;
let gridW, gridH, grid, gridCount;

// ── SIZE ──
function getSize() {
  W = window.innerWidth;
  H = window.innerHeight;
}

// ── BUILD MASK ──
function buildMask() {
  const mc   = document.createElement('canvas');
  mc.width   = W; mc.height = H;
  const mctx = mc.getContext('2d');
  const letters = ['G', 'o', 'o', 'g', 'l', 'e'];

  const targetW = Math.min(W, H) - 40;
  let fontSize  = W * 0.2;
  mctx.textBaseline = 'middle';
  for (let i = 0; i < 14; i++) {
    mctx.font = `900 ${fontSize}px Arial Black, Arial, sans-serif`;
    fontSize  *= targetW / mctx.measureText('Google').width;
  }
  mctx.font = `900 ${fontSize}px Arial Black, Arial, sans-serif`;

  const totalW = mctx.measureText('Google').width;
  const startX = (W - totalW) / 2;
  letters.forEach((ch, i) => {
    const x = startX + mctx.measureText('Google'.slice(0, i)).width;
    mctx.fillStyle = `rgb(${(i + 1) * 40},0,0)`;
    mctx.fillText(ch, x, H / 2);
  });

  const raw  = mctx.getImageData(0, 0, W, H).data;
  mask       = new Uint8Array(W * H);
  letterPx   = Array.from({ length: N_LETTERS }, () => ({ xs: [], ys: [] }));
  letterCx   = new Float32Array(N_LETTERS);
  letterCy   = new Float32Array(N_LETTERS);
  letterMinX = new Float32Array(N_LETTERS).fill(W);
  letterMaxX = new Float32Array(N_LETTERS);

  for (let idx = 0; idx < W * H; idx++) {
    const r = raw[idx * 4];
    if (r === 0) continue;
    const li = Math.round(r / 40) - 1;
    mask[idx] = li + 1;
    const xi = idx % W, yi = (idx / W) | 0;
    letterPx[li].xs.push(xi);
    letterPx[li].ys.push(yi);
    letterCx[li] += xi;
    letterCy[li] += yi;
    if (xi < letterMinX[li]) letterMinX[li] = xi;
    if (xi > letterMaxX[li]) letterMaxX[li] = xi;
  }

  for (let li = 0; li < N_LETTERS; li++) {
    const cnt = letterPx[li].xs.length;
    if (cnt > 0) { letterCx[li] /= cnt; letterCy[li] /= cnt; }
  }
}

// ── GRID ──
function initGrid() {
  gridW     = Math.ceil(W / CELL) + 2;
  gridH     = Math.ceil(H / CELL) + 2;
  grid      = new Int32Array(gridW * gridH * 40).fill(-1);
  gridCount = new Int32Array(gridW * gridH);
}

function buildGrid() {
  gridCount.fill(0);
  for (let i = 0; i < N; i++) {
    const gx = (px[i] / CELL) | 0;
    const gy = (py[i] / CELL) | 0;
    if (gx < 0 || gx >= gridW || gy < 0 || gy >= gridH) continue;
    const cell = gy * gridW + gx;
    const slot = gridCount[cell];
    if (slot < 40) { grid[cell * 40 + slot] = i; gridCount[cell]++; }
  }
}

// ── INIT PARTICLES ──
function initParticles() {
  px      = new Float32Array(N);
  py      = new Float32Array(N);
  vx      = new Float32Array(N);
  vy      = new Float32Array(N);
  baseSpd = new Float32Array(N);
  homeIdx = new Uint8Array(N);
  lox     = new Float32Array(N_LETTERS);
  loy     = new Float32Array(N_LETTERS);

  for (let li = 0; li < N_LETTERS; li++) {
    const { xs, ys } = letterPx[li];
    const count      = xs.length;
    for (let k = 0; k < PER_LETTER; k++) {
      const i  = li * PER_LETTER + k;
      const ri = (Math.random() * count) | 0;
      px[i]    = xs[ri] + (Math.random() - 0.5);
      py[i]    = ys[ri] + (Math.random() - 0.5);
      const angle = Math.random() * Math.PI * 2;
      const spd   = BASE_SPEED * (0.5 + Math.random() * 1.0);
      baseSpd[i]  = spd;
      vx[i]       = Math.cos(angle) * spd;
      vy[i]       = Math.sin(angle) * spd;
      homeIdx[i]  = li + 1;
    }
  }
}

// ── COORDINATE CONVERSION ──
function toCanvas(sx, sy) {
  return { x: sx, y: sy };
}

// ── MOUSE / TOUCH ──
const mouse = { x: -9999, y: -9999, down: false, touching: false };

window.addEventListener('mousemove', e => {
  const c = toCanvas(e.clientX, e.clientY);
  mouse.x = c.x; mouse.y = c.y;
  curEl.style.left = e.clientX + 'px';
  curEl.style.top  = e.clientY + 'px';
});
window.addEventListener('mousedown', () => { mouse.down = true; });
window.addEventListener('mouseup',   () => { mouse.down = false; });
window.addEventListener('touchstart', e => {
  e.preventDefault();
  const t = e.touches[0];
  const c = toCanvas(t.clientX, t.clientY);
  mouse.x = c.x; mouse.y = c.y;
  mouse.touching = true;
  curEl.style.left = t.clientX + 'px';
  curEl.style.top  = t.clientY + 'px';
}, { passive: false });
window.addEventListener('touchmove', e => {
  e.preventDefault();
  const t = e.touches[0];
  const c = toCanvas(t.clientX, t.clientY);
  mouse.x = c.x; mouse.y = c.y;
  curEl.style.left = t.clientX + 'px';
  curEl.style.top  = t.clientY + 'px';
}, { passive: false });
window.addEventListener('touchend', e => {
  e.preventDefault();
  mouse.touching = false;
  mouse.x = -9999; mouse.y = -9999;
}, { passive: false });

// ── BOUNCE ──
function bounce(i) {
  const hi = homeIdx[i];

  const inBounds = (x, y) => {
    const xi = x | 0, yi = y | 0;
    return xi >= 0 && xi < W && yi >= 0 && yi < H && mask[yi * W + xi] === hi;
  };

  let nx = px[i] + vx[i];
  let ny = py[i] + vy[i];

  if (!inBounds(nx, ny)) {
    const flipX = inBounds(px[i] - vx[i], ny);
    const flipY = inBounds(nx, py[i] - vy[i]);

    if (flipX && !flipY)      { vx[i] = -vx[i]; }
    else if (flipY && !flipX) { vy[i] = -vy[i]; }
    else                      { vx[i] = -vx[i]; vy[i] = -vy[i]; }

    nx = px[i] + vx[i];
    ny = py[i] + vy[i];

    if (!inBounds(nx, ny)) {
      const dx  = letterCx[hi - 1] - px[i];
      const dy  = letterCy[hi - 1] - py[i];
      const d   = Math.hypot(dx, dy) || 1;
      const spd = baseSpd[i];
      vx[i] = (dx / d) * spd + (Math.random() - 0.5) * 0.3;
      vy[i] = (dy / d) * spd + (Math.random() - 0.5) * 0.3;
      nx    = px[i] + vx[i];
      ny    = py[i] + vy[i];
      if (!inBounds(nx, ny)) { nx = px[i]; ny = py[i]; }
    }
  }

  px[i] = nx; py[i] = ny;
}

// ── UPDATE LETTER OFFSETS ──
function updateOffsets() {
  const mx  = mouse.x, my = mouse.y;
  const GAP = 4;

  for (let li = 0; li < N_LETTERS; li++) {
    if (mouse.down || mouse.touching) {
      const dx = mx - (letterCx[li] + lox[li]);
      const dy = my - (letterCy[li] + loy[li]);
      lox[li] += (dx > 0 ? 1 : -1) * Math.min(Math.abs(dx), MAX_OFFSET_X) * ATTRACT_LER;
      loy[li] += (dy > 0 ? 1 : -1) * Math.min(Math.abs(dy), MAX_OFFSET_Y) * ATTRACT_LER;
      lox[li] = Math.max(-MAX_OFFSET_X, Math.min(MAX_OFFSET_X, lox[li]));
      loy[li] = Math.max(-MAX_OFFSET_Y, Math.min(MAX_OFFSET_Y, loy[li]));
    } else {
      lox[li] += (0 - lox[li]) * SPRING_LER;
      loy[li] += (0 - loy[li]) * SPRING_LER;
    }
  }

  for (let li = 1; li < N_LETTERS; li++) {
    const rightEdge = letterMaxX[li - 1] + lox[li - 1];
    const leftEdge  = letterMinX[li]     + lox[li];
    if (leftEdge < rightEdge + GAP) {
      const overlap = (rightEdge + GAP - leftEdge) / 2;
      lox[li]     = Math.max(-MAX_OFFSET_X, Math.min(MAX_OFFSET_X, lox[li]     + overlap));
      lox[li - 1] = Math.max(-MAX_OFFSET_X, Math.min(MAX_OFFSET_X, lox[li - 1] - overlap));
    }
  }
}

// ── UPDATE PARTICLES ──
function update() {
  for (let i = 0; i < N; i++) {
    const spd = Math.sqrt(vx[i] * vx[i] + vy[i] * vy[i]);
    if (spd > 0.001) {
      const newSpd  = spd + (baseSpd[i] - spd) * SPEED_LERP;
      const scale   = Math.min(newSpd, MAX_SPD) / spd;
      vx[i] *= scale; vy[i] *= scale;
    } else {
      const a = Math.random() * Math.PI * 2;
      vx[i] = Math.cos(a) * baseSpd[i];
      vy[i] = Math.sin(a) * baseSpd[i];
    }
    bounce(i);
  }
}

// ── LINE-OF-SIGHT ──
function lineInStroke(x1, y1, x2, y2, letterIdx) {
  const STEPS = 10;
  const dx = x2 - x1, dy = y2 - y1;
  for (let s = 1; s < STEPS; s++) {
    const t  = s / STEPS;
    const xi = (x1 + dx * t) | 0;
    const yi = (y1 + dy * t) | 0;
    if (xi < 0 || xi >= W || yi < 0 || yi >= H) return false;
    if (mask[yi * W + xi] !== letterIdx) return false;
  }
  return true;
}

// ── DRAW LINES ──
function drawLines() {
  const candBuf = new Int32Array(150);
  const distBuf = new Float32Array(150);

  for (let i = 0; i < N; i++) {
    const li  = homeIdx[i] - 1;
    const hi  = homeIdx[i];
    const ax  = px[i] + lox[li];
    const ay  = py[i] + loy[li];
    const gcx = (ax / CELL) | 0;
    const gcy = (ay / CELL) | 0;

    let candLen = 0;
    for (let oy = -1; oy <= 1; oy++) {
      const gy = gcy + oy;
      if (gy < 0 || gy >= gridH) continue;
      for (let ox = -1; ox <= 1; ox++) {
        const gx = gcx + ox;
        if (gx < 0 || gx >= gridW) continue;
        const cell = gy * gridW + gx;
        const cnt  = gridCount[cell];
        const base = cell * 40;
        for (let s = 0; s < cnt; s++) {
          const j = grid[base + s];
          if (j <= i || homeIdx[j] !== hi) continue;
          const lj  = homeIdx[j] - 1;
          const bx  = px[j] + lox[lj], by = py[j] + loy[lj];
          const ddx = ax - bx, ddy = ay - by;
          const d2  = ddx * ddx + ddy * ddy;
          if (d2 < SEARCH_R2 && candLen < 150) {
            candBuf[candLen] = j;
            distBuf[candLen] = d2;
            candLen++;
          }
        }
      }
    }

    if (candLen === 0) continue;
    const k = Math.min(NEAREST_K, candLen);

    for (let ki = 0; ki < k; ki++) {
      let minIdx = ki;
      for (let m = ki + 1; m < candLen; m++) {
        if (distBuf[m] < distBuf[minIdx]) minIdx = m;
      }
      if (minIdx !== ki) {
        let tmp = candBuf[ki]; candBuf[ki] = candBuf[minIdx]; candBuf[minIdx] = tmp;
        let td  = distBuf[ki]; distBuf[ki] = distBuf[minIdx]; distBuf[minIdx] = td;
      }

      const j  = candBuf[ki];
      const lj = homeIdx[j] - 1;
      const bx = px[j] + lox[lj], by = py[j] + loy[lj];

      if (!lineInStroke(px[i], py[i], px[j], py[j], hi)) continue;

      const d     = Math.sqrt(distBuf[ki]);
      const t     = 1 - d / SEARCH_R;
      const alpha = t * t * 0.8;
      const [r, g, b] = G_RGB[hi - 1];

      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.strokeStyle = `rgba(${r},${g},${b},${alpha.toFixed(2)})`;
      ctx.lineWidth   = 1.0 + t * 0.6;
      ctx.stroke();
    }
  }
}

// ── DRAW DOTS ──
function drawDots() {
  for (let li = 0; li < N_LETTERS; li++) {
    const hi        = li + 1;
    const [r, g, b] = G_RGB[li];
    const ocx       = letterCx[li] + lox[li];
    const ocy       = letterCy[li] + loy[li];

    const glow = ctx.createRadialGradient(ocx, ocy, 0, ocx, ocy, SEARCH_R * 1.4);
    glow.addColorStop(0, `rgba(${r},${g},${b},0.07)`);
    glow.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.beginPath();
    ctx.arc(ocx, ocy, SEARCH_R * 1.4, 0, Math.PI * 2);
    ctx.fillStyle = glow;
    ctx.fill();

    ctx.beginPath();
    for (let k = 0; k < PER_LETTER; k++) {
      const i  = li * PER_LETTER + k;
      const rx = px[i] + lox[li];
      const ry = py[i] + loy[li];
      ctx.moveTo(rx + 2.6, ry);
      ctx.arc(rx, ry, 2.6, 0, Math.PI * 2);
    }
    ctx.shadowBlur  = 14;
    ctx.shadowColor = `rgb(${r},${g},${b})`;
    ctx.fillStyle   = DOT_COLORS[li];
    ctx.fill();
  }
  ctx.shadowBlur = 0;
}

// ── LOOP ──
function animate() {
  ctx.fillStyle = '#050505';
  ctx.fillRect(0, 0, W, H);

  updateOffsets();
  update();
  buildGrid();
  drawLines();
  drawDots();

  requestAnimationFrame(animate);
}

// ── INIT ──
function init() {
  getSize();
  canvas.width  = W;
  canvas.height = H;
  buildMask();
  initGrid();
  initParticles();
  animate();
}

init();

window.addEventListener('resize', () => {
  getSize();
  canvas.width  = W;
  canvas.height = H;
  buildMask();
  initGrid();
  initParticles();
});
