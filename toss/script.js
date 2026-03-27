const canvas = document.getElementById('c');
const ctx    = canvas.getContext('2d');
const DPR = window.devicePixelRatio || 1;
const W = window.innerWidth;
const H = window.innerHeight;
canvas.width  = W * DPR;
canvas.height = H * DPR;
canvas.style.width  = W + 'px';
canvas.style.height = H + 'px';
ctx.scale(DPR, DPR);

// ── 좌표 변환 ─────────────────────────────────────────────
const VX = -65, VY = -10, VW = 570, VH = 435;
const scl = Math.min(W / VW, H / VH) * 0.92;
const OX  = (W - VW * scl) / 2 - VX * scl;
const OY  = (H - VH * scl) / 2 - VY * scl;

function sc(x, y) {
  return [x * scl + OX, y * scl + OY];
}

// ── Cubic Bezier ──────────────────────────────────────────
function cbez(p, t) {
  const u = 1 - t;
  return [
    u**3*p[0][0] + 3*u**2*t*p[1][0] + 3*u*t**2*p[2][0] + t**3*p[3][0],
    u**3*p[0][1] + 3*u**2*t*p[1][1] + 3*u*t**2*p[2][1] + t**3*p[3][1],
  ];
}

// ── 외곽 곡선 ─────────────────────────────────────────────
const segL1 = [[177.784,313.236],[103.789,323.675],[41.638,299.053],[21.147,270.736]];
const segL2 = [[21.147,270.736],[-54.353,166.402],[107.797,18.790],[256.784,2.236]];
function outerL(t) {
  return t <= 0.5 ? cbez(segL1, t * 2) : cbez(segL2, (t - 0.5) * 2);
}

const segR1 = [[248.784,91.236],[322.779,80.797],[384.930,105.419],[405.421,133.736]];
const segR2 = [[405.421,133.736],[480.921,238.070],[318.771,385.682],[169.784,402.236]];
function outerR(t) {
  return t <= 0.5 ? cbez(segR1, t * 2) : cbez(segR2, (t - 0.5) * 2);
}

// ── 경로 샘플링 ───────────────────────────────────────────
const STEPS = 100;

function sampleFn(fn) {
  const pts = [];
  for (let i = 0; i <= STEPS; i++) pts.push(fn(i / STEPS));
  return pts;
}

function sampleQuadBez(P1, cp, P2) {
  const pts = [];
  for (let i = 0; i <= STEPS; i++) {
    const t = i / STEPS, u = 1 - t;
    pts.push([
      u*u*P1[0] + 2*u*t*cp[0] + t*t*P2[0],
      u*u*P1[1] + 2*u*t*cp[1] + t*t*P2[1],
    ]);
  }
  return pts;
}

function sampleCubicBez(p0, cp1, cp2, p1) {
  const pts = [];
  for (let i = 0; i <= STEPS; i++) {
    const t = i / STEPS, u = 1 - t;
    pts.push([
      u**3*p0[0] + 3*u**2*t*cp1[0] + 3*u*t**2*cp2[0] + t**3*p1[0],
      u**3*p0[1] + 3*u**2*t*cp1[1] + 3*u*t**2*cp2[1] + t**3*p1[1],
    ]);
  }
  return pts;
}

// 경로가 위→아래 방향(y 오름차순)이 되도록 보장
function ensureDownward(pts) {
  return pts[0][1] <= pts[pts.length - 1][1] ? pts : [...pts].reverse();
}

// 경로 위의 t(0~1) 위치 선형 보간
function ptAt(pts, t) {
  const idx = t * (pts.length - 1);
  const i   = Math.min(Math.floor(idx), pts.length - 2);
  const f   = idx - i;
  return [
    pts[i][0] + f * (pts[i + 1][0] - pts[i][0]),
    pts[i][1] + f * (pts[i + 1][1] - pts[i][1]),
  ];
}

// ── 로고 경로 수집 ────────────────────────────────────────
const N = 40;
const paths = [];

for (const outerFn of [outerL, outerR]) {
  for (let i = 0; i < N; i++) {
    const alpha    = i / N;
    const tStart   = alpha * 0.5;
    const tEnd     = 1.0 - alpha * 0.5;
    const P1       = outerFn(tStart);
    const P2       = outerFn(tEnd);
    const Mid      = outerFn(0.5);
    const midLine  = [(P1[0] + P2[0]) / 2, (P1[1] + P2[1]) / 2];
    const cp       = [
      midLine[0] + alpha * (Mid[0] - midLine[0]),
      midLine[1] + alpha * (Mid[1] - midLine[1]),
    ];
    const weight = alpha < 0.1 ? alpha / 0.1 : 0.5 + 1.5 * alpha;
    paths.push({ pts: ensureDownward(sampleQuadBez(P1, cp, P2)), weight });
  }
}

