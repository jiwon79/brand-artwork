const canvas = document.getElementById('c');
const ctx    = canvas.getContext('2d');
const W = canvas.width  = window.innerWidth;
const H = canvas.height = window.innerHeight;

// ── 좌표 변환 ─────────────────────────────────────────────
// SVG viewBox: x=-65~505, y=-10~425
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
// 왼쪽: C(t=0) → A(t=1), 원본 패스 첫 두 세그먼트
const segL1 = [[177.784,313.236],[103.789,323.675],[41.638,299.053],[21.147,270.736]];
const segL2 = [[21.147,270.736],[-54.353,166.402],[107.797,18.790],[256.784,2.236]];

function outerL(t) {
  return t <= 0.5 ? cbez(segL1, t * 2) : cbez(segL2, (t - 0.5) * 2);
}

// 오른쪽: B(t=0) → D(t=1), 회전 패스 첫 두 세그먼트
const segR1 = [[248.784,91.236],[322.779,80.797],[384.930,105.419],[405.421,133.736]];
const segR2 = [[405.421,133.736],[480.921,238.070],[318.771,385.682],[169.784,402.236]];

function outerR(t) {
  return t <= 0.5 ? cbez(segR1, t * 2) : cbez(segR2, (t - 0.5) * 2);
}

// ── 그리기 함수 ───────────────────────────────────────────
// 보간 채우기 선: 끝점이 외곽을 따라 슬라이드하며 수렴
// alpha=0 → AC 직선, alpha=1 → 외곽 극단점으로 수렴
function drawFillLines(outerFn, N) {
  for (let i = 0; i <= N; i++) {
    const alpha  = i / N;
    const tStart = alpha * 0.5;       // 0 → 0.5
    const tEnd   = 1.0 - alpha * 0.5; // 1 → 0.5

    const P1  = outerFn(tStart); // 시작점
    const P2  = outerFn(tEnd);   // 끝점
    const Mid = outerFn(0.5);    // 외곽 극단점 (곡률 제어)

    const midLine = [(P1[0] + P2[0]) / 2, (P1[1] + P2[1]) / 2];
    const cp = [
      midLine[0] + alpha * (Mid[0] - midLine[0]),
      midLine[1] + alpha * (Mid[1] - midLine[1]),
    ];

    const [x1, y1]     = sc(...P1);
    const [cpx, cpy]   = sc(...cp);
    const [x2, y2]     = sc(...P2);
    const opacity      = 0.9 - alpha * 0.4;

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.quadraticCurveTo(cpx, cpy, x2, y2);
    ctx.strokeStyle = `rgba(255,255,255,${opacity.toFixed(2)})`;
    ctx.lineWidth   = 1.5;
    ctx.stroke();
  }
}

function drawOuter(outerFn) {
  const STEPS = 200;
  ctx.beginPath();
  for (let i = 0; i <= STEPS; i++) {
    const [px, py] = outerFn(i / STEPS);
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

// ── 렌더 ──────────────────────────────────────────────────
const N = 40;

ctx.fillStyle = '#000';
ctx.fillRect(0, 0, W, H);

// 1. 보간 채우기 선 (가장 아래 레이어)
drawFillLines(outerL, N);
drawFillLines(outerR, N);

// 2. 외곽선
drawOuter(outerL);
drawOuter(outerR);

// 3. 블레이드 곡선 AB, CD
// AB: A(256.784,2.236) → B(248.784,91.236)
drawBezier([256.784,2.236], [256.56,38.471], [254.264,57.873], [248.784,91.236]);
// CD: C(177.784,313.236) → D(169.784,402.236), CP 순서 반전 (180도 회전)
drawBezier([177.784,313.236], [170.008,366.001], [172.304,346.599], [169.784,402.236]);

// 4. AD 세로선 (가장 위 레이어)
drawStraightLine([256.784,2.236], [169.784,402.236]);
