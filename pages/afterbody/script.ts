import GUI from 'lil-gui';

type FigureMode = 'Lines' | 'Solid';
type Phase = 'idle' | 'dissolving' | 'blank';

type FigurePoint = {
  x: number;
  y: number;
  seed: number;
  seed2: number;
};

type View = {
  width: number;
  height: number;
  fit: number;
  offsetX: number;
  offsetY: number;
};

type DebugApi = {
  dissolve: () => void;
  reset: () => void;
  setMode: (mode: FigureMode) => void;
  getPhase: () => Phase;
};

const DESIGN_WIDTH = 480;
const DESIGN_HEIGHT = 270;
const SOURCE_X_LIMIT = 66;

const canvas = document.getElementById('artwork') as HTMLCanvasElement;
const hint = document.getElementById('hint') as HTMLParagraphElement;
const error = document.getElementById('error') as HTMLDivElement;
const ctx = canvas.getContext('2d', { alpha: false });

if (!ctx) {
  throw new Error('2D canvas is not supported.');
}

const artworkCanvas = document.createElement('canvas');
const artworkCtx = artworkCanvas.getContext('2d');

if (!artworkCtx) {
  throw new Error('Offscreen 2D canvas is not supported.');
}

const settings = {
  figure: 'Lines' as FigureMode,
  echoes: 6,
  rgbOffset: 3.2,
  lineThickness: 0.88,
  idleMotion: 1,
  hold: 0.72,
  sweepDuration: 3.25,
  sweepJitter: 0.34,
  drift: 27,
  spread: 9.5,
  turbulence: 2.6,
  particleLife: 3.35,
  particleSize: 1.15,
  glow: 0.26,
  scanlines: 0.08,
};

const channelColors = ['#ff2924', '#59ff50', '#2795ff'] as const;
const channelX = [-1, 0, 1] as const;
const channelY = [0.55, 0, -0.55] as const;
const echoCenters = [94, 171, 240, 301, 356, 405];
const echoScales = [1.94, 1.78, 1.64, 1.51, 1.39, 1.28];

let view: View = {
  width: DESIGN_WIDTH,
  height: DESIGN_HEIGHT,
  fit: 1,
  offsetX: 0,
  offsetY: 0,
};
let linePoints: FigurePoint[] = [];
let solidPoints: FigurePoint[] = [];
let phase: Phase = 'idle';
let triggeredAt = 0;
let animationFrame = 0;
let sourceMask: Uint8Array | null = null;
let sourceLineMask: Uint8Array | null = null;
let sourceWidth = 0;
let sourceHeight = 0;
let sourceCenterX = 0;
let sourceCenterY = 0;
let lastNow = 0;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function hash(a: number, b: number, c = 0): number {
  const value = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453123;
  return value - Math.floor(value);
}

function resize(): void {
  const aspect = Math.max(0.35, window.innerWidth / Math.max(1, window.innerHeight));
  const internalWidth = aspect >= 1
    ? Math.round(DESIGN_HEIGHT * aspect)
    : DESIGN_HEIGHT;
  const internalHeight = aspect >= 1
    ? DESIGN_HEIGHT
    : Math.round(DESIGN_HEIGHT / aspect);

  canvas.width = internalWidth;
  canvas.height = internalHeight;
  artworkCanvas.width = internalWidth;
  artworkCanvas.height = internalHeight;

  const fit = Math.min(internalWidth / DESIGN_WIDTH, internalHeight / DESIGN_HEIGHT);
  view = {
    width: internalWidth,
    height: internalHeight,
    fit,
    offsetX: (internalWidth - DESIGN_WIDTH * fit) * 0.5,
    offsetY: (internalHeight - DESIGN_HEIGHT * fit) * 0.5,
  };

  ctx.imageSmoothingEnabled = false;
  artworkCtx.imageSmoothingEnabled = false;
}

function dilate(input: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const output = new Uint8Array(input.length);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let active = 0;
      for (let oy = -radius; oy <= radius && active === 0; oy += 1) {
        const sy = y + oy;
        if (sy < 0 || sy >= height) continue;
        for (let ox = -radius; ox <= radius; ox += 1) {
          const sx = x + ox;
          if (sx < 0 || sx >= width) continue;
          if (input[sy * width + sx] !== 0) {
            active = 1;
            break;
          }
        }
      }
      output[y * width + x] = active;
    }
  }

  return output;
}

function erode(input: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const output = new Uint8Array(input.length);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let active = 1;
      for (let oy = -radius; oy <= radius && active === 1; oy += 1) {
        const sy = y + oy;
        if (sy < 0 || sy >= height) {
          active = 0;
          break;
        }
        for (let ox = -radius; ox <= radius; ox += 1) {
          const sx = x + ox;
          if (sx < 0 || sx >= width || input[sy * width + sx] === 0) {
            active = 0;
            break;
          }
        }
      }
      output[y * width + x] = active;
    }
  }

  return output;
}