paths.push({ pts: sampleCubicBez([256.784,2.236], [256.56,38.471], [254.264,57.873], [248.784,91.236]), weight: 1 });
paths.push({ pts: sampleCubicBez([177.784,313.236], [170.008,366.001], [172.304,346.599], [169.784,402.236]), weight: 1 });
paths.push({ pts: [[256.784, 2.236], [169.784, 402.236]], weight: 1 });

// ── 유틸 ──────────────────────────────────────────────────
let BASE_SPEED        = 0.12;
const DOTS_PER_SVG_UNIT = 0.15;

function pathLength(pts) {
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i][0] - pts[i - 1][0];
    const dy = pts[i][1] - pts[i - 1][1];
    len += Math.sqrt(dx * dx + dy * dy);
  }
  return len;
}

function makeDot(pathIdx) {
  return {
    pathIdx,
    phase:  Math.random(),
    speed:  BASE_SPEED * (0.5 + Math.random()),
    radius: 0.8 + Math.random() * 1.4,
    alpha:  0.5 + Math.random() * 0.5,
    jitter: (Math.random() - 0.5) * 4,
    rx: 0, ry: 0, vx: 0, vy: 0,
  };
}

// ── 로고 점 생성 ──────────────────────────────────────────
const dots = paths.flatMap(({ pts, weight }, pi) => {
  const count = Math.max(1, Math.round(pathLength(pts) * DOTS_PER_SVG_UNIT * weight));
  return Array.from({ length: count }, () => makeDot(pi));
});

const avgLogoLen = paths.reduce((s, { pts }) => s + pathLength(pts), 0) / paths.length;

function generateDots(pathSet, count) {
  const isText = pathSet !== paths;
  const lens = pathSet.map(({ pts }) => pathLength(pts));
  const totalLen = lens.reduce((a, b) => a + b, 0);
  const result = [];
  pathSet.forEach(({ pts }, pi) => {
    const n = Math.max(1, Math.round(count * lens[pi] / totalLen));
    for (let d = 0; d < n; d++) {
      const dot = makeDot(pi);
      if (isText) dot.speed = dot.speed * avgLogoLen / Math.max(lens[pi], 1);
      result.push(dot);
    }
  });
  while (result.length < count) {
    const maxPi = lens.indexOf(Math.max(...lens));
    const dot = makeDot(maxPi);
    if (isText) dot.speed = dot.speed * avgLogoLen / Math.max(lens[maxPi], 1);
    result.push(dot);
  }
  result.length = count;
  return result;
}

function computeDotPos(dot, pathSet) {
  const [cx, cy] = sc(...ptAt(pathSet[dot.pathIdx].pts, dot.phase));
  const t2 = Math.min(dot.phase + 0.01, 1);
  const [nx, ny] = sc(...ptAt(pathSet[dot.pathIdx].pts, t2));
  const dx = nx - cx, dy = ny - cy;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const px = -dy / len, py = dx / len;
  return [cx + px * dot.jitter, cy + py * dot.jitter];
}

// ── "toss" 텍스트 경로 생성 ───────────────────────────────
const TEXT_SCAN_STEP       = 4;
const TEXT_MIN_HEIGHT_PX   = 10;
const TEXT_ALPHA_THRESHOLD = 128;
const FONT_FAMILY = `system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif`;

const textPaths = [];

