import GUI from 'lil-gui';

type FigureMode = 'Lines' | 'Solid';
type Phase = 'idle' | 'dissolving' | 'blank';

type FigurePoint = {
  x: number;
  y: number;
  seed: number;
  seed2: number;
};

type ScanPath = {
  points: FigurePoint[];
};

type SourcePoint = {
  x: number;
  y: number;
};

type EchoLineGeometry = {
  paths: ScanPath[];
  samples: FigurePoint[];
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
const SOURCE_X_LIMIT = 61;

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
  lineThickness: 1.72,
  idleMotion: 0.34,
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
const echoCenters = [99, 187, 255, 312, 362, 408];
const echoYCenters = [142, 146, 149, 152, 155, 156];
const echoYScales = [1.79, 1.52, 1.32, 1.16, 1.03, 0.93];
const echoXScales = echoYScales.map((scale) => scale * 1.28);
const echoLineWeights = [1.04, 1.02, 1, 0.98, 0.96, 0.94];
const echoDensityOffsets = [
  [0],
  [-0.8, 0.8],
  [-1.3, 0, 1.3],
  [-2, -0.7, 0.7, 2],
  [-2.7, -1.35, 0, 1.35, 2.7],
  [-3.4, -2, -0.7, 0.7, 2, 3.4],
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
let animationFrame = 0;
let sourceMask: Uint8Array | null = null;
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
      const greenCenterline = g > 72 && g + 14 >= r && g >= b * 0.68;
      rawLine[y * sourceCanvas.width + x] = greenCenterline ? 1 : 0;
    }
  }

  // The filmed source contains scan bands, not a clean body mask. Closing
  // their small vertical gaps gives us a continuous silhouette from which we
  // can generate fresh, smooth lines at a different density for every echo.
  const closed = erode(
    dilate(raw, sourceCanvas.width, sourceCanvas.height, 3),
    sourceCanvas.width,
    sourceCanvas.height,
    2,
  );
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
  rebuildGeometry(rawLine);
}

function makeFigurePoint(x: number, y: number): FigurePoint {
  return {
    x: x - sourceCenterX,
    y: y - sourceCenterY,
    seed: hash(x, y),
    seed2: hash(y, x, 3),
  };
}

function neighborIndices(index: number, mask: Uint8Array): number[] {
  const x = index % sourceWidth;
  const y = Math.floor(index / sourceWidth);
  const neighbors: number[] = [];

  for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      if (offsetX === 0 && offsetY === 0) continue;
      const nextX = x + offsetX;
      const nextY = y + offsetY;
      if (nextX < 0 || nextX >= sourceWidth || nextY < 0 || nextY >= sourceHeight) continue;
      const nextIndex = nextY * sourceWidth + nextX;
      if (mask[nextIndex] !== 0) neighbors.push(nextIndex);
    }
  }

  return neighbors;
}

function thinLineMask(input: Uint8Array): Uint8Array {
  const output = input.slice();
  let changed = true;

  while (changed) {
    changed = false;

    for (let pass = 0; pass < 2; pass += 1) {
      const remove: number[] = [];

      for (let y = 1; y < sourceHeight - 1; y += 1) {
        for (let x = 1; x < sourceWidth - 1; x += 1) {
          const index = y * sourceWidth + x;
          if (output[index] === 0) continue;

          const p2 = output[(y - 1) * sourceWidth + x];
          const p3 = output[(y - 1) * sourceWidth + x + 1];
          const p4 = output[y * sourceWidth + x + 1];
          const p5 = output[(y + 1) * sourceWidth + x + 1];
          const p6 = output[(y + 1) * sourceWidth + x];
          const p7 = output[(y + 1) * sourceWidth + x - 1];
          const p8 = output[y * sourceWidth + x - 1];
          const p9 = output[(y - 1) * sourceWidth + x - 1];
          const neighbors = [p2, p3, p4, p5, p6, p7, p8, p9];
          const count = neighbors.reduce((sum, value) => sum + value, 0);
          if (count < 2 || count > 6) continue;

          let transitions = 0;
          for (let neighbor = 0; neighbor < neighbors.length; neighbor += 1) {
            if (neighbors[neighbor] === 0 && neighbors[(neighbor + 1) % neighbors.length] !== 0) transitions += 1;
          }
          if (transitions !== 1) continue;

          const firstCondition = pass === 0 ? p2 * p4 * p6 === 0 : p2 * p4 * p8 === 0;
          const secondCondition = pass === 0 ? p4 * p6 * p8 === 0 : p2 * p6 * p8 === 0;
          if (firstCondition && secondCondition) remove.push(index);
        }
      }

      if (remove.length > 0) {
        changed = true;
        for (const index of remove) output[index] = 0;
      }
    }
  }

  return output;
}

