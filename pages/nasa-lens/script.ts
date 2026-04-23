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
  mouse: { x: 0.5, y: 0.5 },
  mouseTarget: { x: 0.5, y: 0.5 },
  interacting: false,
  isTouch: false,
};

// Cache the canvas's on-screen rect. Touch/mouse clientX/Y are in visual-
// viewport CSS pixels, so driving the lens and canvas sizing from this rect
// (rather than window.innerWidth/Height) keeps the lens centered on the
// touch point even when mobile Safari's URL bar shifts the viewport.
let stageRect = stage.getBoundingClientRect();
function refreshStageRect(): void {
  stageRect = stage.getBoundingClientRect();
}

// ── Background canvas (offscreen) ────────────────────────
const bgCanvas = document.createElement('canvas');
const bgCtx = bgCanvas.getContext('2d')!;

function drawBackground(): void {
  const w = stageRect.width;
  const h = stageRect.height;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  bgCanvas.width = w * dpr;
  bgCanvas.height = h * dpr;
  bgCtx.setTransform(1, 0, 0, 1, 0, 0);
  bgCtx.scale(dpr, dpr);

  bgCtx.fillStyle = '#000';
  bgCtx.fillRect(0, 0, w, h);

  drawWordsAndStars(w, h);

  bgTexture.needsUpdate = true;
}

// Fills every row with a repeating SPACESPACESPACE... flow. Each row uses a
// different horizontal phase shift so consecutive rows look like different
// slices of the same continuous stream. A tiny yellow star sits between
// every pair of adjacent letters.
function drawWordsAndStars(w: number, h: number): void {
  // Calibrate fontSize so ~6 letters span the viewport width
  // (user asked for 5–7 visible chars).
  const REF_SIZE = 100;
  const TARGET_CHARS = 6;
  bgCtx.font = '900 ' + REF_SIZE + 'px "Arial Black", "Helvetica Neue", sans-serif';
  const refCharAvg = bgCtx.measureText('SPACES').width / 6;
  const fontSize = (w / TARGET_CHARS) * (REF_SIZE / refCharAvg);

  const rowSpacing = fontSize * 1.0;
  const rows = Math.ceil(h / rowSpacing) + 2;
  const totalH = rowSpacing * rows;
  const startY = (h - totalH) / 2 + rowSpacing / 2;

  bgCtx.font = '900 ' + fontSize + 'px "Arial Black", "Helvetica Neue", sans-serif';
  bgCtx.textAlign = 'left';
  bgCtx.textBaseline = 'middle';

  // Long enough that even the largest phase shift still fills the viewport.
  const BASE = 'SPACE'.repeat(15);

  // Cumulative x after each character. Using measureText on prefixes keeps
  // star positions aligned with the kerning applied by strokeText below.
  const cumX: number[] = [0];
  for (let j = 1; j <= BASE.length; j++) {
    cumX.push(bgCtx.measureText(BASE.substring(0, j)).width);
  }

  const starSize = fontSize * 0.06;
  // Phase shift per row, in fontSize units — gives the flowing look.
  const shifts = [0, 0.35, 1.1, 1.7, 0.6, 2.2, 0.2, 1.4];

  const textOutline = 'rgba(255, 200, 40, 0.55)';
  const textCore = 'rgba(255, 230, 90, 0.95)';

  for (let i = 0; i < rows; i++) {
    const y = startY + i * rowSpacing;
    const offX = -shifts[i % shifts.length] * fontSize;

    bgCtx.strokeStyle = textOutline;
    bgCtx.lineWidth = Math.max(2, fontSize * 0.035);
    bgCtx.strokeText(BASE, offX, y);
    bgCtx.strokeStyle = textCore;
    bgCtx.lineWidth = Math.max(1, fontSize * 0.012);
    bgCtx.strokeText(BASE, offX, y);

    for (let j = 1; j < BASE.length; j++) {
      const starX = offX + cumX[j];
      if (starX < 0 || starX > w) continue;
      drawStar(starX, y, starSize);
    }
  }
}

function drawStar(cx: number, cy: number, r: number): void {
  const inner = r * 0.4;
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

gui.add(state, 'radius', 0.1, 0.8, 0.005).name('Radius');
gui.add(state, 'strength', 0, 3.0, 0.01).name('Strength');
gui.add(state, 'thickness', 0.5, 4.0, 0.01).name('Thickness');

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
    drawBackground();
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
function tick(): void {
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

drawBackground();
tick();