function buildMask(image: HTMLImageElement): void {
  const sourceCanvas = document.createElement('canvas');
  sourceCanvas.width = image.naturalWidth;
  sourceCanvas.height = image.naturalHeight;
  const sourceCtx = sourceCanvas.getContext('2d', { willReadFrequently: true });

  if (!sourceCtx) throw new Error('Could not prepare the human source image.');

  sourceCtx.drawImage(image, 0, 0);
  const pixels = sourceCtx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height).data;
  const raw = new Uint8Array(sourceCanvas.width * sourceCanvas.height);
  const rawLine = new Uint8Array(sourceCanvas.width * sourceCanvas.height);

  for (let y = 0; y < sourceCanvas.height; y += 1) {
    for (let x = 0; x < sourceCanvas.width; x += 1) {
      // The crop still contains a few pixels from the TFT bezel above the
      // head and the neighbouring echo on the far right. Keep only the first
      // figure's visible screen region.
      if (y < 8 || x < 3 || x >= SOURCE_X_LIMIT) continue;
      const index = (y * sourceCanvas.width + x) * 4;
      const r = pixels[index];
      const g = pixels[index + 1];
      const b = pixels[index + 2];
      const brightest = Math.max(r, g, b);
      const darkest = Math.min(r, g, b);
      const coloredStroke = brightest > 72 && brightest - darkest > 24;
      const whiteStroke = r + g + b > 350 && brightest > 128;
      raw[y * sourceCanvas.width + x] = coloredStroke || whiteStroke ? 1 : 0;
      // Use the green pass as the neutral centerline. Sampling the union of
      // the filmed RGB passes and splitting it again would create nine
      // overlapping strokes and wash the figure out to grey.
      const greenCenterline = g > 72 && g + 14 >= r && g >= b * 0.68;
      rawLine[y * sourceCanvas.width + x] = greenCenterline ? 1 : 0;
    }
  }

  sourceLineMask = rawLine;
  const closed = erode(dilate(raw, sourceCanvas.width, sourceCanvas.height, 2), sourceCanvas.width, sourceCanvas.height, 1);
  sourceMask = dilate(closed, sourceCanvas.width, sourceCanvas.height, 1);
  sourceWidth = sourceCanvas.width;
  sourceHeight = sourceCanvas.height;

  let minX = sourceWidth;
  let minY = sourceHeight;
  let maxX = 0;
  let maxY = 0;

  for (let y = 0; y < sourceHeight; y += 1) {
    for (let x = 0; x < sourceWidth; x += 1) {
      if (sourceMask[y * sourceWidth + x] === 0) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  sourceCenterX = (minX + maxX) * 0.5;
  sourceCenterY = (minY + maxY) * 0.5;
  rebuildPoints();
}

function rebuildPoints(): void {
  if (!sourceMask || !sourceLineMask) return;

  linePoints = [];
  solidPoints = [];

  for (let y = 0; y < sourceHeight; y += 1) {
    for (let x = 0; x < sourceWidth; x += 1) {
      const centeredX = x - sourceCenterX;
      const centeredY = y - sourceCenterY;
      const seed = hash(x, y);
      const seed2 = hash(y, x, 3);

      if (sourceLineMask[y * sourceWidth + x] !== 0) {
        linePoints.push({ x: centeredX, y: centeredY, seed, seed2 });
      }

      if (sourceMask[y * sourceWidth + x] !== 0 && x % 2 === 0 && y % 2 === 0) {
        solidPoints.push({ x: centeredX, y: centeredY, seed, seed2 });
      }
    }
  }
}

function pointPosition(point: FigurePoint, echoIndex: number, time: number): { x: number; y: number; designX: number } {
  const echoPhase = time * 1.45 - echoIndex * 0.19;
  const motion = settings.idleMotion;
  const scale = echoScales[echoIndex];
  const wave = (
    Math.sin(point.y * 0.205 + echoPhase) * 0.72
    + Math.sin(point.y * 0.067 - echoPhase * 0.73) * 0.48
  ) * motion;
  const sway = Math.sin(echoPhase * 0.44) * (1.1 - echoIndex * 0.09) * motion;
  const verticalJitter = Math.sin(point.x * 0.13 + echoPhase * 1.31) * 0.16 * motion;
  const designX = echoCenters[echoIndex] + (point.x + wave) * scale + sway;
  const designY = 142 + point.y * scale + verticalJitter;

  return {
    x: view.offsetX + designX * view.fit,
    y: view.offsetY + designY * view.fit,
    designX,
  };
}

function drawStablePoint(
  point: FigurePoint,
  echoIndex: number,
  channelIndex: number,
  now: number,
  size: number,
): void {
  const position = pointPosition(point, echoIndex, now);
  const echoSeparation = 1.34 - echoIndex * 0.13;
  const offset = settings.rgbOffset * echoSeparation * view.fit;
  const x = position.x + channelX[channelIndex] * offset;
  const y = position.y + channelY[channelIndex] * offset;
  artworkCtx.fillRect(x, y, size, size);
}

function spawnTimeFor(designX: number, point: FigurePoint, echoIndex: number): number {
  const xProgress = 1 - clamp(designX / DESIGN_WIDTH, 0, 1);
  const jitter = (hash(point.x, point.y, echoIndex) - 0.5) * settings.sweepJitter;
  return settings.hold + xProgress * settings.sweepDuration + jitter;
}

function drawParticle(
  point: FigurePoint,
  echoIndex: number,
  channelIndex: number,
  spawnTime: number,
  age: number,
  baseSize: number,
): void {
  const originTime = triggeredAt + spawnTime;
  const origin = pointPosition(point, echoIndex, originTime);
  const channelSeed = hash(point.x, point.y, channelIndex + echoIndex * 3);
  const speed = settings.drift * (0.58 + channelSeed * 0.82) * view.fit;
  const verticalSpeed = (point.seed2 - 0.5) * settings.spread * view.fit;
  const noise = Math.sin(age * (3.2 + point.seed * 4.8) + point.seed2 * 18) * settings.turbulence * age * view.fit;
  const echoSeparation = 1.34 - echoIndex * 0.13;
  const channelOffset = settings.rgbOffset * echoSeparation * view.fit;
  const x = origin.x
    + channelX[channelIndex] * channelOffset
    + speed * age
    + age * age * 1.65 * view.fit;
  const y = origin.y
    + channelY[channelIndex] * channelOffset
    + verticalSpeed * age
    + noise;
  const life = settings.particleLife * (0.72 + point.seed * 0.48);
  const alpha = Math.pow(clamp(1 - age / life, 0, 1), 1.3) * (0.48 + point.seed * 0.52);
  const size = baseSize * (0.7 + channelSeed * 0.85) * settings.particleSize;

  if (alpha <= 0.01 || x > view.width + 8 || y < -8 || y > view.height + 8) return;

  artworkCtx.globalAlpha = alpha;
  artworkCtx.fillRect(x, y, Math.max(0.65, size), Math.max(0.65, size * (0.72 + point.seed2 * 0.55)));
}

function renderFigures(now: number): void {
  const points = settings.figure === 'Lines' ? linePoints : solidPoints;
  const baseSize = (settings.figure === 'Lines' ? settings.lineThickness : 2.25) * view.fit;
  const elapsed = phase === 'dissolving' ? now - triggeredAt : 0;
  const echoCount = clamp(Math.round(settings.echoes), 1, echoCenters.length);

  artworkCtx.globalCompositeOperation = 'lighter';

  for (let channelIndex = 0; channelIndex < channelColors.length; channelIndex += 1) {
    artworkCtx.fillStyle = channelColors[channelIndex];
    artworkCtx.globalAlpha = 0.84;

    for (let echoIndex = 0; echoIndex < echoCount; echoIndex += 1) {
      for (const point of points) {
        if (phase !== 'dissolving') {
          drawStablePoint(point, echoIndex, channelIndex, now, baseSize);
          continue;
        }

        const currentPosition = pointPosition(point, echoIndex, now);
        const spawnTime = spawnTimeFor(currentPosition.designX, point, echoIndex);

        if (elapsed < spawnTime) {
          drawStablePoint(point, echoIndex, channelIndex, now, baseSize);
        } else {
          drawParticle(point, echoIndex, channelIndex, spawnTime, elapsed - spawnTime, baseSize);
        }
      }
    }
  }

  artworkCtx.globalAlpha = 1;
  artworkCtx.globalCompositeOperation = 'source-over';
}

function renderScanlines(): void {
  if (settings.scanlines <= 0) return;
  ctx.fillStyle = `rgba(0, 0, 0, ${settings.scanlines})`;
  for (let y = 1; y < view.height; y += 3) {
    ctx.fillRect(0, y, view.width, 1);
  }
}

function render(timestamp: number): void {
  const now = timestamp * 0.001;
  lastNow = now;
  artworkCtx.globalCompositeOperation = 'source-over';
  artworkCtx.globalAlpha = 1;
  artworkCtx.fillStyle = '#000';
  artworkCtx.fillRect(0, 0, view.width, view.height);

  if (phase !== 'blank') {
    renderFigures(now);
  }

  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.filter = 'none';
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, view.width, view.height);

  if (settings.glow > 0) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = settings.glow;
    ctx.filter = `blur(${Math.max(0.55, 1.5 * view.fit)}px)`;
    ctx.drawImage(artworkCanvas, 0, 0);
  }

  ctx.filter = 'none';
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'lighter';
  ctx.drawImage(artworkCanvas, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  renderScanlines();

  if (phase === 'dissolving') {
    const totalDuration = settings.hold + settings.sweepDuration + settings.particleLife + 0.45;
    if (now - triggeredAt > totalDuration) {
      phase = 'blank';
      hint.textContent = 'TAP TO REPLAY';
      hint.classList.remove('hidden');
    }
  }

  animationFrame = requestAnimationFrame(render);
}