function smoothSourcePath(points: SourcePoint[]): SourcePoint[] {
  let smoothed = points;

  for (let iteration = 0; iteration < 2; iteration += 1) {
    if (smoothed.length < 3) break;
    const next: SourcePoint[] = [smoothed[0]];
    for (let index = 0; index < smoothed.length - 1; index += 1) {
      const first = smoothed[index];
      const second = smoothed[index + 1];
      next.push(
        { x: first.x * 0.75 + second.x * 0.25, y: first.y * 0.75 + second.y * 0.25 },
        { x: first.x * 0.25 + second.x * 0.75, y: first.y * 0.25 + second.y * 0.75 },
      );
    }
    next.push(smoothed[smoothed.length - 1]);
    smoothed = next;
  }

  return smoothed;
}

function traceLinePaths(mask: Uint8Array): SourcePoint[][] {
  const pixelCount = sourceWidth * sourceHeight;
  const edgeKey = (first: number, second: number): number => (
    Math.min(first, second) * pixelCount + Math.max(first, second)
  );
  const visitedEdges = new Set<number>();
  const paths: SourcePoint[][] = [];

  const walk = (start: number, next: number): SourcePoint[] => {
    const indices = [start];
    let previous = start;
    let current = next;
    visitedEdges.add(edgeKey(previous, current));

    while (true) {
      indices.push(current);
      const neighbors = neighborIndices(current, mask);
      if (neighbors.length !== 2 && current !== start) break;
      const candidates = neighbors.filter((candidate) => !visitedEdges.has(edgeKey(current, candidate)));
      if (candidates.length === 0) break;

      const previousX = previous % sourceWidth;
      const previousY = Math.floor(previous / sourceWidth);
      const currentX = current % sourceWidth;
      const currentY = Math.floor(current / sourceWidth);
      const incomingX = currentX - previousX;
      const incomingY = currentY - previousY;
      let best = candidates[0];
      let bestDot = Number.NEGATIVE_INFINITY;

      for (const candidate of candidates) {
        const candidateX = candidate % sourceWidth;
        const candidateY = Math.floor(candidate / sourceWidth);
        const dot = incomingX * (candidateX - currentX) + incomingY * (candidateY - currentY);
        if (dot > bestDot) {
          best = candidate;
          bestDot = dot;
        }
      }

      previous = current;
      current = best;
      visitedEdges.add(edgeKey(previous, current));
      if (current === start) break;
    }

    return indices.map((index) => ({
      x: index % sourceWidth,
      y: Math.floor(index / sourceWidth),
    }));
  };

  for (let index = 0; index < mask.length; index += 1) {
    if (mask[index] === 0) continue;
    const neighbors = neighborIndices(index, mask);
    if (neighbors.length === 2) continue;
    for (const next of neighbors) {
      if (visitedEdges.has(edgeKey(index, next))) continue;
      const path = walk(index, next);
      if (path.length >= 3) paths.push(path);
    }
  }

  for (let index = 0; index < mask.length; index += 1) {
    if (mask[index] === 0) continue;
    const next = neighborIndices(index, mask).find((candidate) => !visitedEdges.has(edgeKey(index, candidate)));
    if (next === undefined) continue;
    const path = walk(index, next);
    if (path.length >= 3) paths.push(path);
  }

  return paths;
}