// cssFontSize: CSS 픽셀 단위 폰트 크기
function buildTextPaths(cssFontSize) {
  textPaths.length = 0;

  const fontSize = Math.round(cssFontSize * DPR); // 물리 픽셀로 변환
  const fontStr  = `700 ${fontSize}px ${FONT_FAMILY}`;

  // 실제 잉크 폭 측정 (actualBoundingBox > advance width로 더 정확)
  const tempCtx = document.createElement('canvas').getContext('2d');
  tempCtx.font  = fontStr;
  const m       = tempCtx.measureText('toss');
  const inkW    = (m.actualBoundingBoxLeft ?? 0) + (m.actualBoundingBoxRight ?? m.width);
  // 캔버스 중앙 기준으로 좌우 각각 inkW/2 + 50% 여유
  const halfOff = Math.ceil(Math.max(inkW * 0.75, W * DPR / 2));
  const offW    = halfOff * 2;
  const offH = H * DPR;

  const off  = document.createElement('canvas');
  off.width  = offW;
  off.height = offH;
  const offCtx = off.getContext('2d');

  // 오프스크린 캔버스 중앙에 그림
  offCtx.font         = fontStr;
  offCtx.textAlign    = 'center';
  offCtx.textBaseline = 'middle';
  offCtx.fillStyle    = '#fff';
  offCtx.fillText('toss', offW / 2, offH / 2);

  const { data } = offCtx.getImageData(0, 0, offW, offH);

  // 오프스크린 중앙(offW/2) → viewport 중앙(W/2) 보정값
  const xCSSOffset = W / 2 - offW / (2 * DPR);

  for (let x = 0; x < offW; x += TEXT_SCAN_STEP) {
    const cssX = x / DPR + xCSSOffset;
    if (cssX < 0 || cssX > W) continue; // viewport 밖은 스킵

    let segStart = -1;
    for (let y = 0; y <= offH; y++) {
      const inPixel = y < offH && data[(y * offW + x) * 4 + 3] > TEXT_ALPHA_THRESHOLD;
      if (inPixel && segStart === -1) {
        segStart = y;
      } else if (!inPixel && segStart !== -1) {
        const topY = segStart, botY = y - 1;
        segStart = -1;
        if ((botY - topY) < TEXT_MIN_HEIGHT_PX) continue;
        const svgX   = (cssX          - OX) / scl;
        const svgTop = (topY / DPR    - OY) / scl;
        const svgBot = (botY / DPR    - OY) / scl;
        textPaths.push({ pts: [[svgX, svgTop], [svgX, svgBot]], weight: 1 });
      }
    }
  }
}

// 초기 빌드 (CSS px 기준, 화면 너비의 25% 정도)
const guiParams = { fontSize: Math.round(W * 0.25), speed: BASE_SPEED };
buildTextPaths(guiParams.fontSize);

let activeDots  = dots;
let activePaths = paths;

let morphFrom   = [];
let morphTo     = [];
let pendingDots  = null;
let pendingPaths = null;

// ── 모프 상태 머신 ────────────────────────────────────────
const MORPH_DURATION = 700; // ms
const morphState = { mode: 'logo', startTime: 0 };

function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);
}

function triggerMorph() {
  if (morphState.mode.startsWith('morphing')) return;

  const toText   = morphState.mode === 'logo';
  const dstPaths = toText ? textPaths : paths;
  if (dstPaths.length === 0) return;

  // snapshot current rendered positions
  morphFrom = activeDots.map(dot => {
    const [jx, jy] = computeDotPos(dot, activePaths);
    return { x: jx + dot.rx, y: jy + dot.ry, radius: dot.radius, alpha: dot.alpha };
  });

  // fresh destination dots
  pendingDots  = generateDots(dstPaths, activeDots.length);
  pendingPaths = dstPaths;

  // fixed destination positions
  morphTo = pendingDots.map(dot => {
    const [jx, jy] = computeDotPos(dot, dstPaths);
    return { x: jx, y: jy, radius: dot.radius, alpha: dot.alpha };
  });

  morphState.mode      = toText ? 'morphing-to-text' : 'morphing-to-logo';
  morphState.startTime = performance.now();

  const btn = document.getElementById('morph-btn');
  if (btn) btn.textContent = toText ? 'logo' : 'toss';
}

// ── 터치/마우스 입력 ──────────────────────────────────────
const REPULSE_RADIUS = 110;
const MAX_DEFLECT    = 90;
const SPRING_K       = 28;
const DAMP_RATE      = 5;

const pointer = { x: 0, y: 0, active: false };

function updatePointer(e) {
  const r = canvas.getBoundingClientRect();
  pointer.x = (e.clientX ?? e.touches[0].clientX) - r.left;
  pointer.y = (e.clientY ?? e.touches[0].clientY) - r.top;
}

canvas.addEventListener('pointerdown',   e => { pointer.active = true;  updatePointer(e); });
canvas.addEventListener('pointermove',   e => { if (pointer.active) updatePointer(e); });
canvas.addEventListener('pointerup',     () => { pointer.active = false; });
canvas.addEventListener('pointercancel', () => { pointer.active = false; });

// 버튼
const btn = document.getElementById('morph-btn');
if (btn) {
  btn.addEventListener('pointerdown', e => {
    e.stopPropagation();
    triggerMorph();
  });
}