function dissolve(): void {
  if (phase === 'dissolving') return;
  phase = 'dissolving';
  triggeredAt = lastNow || performance.now() * 0.001;
  hint.classList.add('hidden');
  canvas.focus({ preventScroll: true });
}

function reset(): void {
  phase = 'idle';
  triggeredAt = 0;
  hint.textContent = 'TAP TO DISSOLVE';
  hint.classList.remove('hidden');
}

function replay(): void {
  if (phase === 'dissolving') return;
  if (phase === 'blank') reset();
  dissolve();
}

function setMode(mode: FigureMode): void {
  settings.figure = mode;
  reset();
  figureController.updateDisplay();
}

const gui = new GUI({ title: 'Afterbody' });
const figureController = gui.add(settings, 'figure', ['Lines', 'Solid']).name('Figure').onChange(() => reset());
gui.add(settings, 'echoes', 1, 6, 1).name('Echoes');
gui.add(settings, 'rgbOffset', 0, 6, 0.05).name('RGB offset');
gui.add(settings, 'idleMotion', 0, 2.5, 0.05).name('Idle motion');

const shapeFolder = gui.addFolder('Shape');
shapeFolder.add(settings, 'lineThickness', 0.6, 2.4, 0.02).name('Line width');

const dissolveFolder = gui.addFolder('Dissolve');
dissolveFolder.add(settings, 'hold', 0, 2, 0.01).name('Hold');
dissolveFolder.add(settings, 'sweepDuration', 1, 6, 0.05).name('Sweep');
dissolveFolder.add(settings, 'sweepJitter', 0, 1, 0.01).name('Edge noise');
dissolveFolder.add(settings, 'drift', 5, 60, 0.5).name('Drift');
dissolveFolder.add(settings, 'spread', 0, 24, 0.5).name('Spread');
dissolveFolder.add(settings, 'turbulence', 0, 8, 0.1).name('Turbulence');
dissolveFolder.add(settings, 'particleLife', 1, 6, 0.05).name('Lifetime');
dissolveFolder.add(settings, 'particleSize', 0.5, 3, 0.05).name('Size');

