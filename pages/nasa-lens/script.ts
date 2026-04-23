import * as THREE from 'three';
import GUI from 'lil-gui';

const errorEl = document.getElementById('error') as HTMLDivElement;
const stage = document.getElementById('stage') as HTMLCanvasElement;
const cursor = document.getElementById('cursor') as HTMLDivElement;

window.addEventListener('error', (e) => {
  errorEl.textContent = 'Error: ' + (e.message || 'unknown');
  errorEl.classList.add('show');
});

const state = {
  radius: 0.4,
  strength: 1.5,
  thickness: 2.0,
  starSize: 0.035,      // star radius as a fraction of fontSize (halved from 0.07)
  starThickness: 0.4,   // inner/outer radius ratio — lower = thinner/spikier
  starSpeed: 15,        // pixels per second of random drift
  mouse: { x: 0.5, y: 0.5 },
  mouseTarget: { x: 0.5, y: 0.5 },
  interacting: false,
  isTouch: false,
};

type Star = { x: number; y: number; vx: number; vy: number };
let stars: Star[] = [];
let fieldWidth = 0;
let fieldHeight = 0;
let fontSizeCache = 0;

// Cache the canvas's on-screen rect. Touch/mouse clientX/Y are in visual-
// viewport CSS pixels, so driving the lens and canvas sizing from this rect
// (rather than window.innerWidth/Height) keeps the lens centered on the
// touch point even when mobile Safari's URL bar shifts the viewport.
let stageRect = stage.getBoundingClientRect();
function refreshStageRect(): void {
  stageRect = stage.getBoundingClientRect();
}

// ── Background canvases (offscreen) ──────────────────────
// bgCanvas is the final texture that the shader samples. textCanvas holds
// the static SPACE text rendered once per resize; each frame we copy it
// into bgCanvas and draw the animated stars on top.
const bgCanvas = document.createElement('canvas');
const bgCtx = bgCanvas.getContext('2d')!;
const textCanvas = document.createElement('canvas');
const textCtx = textCanvas.getContext('2d')!;

function bakeBackground(): void {
  const w = stageRect.width;
  const h = stageRect.height;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  bgCanvas.width = w * dpr;
  bgCanvas.height = h * dpr;
  textCanvas.width = w * dpr;
  textCanvas.height = h * dpr;
  textCtx.setTransform(1, 0, 0, 1, 0, 0);
  textCtx.scale(dpr, dpr);
  textCtx.clearRect(0, 0, w, h);

  // Calibrate fontSize so ~6 letters span the viewport width
  // (user asked for 5–7 visible chars).
  const REF_SIZE = 100;
  const TARGET_CHARS = 6;
  textCtx.font = '900 ' + REF_SIZE + 'px "Arial Black", "Helvetica Neue", sans-serif';
  const refCharAvg = textCtx.measureText('SPACES').width / 6;
  const fontSize = (w / TARGET_CHARS) * (REF_SIZE / refCharAvg);

  const rowSpacing = fontSize * 1.35;
  const rows = Math.ceil(h / rowSpacing) + 2;
  const totalH = rowSpacing * rows;
  const startY = (h - totalH) / 2 + rowSpacing / 2;

  textCtx.font = '900 ' + fontSize + 'px "Arial Black", "Helvetica Neue", sans-serif';
  textCtx.textAlign = 'left';
  textCtx.textBaseline = 'middle';

  const BASE = 'SPACE '.repeat(12);
  const shifts = [0, 0.4, 1.2, 1.9, 0.7, 2.4, 0.2, 1.5];

  for (let i = 0; i < rows; i++) {
    const y = startY + i * rowSpacing;
    const offX = -shifts[i % shifts.length] * fontSize;

    textCtx.strokeStyle = 'rgba(255, 200, 40, 0.55)';
    textCtx.lineWidth = Math.max(2, fontSize * 0.035);
    textCtx.strokeText(BASE, offX, y);
    textCtx.strokeStyle = 'rgba(255, 230, 90, 0.95)';
    textCtx.lineWidth = Math.max(1, fontSize * 0.012);
    textCtx.strokeText(BASE, offX, y);
  }

  // Rebuild the star field — 1 or 2 stars per row gap with a random
  // drift direction. Positions and directions are seeded by row index so
  // the starting layout is stable on resize.
  stars = [];
  for (let i = 0; i < rows - 1; i++) {
    const gapY = startY + (i + 0.5) * rowSpacing;
    const count = hashRand(i, 0) > 0.45 ? 2 : 1;
    for (let k = 0; k < count; k++) {
      const sx = hashRand(i, k * 2 + 1) * w;
      const sy = gapY + (hashRand(i, k * 2 + 2) - 0.5) * fontSize * 0.25;
      const ang = hashRand(i, k * 11 + 7) * Math.PI * 2;
      stars.push({ x: sx, y: sy, vx: Math.cos(ang), vy: Math.sin(ang) });
    }
  }

  fieldWidth = w;
  fieldHeight = h;
  fontSizeCache = fontSize;

  composeBackground();
}

