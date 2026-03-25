const canvas = document.getElementById('c');
const ctx    = canvas.getContext('2d');
const W = canvas.width  = window.innerWidth;
const H = canvas.height = window.innerHeight;

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

// ── 모든 경로 수집 ────────────────────────────────────────
const N = 40;
const paths = [];

// 보간 채우기 선 (왼쪽, 오른쪽)
// weight: 외곽(alpha=0) → 0.1, 중간(alpha=1) → 1.0 (중심일수록 점 밀도 증가)
for (const outerFn of [outerL, outerR]) {
  for (let i = 0; i < N; i++) { // i=N은 길이 0인 퇴화 경로이므로 제외
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
    const weight = 0.1 + 0.9 * alpha; // 외곽 10% ~ 중심 100% 밀도
    paths.push({ pts: ensureDownward(sampleQuadBez(P1, cp, P2)), weight });
  }
}

// 블레이드 곡선 AB, CD
paths.push({ pts: sampleCubicBez([256.784,2.236], [256.56,38.471], [254.264,57.873], [248.784,91.236]), weight: 1 });
paths.push({ pts: sampleCubicBez([177.784,313.236], [170.008,366.001], [172.304,346.599], [169.784,402.236]), weight: 1 });

// AD 세로선
paths.push({ pts: [[256.784, 2.236], [169.784, 402.236]], weight: 1 });

// ── 정적 그리기 함수 ──────────────────────────────────────
function drawFillLines(outerFn) {
  for (let i = 0; i <= N; i++) {
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
    const [x1, y1]   = sc(...P1);
    const [cpx, cpy] = sc(...cp);
    const [x2, y2]   = sc(...P2);
    const opacity    = 0.9 - alpha * 0.4;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.quadraticCurveTo(cpx, cpy, x2, y2);
    ctx.strokeStyle = `rgba(255,255,255,${opacity.toFixed(2)})`;
    ctx.lineWidth   = 1.5;
    ctx.stroke();
  }
}

function drawOuter(outerFn) {
  ctx.beginPath();
  for (let i = 0; i <= 200; i++) {
    const [px, py] = outerFn(i / 200);
    const [sx, sy] = sc(px, py);
    i === 0 ? ctx.moveTo(sx, sy) : ctx.lineTo(sx, sy);
  }
  ctx.strokeStyle = 'rgba(255,255,255,1)';
  ctx.lineWidth   = 1.5;
  ctx.stroke();
}

function drawBezier(p0, cp1, cp2, p1, lw = 1.5) {
  const [x0, y0]   = sc(...p0);
  const [cx1, cy1] = sc(...cp1);
  const [cx2, cy2] = sc(...cp2);
  const [x1, y1]   = sc(...p1);
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.bezierCurveTo(cx1, cy1, cx2, cy2, x1, y1);
  ctx.strokeStyle = 'rgba(255,255,255,1)';
  ctx.lineWidth   = lw;
  ctx.stroke();
}

function drawStraightLine(p1, p2, lw = 1.5) {
  const [x1, y1] = sc(...p1);
  const [x2, y2] = sc(...p2);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.strokeStyle = 'rgba(255,255,255,1)';
  ctx.lineWidth   = lw;
  ctx.stroke();
}

function drawAll() {
  // 1. 보간 채우기 선 (가장 아래 레이어)
  drawFillLines(outerL);
  drawFillLines(outerR);
  // 2. 외곽선
  drawOuter(outerL);
  drawOuter(outerR);
  // 3. 블레이드 곡선 AB, CD
  drawBezier([256.784,2.236], [256.56,38.471], [254.264,57.873], [248.784,91.236]);
  drawBezier([177.784,313.236], [170.008,366.001], [172.304,346.599], [169.784,402.236]);
  // 4. AD 세로선 (가장 위 레이어)
  drawStraightLine([256.784,2.236], [169.784,402.236]);
}

// ── 점 애니메이션 ─────────────────────────────────────────
const BASE_SPEED       = 0.2;  // 기본 속도 (경로 단위/초)
const DOTS_PER_SVG_UNIT = 0.15; // SVG 길이 단위당 점 수

// 샘플링된 경로의 SVG 좌표 기준 호 길이 계산
function pathLength(pts) {
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i][0] - pts[i - 1][0];
    const dy = pts[i][1] - pts[i - 1][1];
    len += Math.sqrt(dx * dx + dy * dy);
  }
  return len;
}

const dots = paths.flatMap(({ pts, weight }, pi) => {
  const count = Math.max(1, Math.round(pathLength(pts) * DOTS_PER_SVG_UNIT * weight));
  return Array.from({ length: count }, () => ({
    pathIdx: pi,
    phase:   Math.random(),
    speed:   BASE_SPEED * (0.5 + Math.random()),
    radius:  0.8 + Math.random() * 1.4,
    alpha:   0.5 + Math.random() * 0.5,
    jitter:  (Math.random() - 0.5) * 4,
  }));
});

let lastTime = null;

function animate(timestamp) {
  if (!lastTime) lastTime = timestamp;
  const dt = Math.min((timestamp - lastTime) / 1000, 0.05);
  lastTime = timestamp;

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);

  for (const dot of dots) {
    dot.phase = (dot.phase + dot.speed * dt) % 1;
    const [svgX, svgY] = ptAt(paths[dot.pathIdx].pts, dot.phase);
    const [cx, cy]     = sc(svgX, svgY);

    // 경로 접선에 수직 방향으로 jitter 적용
    const t2  = Math.min(dot.phase + 0.01, 1);
    const [nx, ny] = ptAt(paths[dot.pathIdx].pts, t2);
    const [sx2, sy2] = sc(nx, ny);
    const dx = sy2 - cy, dy = -(sx2 - cx); // 수직 벡터
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const jx  = cx + (dx / len) * dot.jitter;
    const jy  = cy + (dy / len) * dot.jitter;

    // 시작/끝 구간에서 페이드 인/아웃 (각 10%)
    const FADE = 0.1;
    let fade = 1;
    if (dot.phase < FADE)        fade = dot.phase / FADE;
    else if (dot.phase > 1 - FADE) fade = (1 - dot.phase) / FADE;

    ctx.beginPath();
    ctx.arc(jx, jy, dot.radius, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,255,255,${(dot.alpha * fade).toFixed(2)})`;
    ctx.fill();
  }

  requestAnimationFrame(animate);
}

requestAnimationFrame(animate);