const finishFolder = gui.addFolder('Display');
finishFolder.add(settings, 'glow', 0, 0.8, 0.01).name('Glow');
finishFolder.add(settings, 'scanlines', 0, 0.3, 0.01).name('Scanlines');

gui.add({ dissolve: replay }, 'dissolve').name('Dissolve');
gui.add({ reset }, 'reset').name('Reset');
gui.close();
let guiVisible = new URLSearchParams(window.location.search).get('debug') === '1';
if (!guiVisible) gui.hide();

canvas.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  replay();
});

window.addEventListener('keydown', (event) => {
  if (event.key === ' ' || event.key === 'Enter') {
    event.preventDefault();
    replay();
  } else if (event.key.toLowerCase() === 'm') {
    setMode(settings.figure === 'Lines' ? 'Solid' : 'Lines');
  } else if (event.key.toLowerCase() === 'r') {
    reset();
  } else if (event.key.toLowerCase() === 'g') {
    guiVisible = !guiVisible;
    if (guiVisible) gui.show();
    else gui.hide();
  }
});

window.addEventListener('resize', resize);
window.addEventListener('error', (event) => {
  error.textContent = event.message || 'Afterbody could not start.';
  error.classList.add('show');
});

const debugWindow = window as Window & { __afterbody?: DebugApi };
debugWindow.__afterbody = {
  dissolve: replay,
  reset,
  setMode,
  getPhase: () => phase,
};

async function start(): Promise<void> {
  resize();
  const image = new Image();
  image.decoding = 'async';
  image.src = new URL('./assets/figure-source.png', import.meta.url).href;
  await image.decode();
  buildMask(image);

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    settings.idleMotion = 0.16;
    settings.drift = 15;
    settings.sweepDuration = 4.5;
  }

  cancelAnimationFrame(animationFrame);
  animationFrame = requestAnimationFrame(render);
}

start().catch((reason: unknown) => {
  const message = reason instanceof Error ? reason.message : 'Afterbody could not start.';
  error.textContent = message;
  error.classList.add('show');
});