function mergeSourcePaths(input: SourcePoint[][]): SourcePoint[][] {
  const paths = input.map((path) => [...path]);

  while (true) {
    let best: { first: number; second: number; reverseFirst: boolean; reverseSecond: boolean; score: number } | null = null;

    for (let firstIndex = 0; firstIndex < paths.length; firstIndex += 1) {
      for (let secondIndex = firstIndex + 1; secondIndex < paths.length; secondIndex += 1) {
        for (const reverseFirst of [false, true]) {
          for (const reverseSecond of [false, true]) {
            const first = reverseFirst ? [...paths[firstIndex]].reverse() : paths[firstIndex];
            const second = reverseSecond ? [...paths[secondIndex]].reverse() : paths[secondIndex];
            const firstEnd = first[first.length - 1];
            const firstBefore = first[Math.max(0, first.length - 3)];
            const secondStart = second[0];
            const secondAfter = second[Math.min(second.length - 1, 2)];
            const distance = Math.hypot(secondStart.x - firstEnd.x, secondStart.y - firstEnd.y);
            if (distance > 3.8) continue;

            const incomingX = firstEnd.x - firstBefore.x;
            const incomingY = firstEnd.y - firstBefore.y;
            const outgoingX = secondAfter.x - secondStart.x;
            const outgoingY = secondAfter.y - secondStart.y;
            const lengths = Math.hypot(incomingX, incomingY) * Math.hypot(outgoingX, outgoingY);
            const alignment = lengths > 0
              ? (incomingX * outgoingX + incomingY * outgoingY) / lengths
              : 1;
            if (alignment < -0.1) continue;

            const score = distance + (1 - alignment) * 1.8;
            if (!best || score < best.score) {
              best = {
                first: firstIndex,
                second: secondIndex,
                reverseFirst,
                reverseSecond,
                score,
              };
            }
          }
        }
      }
    }

    if (!best) break;
    const first = best.reverseFirst ? [...paths[best.first]].reverse() : paths[best.first];
    const second = best.reverseSecond ? [...paths[best.second]].reverse() : paths[best.second];
    const joined = [...first, ...second];
    paths.splice(best.second, 1);
    paths.splice(best.first, 1, joined);
  }

  return paths;
}

function simplifySourcePath(path: SourcePoint[]): SourcePoint[] {
  if (path.length <= 4) return path;
  const simplified = path.filter((_, index) => index % 2 === 0);
  const last = path[path.length - 1];
  if (simplified[simplified.length - 1] !== last) simplified.push(last);
  return simplified;
}

function offsetSourcePath(path: SourcePoint[], distance: number): SourcePoint[] {
  if (distance === 0) return path;

  return path.map((point, index) => {
    const previous = path[Math.max(0, index - 2)];
    const next = path[Math.min(path.length - 1, index + 2)];
    const tangentX = next.x - previous.x;
    const tangentY = next.y - previous.y;
    const length = Math.hypot(tangentX, tangentY) || 1;
    const lowerBody = clamp((point.y - sourceCenterY - 4) / 38, 0, 1);
    const localDistance = distance * (1 + lowerBody * 0.68);
    return {
      x: point.x - (tangentY / length) * localDistance,
      y: point.y + (tangentX / length) * localDistance,
    };
  });
}

function rebuildGeometry(rawLine: Uint8Array): void {
  if (!sourceMask) return;

  const skeleton = thinLineMask(rawLine);
  const sourcePaths = mergeSourcePaths(traceLinePaths(skeleton))
    .map((path) => simplifySourcePath(smoothSourcePath(path)));
  echoLineGeometry = echoDensityOffsets.map((offsets) => {
    const paths = sourcePaths.flatMap((sourcePath) => offsets.map((offset) => ({
      points: offsetSourcePath(sourcePath, offset).map((point) => makeFigurePoint(point.x, point.y)),
    })));
    return {
      paths,
      samples: paths.flatMap((path) => path.points.filter((_, index) => index % 3 === 0)),
    };
  });
  solidPoints = [];

  for (let y = 0; y < sourceHeight; y += 1) {
    for (let x = 0; x < sourceWidth; x += 1) {
      const centeredX = x - sourceCenterX;
      const centeredY = y - sourceCenterY;
      const seed = hash(x, y);
      const seed2 = hash(y, x, 3);

      if (sourceMask[y * sourceWidth + x] !== 0 && x % 2 === 0 && y % 2 === 0) {
        solidPoints.push({ x: centeredX, y: centeredY, seed, seed2 });
      }
    }
  }
}

