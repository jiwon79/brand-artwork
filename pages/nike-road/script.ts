import GUI from 'lil-gui';

// ── Constants ────────────────────────────────────────────
const W = 405;
const H = 720;
const GRAVITY = 280; // px/s²
const FPS = 60;
const TOTAL_FRAMES = 480; // 8s of pre-computed simulation
const SUB_STEPS = 4;
const TOP_OFFSET_RATIO = 0.4; // how far above word baseline-center the platform sits

// ── DOM ──────────────────────────────────────────────────
const canvas = document.getElementById('scene') as HTMLCanvasElement;
const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
const playBtn = document.getElementById('btn-play') as HTMLButtonElement;
const resetBtn = document.getElementById('btn-reset') as HTMLButtonElement;
const skyVideo = document.getElementById('sky') as HTMLVideoElement;

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
  { text: 'failures', cx: 127, cy: 237, angle:  13, font: 'italic 28px Georgia, serif', width: 0, p1: { x: 0, y: 0 }, p2: { x: 0, y: 0 }, normal: { x: 0, y: 0 } },
  { text: 'become',   cx: 281, cy: 325, angle: -21, font: 'italic 28px Georgia, serif', width: 0, p1: { x: 0, y: 0 }, p2: { x: 0, y: 0 }, normal: { x: 0, y: 0 } },
  { text: 'the',      cx: 176, cy: 413, angle:  20, font: 'italic 30px Georgia, serif', width: 0, p1: { x: 0, y: 0 }, p2: { x: 0, y: 0 }, normal: { x: 0, y: 0 } },
  { text: 'road',     cx: 251, cy: 511, angle: -20, font: 'italic 32px Georgia, serif', width: 0, p1: { x: 0, y: 0 }, p2: { x: 0, y: 0 }, normal: { x: 0, y: 0 } },
];

function fontPx(fontStr: string): number {
  const m = fontStr.match(/(\d+(?:\.\d+)?)px/);
  return m ? parseFloat(m[1]) : 24;
}

function measureWords(): void {
  for (const w of words) {
    ctx.font = w.font;
    const m = ctx.measureText(w.text);
    w.width = m.width;
    const a = (w.angle * Math.PI) / 180;
    const half = w.width / 2;
    const cosA = Math.cos(a);
    const sinA = Math.sin(a);
    // Surface normal pointing UP from the word's top edge
    w.normal = { x: sinA, y: -cosA };
    // Lift platform line from baseline-center to top of glyph so the ball rolls
    // ABOVE the word (keeping the text visible).
    const topOff = fontPx(w.font) * TOP_OFFSET_RATIO;
    const ox = w.normal.x * topOff;
    const oy = w.normal.y * topOff;
    w.p1 = { x: w.cx - cosA * half + ox, y: w.cy - sinA * half + oy };
    w.p2 = { x: w.cx + cosA * half + ox, y: w.cy + sinA * half + oy };
  }
}

// ── Ball physics ─────────────────────────────────────────
const ball = {
  x: 120,
  y: -20,
  vx: 0,
  vy: 0,
  r: 7,
  onPlatform: -1,
  t: 0,
};

const masterTrail: { x: number; y: number }[] = [];

