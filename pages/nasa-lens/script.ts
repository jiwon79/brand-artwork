import * as THREE from 'three';
import GUI from 'lil-gui';

type BackgroundMode = 'text' | 'shape';
type ShapePattern = 'grid' | 'circles';

const errorEl = document.getElementById('error') as HTMLDivElement;
const stage = document.getElementById('stage') as HTMLCanvasElement;
const cursor = document.getElementById('cursor') as HTMLDivElement;

window.addEventListener('error', (e) => {
  errorEl.textContent = 'Error: ' + (e.message || 'unknown');
  errorEl.classList.add('show');
});

const state = {
  bg: 'text' as BackgroundMode,
  text: 'HOT',
  shape: 'grid' as ShapePattern,
  radius: 0.22,
  strength: 0.6,
  thickness: 1.0,
  mouse: { x: 0.5, y: 0.5 },
  mouseTarget: { x: 0.5, y: 0.5 },
  interacting: false,
  isTouch: false,
};

// ── Background canvas (offscreen) ────────────────────────
const bgCanvas = document.createElement('canvas');
const bgCtx = bgCanvas.getContext('2d')!;

function drawBackground(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  bgCanvas.width = w * dpr;
  bgCanvas.height = h * dpr;
  bgCtx.setTransform(1, 0, 0, 1, 0, 0);
  bgCtx.scale(dpr, dpr);

  bgCtx.fillStyle = '#000';
  bgCtx.fillRect(0, 0, w, h);

  if (state.bg === 'text') drawText(w, h);
  else drawShape(w, h);

  bgTexture.needsUpdate = true;
}

function drawText(w: number, h: number): void {
  const txt = (state.text || 'HOT').toUpperCase().slice(0, 8);
  const aspect = h / w;
  const cols = aspect > 1.5 ? 2 : 3;
  const fontSize = (w / cols) * 0.95;
  const rowSpacing = fontSize * 0.88;
  const rows = Math.ceil(h / rowSpacing) + 2;

  bgCtx.font = '900 ' + fontSize + 'px "Arial Black", "Helvetica Neue", sans-serif';
  bgCtx.textAlign = 'center';
  bgCtx.textBaseline = 'middle';

  const totalH = rowSpacing * rows;
  const startY = (h - totalH) / 2 + rowSpacing / 2;
  const offsets = [0, w * 0.14, -w * 0.1, w * 0.18, -w * 0.06, w * 0.1, -w * 0.14];

  for (let i = 0; i < rows; i++) {
    const y = startY + i * rowSpacing;
    const x = w / 2 + offsets[i % offsets.length];

    bgCtx.strokeStyle = 'rgba(255, 20, 20, 0.55)';
    bgCtx.lineWidth = Math.max(2, fontSize * 0.035);
    bgCtx.strokeText(txt, x, y);

    bgCtx.strokeStyle = 'rgba(255, 45, 45, 0.95)';
    bgCtx.lineWidth = Math.max(1, fontSize * 0.012);
    bgCtx.strokeText(txt, x, y);
  }
}

function drawShape(w: number, h: number): void {
  if (state.shape === 'grid') {
    const cols = w < 500 ? 4 : 6;
    const cellW = w / cols;
    const rows = Math.ceil(h / cellW);
    const cellH = h / rows;
    const pad = Math.min(cellW, cellH) * 0.15;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = c * cellW + pad;
        const y = r * cellH + pad;
        const ww = cellW - pad * 2;
        const hh = cellH - pad * 2;

        bgCtx.strokeStyle = 'rgba(255, 20, 20, 0.5)';
        bgCtx.lineWidth = 3;
        bgCtx.strokeRect(x, y, ww, hh);
        bgCtx.strokeStyle = 'rgba(255, 55, 55, 0.95)';
        bgCtx.lineWidth = 1;
        bgCtx.strokeRect(x + 5, y + 5, ww - 10, hh - 10);
      }
    }
  } else {
    const cols = w < 500 ? 3 : 5;
    const cellW = w / cols;
    const rows = Math.ceil(h / cellW);
    const cellH = h / rows;
    const radius = Math.min(cellW, cellH) * 0.4;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cx = c * cellW + cellW / 2;
        const cy = r * cellH + cellH / 2;

        bgCtx.strokeStyle = 'rgba(255, 20, 20, 0.5)';
        bgCtx.lineWidth = 3;
        bgCtx.beginPath();
        bgCtx.arc(cx, cy, radius, 0, Math.PI * 2);
        bgCtx.stroke();

        bgCtx.strokeStyle = 'rgba(255, 55, 55, 0.95)';
        bgCtx.lineWidth = 1;
        bgCtx.beginPath();
        bgCtx.arc(cx, cy, radius - 7, 0, Math.PI * 2);
        bgCtx.stroke();
      }
    }
  }
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
renderer.setSize(window.innerWidth, window.innerHeight, false);

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
  uResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
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
    vec2 aspect = vec2(uResolution.x / uResolution.y, 1.0);
    vec2 p = vUv * aspect;
    vec2 m = uMouse * aspect;
    vec2 delta = p - m;
    float dist = length(delta);
    float R = uRadius * aspect.y;

    float t = dist / R;

    float lensMask = 1.0 - smoothstep(0.0, 1.0, t);
    lensMask *= uActive;

    float tc = min(t, 1.0);
    float z = sqrt(max(0.0, 1.0 - tc * tc));

    float extra = uStrength * pow(z, 0.6) * lensMask * 1.8;
    float mag = 1.0 + extra;

    vec2 sampleP = m + delta / mag;
    vec2 sampleUv = sampleP / aspect;
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

    col.r += coreStrength * 0.3 * col.r;

    float rimT = abs(t - 1.0);
    float rimWidth = 0.06;
    float rim = exp(-rimT * rimT / (rimWidth * rimWidth)) * uActive;
    col.rgb += vec3(0.35, 0.05, 0.05) * rim * 0.5;

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

const bgCtrl = gui
  .add(state, 'bg', { Text: 'text', Shape: 'shape' })
  .name('Background');

const textCtrl = gui
  .add(state, 'text')
  .name('Content')
  .onChange(drawBackground);

const shapeCtrl = gui
  .add(state, 'shape', { Grid: 'grid', Circles: 'circles' })
  .name('Pattern')
  .onChange(drawBackground);

gui.add(state, 'radius', 0.05, 0.6, 0.005).name('Radius');
gui.add(state, 'strength', 0, 1.5, 0.01).name('Strength');
gui.add(state, 'thickness', 0.5, 3.0, 0.01).name('Thickness');

function syncRows(): void {
  textCtrl.show(state.bg === 'text');
  shapeCtrl.show(state.bg === 'shape');
}
syncRows();
bgCtrl.onChange(() => { syncRows(); drawBackground(); });

if (window.innerWidth <= 700) gui.close();

// ── Input ────────────────────────────────────────────────
function setPointer(x: number, y: number): void {
  state.mouseTarget.x = x / window.innerWidth;
  state.mouseTarget.y = 1.0 - y / window.innerHeight;
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
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    uniforms.uResolution.value.set(window.innerWidth, window.innerHeight);
    drawBackground();
  }, 100);
}
window.addEventListener('resize', handleResize);
window.addEventListener('orientationchange', handleResize);

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
