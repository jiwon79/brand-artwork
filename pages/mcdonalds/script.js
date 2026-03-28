'use strict';

// ═══════════════════════════════════════════════════════════════
//  The Fry Matrix — script.js
//  Scenes: 1-Single Fry  2-Grid Fill  3-Logo Pixel Art  4-Physics
// ═══════════════════════════════════════════════════════════════

// ── Physics constants ──────────────────────────────────────────
const REPULSION_RADIUS = 80;
const REPULSION_FORCE  = 5;
const SPRING_K         = 0.031;
const DAMPING          = 0.75;
const RETURN_DAMPING   = 0.92;

// ── Grid constants ─────────────────────────────────────────────
const MAX_COLS         = 100;

// ═══════════════════════════════════════════════════════════════
//  Fry (particle)
// ═══════════════════════════════════════════════════════════════
class Fry {
  constructor(tx, ty, size, isGolden) {
    this.targetX   = tx;
    this.targetY   = ty;
    this.x         = tx;
    this.y         = ty;
    this.vx        = 0;
    this.vy        = 0;
    this.size      = size;
    this.isGolden  = isGolden;
    this._repelled = false;
    this.angle     = (Math.random() - 0.5) * 0.5;
  }

  applyRepulsion(mx, my) {
    const dx = this.x - mx;
    const dy = this.y - my;
    const d2 = dx * dx + dy * dy;
    if (d2 < REPULSION_RADIUS * REPULSION_RADIUS && d2 > 0.001) {
      const d   = Math.sqrt(d2);
      const str = (1 - d / REPULSION_RADIUS) * REPULSION_FORCE;
      this.vx  += (dx / d) * str;
      this.vy  += (dy / d) * str;
      this._repelled = true;
    }
  }

  applySpring() {
    this.vx += (this.targetX - this.x) * SPRING_K;
    this.vy += (this.targetY - this.y) * SPRING_K;
  }

  integrate() {
    const damp     = this._repelled ? DAMPING : RETURN_DAMPING;
    this._repelled = false;
    this.vx *= damp;
    this.vy *= damp;
    this.x  += this.vx;
    this.y  += this.vy;
  }

  isAtRest() {
    return (
      Math.abs(this.vx) < 0.04 &&
      Math.abs(this.vy) < 0.04 &&
      Math.abs(this.x - this.targetX) < 0.04 &&
      Math.abs(this.y - this.targetY) < 0.04
    );
  }
}

// ═══════════════════════════════════════════════════════════════
//  McDonald's Golden Arches — drawn programmatically on offscreen canvas
//  Returns a 300×300 HTMLCanvasElement (black/white for pixel mapping)
// ═══════════════════════════════════════════════════════════════
function buildArchesCanvas() {
  const SZ  = 300;
  const off = document.createElement('canvas');
  off.width  = SZ;
  off.height = SZ;
  const ctx = off.getContext('2d');
  const cx  = SZ / 2;

  // ── Background ───────────────────────────────────────────────
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, SZ, SZ);

  // ── Golden Arches (white for pixel mapping) ───────────────────
  ctx.fillStyle = '#fff';

  const baseY  = Math.round(SZ * 0.82);
  const outerR = Math.round(SZ * 0.185);
  const innerR = Math.round(SZ * 0.095);
  const lax    = Math.round(cx - SZ * 0.155);   // left arch center X
  const rax    = Math.round(cx + SZ * 0.155);   // right arch center X
  const archCY = baseY - outerR;                 // arch circle center Y

  // Draw each arch as a filled annular half-ring
  [lax, rax].forEach(ax => {
    ctx.beginPath();
    // Outer ring: left leg up → top arc (clockwise) → right leg down
    ctx.moveTo(ax - outerR, baseY);
    ctx.lineTo(ax - outerR, archCY);
    ctx.arc(ax, archCY, outerR, Math.PI, 0, false);
    ctx.lineTo(ax + outerR, baseY);
    // Inner cutout: right inner corner → right inner leg up → inner arc (counterclockwise) → left inner leg down
    ctx.lineTo(ax + innerR, baseY);
    ctx.lineTo(ax + innerR, archCY);
    ctx.arc(ax, archCY, innerR, 0, Math.PI, true);
    ctx.lineTo(ax - innerR, baseY);
    ctx.closePath();
    ctx.fill();
  });

  return off;
}