// ── 애니메이션 루프 ───────────────────────────────────────
let lastTime = null;

function animate(timestamp) {
  if (!lastTime) lastTime = timestamp;
  const dt = Math.min((timestamp - lastTime) / 1000, 0.05);
  lastTime = timestamp;

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);

  const morphing = morphState.mode.startsWith('morphing');

  let morphProg = 0;
  if (morphing) {
    const raw = (timestamp - morphState.startTime) / MORPH_DURATION;
    morphProg = easeInOut(Math.min(raw, 1));
    if (raw >= 1) {
      activeDots   = pendingDots;
      activePaths  = pendingPaths;
      pendingDots  = null;
      pendingPaths = null;
      morphState.mode = morphState.mode === 'morphing-to-text' ? 'text' : 'logo';
    }
  }

  if (morphing) {
    for (let i = 0; i < morphFrom.length; i++) {
      const fr = morphFrom[i];
      const to = morphTo[i];
      const fx = fr.x + (to.x - fr.x) * morphProg;
      const fy = fr.y + (to.y - fr.y) * morphProg;
      const r  = fr.radius + (to.radius - fr.radius) * morphProg;
      const a  = fr.alpha  + (to.alpha  - fr.alpha)  * morphProg;
      ctx.beginPath();
      ctx.arc(fx, fy, r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${a.toFixed(2)})`;
      ctx.fill();
    }
    requestAnimationFrame(animate);
    return;
  }

  // normal flow
  for (let i = 0; i < activeDots.length; i++) {
    const dot = activeDots[i];
    dot.phase = (dot.phase + dot.speed * dt) % 1;

    const [cx, cy] = sc(...ptAt(activePaths[dot.pathIdx].pts, dot.phase));
    const t2 = Math.min(dot.phase + 0.01, 1);
    const [nx2, ny2] = ptAt(activePaths[dot.pathIdx].pts, t2);
    const [sx2, sy2] = sc(nx2, ny2);
    const tdx = sx2 - cx, tdy = sy2 - cy;
    const tlen = Math.sqrt(tdx * tdx + tdy * tdy) || 1;
    const perpX = -tdy / tlen, perpY = tdx / tlen;

    const jx = cx + perpX * dot.jitter;
    const jy = cy + perpY * dot.jitter;

    let tgtRx = 0, tgtRy = 0;
    if (pointer.active) {
      const ex = cx - pointer.x, ey = cy - pointer.y;
      const dist = Math.sqrt(ex * ex + ey * ey) || 1;
      if (dist < REPULSE_RADIUS) {
        const latNorm = (ex * perpX + ey * perpY) / dist;
        const t = 1 - dist / REPULSE_RADIUS;
        const mag = latNorm * t * MAX_DEFLECT;
        tgtRx = perpX * mag;
        tgtRy = perpY * mag;
      }
    }
    dot.vx += (tgtRx - dot.rx) * SPRING_K * dt;
    dot.vy += (tgtRy - dot.ry) * SPRING_K * dt;
    const damp = Math.max(0, 1 - DAMP_RATE * dt);
    dot.vx *= damp;
    dot.vy *= damp;
    dot.rx += dot.vx * dt;
    dot.ry += dot.vy * dt;

    const fx = jx + dot.rx;
    const fy = jy + dot.ry;

    const FADE = 0.1;
    let fade = 1;
    if (dot.phase < FADE)          fade = dot.phase / FADE;
    else if (dot.phase > 1 - FADE) fade = (1 - dot.phase) / FADE;

    ctx.beginPath();
    ctx.arc(fx, fy, dot.radius, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,255,255,${(dot.alpha * fade).toFixed(2)})`;
    ctx.fill();
  }

  requestAnimationFrame(animate);
}

requestAnimationFrame(animate);

// ── Font size GUI ──────────────────────────────────────────
if (typeof lil !== 'undefined') {
  try {
    const gui = new lil.GUI({ title: 'debug' });
    gui.add(guiParams, 'fontSize', 10, Math.round(Math.min(W, H) * 0.8), 1)
      .name('font size (CSS px)')
      .onChange(v => buildTextPaths(v));
    gui.add(guiParams, 'speed', 0.02, 1.0, 0.01)
      .name('speed')
      .onChange(v => { BASE_SPEED = v; buildTextPaths(guiParams.fontSize); });
  } catch (e) {
    console.warn('GUI init failed', e);
  }
}