function pointPosition(point: FigurePoint, echoIndex: number, time: number): { x: number; y: number; designX: number } {
  const echoPhase = time * 1.45 - echoIndex * 0.19;
  const motion = settings.idleMotion;
  const scaleX = echoXScales[echoIndex];
  const scaleY = echoYScales[echoIndex];
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
  const designY = echoYCenters[echoIndex] + (point.y + rasterWave) * scaleY + verticalJitter;

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
  const offset = settings.rgbOffset * view.fit;
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
  const channelOffset = settings.rgbOffset * view.fit;
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

function channelPosition(
  point: FigurePoint,
  echoIndex: number,
  channelIndex: number,
  now: number,
): { x: number; y: number; designX: number } {
  const position = pointPosition(point, echoIndex, now);
  const offset = settings.rgbOffset * view.fit;
  return {
    x: position.x + channelX[channelIndex] * offset,
    y: position.y + channelY[channelIndex] * offset,
    designX: position.designX,
  };
}

function drawStableLinePaths(echoIndex: number, channelIndex: number, now: number, elapsed: number | null): void {
  const geometry = echoLineGeometry[echoIndex];
  if (!geometry) return;

  artworkCtx.beginPath();

  for (const path of geometry.paths) {
    let drawing = false;
    for (const point of path.points) {
      const position = channelPosition(point, echoIndex, channelIndex, now);
      const remains = elapsed === null || elapsed < spawnTimeFor(position.designX, point, echoIndex);

      if (!remains) {
        drawing = false;
        continue;
      }

      if (drawing) artworkCtx.lineTo(position.x, position.y);
      else artworkCtx.moveTo(position.x, position.y);
      drawing = true;
    }
  }

  artworkCtx.lineCap = 'round';
  artworkCtx.lineJoin = 'round';
  artworkCtx.lineWidth = settings.lineThickness * echoLineWeights[echoIndex] * view.fit;
  artworkCtx.stroke();
}

function renderLineFigures(now: number, elapsed: number): void {
  const echoCount = clamp(Math.round(settings.echoes), 1, echoCenters.length);

  for (let channelIndex = 0; channelIndex < channelColors.length; channelIndex += 1) {
    artworkCtx.strokeStyle = channelColors[channelIndex];
    artworkCtx.fillStyle = channelColors[channelIndex];
    artworkCtx.globalAlpha = 0.84;

    for (let echoIndex = 0; echoIndex < echoCount; echoIndex += 1) {
      drawStableLinePaths(echoIndex, channelIndex, now, phase === 'dissolving' ? elapsed : null);
      if (phase !== 'dissolving') continue;

      const geometry = echoLineGeometry[echoIndex];
      const baseSize = settings.lineThickness * 0.82 * view.fit;
      for (const point of geometry.samples) {
        const currentPosition = pointPosition(point, echoIndex, now);
        const spawnTime = spawnTimeFor(currentPosition.designX, point, echoIndex);
        if (elapsed >= spawnTime) {
          drawParticle(point, echoIndex, channelIndex, spawnTime, elapsed - spawnTime, baseSize);
        }
      }
    }
  }
}

function renderSolidFigures(now: number, elapsed: number): void {
  const baseSize = 2.25 * view.fit;
  const echoCount = clamp(Math.round(settings.echoes), 1, echoCenters.length);

  for (let channelIndex = 0; channelIndex < channelColors.length; channelIndex += 1) {
    artworkCtx.fillStyle = channelColors[channelIndex];
    artworkCtx.globalAlpha = 0.84;

    for (let echoIndex = 0; echoIndex < echoCount; echoIndex += 1) {
      for (const point of solidPoints) {
        if (phase !== 'dissolving') {
          drawStablePoint(point, echoIndex, channelIndex, now, baseSize);
          continue;
        }

        const currentPosition = pointPosition(point, echoIndex, now);
        const spawnTime = spawnTimeFor(currentPosition.designX, point, echoIndex);
        if (elapsed < spawnTime) drawStablePoint(point, echoIndex, channelIndex, now, baseSize);
        else drawParticle(point, echoIndex, channelIndex, spawnTime, elapsed - spawnTime, baseSize);
      }
    }
  }
}

function renderFigures(now: number): void {
  const elapsed = phase === 'dissolving' ? now - triggeredAt : 0;
  artworkCtx.globalCompositeOperation = 'lighter';

  if (settings.figure === 'Lines') renderLineFigures(now, elapsed);
  else renderSolidFigures(now, elapsed);

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
shapeFolder.add(settings, 'lineThickness', 0.8, 3.2, 0.02).name('Line width');

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
  image.src = new URL('./assets/figure-source-start.png', import.meta.url).href;
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