// ═══════════════════════════════════════════════════════════════
//  FryMatrix — main application controller
// ═══════════════════════════════════════════════════════════════
class FryMatrix {
  constructor() {
    this.canvas = document.getElementById('canvas');
    this.ctx    = this.canvas.getContext('2d');
    this.slider = document.getElementById('slider');
    this.hintEl = document.getElementById('hint-text');

    this.fries         = [];
    this.mouseX        = -9999;
    this.mouseY        = -9999;
    this.prevSliderVal = 1;

    this.archesCanvas = buildArchesCanvas();
    this.archesPixels = null;

    this._bindEvents();
    this._resizeAndRebuild();
    this._tick();
  }

  // ── Canvas resize ─────────────────────────────────────────────
  _resizeCanvas() {
    this.canvas.width  = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  _resizeAndRebuild() {
    this._resizeCanvas();
    this._buildGrid();
  }

  // ── Slider → column count mapping ────────────────────────────
  _colsFromSlider() {
    const v = parseInt(this.slider.value);
    if (v <= 0) return 1;
    if (v <= 1) return 2;
    if (v <= 2) return 3;
    if (v <= 3) return 4;
    const t = (v - 3) / (49 - 3);
    return Math.round(4 * Math.pow(MAX_COLS / 4, t));
  }

  // ── Logo pixel brightness at grid position ───────────────────
  _logoBrightness(col, cols, row, rows) {
    if (!this.archesPixels) {
      this.archesPixels = this.archesCanvas.getContext('2d')
        .getImageData(0, 0, this.archesCanvas.width, this.archesCanvas.height);
    }
    const lw = this.archesPixels.width;
    const lh = this.archesPixels.height;
    const px = Math.min(lw - 1, Math.floor(((col + 0.5) / cols) * lw));
    const py = Math.min(lh - 1, Math.floor(((row + 0.5) / rows) * lh));
    const i  = (py * lw + px) * 4;
    const d  = this.archesPixels.data;
    return (d[i] + d[i + 1] + d[i + 2]) / 3;
  }

  // ── Build (or rebuild) the fry grid ──────────────────────────
  _buildGrid() {
    const cols = this._colsFromSlider();
    const W    = this.canvas.width;
    const H    = this.canvas.height;

    this.fries = [];

    // Scene 1: single large centered fry
    if (cols === 1) {
      const size = Math.min(W, H) * 0.45;
      this.fries.push(new Fry(W / 2, H / 2, size, true));
      return;
    }

    // Square grid: cols × cols, circle-clipped
    const rows   = cols;
    const gridSz = W - 48;
    const cellW  = gridSz / cols;
    const frySz  = cellW * 0.88;
    const offX   = 24;
    const offY   = (H - gridSz) / 2;
    const cx     = W / 2;
    const cy     = H / 2;
    const R2     = (gridSz / 2) * (gridSz / 2);

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const tx = offX + c * cellW + cellW * 0.5;
        const ty = offY + r * cellW + cellW * 0.5;
        const dx = tx - cx;
        const dy = ty - cy;
        if (dx * dx + dy * dy > R2) continue;
        // Logo pixel mapping: bright → golden fry, dark → background fry
        const isGolden = this._logoBrightness(c, cols, r, rows) > 128;
        this.fries.push(new Fry(tx, ty, frySz, isGolden));
      }
    }
  }

  // ── Update slider fill gradient ───────────────────────────────
  _updateSliderFill() {
    const v   = parseInt(this.slider.value);
    const pct = (v / 49) * 100;
    this.slider.style.setProperty('--pct', pct.toFixed(1) + '%');
  }

  // ── Event binding ─────────────────────────────────────────────
  _bindEvents() {
    this.slider.addEventListener('input', () => {
      const v = parseInt(this.slider.value);
      this._updateSliderFill();
      if (v > 0) this.hintEl.classList.add('hidden');
      this.prevSliderVal = v;
      this._buildGrid();
    });

    this.canvas.addEventListener('mousemove', e => {
      const r     = this.canvas.getBoundingClientRect();
      this.mouseX = e.clientX - r.left;
      this.mouseY = e.clientY - r.top;
    });
    this.canvas.addEventListener('mouseleave', () => {
      this.mouseX = -9999;
      this.mouseY = -9999;
    });

    const onTouch = e => {
      e.preventDefault();
      const t = e.touches[0];
      if (t) {
        const r     = this.canvas.getBoundingClientRect();
        this.mouseX = t.clientX - r.left;
        this.mouseY = t.clientY - r.top;
      }
    };
    this.canvas.addEventListener('touchstart', onTouch, { passive: false });
    this.canvas.addEventListener('touchmove',  onTouch, { passive: false });
    this.canvas.addEventListener('touchend', () => {
      this.mouseX = -9999;
      this.mouseY = -9999;
    });

    window.addEventListener('resize', () => this._resizeAndRebuild());
  }

  // ── Physics update ────────────────────────────────────────────
  _update() {
    const mx       = this.mouseX;
    const my       = this.mouseY;
    const hasInput = mx > -1000;

    for (const f of this.fries) {
      if (!hasInput && f.isAtRest()) continue;
      if (hasInput) f.applyRepulsion(mx, my);
      f.applySpring();
      f.integrate();
    }
  }

  // ── Draw a single french fry ──────────────────────────────────
  _drawFry(f) {
    const ctx = this.ctx;
    const s   = f.size;

    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.rotate(f.angle);

    if (f.isGolden) {
      const w = s * 0.24;
      const h = s * 0.74;
      const r = Math.min(w * 0.35, h * 0.15);

      // Fry body — rounded rectangle
      ctx.fillStyle = '#FFC72C';
      ctx.beginPath();
      ctx.moveTo(-w / 2 + r, -h / 2);
      ctx.lineTo(w / 2 - r, -h / 2);
      ctx.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
      ctx.lineTo(w / 2, h / 2 - r);
      ctx.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
      ctx.lineTo(-w / 2 + r, h / 2);
      ctx.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
      ctx.lineTo(-w / 2, -h / 2 + r);
      ctx.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
      ctx.closePath();
      ctx.fill();

      // Highlight streak
      ctx.fillStyle = 'rgba(255, 240, 160, 0.35)';
      ctx.fillRect(-w * 0.12, -h / 2 + r, w * 0.12, h * 0.55);
    } else {
      // Background fry — subtle dark red
      const w = s * 0.20;
      const h = s * 0.68;
      ctx.fillStyle = 'rgba(160, 20, 20, 0.28)';
      ctx.fillRect(-w / 2, -h / 2, w, h);
    }

    ctx.restore();
  }

  // ── Draw frame ────────────────────────────────────────────────
  _draw() {
    const ctx = this.ctx;
    const W   = this.canvas.width;
    const H   = this.canvas.height;

    // Background
    ctx.fillStyle = '#1a0000';
    ctx.fillRect(0, 0, W, H);

    for (const f of this.fries) {
      this._drawFry(f);
    }

    // Fry count above the circle (grid mode only)
    if (this.fries.length > 1) {
      const R    = (W - 48) / 2;
      const topY = H / 2 - R - 12;
      ctx.save();
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'bottom';
      ctx.font         = '11px "Arial", monospace, sans-serif';
      ctx.fillStyle    = 'rgba(255, 199, 44, 0.45)';
      ctx.fillText(this.fries.length.toLocaleString(), W / 2, topY);
      ctx.restore();
    }
  }

  // ── Main loop ─────────────────────────────────────────────────
  _tick() {
    const loop = () => {
      this._update();
      this._draw();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
}

// ── Bootstrap ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  new FryMatrix();
});
