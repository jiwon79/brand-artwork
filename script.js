'use strict';

// ═══════════════════════════════════════════════════════════════
//  The Bean Matrix — script.js
//  Scenes: 1-Single Bean  2-Grid Fill  3-Logo Pixel Art  4-Physics
// ═══════════════════════════════════════════════════════════════

// ── Physics constants ──────────────────────────────────────────
const REPULSION_RADIUS  = 80;   // px — cursor influence radius
const REPULSION_FORCE   = 5;    // repulsion strength
const SPRING_K          = 0.031; // Hooke spring constant
const DAMPING           = 0.75;  // velocity damping while being repelled
const RETURN_DAMPING    = 0.92;  // lighter damping on return → spring oscillation

// ── Grid constants ─────────────────────────────────────────────
const MAX_COLS          = 48;   // columns at slider = 100

// ═══════════════════════════════════════════════════════════════
//  Bean (particle)
// ═══════════════════════════════════════════════════════════════
class Bean {
  constructor(tx, ty, size, isFront) {
    this.targetX = tx;
    this.targetY = ty;
    this.x  = tx;
    this.y  = ty;
    this.vx = 0;
    this.vy = 0;
    this.size      = size;
    this.isFront   = isFront;
    this._repelled = false;
  }

  // Repulsion force from cursor (Coulomb-like fall-off)
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

  // Hooke's Law: pull back to grid position
  applySpring() {
    this.vx += (this.targetX - this.x) * SPRING_K;
    this.vy += (this.targetY - this.y) * SPRING_K;
  }

  // Symplectic Euler integration + damping
  // Use heavy damping while repelled, lighter damping on return (→ spring oscillation)
  integrate() {
    const damp = this._repelled ? DAMPING : RETURN_DAMPING;
    this._repelled = false;
    this.vx *= damp;
    this.vy *= damp;
    this.x  += this.vx;
    this.y  += this.vy;
  }

  // Skip update when effectively at rest (performance)
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
//  Audio Engine  (Web Audio API — no external files)
// ═══════════════════════════════════════════════════════════════
class AudioEngine {
  constructor() {
    this.actx = null;
  }

  _init() {
    if (!this.actx) {
      this.actx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (this.actx.state === 'suspended') this.actx.resume();
  }

  // Layered grinding / ASMR sound
  playGrind(intensity = 1.0) {
    try {
      this._init();
      const sr  = this.actx.sampleRate;
      const dur = 1.4 * intensity;
      const buf = this.actx.createBuffer(2, Math.floor(sr * dur), sr);

      for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        for (let i = 0; i < d.length; i++) {
          const t   = i / sr;
          // Envelope: fast attack, slow decay
          const env = (1 - Math.exp(-t * 40)) * Math.exp(-t * 2.5 / intensity);
          // Brown-noise base
          const noise = (Math.random() * 2 - 1) * 0.55;
          // Periodic grinding texture
          const g1 = Math.sin(t * 280 + Math.random() * 0.8) * 0.2;
          const g2 = Math.sin(t * 960 + Math.random() * 0.3) * 0.08;
          // Low-end thud
          const thud = Math.sin(t * 60) * Math.exp(-t * 8) * 0.3;
          d[i] = (noise + g1 + g2 + thud) * env * 0.42 * intensity;
        }
      }

      const src  = this.actx.createBufferSource();
      src.buffer = buf;

      // Tone shaping
      const lp = this.actx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1400;
      lp.Q.value = 0.7;

      const hp = this.actx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 120;

      const gain = this.actx.createGain();
      gain.gain.value = 0.75;

      src.connect(hp);
      hp.connect(lp);
      lp.connect(gain);
      gain.connect(this.actx.destination);
      src.start();
    } catch (_) {
      // Silently fail — audio is non-essential
    }
  }

  // Short crisp snap when logo reveals
  playSnap() {
    try {
      this._init();
      const sr  = this.actx.sampleRate;
      const buf = this.actx.createBuffer(1, Math.floor(sr * 0.18), sr);
      const d   = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        d[i] = (Math.random() * 2 - 1) * Math.exp(-t * 60) * 0.9;
      }
      const src  = this.actx.createBufferSource();
      src.buffer = buf;
      const gain = this.actx.createGain();
      gain.gain.value = 0.5;
      src.connect(gain);
      gain.connect(this.actx.destination);
      src.start();
    } catch (_) {}
  }
}