// Per-frame compositor: copy the pre-rendered text layer onto bgCanvas and
// draw the current star positions on top. Runs inside tick().
function composeBackground(): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  bgCtx.setTransform(1, 0, 0, 1, 0, 0);
  bgCtx.fillStyle = '#000';
  bgCtx.fillRect(0, 0, bgCanvas.width, bgCanvas.height);
  bgCtx.drawImage(textCanvas, 0, 0);
  bgCtx.scale(dpr, dpr);

  const r = fontSizeCache * state.starSize;
  for (const s of stars) {
    drawStar(s.x, s.y, r, state.starThickness);
  }

  bgTexture.needsUpdate = true;
}

function updateStars(dt: number): void {
  const speed = state.starSpeed;
  if (speed <= 0 || stars.length === 0) return;
  // Wrap around the viewport so stars never disappear.
  const margin = fontSizeCache * 0.5;
  const wSpan = fieldWidth + margin * 2;
  const hSpan = fieldHeight + margin * 2;
  for (const s of stars) {
    s.x += s.vx * speed * dt;
    s.y += s.vy * speed * dt;
    if (s.x < -margin) s.x += wSpan;
    else if (s.x > fieldWidth + margin) s.x -= wSpan;
    if (s.y < -margin) s.y += hSpan;
    else if (s.y > fieldHeight + margin) s.y -= hSpan;
  }
}

// Deterministic pseudo-random in [0, 1) from two integer seeds.
function hashRand(a: number, b: number): number {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function drawStar(cx: number, cy: number, r: number, innerRatio: number): void {
  const inner = r * innerRatio;
  bgCtx.save();
  bgCtx.fillStyle = 'rgba(255, 214, 64, 1)';
  bgCtx.strokeStyle = 'rgba(255, 236, 140, 0.9)';
  bgCtx.lineWidth = Math.max(1, r * 0.08);
  bgCtx.lineJoin = 'round';
  bgCtx.beginPath();
  for (let i = 0; i < 10; i++) {
    const ang = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? r : inner;
    const px = cx + Math.cos(ang) * rr;
    const py = cy + Math.sin(ang) * rr;
    if (i === 0) bgCtx.moveTo(px, py);
    else bgCtx.lineTo(px, py);
  }
  bgCtx.closePath();
  bgCtx.fill();
  bgCtx.stroke();
  bgCtx.restore();
}

// ── Three.js setup ───────────────────────────────────────
let renderer: THREE.WebGLRenderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas: stage, antialias: true, alpha: false });
} catch (e) {
  errorEl.textContent = 'WebGL unavailable: ' + (e as Error).message;
  errorEl.classList.add('show');
  throw e;
}

renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(stageRect.width, stageRect.height, false);

const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

const bgTexture = new THREE.CanvasTexture(bgCanvas);
bgTexture.minFilter = THREE.LinearFilter;
bgTexture.magFilter = THREE.LinearFilter;
bgTexture.wrapS = THREE.ClampToEdgeWrapping;
bgTexture.wrapT = THREE.ClampToEdgeWrapping;

const uniforms = {
  uTex: { value: bgTexture },
  uMouse: { value: new THREE.Vector2(0.5, 0.5) },
  uRadius: { value: state.radius },
  uStrength: { value: state.strength },
  uThickness: { value: state.thickness },
  uActive: { value: 0.0 },
  uResolution: { value: new THREE.Vector2(stageRect.width, stageRect.height) },
};

const vertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`;

// Spherical magnifying lens. Magnification shaped so it smoothly reaches 1.0
// at the rim — sampleP == p there, so the lens result is continuous with bg.
const fragmentShader = `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uTex;
  uniform vec2 uMouse;
  uniform vec2 uResolution;
  uniform float uRadius;
  uniform float uStrength;
  uniform float uThickness;
  uniform float uActive;

  void main() {
    // Compute lens geometry in pixel space so the lens is perfectly circular
    // regardless of viewport aspect ratio.
    vec2 pxPos = vUv * uResolution;
    vec2 pxMouse = uMouse * uResolution;
    vec2 pxDelta = pxPos - pxMouse;
    float pxDist = length(pxDelta);
    float pxR = uRadius * min(uResolution.x, uResolution.y);

    float t = pxDist / pxR;

    float lensMask = 1.0 - smoothstep(0.0, 1.0, t);
    lensMask *= uActive;

    float tc = min(t, 1.0);
    float z = sqrt(max(0.0, 1.0 - tc * tc));

    float extra = uStrength * pow(z, 0.6) * lensMask * 1.8;
    float mag = 1.0 + extra;

    vec2 samplePx = pxMouse + pxDelta / mag;
    vec2 sampleUv = samplePx / uResolution;
    sampleUv = clamp(sampleUv, vec2(0.0), vec2(1.0));

    vec4 col = texture2D(uTex, sampleUv);

    float coreStrength = pow(z, 1.5) * lensMask;
    float dilate = coreStrength * (uThickness - 0.5);
    if (dilate > 0.01) {
      vec2 px = dilate * 4.0 / uResolution;
      vec4 maxC = col;
      maxC = max(maxC, texture2D(uTex, sampleUv + vec2( 1.0,  0.0) * px));
      maxC = max(maxC, texture2D(uTex, sampleUv + vec2(-1.0,  0.0) * px));
      maxC = max(maxC, texture2D(uTex, sampleUv + vec2( 0.0,  1.0) * px));
      maxC = max(maxC, texture2D(uTex, sampleUv + vec2( 0.0, -1.0) * px));
      maxC = max(maxC, texture2D(uTex, sampleUv + vec2( 0.707,  0.707) * px));
      maxC = max(maxC, texture2D(uTex, sampleUv + vec2(-0.707,  0.707) * px));
      maxC = max(maxC, texture2D(uTex, sampleUv + vec2( 0.707, -0.707) * px));
      maxC = max(maxC, texture2D(uTex, sampleUv + vec2(-0.707, -0.707) * px));
      col = mix(col, maxC, clamp(dilate, 0.0, 1.0));
    }

    float innerShade = smoothstep(0.75, 1.0, tc) * lensMask;
    col.rgb *= mix(1.0, 0.88, innerShade);

    col.rgb = clamp(col.rgb, 0.0, 1.0);
    gl_FragColor = col;
  }