function resetPhysics(): void {
  ball.x = 120;
  ball.y = -20;
  ball.vx = 0;
  ball.vy = 0;
  ball.onPlatform = -1;
  ball.t = 0;
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
      if (nDot >= -ball.r * 0.8 && r.dist < bestDist) {
        bestDist = r.dist;
        bestI = i;
        bestRes = r;
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

  const last = masterTrail[masterTrail.length - 1];
  if (!last || Math.abs(last.x - ball.x) > 0.5 || Math.abs(last.y - ball.y) > 0.5) {
    masterTrail.push({ x: ball.x, y: ball.y });
  }
}

// ── Pre-computed frames ──────────────────────────────────
type Frame = { x: number; y: number; trailLen: number };
let frames: Frame[] = [];

function precompute(): void {
  measureWords();
  resetPhysics();
  masterTrail.length = 0;
  masterTrail.push({ x: ball.x, y: ball.y });
  frames = [{ x: ball.x, y: ball.y, trailLen: masterTrail.length }];

  const dt = 1 / FPS;
  for (let i = 1; i < TOTAL_FRAMES; i++) {
    for (let s = 0; s < SUB_STEPS; s++) physicsStep(dt / SUB_STEPS);
    frames.push({ x: ball.x, y: ball.y, trailLen: masterTrail.length });
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

const ROAD_WIDTH = 22;
const EDGE_INSET = 2;        // white edge band thickness on each side
const CENTER_LINE_WIDTH = 1.8;
const CENTER_LINE_COLOR = '#f0c419';
const EDGE_COLOR = '#f4f1ea';

function traceTrail(c: CanvasRenderingContext2D, trailLen: number): void {
  c.beginPath();
  c.moveTo(masterTrail[0].x, masterTrail[0].y);
  for (let i = 1; i < trailLen; i++) {
    c.lineTo(masterTrail[i].x, masterTrail[i].y);
  }
  c.stroke();
}

function buildRoad(trailLen: number): void {
  rCtx.clearRect(0, 0, W, H);
  if (trailLen < 2) return;

  rCtx.lineCap = 'round';
  rCtx.lineJoin = 'round';

  // 1) White edge band (full road width)
  rCtx.strokeStyle = EDGE_COLOR;
  rCtx.lineWidth = ROAD_WIDTH;
  traceTrail(rCtx, trailLen);

  // 2) Asphalt-textured inner band, carved inside the edges via scratch mask
  mCtx.clearRect(0, 0, W, H);
  mCtx.lineCap = 'round';
  mCtx.lineJoin = 'round';
  mCtx.strokeStyle = '#000';
  mCtx.lineWidth = ROAD_WIDTH - EDGE_INSET * 2;
  traceTrail(mCtx, trailLen);
  mCtx.globalCompositeOperation = 'source-in';
  mCtx.drawImage(asphalt, 0, 0);
  mCtx.globalCompositeOperation = 'source-over';
  rCtx.drawImage(mask, 0, 0);

  // 3) Yellow dashed center line
  rCtx.save();
  rCtx.strokeStyle = CENTER_LINE_COLOR;
  rCtx.lineWidth = CENTER_LINE_WIDTH;
  rCtx.lineCap = 'butt';
  rCtx.setLineDash([6, 8]);
  traceTrail(rCtx, trailLen);
  rCtx.restore();
}

// ── Rendering ────────────────────────────────────────────
function drawWord(w: Word): void {
  ctx.save();
  ctx.translate(w.cx, w.cy);
  ctx.rotate((w.angle * Math.PI) / 180);
  ctx.font = w.font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#0a0a0a';
  ctx.fillText(w.text, 0, 0);
  ctx.restore();
}

function drawBall(x: number, y: number): void {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.25)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 2;
  ctx.fillStyle = '#0a0a0a';
  ctx.beginPath();
  ctx.arc(x, y, ball.r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function renderFrame(idx: number): void {
  const i = Math.max(0, Math.min(frames.length - 1, Math.round(idx)));
  const f = frames[i];

  buildRoad(f.trailLen);

  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(roadCanvas, 0, 0);
  for (const w of words) drawWord(w);
  drawBall(f.x, f.y);
}

// ── Playback ─────────────────────────────────────────────
const state = { frame: 0 };
let raf: number | null = null;
let playing = false;

function play(): void {
  if (playing) return;
  if (state.frame >= frames.length - 1) state.frame = 0;
  playing = true;
  let lastTs: number | null = null;
  const tick = (ts: number) => {
    if (!playing) return;
    if (lastTs === null) lastTs = ts;
    const dt = (ts - lastTs) / 1000;
    lastTs = ts;
    state.frame = Math.min(frames.length - 1, state.frame + dt * FPS);
    frameCtrl.updateDisplay();
    renderFrame(state.frame);
    if (state.frame >= frames.length - 1) {
      playing = false;
      return;
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}

function reset(): void {
  if (raf !== null) cancelAnimationFrame(raf);
  playing = false;
  state.frame = 0;
  frameCtrl.updateDisplay();
  renderFrame(0);
  seekVideo(video.startTime);
}

function stopPlayback(): void {
  if (raf !== null) cancelAnimationFrame(raf);
  playing = false;
}

playBtn.addEventListener('click', play);
resetBtn.addEventListener('click', reset);

// ── Video ────────────────────────────────────────────────
const video = {
  playbackRate: 1.0,
  startTime: 0,
};

function applyVideo(): void {
  skyVideo.playbackRate = video.playbackRate;
}

function seekVideo(t: number): void {
  if (!Number.isFinite(skyVideo.duration) || skyVideo.duration === 0) return;
  skyVideo.currentTime = Math.max(0, Math.min(skyVideo.duration - 0.001, t));
}

skyVideo.addEventListener('loadedmetadata', () => {
  videoStartCtrl.max(skyVideo.duration);
  seekVideo(video.startTime);
  applyVideo();
});

// ── GUI ──────────────────────────────────────────────────
const gui = new GUI({ title: 'Controls' });

precompute();

const frameCtrl = gui.add(state, 'frame', 0, TOTAL_FRAMES - 1, 1).name('frame').onChange((v: number) => {
  stopPlayback();
  renderFrame(v);
});

const videoFolder = gui.addFolder('Video');
videoFolder.add(video, 'playbackRate', 0.1, 4, 0.05).onChange(applyVideo);
const videoStartCtrl = videoFolder
  .add(video, 'startTime', 0, 60, 0.05)
  .name('startTime')
  .onChange((v: number) => seekVideo(v));

renderFrame(0);