// ═══════════════════════════════════════════════════════════════
//  Starbucks Siren logo — drawn programmatically on offscreen canvas
//  Returns a 300×300 HTMLCanvasElement (black/white for pixel mapping)
// ═══════════════════════════════════════════════════════════════
function buildSirenCanvas() {
  const SZ  = 300;
  const off = document.createElement('canvas');
  off.width  = SZ;
  off.height = SZ;
  const ctx = off.getContext('2d');
  const cx  = SZ / 2;
  const cy  = SZ / 2;
  const R   = SZ * 0.46;

  // ── Background ───────────────────────────────────────────────
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, SZ, SZ);

  // ── Outer white ring ─────────────────────────────────────────
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();

  // ── Black band inside ring ───────────────────────────────────
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.875, 0, Math.PI * 2);
  ctx.fillStyle = '#000';
  ctx.fill();

  // ── White inner circle ───────────────────────────────────────
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.8, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();

  // ── Crown — 3 triangular spikes ──────────────────────────────
  ctx.fillStyle = '#fff';
  const crownBaseY = cy - R * 0.38;

  // Left spike
  _tri(ctx,
    cx - R * 0.42, crownBaseY + R * 0.04,
    cx - R * 0.27, cy - R * 0.63,
    cx - R * 0.10, crownBaseY + R * 0.04
  );
  // Center spike (tallest)
  _tri(ctx,
    cx - R * 0.11, crownBaseY,
    cx,             cy - R * 0.78,
    cx + R * 0.11, crownBaseY
  );
  // Right spike
  _tri(ctx,
    cx + R * 0.10, crownBaseY + R * 0.04,
    cx + R * 0.27, cy - R * 0.63,
    cx + R * 0.42, crownBaseY + R * 0.04
  );

  // ── Hair / shoulders (dark trapezoid behind face) ─────────────
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.moveTo(cx - R * 0.34, cy - R * 0.30);
  ctx.lineTo(cx - R * 0.50, cy + R * 0.12);
  ctx.lineTo(cx + R * 0.50, cy + R * 0.12);
  ctx.lineTo(cx + R * 0.34, cy - R * 0.30);
  ctx.closePath();
  ctx.fill();

  // ── Face oval (white, on top of hair) ────────────────────────
  ctx.beginPath();
  ctx.ellipse(cx, cy - R * 0.12, R * 0.215, R * 0.255, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();

  // ── Eyes (black dots) ────────────────────────────────────────
  ctx.fillStyle = '#000';
  _dot(ctx, cx - R * 0.085, cy - R * 0.14, R * 0.028);
  _dot(ctx, cx + R * 0.085, cy - R * 0.14, R * 0.028);

  // ── Body (dark ellipse) ───────────────────────────────────────
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(cx, cy + R * 0.29, R * 0.29, R * 0.39, 0, 0, Math.PI * 2);
  ctx.fill();

  // ── Left tail ─────────────────────────────────────────────────
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.moveTo(cx - R * 0.28, cy + R * 0.10);
  ctx.bezierCurveTo(
    cx - R * 0.72, cy + R * 0.22,
    cx - R * 0.75, cy + R * 0.66,
    cx - R * 0.44, cy + R * 0.79
  );
  ctx.bezierCurveTo(
    cx - R * 0.18, cy + R * 0.89,
    cx - R * 0.04, cy + R * 0.73,
    cx - R * 0.04, cy + R * 0.52
  );
  ctx.bezierCurveTo(
    cx - R * 0.04, cy + R * 0.30,
    cx - R * 0.14, cy + R * 0.20,
    cx - R * 0.28, cy + R * 0.10
  );
  ctx.closePath();
  ctx.fill();

  // ── Right tail ────────────────────────────────────────────────
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.moveTo(cx + R * 0.28, cy + R * 0.10);
  ctx.bezierCurveTo(
    cx + R * 0.72, cy + R * 0.22,
    cx + R * 0.75, cy + R * 0.66,
    cx + R * 0.44, cy + R * 0.79
  );
  ctx.bezierCurveTo(
    cx + R * 0.18, cy + R * 0.89,
    cx + R * 0.04, cy + R * 0.73,
    cx + R * 0.04, cy + R * 0.52
  );
  ctx.bezierCurveTo(
    cx + R * 0.04, cy + R * 0.30,
    cx + R * 0.14, cy + R * 0.20,
    cx + R * 0.28, cy + R * 0.10
  );
  ctx.closePath();
  ctx.fill();

  // ── Stars on the outer text ring (4 stars) ────────────────────
  const starAngles = [-Math.PI * 0.12, Math.PI * 0.12, Math.PI * 0.88, -Math.PI * 0.88];
  starAngles.forEach(a => {
    _star(ctx,
      cx + R * 0.935 * Math.cos(a),
      cy + R * 0.935 * Math.sin(a),
      R * 0.042
    );
  });

  return off;
}