`;

const mat = new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader });
const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
scene.add(quad);

// ── lil-gui controls ─────────────────────────────────────
const gui = new GUI({ title: 'Controls' });

const lensFolder = gui.addFolder('Lens');
lensFolder.add(state, 'radius', 0.1, 0.8, 0.005).name('Radius');
lensFolder.add(state, 'strength', 0, 3.0, 0.01).name('Strength');
lensFolder.add(state, 'thickness', 0.5, 4.0, 0.01).name('Thickness');

const starFolder = gui.addFolder('Stars');
starFolder.add(state, 'starSize', 0.005, 0.12, 0.001).name('Size');
starFolder.add(state, 'starThickness', 0.15, 0.7, 0.01).name('Thickness');
starFolder.add(state, 'starSpeed', 0, 80, 1).name('Speed');

if (window.innerWidth <= 700) gui.close();

// ── Input ────────────────────────────────────────────────
function setPointer(x: number, y: number): void {
  const localX = x - stageRect.left;
  const localY = y - stageRect.top;
  state.mouseTarget.x = localX / stageRect.width;
  state.mouseTarget.y = 1.0 - localY / stageRect.height;
  cursor.style.transform =
    'translate(' + x + 'px, ' + y + 'px) translate(-50%, -50%)';
}

window.addEventListener('mousemove', (e) => {
  if (state.isTouch) return;
  state.interacting = true;
  setPointer(e.clientX, e.clientY);
});

stage.addEventListener('touchstart', (e) => {
  state.isTouch = true;
  state.interacting = true;
  const t = e.touches[0];
  if (t) {
    setPointer(t.clientX, t.clientY);
    // Snap on first touch so the lens appears where the finger lands
    state.mouse.x = state.mouseTarget.x;
    state.mouse.y = state.mouseTarget.y;
  }
}, { passive: true });

stage.addEventListener('touchmove', (e) => {
  const t = e.touches[0];
  if (t) setPointer(t.clientX, t.clientY);
}, { passive: true });

stage.addEventListener('touchend', () => { state.interacting = false; });
stage.addEventListener('touchcancel', () => { state.interacting = false; });

// ── Resize ───────────────────────────────────────────────
let resizeTimer: number | undefined;
function handleResize(): void {
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => {
    refreshStageRect();
    renderer.setSize(stageRect.width, stageRect.height, false);
    uniforms.uResolution.value.set(stageRect.width, stageRect.height);
    bakeBackground();
  }, 100);
}
window.addEventListener('resize', handleResize);
window.addEventListener('orientationchange', handleResize);
window.addEventListener('scroll', refreshStageRect, { passive: true });
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', handleResize);
  window.visualViewport.addEventListener('scroll', refreshStageRect);
}

// On non-touch, lens is visible in the middle at start
if (!('ontouchstart' in window)) state.interacting = true;

// ── Loop ─────────────────────────────────────────────────
let lastFrameTime = performance.now();
function tick(): void {
  const now = performance.now();
  const dt = Math.min(0.05, (now - lastFrameTime) / 1000);
  lastFrameTime = now;

  updateStars(dt);
  composeBackground();

  state.mouse.x += (state.mouseTarget.x - state.mouse.x) * 0.18;
  state.mouse.y += (state.mouseTarget.y - state.mouse.y) * 0.18;

  const activeTarget = state.interacting ? 1.0 : 0.0;
  uniforms.uActive.value += (activeTarget - uniforms.uActive.value) * 0.15;

  uniforms.uMouse.value.x = state.mouse.x;
  uniforms.uMouse.value.y = state.mouse.y;
  uniforms.uRadius.value = state.radius;
  uniforms.uStrength.value = state.strength;
  uniforms.uThickness.value = state.thickness;

  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}

bakeBackground();
tick();
