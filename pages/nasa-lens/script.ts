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
  engageDuration: 0.2,  // seconds for the lens to fade in after first touch
  burstDuration: 0.55,  // seconds the release burst animation runs
  burstSize: 2.8,       // max radius multiplier at the end of the burst
  burstIntensity: 1.4,  // fade-out exponent; higher = lens drops off faster
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
// bgCanvas holds only the static SPACE text (baked once per resize) and
// is sampled with the lens's "thickness" dilation. starsCanvas is a
// separate texture holding only the stars (redrawn each frame) so the
// dilation — tuned for thick text strokes — doesn't fragment the tiny
// star shapes into separate arms.
const bgCanvas = document.createElement('canvas');
const bgCtx = bgCanvas.getContext('2d')!;
const starsCanvas = document.createElement('canvas');
const starsCtx = starsCanvas.getContext('2d')!;

function bakeBackground(): void {
  const w = stageRect.width;
  const h = stageRect.height;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  bgCanvas.width = w * dpr;
  bgCanvas.height = h * dpr;
  starsCanvas.width = w * dpr;
  starsCanvas.height = h * dpr;
  bgCtx.setTransform(1, 0, 0, 1, 0, 0);
  bgCtx.scale(dpr, dpr);
  bgCtx.fillStyle = '#000';
  bgCtx.fillRect(0, 0, w, h);

  // Calibrate fontSize so ~6 letters span the viewport width
  // (user asked for 5–7 visible chars).
  const REF_SIZE = 100;
  const TARGET_CHARS = 6;
  bgCtx.font = '900 ' + REF_SIZE + 'px "Arial Black", "Helvetica Neue", sans-serif';
  const refCharAvg = bgCtx.measureText('SPACES').width / 6;
  const fontSize = (w / TARGET_CHARS) * (REF_SIZE / refCharAvg);

  const rowSpacing = fontSize * 1.35;
  const rows = Math.ceil(h / rowSpacing) + 2;
  const totalH = rowSpacing * rows;
  const startY = (h - totalH) / 2 + rowSpacing / 2;

  bgCtx.font = '900 ' + fontSize + 'px "Arial Black", "Helvetica Neue", sans-serif';
  bgCtx.textAlign = 'left';
  bgCtx.textBaseline = 'middle';

  const BASE = 'SPACE '.repeat(12);
  const shifts = [0, 0.4, 1.2, 1.9, 0.7, 2.4, 0.2, 1.5];

  for (let i = 0; i < rows; i++) {
    const y = startY + i * rowSpacing;
    const offX = -shifts[i % shifts.length] * fontSize;

    bgCtx.strokeStyle = 'rgba(255, 200, 40, 0.55)';
    bgCtx.lineWidth = Math.max(2, fontSize * 0.035);
    bgCtx.strokeText(BASE, offX, y);
    bgCtx.strokeStyle = 'rgba(255, 230, 90, 0.95)';
    bgCtx.lineWidth = Math.max(1, fontSize * 0.012);
    bgCtx.strokeText(BASE, offX, y);
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

  bgTexture.needsUpdate = true;
  renderStars();
}

// Per-frame: redraw the current star positions onto starsCanvas (transparent
// background) and flag the separate stars texture for upload.
function renderStars(): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  starsCtx.setTransform(1, 0, 0, 1, 0, 0);
  starsCtx.clearRect(0, 0, starsCanvas.width, starsCanvas.height);
  starsCtx.scale(dpr, dpr);

  const r = fontSizeCache * state.starSize;
  for (const s of stars) {
    drawStar(starsCtx, s.x, s.y, r, state.starThickness);
  }

  starsTexture.needsUpdate = true;
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

function drawStar(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, innerRatio: number): void {
  const inner = r * innerRatio;
  ctx.save();
  ctx.fillStyle = 'rgba(255, 214, 64, 1)';
  ctx.strokeStyle = 'rgba(255, 236, 140, 0.9)';
  ctx.lineWidth = Math.max(1, r * 0.08);
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const ang = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? r : inner;
    const px = cx + Math.cos(ang) * rr;
    const py = cy + Math.sin(ang) * rr;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
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

const starsTexture = new THREE.CanvasTexture(starsCanvas);
starsTexture.minFilter = THREE.LinearFilter;
starsTexture.magFilter = THREE.LinearFilter;
starsTexture.wrapS = THREE.ClampToEdgeWrapping;
starsTexture.wrapT = THREE.ClampToEdgeWrapping;

const uniforms = {
  uTex: { value: bgTexture },
  uStars: { value: starsTexture },
  uMouse: { value: new THREE.Vector2(0.5, 0.5) },
  uRadius: { value: state.radius },
  uStrength: { value: state.strength },
  uThickness: { value: state.thickness },
  uActive: { value: 0.0 },
  // Effective-radius multiplier, driven by JS. Usually 1.0; briefly grows
  // during the release animation to make the lens "burst outward" when the
  // user lets go of the drag.
  uExpand: { value: 1.0 },
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
  uniform sampler2D uStars;
  uniform vec2 uMouse;
  uniform vec2 uResolution;
  uniform float uRadius;
  uniform float uStrength;
  uniform float uThickness;
  uniform float uActive;
  uniform float uExpand;

  void main() {
    // Compute lens geometry in pixel space so the lens is perfectly circular
    // regardless of viewport aspect ratio.
    vec2 pxPos = vUv * uResolution;
    vec2 pxMouse = uMouse * uResolution;
    vec2 pxDelta = pxPos - pxMouse;
    float pxDist = length(pxDelta);
    float pxR = uRadius * uExpand * min(uResolution.x, uResolution.y);

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

    // Stars live on their own texture and are composited on top of the
    // dilated text so the thickness pass doesn't shatter their small shapes.
    vec4 starsCol = texture2D(uStars, sampleUv);
    col.rgb = mix(col.rgb, starsCol.rgb, starsCol.a);

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

const burstFolder = gui.addFolder('Burst');
burstFolder.add(state, 'engageDuration', 0.05, 1.5, 0.01).name('Engage');
burstFolder.add(state, 'burstDuration', 0.1, 2.0, 0.01).name('Duration');
burstFolder.add(state, 'burstSize', 1.2, 5.0, 0.05).name('Size');
burstFolder.add(state, 'burstIntensity', 0.3, 4.0, 0.05).name('Intensity');

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

// Desktop: the lens only engages while the user is dragging (mouse button
// held). Hover just moves the cursor indicator — no lens.
window.addEventListener('mousemove', (e) => {
  if (state.isTouch) return;
  setPointer(e.clientX, e.clientY);
});

stage.addEventListener('mousedown', (e) => {
  if (state.isTouch) return;
  state.interacting = true;
  setPointer(e.clientX, e.clientY);
  // Snap lens to cursor so it appears right at the press point
  state.mouse.x = state.mouseTarget.x;
  state.mouse.y = state.mouseTarget.y;
});

window.addEventListener('mouseup', () => {
  if (state.isTouch) return;
  state.interacting = false;
});

window.addEventListener('blur', () => {
  state.interacting = false;
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

// ── Loop ─────────────────────────────────────────────────
let lastFrameTime = performance.now();
// Lens transition state. engageT progresses 0→1 while the user drags; on
// release it freezes to whatever value it had reached and feeds the release
// burst so a quick tap still bursts from partial strength. releaseT drives
// the burst from that point out to burstSize / 0.
let engageT = 0;
let releasing = false;
let releaseT = 0;
let releaseFromActive = 0;
let releaseFromExpand = 1;

function tick(): void {
  const now = performance.now();
  const dt = Math.min(0.05, (now - lastFrameTime) / 1000);
  lastFrameTime = now;

  updateStars(dt);
  renderStars();

  state.mouse.x += (state.mouseTarget.x - state.mouse.x) * 0.18;
  state.mouse.y += (state.mouseTarget.y - state.mouse.y) * 0.18;

  if (state.interacting) {
    // Picking up mid-burst cancels the release and keeps engage continuous.
    releasing = false;
    releaseT = 0;
    const dur = Math.max(0.02, state.engageDuration);
    engageT = Math.min(1, engageT + dt / dur);
    // Ease-out so the fade-in lands softly at full strength.
    uniforms.uActive.value = 1 - Math.pow(1 - engageT, 2);
    uniforms.uExpand.value = 1;
  } else {
    if (!releasing && uniforms.uActive.value > 0.02) {
      // Just released — snapshot current values so the burst is continuous
      // even if the lens never reached full strength.
      releasing = true;
      releaseT = 0;
      releaseFromActive = uniforms.uActive.value;
      releaseFromExpand = uniforms.uExpand.value;
    }
    engageT = 0;
    if (releasing) {
      releaseT += dt;
      const duration = Math.max(0.05, state.burstDuration);
      const p = Math.min(1, releaseT / duration);
      const easeOut = 1 - Math.pow(1 - p, 2);
      uniforms.uExpand.value = releaseFromExpand + (state.burstSize - releaseFromExpand) * easeOut;
      uniforms.uActive.value = releaseFromActive * Math.pow(1 - p, state.burstIntensity);
      if (p >= 1) {
        releasing = false;
        releaseT = 0;
        uniforms.uActive.value = 0;
        uniforms.uExpand.value = 1;
      }
    } else {
      uniforms.uActive.value = 0;
      uniforms.uExpand.value = 1;
    }
  }

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
