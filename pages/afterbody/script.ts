import GUI from 'lil-gui';

type FigureMode = 'Lines' | 'Solid';
type InteractionMode = 'Original' | 'NameDrop Wave';
type Phase = 'idle' | 'gathering' | 'dissolving' | 'blank';

type FigurePoint = {
  x: number;
  y: number;
  seed: number;
  seed2: number;
  startsPath?: boolean;
};

type EchoLineGeometry = {
  path: Path2D;
  points: FigurePoint[];
  samples: FigurePoint[];
  strokeWidth: number;
  viewBoxX: number;
  viewBoxY: number;
  width: number;
  height: number;
};

type View = {
  width: number;
  height: number;
  fit: number;
  offsetX: number;
  offsetY: number;
};

type DesignPoint = {
  x: number;
  y: number;
};

type PositionedPoint = {
  x: number;
  y: number;
  designX: number;
  designY: number;
};

type DebugApi = {
  dissolve: () => void;
  burst: (clientX?: number, clientY?: number) => void;
  reset: () => void;
  setMode: (mode: FigureMode) => void;
  setInteraction: (mode: InteractionMode) => void;
  getPhase: () => Phase;
  getInteraction: () => InteractionMode;
};

const DESIGN_WIDTH = 480;
const DESIGN_HEIGHT = 270;
const SOURCE_X_LIMIT = 61;
const SVG_TO_DESIGN = 0.32;
const SVG_SAMPLE_STEP = 3.2;
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

const canvas = document.getElementById('artwork') as HTMLCanvasElement;
const hint = document.getElementById('hint') as HTMLParagraphElement;
const error = document.getElementById('error') as HTMLDivElement;
const ctx = canvas.getContext('2d', { alpha: false });

if (!ctx) throw new Error('2D canvas is not supported.');

const artworkCanvas = document.createElement('canvas');
const artworkCtx = artworkCanvas.getContext('2d');

if (!artworkCtx) throw new Error('Offscreen 2D canvas is not supported.');

const settings = {
  figure: 'Lines' as FigureMode,
  interaction: 'NameDrop Wave' as InteractionMode,
  echoes: 6,
  rgbOffset: 3.2,
  lineThickness: 1,
  idleMotion: 0.34,
  hold: 0.72,
  sweepDuration: 3.25,
  sweepJitter: 0.34,
  drift: 27,
  spread: 9.5,
  turbulence: 2.6,
  particleLife: 3.35,
  particleSize: 1.15,
  contactGatherDuration: 0.92,
  contactDensityDuration: 0.52,
  contactCompression: 0.18,
  contactWaveDuration: 0.36,
  contactForce: 100,
  contactSpread: 8,
  contactReleaseSpread: 0.24,
  contactReleaseSpeed: 1.5,
  glow: 0.26,
  scanlines: 0.08,
};

const channelColors = ['#ff2924', '#59ff50', '#2795ff'] as const;
const channelX = [-1, 0, 1] as const;
const channelY = [0.55, 0, -0.55] as const;
const echoCenters = [99, 187, 255, 312, 362, 408];
const lineEchoYCenters = [137, 142, 146, 149, 153, 157];
const solidEchoYCenters = [142, 146, 149, 152, 155, 156];
const solidEchoYScales = [1.79, 1.52, 1.32, 1.16, 1.03, 0.93];
const solidEchoXScales = solidEchoYScales.map((scale) => scale * 1.28);
const lineAssetUrls = [
  new URL('./assets/sori/figure-1.svg', import.meta.url).href,
  new URL('./assets/sori/figure-2.svg', import.meta.url).href,
  new URL('./assets/sori/figure-3.svg', import.meta.url).href,
  new URL('./assets/sori/figure-4.svg', import.meta.url).href,
  new URL('./assets/sori/figure-5.svg', import.meta.url).href,
  new URL('./assets/sori/figure-6.svg', import.meta.url).href,
];

let view: View = {
  width: DESIGN_WIDTH,
  height: DESIGN_HEIGHT,
  fit: 1,
  offsetX: 0,
  offsetY: 0,
};
let echoLineGeometry: EchoLineGeometry[] = [];
let solidPoints: FigurePoint[] = [];
let phase: Phase = 'idle';
let triggeredAt = 0;
let releasedAt = 0;
let contactOrigin: DesignPoint = { x: DESIGN_WIDTH * 0.5, y: DESIGN_HEIGHT * 0.5 };
let activePointerId: number | null = null;
let animationFrame = 0;
let lastNow = 0;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function hash(a: number, b: number, c = 0): number {
  const value = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453123;
  return value - Math.floor(value);
}

function smoothstep(value: number): number {
  const progress = clamp(value, 0, 1);
  return progress * progress * (3 - 2 * progress);
}