// Helpers for logo drawing
function _tri(ctx, x1, y1, x2, y2, x3, y3) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.lineTo(x3, y3);
  ctx.closePath();
  ctx.fill();
}

function _dot(ctx, cx, cy, r) {
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
}

function _star(ctx, cx, cy, outerR) {
  const innerR = outerR * 0.42;
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const angle = (i * Math.PI * 2) / 10 - Math.PI / 2;
    const r = i % 2 === 0 ? outerR : innerR;
    const x = cx + r * Math.cos(angle);
    const y = cy + r * Math.sin(angle);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

// ═══════════════════════════════════════════════════════════════
//  BeanMatrix — main application controller
// ═══════════════════════════════════════════════════════════════
class BeanMatrix {
  constructor() {
    this.canvas      = document.getElementById('canvas');
    this.ctx         = this.canvas.getContext('2d');
    this.slider      = document.getElementById('slider');
    this.hintEl      = document.getElementById('hint-text');
    this.sceneLabelEl = null;

    this.beans       = [];
    this.mouseX      = -9999;
    this.mouseY      = -9999;

    this.imagesReady  = false;
    this.useFallback  = false;
    this.prevSliderVal = 1;

    this.audio        = new AudioEngine();
    this.sirenCanvas  = buildSirenCanvas();
    this.sirenPixels  = null;   // ImageData, loaded lazily

    this.beanFront    = new Image();
    this.beanBack     = new Image();

    this._bindEvents();
    this._loadImages();
    this._tick();
  }

  // ── Image loading ────────────────────────────────────────────
  _loadImages() {
    let loaded = 0;
    const done = () => {
      loaded++;
      if (loaded >= 2) {
        this.imagesReady = true;
        this._resizeAndRebuild();
      }
    };

    this.beanFront.onload  = done;
    this.beanFront.onerror = () => { this.useFallback = true; done(); };
    this.beanBack.onload   = done;
    this.beanBack.onerror  = () => { this.useFallback = true; done(); };

    // Relative paths — place images in assets/ folder
    this.beanFront.src = 'assets/Front.png';
    this.beanBack.src  = 'assets/Back.png';

    // Load user's Starbucks logo image; fallback to programmatic siren
    const logoImg = new Image();
    logoImg.onload = () => {
      const SZ  = this.sirenCanvas.width;
      const ctx = this.sirenCanvas.getContext('2d');
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, SZ, SZ);
      // Draw maintaining aspect ratio, centered (letterbox)
      const aspect = logoImg.naturalWidth / logoImg.naturalHeight;
      const dw = aspect >= 1 ? SZ : SZ * aspect;
      const dh = aspect >= 1 ? SZ / aspect : SZ;
      ctx.drawImage(logoImg, (SZ - dw) / 2, (SZ - dh) / 2, dw, dh);
      // Convert to high-contrast black/white for pixel mapping
      const imgData = ctx.getImageData(0, 0, SZ, SZ);
      const d = imgData.data;
      for (let i = 0; i < d.length; i += 4) {
        const brightness = (d[i] + d[i + 1] + d[i + 2]) / 3;
        const v = brightness > 128 ? 255 : 0;
        d[i] = d[i + 1] = d[i + 2] = v;
        d[i + 3] = 255;
      }
      ctx.putImageData(imgData, 0, 0);
      this.sirenPixels = null; // invalidate cache
      this._buildGrid();
    };
    logoImg.src = 'assets/starbucks_logo.png';
  }

  // ── Canvas resize ────────────────────────────────────────────
  _resizeCanvas() {
    this.canvas.width  = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  _resizeAndRebuild() {
    this._resizeCanvas();
    this._buildGrid();
  }

  // ── Slider → column count mapping ────────────────────────────
  // Slider: 0..2000, step 50 (41 positions)
  // 0→1, 50→2, 100→3, 150→4, then true exponential 4→MAX_COLS
  _colsFromSlider() {
    const v = parseInt(this.slider.value);
    if (v <= 0)   return 1;
    if (v <= 50)  return 2;
    if (v <= 100) return 3;
    if (v <= 150) return 4;
    // Exponential: cols = 4 * (MAX_COLS/4)^t, t in [0,1]
    const t = (v - 150) / (2000 - 150);
    return Math.round(4 * Math.pow(MAX_COLS / 4, t));
  }

  // ── Logo pixel brightness at grid position ───────────────────
  _logoBrightness(col, cols, row, rows) {
    if (!this.sirenPixels) {
      this.sirenPixels = this.sirenCanvas.getContext('2d')
        .getImageData(0, 0, this.sirenCanvas.width, this.sirenCanvas.height);
    }
    const lw = this.sirenPixels.width;
    const lh = this.sirenPixels.height;
    const px = Math.min(lw - 1, Math.floor(((col + 0.5) / cols) * lw));
    const py = Math.min(lh - 1, Math.floor(((row + 0.5) / rows) * lh));
    const i  = (py * lw + px) * 4;
    const d  = this.sirenPixels.data;
    return (d[i] + d[i + 1] + d[i + 2]) / 3;
  }

  // ── Step-down mipmap scaler for crisp small beans ────────────
  _makeScaledBean(img, targetSize) {
    const sz = Math.max(1, Math.round(targetSize));
    let src = img;
    let w = img.naturalWidth  || img.width;
    let h = img.naturalHeight || img.height;
    // Halve repeatedly until within 2× of target
    while (w > sz * 2 || h > sz * 2) {
      w = Math.ceil(w / 2);
      h = Math.ceil(h / 2);
      const tmp = document.createElement('canvas');
      tmp.width  = w;
      tmp.height = h;
      const c = tmp.getContext('2d');
      c.imageSmoothingEnabled = true;
      c.imageSmoothingQuality = 'high';
      c.drawImage(src, 0, 0, w, h);
      src = tmp;
    }
    // Final pass to exact target size
    const out = document.createElement('canvas');
    out.width  = sz;
    out.height = sz;
    const c = out.getContext('2d');
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = 'high';
    c.drawImage(src, 0, 0, sz, sz);
    return out;
  }

  // ── Build (or rebuild) the bean grid ─────────────────────────
  _buildGrid() {
    const cols  = this._colsFromSlider();
    const W     = this.canvas.width;
    const H     = this.canvas.height;

    this.beans = [];

    // Scene 1: single large centered bean
    if (cols === 1) {
      const size = Math.min(W, H) * 0.62;
      this.beans.push(new Bean(W / 2, H / 2, size, true));
      return;
    }

    // Square grid: cols × cols, centered on screen (24px horizontal padding)
    const rows   = cols;
    const gridSz = Math.min(W - 48, H);
    const cellW  = gridSz / cols;
    const beanSz = cellW * 0.90;
    const offX   = (W - gridSz) / 2;
    const offY   = (H - gridSz) / 2;

    // Pre-scale bean images for crisp rendering at this cell size
    // For small grids (≤6 cols), use the original image directly for max quality
    if (!this.useFallback) {
      if (cols <= 6) {
        this._cachedFront = this.beanFront;
        this._cachedBack  = this.beanBack;
      } else {
        this._cachedFront = this._makeScaledBean(this.beanFront, beanSz);
        this._cachedBack  = this._makeScaledBean(this.beanBack,  beanSz);
      }
    }

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const tx = offX + c * cellW + cellW * 0.5;
        const ty = offY + r * cellW + cellW * 0.5;
        // Logo pixel mapping: bright → front face, dark → back face
        const isFront = this._logoBrightness(c, cols, r, rows) > 128;
        this.beans.push(new Bean(tx, ty, beanSz, isFront));
      }
    }
  }

  // ── Update slider fill gradient ───────────────────────────────
  _updateSliderFill() {
    const v   = parseInt(this.slider.value);
    const pct = (v / 2000) * 100;
    this.slider.style.setProperty('--pct', pct.toFixed(1) + '%');
  }

  // ── Event binding ─────────────────────────────────────────────
  _bindEvents() {
    // Slider
    this.slider.addEventListener('input', () => {
      const v = parseInt(this.slider.value);
      this._updateSliderFill();

      // Scene transition sound
      if (this.prevSliderVal <= 0 && v > 0) {
        this.audio.playGrind(1.0);
      }

      // Hide hint after first interaction
      if (v > 0) this.hintEl.classList.add('hidden');

      this.prevSliderVal = v;
      this._buildGrid();
    });

    // Mouse
    this.canvas.addEventListener('mousemove', e => {
      const r    = this.canvas.getBoundingClientRect();
      this.mouseX = e.clientX - r.left;
      this.mouseY = e.clientY - r.top;
    });
    this.canvas.addEventListener('mouseleave', () => {
      this.mouseX = -9999;
      this.mouseY = -9999;
    });

    // Touch
    const onTouch = e => {
      e.preventDefault();
      const t = e.touches[0];
      if (t) {
        const r    = this.canvas.getBoundingClientRect();
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

    // Unlock audio on first user gesture
    document.addEventListener('touchstart', () => this.audio._init(), { once: true });
    document.addEventListener('mousedown',  () => this.audio._init(), { once: true });

    // Resize
    window.addEventListener('resize', () => this._resizeAndRebuild());
  }

  // ── Physics update ────────────────────────────────────────────
  _update() {
    const mx = this.mouseX;
    const my = this.mouseY;
    const hasInput = mx > -1000;

    for (const b of this.beans) {
      // Skip beans that are perfectly still and no input is near
      if (!hasInput && b.isAtRest()) continue;

      if (hasInput) b.applyRepulsion(mx, my);
      b.applySpring();
      b.integrate();
    }
  }

  // ── Fallback bean (canvas-drawn coffee bean shape) ────────────
  _drawFallback(b) {
    const ctx = this.ctx;
    const r   = b.size * 0.5;

    ctx.save();
    ctx.translate(b.x, b.y);

    // Bean body
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.62, r * 0.82, 0, 0, Math.PI * 2);
    ctx.fillStyle = b.isFront ? '#5a3410' : '#231308';
    ctx.fill();

    // Specular highlight
    if (b.isFront) {
      ctx.beginPath();
      ctx.ellipse(-r * 0.15, -r * 0.3, r * 0.18, r * 0.1, -0.4, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,200,140,0.18)';
      ctx.fill();
    }

    // Center crease
    ctx.strokeStyle = b.isFront ? '#3a1e06' : '#0e0502';
    ctx.lineWidth   = Math.max(0.5, r * 0.07);
    ctx.lineCap     = 'round';
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.58);
    if (b.isFront) {
      ctx.bezierCurveTo( r * 0.22, -r * 0.2,  r * 0.22, r * 0.2,  0,  r * 0.58);
    } else {
      ctx.bezierCurveTo(-r * 0.22, -r * 0.2, -r * 0.22, r * 0.2,  0,  r * 0.58);
    }
    ctx.stroke();

    ctx.restore();
  }

  // ── Draw frame ────────────────────────────────────────────────
  _draw() {
    const ctx = this.ctx;
    const W   = this.canvas.width;
    const H   = this.canvas.height;

    // Background
    ctx.fillStyle = '#0d0700';
    ctx.fillRect(0, 0, W, H);

    if (!this.imagesReady) {
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.font      = '16px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Loading…', W / 2, H / 2);
      return;
    }

    for (const b of this.beans) {
      if (this.useFallback) {
        this._drawFallback(b);
      } else {
        const img  = b.isFront
          ? (this._cachedFront || this.beanFront)
          : (this._cachedBack  || this.beanBack);
        const half = b.size * 0.5;
        ctx.drawImage(img, b.x - half, b.y - half, b.size, b.size);
      }
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
  new BeanMatrix();
});