function easeOutCubic(value: number): number {
  const progress = clamp(value, 0, 1);
  return 1 - (1 - progress) ** 3;
}

function isNameDropWave(): boolean {
  return settings.interaction === 'NameDrop Wave';
}

function contactReleaseTime(): number {
  return settings.contactGatherDuration + settings.contactDensityDuration;
}

function motionElapsed(now: number): number {
  if (phase === 'gathering') {
    return Math.min(
      Math.max(0, now - triggeredAt),
      Math.max(0, contactReleaseTime() - 0.0001),
    );
  }
  if (phase === 'dissolving' && isNameDropWave()) {
    return contactReleaseTime() + Math.max(0, now - releasedAt);
  }
  if (phase === 'dissolving') return Math.max(0, now - triggeredAt);
  return 0;
}

function resize(): void {
  const pixelRatio = clamp(window.devicePixelRatio || 1, 1, 2);
  const internalWidth = Math.max(1, Math.round(window.innerWidth * pixelRatio));
  const internalHeight = Math.max(1, Math.round(window.innerHeight * pixelRatio));

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

  ctx.imageSmoothingEnabled = true;
  artworkCtx.imageSmoothingEnabled = true;
}

function dilate(input: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const output = new Uint8Array(input.length);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let active = 0;
      for (let offsetY = -radius; offsetY <= radius && active === 0; offsetY += 1) {
        const sourceY = y + offsetY;
        if (sourceY < 0 || sourceY >= height) continue;
        for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
          const sourceX = x + offsetX;
          if (sourceX < 0 || sourceX >= width) continue;
          if (input[sourceY * width + sourceX] !== 0) {
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
      for (let offsetY = -radius; offsetY <= radius && active === 1; offsetY += 1) {
        const sourceY = y + offsetY;
        if (sourceY < 0 || sourceY >= height) {
          active = 0;
          break;
        }
        for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
          const sourceX = x + offsetX;
          if (sourceX < 0 || sourceX >= width || input[sourceY * width + sourceX] === 0) {
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

function buildSolidPoints(image: HTMLImageElement): void {
  const sourceCanvas = document.createElement('canvas');
  sourceCanvas.width = image.naturalWidth;
  sourceCanvas.height = image.naturalHeight;
  const sourceCtx = sourceCanvas.getContext('2d', { willReadFrequently: true });

  if (!sourceCtx) throw new Error('Could not prepare the solid human source image.');

  sourceCtx.drawImage(image, 0, 0);
  const pixels = sourceCtx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height).data;
  const raw = new Uint8Array(sourceCanvas.width * sourceCanvas.height);

  for (let y = 0; y < sourceCanvas.height; y += 1) {
    for (let x = 0; x < sourceCanvas.width; x += 1) {
      if (y < 8 || x < 3 || x >= SOURCE_X_LIMIT) continue;
      const index = (y * sourceCanvas.width + x) * 4;
      const red = pixels[index];
      const green = pixels[index + 1];
      const blue = pixels[index + 2];
      const brightest = Math.max(red, green, blue);
      const darkest = Math.min(red, green, blue);
      const coloredStroke = brightest > 72 && brightest - darkest > 24;
      const whiteStroke = red + green + blue > 350 && brightest > 128;
      raw[y * sourceCanvas.width + x] = coloredStroke || whiteStroke ? 1 : 0;
    }
  }

  const closed = erode(
    dilate(raw, sourceCanvas.width, sourceCanvas.height, 3),
    sourceCanvas.width,
    sourceCanvas.height,
    2,
  );
  const mask = dilate(closed, sourceCanvas.width, sourceCanvas.height, 1);

  let minX = sourceCanvas.width;
  let minY = sourceCanvas.height;
  let maxX = 0;
  let maxY = 0;

  for (let y = 0; y < sourceCanvas.height; y += 1) {
    for (let x = 0; x < sourceCanvas.width; x += 1) {
      if (mask[y * sourceCanvas.width + x] === 0) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  const centerX = (minX + maxX) * 0.5;
  const centerY = (minY + maxY) * 0.5;
  solidPoints = [];

  for (let y = 0; y < sourceCanvas.height; y += 1) {
    for (let x = 0; x < sourceCanvas.width; x += 1) {
      if (mask[y * sourceCanvas.width + x] === 0 || x % 2 !== 0 || y % 2 !== 0) continue;
      solidPoints.push({
        x: x - centerX,
        y: y - centerY,
        seed: hash(x, y),
        seed2: hash(y, x, 3),
      });
    }
  }
}

function readNumber(value: string | null, fallback: number): number {
  if (value === null) return fallback;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function loadLineAsset(url: string, echoIndex: number): Promise<EchoLineGeometry> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load line figure ${echoIndex + 1}.`);

  const source = await response.text();
  const documentSvg = new DOMParser().parseFromString(source, 'image/svg+xml');
  if (documentSvg.querySelector('parsererror')) throw new Error(`Line figure ${echoIndex + 1} is not valid SVG.`);

  const svg = documentSvg.querySelector('svg');
  const sourcePath = documentSvg.querySelector('path');
  const pathData = sourcePath?.getAttribute('d');
  if (!svg || !sourcePath || !pathData) throw new Error(`Line figure ${echoIndex + 1} has no path.`);

  const fallbackWidth = readNumber(svg.getAttribute('width'), 1);
  const fallbackHeight = readNumber(svg.getAttribute('height'), 1);
  const viewBox = (svg.getAttribute('viewBox') ?? `0 0 ${fallbackWidth} ${fallbackHeight}`)
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (viewBox.length !== 4 || viewBox.some((value) => !Number.isFinite(value))) {
    throw new Error(`Line figure ${echoIndex + 1} has an invalid viewBox.`);
  }

  const [viewBoxX, viewBoxY, width, height] = viewBox;
  const strokeWidth = readNumber(sourcePath.getAttribute('stroke-width'), 1);
  const measurementSvg = document.createElementNS(SVG_NAMESPACE, 'svg');
  const measurementPath = document.createElementNS(SVG_NAMESPACE, 'path');
  measurementSvg.setAttribute('viewBox', viewBox.join(' '));
  measurementSvg.setAttribute('aria-hidden', 'true');
  measurementSvg.style.position = 'fixed';
  measurementSvg.style.left = '-10000px';
  measurementSvg.style.top = '-10000px';
  measurementSvg.style.width = '1px';
  measurementSvg.style.height = '1px';
  measurementSvg.style.opacity = '0';
  measurementPath.setAttribute('d', pathData);
  measurementSvg.append(measurementPath);
  document.body.append(measurementSvg);

  const points: FigurePoint[] = [];
  const centerX = viewBoxX + width * 0.5;
  const centerY = viewBoxY + height * 0.5;

  // A single SVG <path> may contain several M-started contours (torso,
  // arms, legs). Sample them independently so the dissolve never draws a
  // straight bridge across those intentional gaps.
  const subpaths = pathData.match(/[Mm][^Mm]*/g) ?? [pathData];
  for (const subpathData of subpaths) {
    measurementPath.setAttribute('d', subpathData);
    const length = measurementPath.getTotalLength();

    for (let distance = 0; distance < length; distance += SVG_SAMPLE_STEP) {
      const point = measurementPath.getPointAtLength(distance);
      points.push({
        x: point.x - centerX,
        y: point.y - centerY,
        seed: hash(point.x, point.y, echoIndex),
        seed2: hash(point.y, point.x, echoIndex + 7),
        startsPath: distance === 0,
      });
    }

    const finalPoint = measurementPath.getPointAtLength(length);
    points.push({
      x: finalPoint.x - centerX,
      y: finalPoint.y - centerY,
      seed: hash(finalPoint.x, finalPoint.y, echoIndex),
      seed2: hash(finalPoint.y, finalPoint.x, echoIndex + 7),
      startsPath: length === 0,
    });
  }
  measurementSvg.remove();

  return {
    path: new Path2D(pathData),
    points,
    samples: points.filter((_, index) => index % 3 === 0),
    strokeWidth,
    viewBoxX,
    viewBoxY,
    width,
    height,
  };
}

async function loadLineAssets(): Promise<void> {
  echoLineGeometry = await Promise.all(
    lineAssetUrls.map((url, echoIndex) => loadLineAsset(url, echoIndex)),
  );
}

function lineSway(echoIndex: number, time: number): number {
  const echoPhase = time * 1.45 - echoIndex * 0.19;
  return Math.sin(echoPhase * 0.44) * (1.1 - echoIndex * 0.09) * settings.idleMotion;
}

function linePointPosition(point: FigurePoint, echoIndex: number, time: number): PositionedPoint {
  const designX = echoCenters[echoIndex] + point.x * SVG_TO_DESIGN + lineSway(echoIndex, time);
  const designY = lineEchoYCenters[echoIndex] + point.y * SVG_TO_DESIGN;

  return {
    x: view.offsetX + designX * view.fit,
    y: view.offsetY + designY * view.fit,
    designX,
    designY,
  };
}

function solidPointPosition(point: FigurePoint, echoIndex: number, time: number): PositionedPoint {
  const echoPhase = time * 1.45 - echoIndex * 0.19;
  const motion = settings.idleMotion;
  const scaleX = solidEchoXScales[echoIndex];
  const scaleY = solidEchoYScales[echoIndex];
  const wave = (
    Math.sin(point.y * 0.205 + echoPhase) * 0.72
    + Math.sin(point.y * 0.067 - echoPhase * 0.73) * 0.48
  ) * motion;
  const sway = Math.sin(echoPhase * 0.44) * (1.1 - echoIndex * 0.09) * motion;
  const verticalJitter = Math.sin(point.x * 0.13 + echoPhase * 1.31) * 0.16 * motion;
  const rasterWave = (
    Math.sin(point.x * 0.115 + point.y * 0.052 + echoPhase * 0.18) * 0.5
    + Math.sin(point.x * 0.041 - point.y * 0.103) * 0.24
  );
  const designX = echoCenters[echoIndex] + (point.x + wave) * scaleX + sway;
  const designY = solidEchoYCenters[echoIndex] + (point.y + rasterWave) * scaleY + verticalJitter;

  return {
    x: view.offsetX + designX * view.fit,
    y: view.offsetY + designY * view.fit,
    designX,
    designY,
  };
}

function contactGatherProgress(elapsed: number): number {
  if (!isNameDropWave()) return 0;
  return smoothstep(elapsed / Math.max(0.001, settings.contactGatherDuration));
}

function contactDensityProgress(elapsed: number): number {
  if (!isNameDropWave()) return 0;
  return smoothstep(
    (elapsed - settings.contactGatherDuration)
    / Math.max(0.001, settings.contactDensityDuration),
  );
}

function gatheredPosition(
  position: PositionedPoint,
  echoIndex: number,
  elapsed: number,
): PositionedPoint {
  const gather = contactGatherProgress(elapsed);
  const density = contactDensityProgress(elapsed);
  const progress = gather * 0.72 + density * 0.28;
  if (progress <= 0) return position;

  const deltaX = contactOrigin.x - position.designX;
  const deltaY = contactOrigin.y - position.designY;
  const distance = Math.max(0.001, Math.hypot(deltaX, deltaY));
  const proximity = smoothstep(1 - distance / (DESIGN_WIDTH * 0.52));
  const holdAge = phase === 'gathering'
    ? Math.max(0, lastNow - triggeredAt - contactReleaseTime())
    : 0;
  const tensionPulse = holdAge > 0
    ? 1 + Math.sin(holdAge * 4.4 + echoIndex * 0.72) * 0.025
    : 1;
  const localTension = 0.22 + proximity * proximity * 1.78;
  const pull = settings.contactCompression * progress * localTension * tensionPulse;
  const designX = position.designX + deltaX * pull;
  const designY = position.designY + deltaY * pull;

  return {
    x: view.offsetX + designX * view.fit,
    y: view.offsetY + designY * view.fit,
    designX,
    designY,
  };
}

function spawnTimeFor(designX: number, designY: number, point: FigurePoint, echoIndex: number): number {
  if (isNameDropWave()) {
    const distance = Math.hypot(designX - contactOrigin.x, designY - contactOrigin.y);
    const shuffledRelease = hash(point.x, point.y, echoIndex + 31) * settings.contactReleaseSpread;
    const waveDelay = clamp(distance / (DESIGN_WIDTH * 0.72), 0, 1) * settings.contactWaveDuration;
    return contactReleaseTime() + waveDelay + shuffledRelease;
  }

  const xProgress = clamp(designX / DESIGN_WIDTH, 0, 1);
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
  lineMode: boolean,
): void {
  const particleAge = isNameDropWave() ? age * settings.contactReleaseSpeed : age;
  const timelineOrigin = isNameDropWave() && releasedAt > 0
    ? releasedAt - contactReleaseTime()
    : triggeredAt;
  const originTime = timelineOrigin + spawnTime;
  const baseOrigin = lineMode
    ? linePointPosition(point, echoIndex, originTime)
    : solidPointPosition(point, echoIndex, originTime);
  const origin = isNameDropWave()
    ? gatheredPosition(baseOrigin, echoIndex, spawnTime)
    : baseOrigin;
  const channelSeed = hash(point.x, point.y, channelIndex + echoIndex * 3);
  const channelOffset = settings.rgbOffset * view.fit;
  let x: number;
  let y: number;

  if (isNameDropWave()) {
    const contactX = view.offsetX + contactOrigin.x * view.fit;
    const contactY = view.offsetY + contactOrigin.y * view.fit;
    let directionX = origin.x - contactX;
    let directionY = origin.y - contactY;
    const distance = Math.hypot(directionX, directionY);

    if (distance < 0.001) {
      const angle = point.seed * Math.PI * 2;
      directionX = Math.cos(angle);
      directionY = Math.sin(angle);
    } else {
      directionX /= distance;
      directionY /= distance;
    }

    const tangentX = -directionY;
    const tangentY = directionX;
    const radialSpeed = settings.contactForce * (0.64 + channelSeed * 0.72) * view.fit;
    const tangentSpeed = (point.seed2 - 0.5) * settings.contactSpread * view.fit;
    const initialBloom = (1 - Math.exp(-particleAge * 13)) * radialSpeed * 0.13;
    const outwardTravel = radialSpeed * particleAge * 0.48;
    const acceleration = particleAge * particleAge * (3.2 + point.seed * 3.4) * view.fit;
    const turbulence = Math.sin(particleAge * (4.1 + point.seed * 4.6) + point.seed2 * 19)
      * settings.turbulence
      * particleAge
      * view.fit;

    x = origin.x
      + channelX[channelIndex] * channelOffset
      + directionX * (initialBloom + outwardTravel + acceleration)
      + tangentX * (tangentSpeed * particleAge + turbulence * 0.18);
    y = origin.y
      + channelY[channelIndex] * channelOffset
      + directionY * (initialBloom + outwardTravel + acceleration)
      + tangentY * (tangentSpeed * particleAge + turbulence * 0.18);
  } else {
    const speed = settings.drift * (0.58 + channelSeed * 0.82) * view.fit;
    const verticalSpeed = (point.seed2 - 0.5) * settings.spread * view.fit;
    const noise = Math.sin(particleAge * (3.2 + point.seed * 4.8) + point.seed2 * 18)
      * settings.turbulence
      * particleAge
      * view.fit;

    x = origin.x
      + channelX[channelIndex] * channelOffset
      + speed * particleAge
      + particleAge * particleAge * 1.65 * view.fit;
    y = origin.y
      + channelY[channelIndex] * channelOffset
      + verticalSpeed * particleAge
      + noise;
  }

  const life = settings.particleLife * (0.72 + point.seed * 0.48);
  const alpha = Math.pow(clamp(1 - particleAge / life, 0, 1), 1.3)
    * (0.48 + point.seed * 0.52);
  const size = baseSize * (0.7 + channelSeed * 0.85) * settings.particleSize;

  if (alpha <= 0.01 || x < -8 || x > view.width + 8 || y < -8 || y > view.height + 8) return;

  artworkCtx.globalAlpha = alpha;
  artworkCtx.fillRect(x, y, Math.max(0.65, size), Math.max(0.65, size * (0.72 + point.seed2 * 0.55)));
}

function drawExactLinePath(echoIndex: number, channelIndex: number, now: number): void {
  const geometry = echoLineGeometry[echoIndex];
  if (!geometry) return;

  const designX = echoCenters[echoIndex]
    + lineSway(echoIndex, now)
    + channelX[channelIndex] * settings.rgbOffset;
  const designY = lineEchoYCenters[echoIndex] + channelY[channelIndex] * settings.rgbOffset;
  artworkCtx.save();
  artworkCtx.translate(
    view.offsetX + designX * view.fit,
    view.offsetY + designY * view.fit,
  );
  artworkCtx.scale(SVG_TO_DESIGN * view.fit, SVG_TO_DESIGN * view.fit);
  artworkCtx.translate(
    -(geometry.viewBoxX + geometry.width * 0.5),
    -(geometry.viewBoxY + geometry.height * 0.5),
  );
  artworkCtx.lineCap = 'round';
  artworkCtx.lineJoin = 'round';
  artworkCtx.lineWidth = geometry.strokeWidth * settings.lineThickness;
  artworkCtx.stroke(geometry.path);
  artworkCtx.restore();
}

function drawDissolvingLinePath(
  echoIndex: number,
  channelIndex: number,
  now: number,
  elapsed: number,
): void {
  const geometry = echoLineGeometry[echoIndex];
  if (!geometry) return;

  artworkCtx.beginPath();
  let drawing = false;

  for (const point of geometry.points) {
    if (point.startsPath) drawing = false;
    const basePosition = linePointPosition(point, echoIndex, now);
    const remains = elapsed < spawnTimeFor(
      basePosition.designX,
      basePosition.designY,
      point,
      echoIndex,
    );

    if (!remains) {
      drawing = false;
      continue;
    }

    const position = gatheredPosition(basePosition, echoIndex, elapsed);
    const channelOffset = settings.rgbOffset * view.fit;
    const x = position.x + channelX[channelIndex] * channelOffset;
    const y = position.y + channelY[channelIndex] * channelOffset;
    if (drawing) artworkCtx.lineTo(x, y);
    else artworkCtx.moveTo(x, y);
    drawing = true;
  }

  artworkCtx.lineCap = 'round';
  artworkCtx.lineJoin = 'round';
  artworkCtx.lineWidth = geometry.strokeWidth * SVG_TO_DESIGN * settings.lineThickness * view.fit;
  artworkCtx.stroke();
}

function renderLineFigures(now: number, elapsed: number): void {
  const echoCount = clamp(Math.round(settings.echoes), 1, echoLineGeometry.length);

  for (let channelIndex = 0; channelIndex < channelColors.length; channelIndex += 1) {
    artworkCtx.strokeStyle = channelColors[channelIndex];
    artworkCtx.fillStyle = channelColors[channelIndex];
    artworkCtx.globalAlpha = 0.84;

    for (let echoIndex = 0; echoIndex < echoCount; echoIndex += 1) {
      if (phase === 'idle') {
        drawExactLinePath(echoIndex, channelIndex, now);
        continue;
      }

      drawDissolvingLinePath(echoIndex, channelIndex, now, elapsed);
      const geometry = echoLineGeometry[echoIndex];
      const baseSize = geometry.strokeWidth * SVG_TO_DESIGN * 0.68 * view.fit;

      for (const point of geometry.samples) {
        const currentPosition = linePointPosition(point, echoIndex, now);
        const spawnTime = spawnTimeFor(
          currentPosition.designX,
          currentPosition.designY,
          point,
          echoIndex,
        );
        if (elapsed >= spawnTime) {
          drawParticle(point, echoIndex, channelIndex, spawnTime, elapsed - spawnTime, baseSize, true);
        }
      }
    }
  }
}

function drawStableSolidPoint(
  point: FigurePoint,
  echoIndex: number,
  channelIndex: number,
  now: number,
  size: number,
  elapsed: number,
): void {
  const basePosition = solidPointPosition(point, echoIndex, now);
  const position = gatheredPosition(basePosition, echoIndex, elapsed);
  const offset = settings.rgbOffset * view.fit;
  const x = position.x + channelX[channelIndex] * offset;
  const y = position.y + channelY[channelIndex] * offset;
  artworkCtx.fillRect(x, y, size, size);
}

function renderSolidFigures(now: number, elapsed: number): void {
  const baseSize = 2.25 * view.fit;
  const echoCount = clamp(Math.round(settings.echoes), 1, echoCenters.length);

  for (let channelIndex = 0; channelIndex < channelColors.length; channelIndex += 1) {
    artworkCtx.fillStyle = channelColors[channelIndex];
    artworkCtx.globalAlpha = 0.84;

    for (let echoIndex = 0; echoIndex < echoCount; echoIndex += 1) {
      for (const point of solidPoints) {
        if (phase === 'idle') {
          drawStableSolidPoint(point, echoIndex, channelIndex, now, baseSize, 0);
          continue;
        }

        const currentPosition = solidPointPosition(point, echoIndex, now);
        const spawnTime = spawnTimeFor(
          currentPosition.designX,
          currentPosition.designY,
          point,
          echoIndex,
        );
        if (elapsed < spawnTime) {
          drawStableSolidPoint(point, echoIndex, channelIndex, now, baseSize, elapsed);
        }
        else drawParticle(point, echoIndex, channelIndex, spawnTime, elapsed - spawnTime, baseSize, false);
      }
    }
  }
}

function renderFigures(now: number): void {
  const elapsed = motionElapsed(now);
  artworkCtx.globalCompositeOperation = 'lighter';

  if (settings.figure === 'Lines') renderLineFigures(now, elapsed);
  else renderSolidFigures(now, elapsed);

  artworkCtx.globalAlpha = 1;
  artworkCtx.globalCompositeOperation = 'source-over';
}

function renderContactEffect(now: number): void {
  if (phase !== 'dissolving' || !isNameDropWave()) return;

  const elapsed = motionElapsed(now);
  const centerX = view.offsetX + contactOrigin.x * view.fit;
  const centerY = view.offsetY + contactOrigin.y * view.fit;
  const releaseAge = elapsed - contactReleaseTime();
  const effectAge = releaseAge * settings.contactReleaseSpeed;
  const releaseProgress = easeOutCubic(effectAge / 0.52);
  const releaseLife = Math.pow(clamp(1 - Math.max(0, effectAge) / 0.68, 0, 1), 1.35);
  const radius = (8.5 + releaseProgress * 78) * view.fit;
  const alpha = releaseLife * 0.48;

  artworkCtx.save();
  artworkCtx.globalCompositeOperation = 'lighter';

  for (let channelIndex = 0; channelIndex < channelColors.length; channelIndex += 1) {
    const channelCenterX = centerX;
    const channelCenterY = centerY;
    const gradient = artworkCtx.createRadialGradient(
      channelCenterX,
      channelCenterY,
      0,
      channelCenterX,
      channelCenterY,
      Math.max(1, radius),
    );
    gradient.addColorStop(0, channelColors[channelIndex]);
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    artworkCtx.globalAlpha = alpha;
    artworkCtx.fillStyle = gradient;
    artworkCtx.fillRect(
      channelCenterX - radius,
      channelCenterY - radius,
      radius * 2,
      radius * 2,
    );
  }

  artworkCtx.restore();
}

function renderScanlines(): void {
  if (settings.scanlines <= 0) return;
  ctx.fillStyle = `rgba(0, 0, 0, ${settings.scanlines})`;
  for (let y = 1; y < view.height; y += 3) ctx.fillRect(0, y, view.width, 1);
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
    renderContactEffect(now);
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
    const contactDuration = settings.contactWaveDuration
      + settings.contactReleaseSpread
      + settings.particleLife / settings.contactReleaseSpeed
      + 0.8;
    const originalDuration = settings.hold + settings.sweepDuration + settings.particleLife + 0.45;
    const totalDuration = isNameDropWave() ? contactDuration : originalDuration;
    const phaseStartedAt = isNameDropWave() ? releasedAt : triggeredAt;
    if (now - phaseStartedAt > totalDuration) {
      if (isNameDropWave()) reset();
      else {
        phase = 'blank';
        hint.textContent = 'TAP TO REPLAY';
        hint.classList.remove('hidden');
      }
    }
  }

  animationFrame = requestAnimationFrame(render);
}

function dissolve(): void {
  if (phase === 'gathering' || phase === 'dissolving') return;
  if (phase === 'blank') reset();
  phase = 'dissolving';
  triggeredAt = lastNow || performance.now() * 0.001;
  releasedAt = 0;
  hint.classList.add('hidden');
  canvas.focus({ preventScroll: true });
}

function beginGather(point?: DesignPoint): void {
  if (phase === 'gathering' || phase === 'dissolving') return;
  if (phase === 'blank') reset();

  contactOrigin = point ?? { x: DESIGN_WIDTH * 0.5, y: DESIGN_HEIGHT * 0.5 };
  phase = 'gathering';
  triggeredAt = lastNow || performance.now() * 0.001;
  releasedAt = 0;
  hint.textContent = 'RELEASE TO BURST';
  hint.classList.remove('hidden');
  canvas.focus({ preventScroll: true });
}

function releaseGather(): void {
  if (phase !== 'gathering') return;
  phase = 'dissolving';
  releasedAt = lastNow || performance.now() * 0.001;
  hint.classList.add('hidden');
}

function reset(): void {
  phase = 'idle';
  triggeredAt = 0;
  releasedAt = 0;
  activePointerId = null;
  hint.textContent = isNameDropWave() ? 'HOLD TO CONNECT' : 'TAP TO DISSOLVE';
  hint.classList.remove('hidden');
}

function replay(point?: DesignPoint): void {
  if (isNameDropWave()) {
    beginGather(point);
    releaseGather();
    return;
  }
  dissolve();
}

function designPointFromClient(clientX: number, clientY: number): DesignPoint {
  const rect = canvas.getBoundingClientRect();
  const internalX = (clientX - rect.left) * (canvas.width / Math.max(1, rect.width));
  const internalY = (clientY - rect.top) * (canvas.height / Math.max(1, rect.height));

  return {
    x: clamp((internalX - view.offsetX) / view.fit, 0, DESIGN_WIDTH),
    y: clamp((internalY - view.offsetY) / view.fit, 0, DESIGN_HEIGHT),
  };
}

function setMode(mode: FigureMode): void {
  settings.figure = mode;
  reset();
  figureController.updateDisplay();
}

function setInteraction(mode: InteractionMode): void {
  settings.interaction = mode;
  reset();
  interactionController.updateDisplay();
}

const gui = new GUI({ title: 'Afterbody' });
const interactionController = gui
  .add(settings, 'interaction', ['Original', 'NameDrop Wave'])
  .name('Interaction')
  .onChange(() => reset());
const figureController = gui.add(settings, 'figure', ['Lines', 'Solid']).name('Figure').onChange(() => reset());
gui.add(settings, 'echoes', 1, 6, 1).name('Echoes');
gui.add(settings, 'rgbOffset', 0, 6, 0.05).name('RGB offset');
gui.add(settings, 'idleMotion', 0, 2.5, 0.05).name('Idle motion');

const shapeFolder = gui.addFolder('Shape');
shapeFolder.add(settings, 'lineThickness', 0.45, 1.8, 0.01).name('SVG line scale');

const dissolveFolder = gui.addFolder('Dissolve');
dissolveFolder.add(settings, 'hold', 0, 2, 0.01).name('Hold');
dissolveFolder.add(settings, 'sweepDuration', 1, 6, 0.05).name('Sweep');
dissolveFolder.add(settings, 'sweepJitter', 0, 1, 0.01).name('Edge noise');
dissolveFolder.add(settings, 'drift', 5, 60, 0.5).name('Drift');
dissolveFolder.add(settings, 'spread', 0, 24, 0.5).name('Spread');
dissolveFolder.add(settings, 'turbulence', 0, 8, 0.1).name('Turbulence');
dissolveFolder.add(settings, 'particleLife', 1, 6, 0.05).name('Lifetime');
dissolveFolder.add(settings, 'particleSize', 0.5, 3, 0.05).name('Size');

const contactFolder = gui.addFolder('NameDrop Wave');
contactFolder.add(settings, 'contactGatherDuration', 0.25, 1.8, 0.01).name('Gather time');
contactFolder.add(settings, 'contactDensityDuration', 0.15, 1.2, 0.01).name('Tension time');
contactFolder.add(settings, 'contactCompression', 0, 0.28, 0.005).name('Line pull');
contactFolder.add(settings, 'contactWaveDuration', 0.05, 0.9, 0.01).name('Wave travel');
contactFolder.add(settings, 'contactForce', 10, 160, 1).name('Release force');
contactFolder.add(settings, 'contactSpread', 0, 50, 1).name('Release curl');
contactFolder.add(settings, 'contactReleaseSpread', 0, 0.7, 0.005).name('Release noise');
contactFolder.add(settings, 'contactReleaseSpeed', 0.5, 3, 0.05).name('Release speed');

const finishFolder = gui.addFolder('Display');
finishFolder.add(settings, 'glow', 0, 0.8, 0.01).name('Glow');
finishFolder.add(settings, 'scanlines', 0, 0.3, 0.01).name('Scanlines');

gui.add({ trigger: () => replay() }, 'trigger').name('Trigger');
gui.add({ reset }, 'reset').name('Reset');
gui.close();
let guiVisible = new URLSearchParams(window.location.search).get('debug') === '1';
if (!guiVisible) gui.hide();

canvas.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  if (isNameDropWave()) {
    if (activePointerId !== null || phase === 'gathering' || phase === 'dissolving') return;
    beginGather(designPointFromClient(event.clientX, event.clientY));
    activePointerId = event.pointerId;
    canvas.setPointerCapture(event.pointerId);
    return;
  }
  replay();
});

canvas.addEventListener('pointermove', (event) => {
  if (!isNameDropWave() || phase !== 'gathering' || event.pointerId !== activePointerId) return;
  event.preventDefault();
  contactOrigin = designPointFromClient(event.clientX, event.clientY);
});

function finishPointerInteraction(event: PointerEvent): void {
  event.preventDefault();
  if (event.pointerId !== activePointerId) return;
  activePointerId = null;
  releaseGather();
}

window.addEventListener('pointerup', finishPointerInteraction);
window.addEventListener('pointercancel', finishPointerInteraction);
canvas.addEventListener('lostpointercapture', (event) => {
  if (event.pointerId !== activePointerId) return;
  activePointerId = null;
  releaseGather();
});

canvas.addEventListener('contextmenu', (event) => event.preventDefault());
canvas.addEventListener('dragstart', (event) => event.preventDefault());
canvas.addEventListener('selectstart', (event) => event.preventDefault());

let keyboardGathering = false;

window.addEventListener('keydown', (event) => {
  if (event.key === ' ' || event.key === 'Enter') {
    event.preventDefault();
    if (event.repeat) return;
    if (isNameDropWave()) {
      keyboardGathering = true;
      beginGather();
    } else replay();
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

window.addEventListener('keyup', (event) => {
  if (event.key !== ' ' && event.key !== 'Enter') return;
  event.preventDefault();
  if (!keyboardGathering) return;
  keyboardGathering = false;
  releaseGather();
});

window.addEventListener('resize', resize);
window.addEventListener('error', (event) => {
  error.textContent = event.message || 'Afterbody could not start.';
  error.classList.add('show');
});

const debugWindow = window as Window & { __afterbody?: DebugApi };
debugWindow.__afterbody = {
  dissolve: replay,
  burst: (clientX = window.innerWidth * 0.5, clientY = window.innerHeight * 0.5) => {
    setInteraction('NameDrop Wave');
    replay(designPointFromClient(clientX, clientY));
  },
  reset,
  setMode,
  setInteraction,
  getPhase: () => phase,
  getInteraction: () => settings.interaction,
};

async function start(): Promise<void> {
  resize();
  const solidImage = new Image();
  solidImage.decoding = 'async';
  solidImage.src = new URL('./assets/figure-source-start.png', import.meta.url).href;

  await Promise.all([
    loadLineAssets(),
    solidImage.decode().then(() => buildSolidPoints(solidImage)),
  ]);

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
