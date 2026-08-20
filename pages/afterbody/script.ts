import GUI from 'lil-gui';

type FigureMode = 'Lines' | 'Solid';
type InteractionMode = 'Original' | 'NameDrop Wave' | 'Drag Dissolve';
type ContactReleaseStyle = 'Previous · Shockwave' | 'Current · Density';
type ContactGatherStyle = 'Density Pull' | 'Rope Pull';
type Phase = 'idle' | 'gathering' | 'dragging' | 'dissolving' | 'blank';

type FigurePoint = {
  x: number;
  y: number;
  seed: number;
  seed2: number;
  startsPath?: boolean;
  pathIndex?: number;
  pathDistance?: number;
  tangentX?: number;
  tangentY?: number;
};

type LineGraphEdge = {
  pointIndex: number;
  distance: number;
};

type RopeField = {
  anchorPointIndex: number;
  graphDistances: number[];
};

type EchoLineGeometry = {
  path: Path2D;
  points: FigurePoint[];
  samples: FigurePoint[];
  graph: LineGraphEdge[][];
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

type DragParticleState = {
  spawnedAt: number;
  originX: number;
  originY: number;
  velocityX: number;
  velocityY: number;
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
  contactGatherStyle: 'Rope Pull' as ContactGatherStyle,
  contactRopePull: 52,
  contactRopeReach: 74,
  contactRopeSlack: 3.2,
  contactReleaseStyle: 'Current · Density' as ContactReleaseStyle,
  contactBloomDuration: 0.22,
  contactWaveDuration: 2.48,
  contactWaveBandWidth: 52,
  contactWaveBrightness: 0.58,
  contactLineFadeDuration: 0.3,
  contactDiffusionDuration: 1.65,
  contactParticleDensity: 3,
  contactParticleSize: 0.8,
  contactForce: 24,
  contactSpread: 6,
  contactReleaseSpread: 0.025,
  contactReleaseSpeed: 1,
  dragRadius: 18,
  dragConnectorRadius: 4,
  dragConnectorWidth: 0.8,
  dragParticleSize: 0.55,
  dragForce: 48,
  dragSpread: 18,
  dragParticleLife: 1.35,
  dragRestoreDelay: 0.8,
  glow: 0.26,
  scanlines: 0.08,
};

const contactReleasePresets: Record<ContactReleaseStyle, Partial<typeof settings>> = {
  'Previous · Shockwave': {
    contactBloomDuration: 0,
    contactWaveDuration: 1.24,
    contactWaveBandWidth: 22,
    contactWaveBrightness: 1,
    contactLineFadeDuration: 0.3,
    contactDiffusionDuration: 1.65,
    contactParticleDensity: 3,
    contactParticleSize: 0.55,
    contactForce: 100,
    contactSpread: 8,
    contactReleaseSpread: 0.08,
    contactReleaseSpeed: 1.5,
  },
  'Current · Density': {
    contactBloomDuration: 0.22,
    contactWaveDuration: 2.48,
    contactWaveBandWidth: 52,
    contactWaveBrightness: 0.58,
    contactLineFadeDuration: 0.3,
    contactDiffusionDuration: 1.65,
    contactParticleDensity: 3,
    contactParticleSize: 0.8,
    contactForce: 24,
    contactSpread: 6,
    contactReleaseSpread: 0.025,
    contactReleaseSpeed: 1,
  },
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
let releasedGatherElapsed = 0;
let releasedHoldAge = 0;
let contactOrigin: DesignPoint = { x: DESIGN_WIDTH * 0.5, y: DESIGN_HEIGHT * 0.5 };
let contactExtentCache = { x: Number.NaN, y: Number.NaN, value: 1 };
let ropeFieldCache = {
  originX: Number.NaN,
  originY: Number.NaN,
  fields: [] as Array<RopeField | undefined>,
};
let dragPointStates: Array<Array<DragParticleState | null>> = [];
let dragHitCounts: number[] = [];
const dragPointers = new Map<number, DesignPoint>();
let dragEndedAt = 0;
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

function isNameDropWave(): boolean {
  return settings.interaction === 'NameDrop Wave';
}

function isPreviousContactRelease(): boolean {
  return settings.contactReleaseStyle === 'Previous · Shockwave';
}

function isRopePull(): boolean {
  return settings.contactGatherStyle === 'Rope Pull' && settings.figure === 'Lines';
}

function isDragDissolve(): boolean {
  return settings.interaction === 'Drag Dissolve';
}

function contactReleaseTime(): number {
  return settings.contactGatherDuration + settings.contactDensityDuration;
}

function contactWaveExtent(): number {
  if (contactExtentCache.x === contactOrigin.x && contactExtentCache.y === contactOrigin.y) {
    return contactExtentCache.value;
  }
  const value = Math.max(
    Math.hypot(contactOrigin.x, contactOrigin.y),
    Math.hypot(DESIGN_WIDTH - contactOrigin.x, contactOrigin.y),
    Math.hypot(contactOrigin.x, DESIGN_HEIGHT - contactOrigin.y),
    Math.hypot(DESIGN_WIDTH - contactOrigin.x, DESIGN_HEIGHT - contactOrigin.y),
  );
  contactExtentCache = { x: contactOrigin.x, y: contactOrigin.y, value };
  return value;
}

function contactWaveEase(progress: number): number {
  return 1 - Math.pow(1 - clamp(progress, 0, 1), 1.25);
}

function contactWaveEaseInverse(progress: number): number {
  return 1 - Math.pow(1 - clamp(progress, 0, 1), 1 / 1.25);
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

function visualGatherElapsed(now: number): number {
  const releaseTime = contactReleaseTime();
  if (phase === 'gathering') {
    return Math.min(Math.max(0, now - triggeredAt), Math.max(0, releaseTime - 0.0001));
  }
  if (phase !== 'dissolving' || !isNameDropWave()) return 0;

  const releaseAge = Math.max(0, now - releasedAt);
  const settleDuration = clamp(settings.contactBloomDuration * 0.82, 0.1, 0.18);
  const settle = smoothstep(releaseAge / settleDuration);
  return releasedGatherElapsed + (releaseTime - releasedGatherElapsed) * settle;
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

function buildLineGraph(points: FigurePoint[]): LineGraphEdge[][] {
  const graph = points.map(() => [] as LineGraphEdge[]);
  const pathGroups = new Map<number, number[]>();

  for (let pointIndex = 0; pointIndex < points.length; pointIndex += 1) {
    const point = points[pointIndex];
    const pathIndex = point.pathIndex ?? 0;
    const group = pathGroups.get(pathIndex) ?? [];
    group.push(pointIndex);
    pathGroups.set(pathIndex, group);

    if (pointIndex === 0 || points[pointIndex - 1].pathIndex !== pathIndex) continue;
    const previousPoint = points[pointIndex - 1];
    const distance = Math.max(
      0.001,
      Math.hypot(point.x - previousPoint.x, point.y - previousPoint.y) * SVG_TO_DESIGN,
    );
    graph[pointIndex - 1].push({ pointIndex, distance });
    graph[pointIndex].push({ pointIndex: pointIndex - 1, distance });
  }

  const groups = [...pathGroups.entries()];
  if (groups.length <= 1) return graph;

  const mainPath = groups.reduce((longest, candidate) => (
    candidate[1].length > longest[1].length ? candidate : longest
  ));
  const connectedPaths = new Set([mainPath[0]]);

  // The SVG deliberately leaves arms and legs as separate contours. Connect
  // their nearest endpoint to the already connected body only for tension
  // propagation; these virtual joints are never rendered as visible strokes.
  while (connectedPaths.size < groups.length) {
    let closest: {
      pathIndex: number;
      endpointIndex: number;
      targetIndex: number;
      distance: number;
    } | null = null;

    for (const [pathIndex, pointIndices] of groups) {
      if (connectedPaths.has(pathIndex) || pointIndices.length === 0) continue;
      const endpoints = pointIndices.length === 1
        ? pointIndices
        : [pointIndices[0], pointIndices[pointIndices.length - 1]];

      for (const endpointIndex of endpoints) {
        const endpoint = points[endpointIndex];
        for (const [connectedPathIndex, connectedPointIndices] of groups) {
          if (!connectedPaths.has(connectedPathIndex)) continue;
          for (const targetIndex of connectedPointIndices) {
            const target = points[targetIndex];
            const distance = Math.hypot(endpoint.x - target.x, endpoint.y - target.y);
            if (!closest || distance < closest.distance) {
              closest = { pathIndex, endpointIndex, targetIndex, distance };
            }
          }
        }
      }
    }

    if (!closest) break;
    const jointDistance = Math.max(1.5, closest.distance * SVG_TO_DESIGN * 0.72);
    graph[closest.endpointIndex].push({
      pointIndex: closest.targetIndex,
      distance: jointDistance,
    });
    graph[closest.targetIndex].push({
      pointIndex: closest.endpointIndex,
      distance: jointDistance,
    });
    connectedPaths.add(closest.pathIndex);
  }

  return graph;
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
  for (let pathIndex = 0; pathIndex < subpaths.length; pathIndex += 1) {
    const subpathData = subpaths[pathIndex];
    measurementPath.setAttribute('d', subpathData);
    const length = measurementPath.getTotalLength();

    for (let distance = 0; distance < length; distance += SVG_SAMPLE_STEP) {
      const point = measurementPath.getPointAtLength(distance);
      const tangentStart = measurementPath.getPointAtLength(Math.max(0, distance - SVG_SAMPLE_STEP));
      const tangentEnd = measurementPath.getPointAtLength(Math.min(length, distance + SVG_SAMPLE_STEP));
      const tangentLength = Math.max(
        0.001,
        Math.hypot(tangentEnd.x - tangentStart.x, tangentEnd.y - tangentStart.y),
      );
      points.push({
        x: point.x - centerX,
        y: point.y - centerY,
        seed: hash(point.x, point.y, echoIndex),
        seed2: hash(point.y, point.x, echoIndex + 7),
        startsPath: distance === 0,
        pathIndex,
        pathDistance: distance,
        tangentX: (tangentEnd.x - tangentStart.x) / tangentLength,
        tangentY: (tangentEnd.y - tangentStart.y) / tangentLength,
      });
    }

    const finalPoint = measurementPath.getPointAtLength(length);
    const finalTangentStart = measurementPath.getPointAtLength(Math.max(0, length - SVG_SAMPLE_STEP));
    const finalTangentLength = Math.max(
      0.001,
      Math.hypot(finalPoint.x - finalTangentStart.x, finalPoint.y - finalTangentStart.y),
    );
    points.push({
      x: finalPoint.x - centerX,
      y: finalPoint.y - centerY,
      seed: hash(finalPoint.x, finalPoint.y, echoIndex),
      seed2: hash(finalPoint.y, finalPoint.x, echoIndex + 7),
      startsPath: length === 0,
      pathIndex,
      pathDistance: length,
      tangentX: (finalPoint.x - finalTangentStart.x) / finalTangentLength,
      tangentY: (finalPoint.y - finalTangentStart.y) / finalTangentLength,
    });
  }
  measurementSvg.remove();

  return {
    path: new Path2D(pathData),
    points,
    samples: points.filter((_, index) => index % 3 === 0),
    graph: buildLineGraph(points),
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

function clearDragState(): void {
  dragPointStates = echoLineGeometry.map((geometry) => (
    Array.from<DragParticleState | null>({ length: geometry.points.length }).fill(null)
  ));
  dragHitCounts = echoLineGeometry.map(() => 0);
  dragPointers.clear();
  dragEndedAt = 0;
}

function ensureDragState(): void {
  const stateMatchesGeometry = dragPointStates.length === echoLineGeometry.length
    && dragPointStates.every((states, echoIndex) => (
      states.length === echoLineGeometry[echoIndex].points.length
    ));
  if (!stateMatchesGeometry) clearDragState();
}

function distanceSquaredToSegment(
  pointX: number,
  pointY: number,
  start: DesignPoint,
  end: DesignPoint,
): number {
  const segmentX = end.x - start.x;
  const segmentY = end.y - start.y;
  const lengthSquared = segmentX * segmentX + segmentY * segmentY;
  if (lengthSquared <= 0.0001) {
    const deltaX = pointX - start.x;
    const deltaY = pointY - start.y;
    return deltaX * deltaX + deltaY * deltaY;
  }

  const projection = clamp(
    ((pointX - start.x) * segmentX + (pointY - start.y) * segmentY) / lengthSquared,
    0,
    1,
  );
  const nearestX = start.x + segmentX * projection;
  const nearestY = start.y + segmentY * projection;
  const deltaX = pointX - nearestX;
  const deltaY = pointY - nearestY;
  return deltaX * deltaX + deltaY * deltaY;
}

function applyDragStroke(
  start: DesignPoint,
  end: DesignPoint,
  now: number,
  radius = settings.dragRadius,
): void {
  ensureDragState();
  const segmentX = end.x - start.x;
  const segmentY = end.y - start.y;
  const segmentLength = Math.hypot(segmentX, segmentY);
  const directionX = segmentLength > 0.001 ? segmentX / segmentLength : 1;
  const directionY = segmentLength > 0.001 ? segmentY / segmentLength : 0;
  const normalX = -directionY;
  const normalY = directionX;
  const radiusSquared = radius * radius;
  const echoCount = clamp(Math.round(settings.echoes), 1, echoLineGeometry.length);

  for (let echoIndex = 0; echoIndex < echoCount; echoIndex += 1) {
    const geometry = echoLineGeometry[echoIndex];
    const states = dragPointStates[echoIndex];

    for (let pointIndex = 0; pointIndex < geometry.points.length; pointIndex += 1) {
      if (states[pointIndex]) continue;
      const point = geometry.points[pointIndex];
      const position = linePointPosition(point, echoIndex, now);
      if (distanceSquaredToSegment(position.designX, position.designY, start, end) > radiusSquared) {
        continue;
      }

      const forwardSpeed = settings.dragForce * (0.62 + point.seed * 0.76);
      const sideSpeed = (point.seed2 - 0.5) * settings.dragSpread;
      states[pointIndex] = {
        spawnedAt: now,
        originX: position.designX,
        originY: position.designY,
        velocityX: directionX * forwardSpeed + normalX * sideSpeed,
        velocityY: directionY * forwardSpeed + normalY * sideSpeed,
      };
      dragHitCounts[echoIndex] += 1;
    }
  }
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

function contactTensionPulse(echoIndex: number): number {
  const holdAge = phase === 'gathering'
    ? Math.max(0, lastNow - triggeredAt - contactReleaseTime())
    : phase === 'dissolving'
      ? releasedHoldAge
      : 0;
  if (holdAge <= 0) return 1;

  const releaseDecay = phase === 'dissolving'
    ? 1 - smoothstep((lastNow - releasedAt) / 0.16)
    : 1;
  return 1
    + Math.sin(holdAge * 4.4 + echoIndex * 0.72) * 0.025 * releaseDecay;
}

function ropeFieldFor(echoIndex: number): RopeField | null {
  const cacheExpired = ropeFieldCache.originX !== contactOrigin.x
    || ropeFieldCache.originY !== contactOrigin.y;
  if (cacheExpired) {
    ropeFieldCache = {
      originX: contactOrigin.x,
      originY: contactOrigin.y,
      fields: [],
    };
  }

  const cached = ropeFieldCache.fields[echoIndex];
  if (cached) return cached;

  const geometry = echoLineGeometry[echoIndex];
  if (!geometry || geometry.points.length === 0) return null;

  let anchorPointIndex = 0;
  let distanceToContact = Number.POSITIVE_INFINITY;
  for (let pointIndex = 0; pointIndex < geometry.points.length; pointIndex += 1) {
    const point = geometry.points[pointIndex];
    const position = linePointPosition(point, echoIndex, lastNow);
    const distance = Math.hypot(
      contactOrigin.x - position.designX,
      contactOrigin.y - position.designY,
    );
    if (distance >= distanceToContact) continue;
    anchorPointIndex = pointIndex;
    distanceToContact = distance;
  }

  const graphDistances = Array.from<number>({ length: geometry.points.length }).fill(
    Number.POSITIVE_INFINITY,
  );
  graphDistances[anchorPointIndex] = 0;
  const stack = [anchorPointIndex];
  while (stack.length > 0) {
    const pointIndex = stack.pop();
    if (pointIndex === undefined) break;
    for (const edge of geometry.graph[pointIndex]) {
      const distance = graphDistances[pointIndex] + edge.distance;
      if (distance >= graphDistances[edge.pointIndex]) continue;
      graphDistances[edge.pointIndex] = distance;
      stack.push(edge.pointIndex);
    }
  }

  const field = { anchorPointIndex, graphDistances };
  ropeFieldCache.fields[echoIndex] = field;
  return field;
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
  const localTension = 0.22 + proximity * proximity * 1.78;
  const pull = settings.contactCompression
    * progress
    * localTension
    * contactTensionPulse(echoIndex);
  const designX = position.designX + deltaX * pull;
  const designY = position.designY + deltaY * pull;

  return {
    x: view.offsetX + designX * view.fit,
    y: view.offsetY + designY * view.fit,
    designX,
    designY,
  };
}

function gatheredLinePosition(
  point: FigurePoint,
  pointIndex: number,
  echoIndex: number,
  time: number,
  elapsed: number,
  basePosition = linePointPosition(point, echoIndex, time),
): PositionedPoint {
  if (!isRopePull()) return gatheredPosition(basePosition, echoIndex, elapsed);

  const gather = contactGatherProgress(elapsed);
  const density = contactDensityProgress(elapsed);
  if (gather <= 0 && density <= 0) return basePosition;

  const geometry = echoLineGeometry[echoIndex];
  const field = ropeFieldFor(echoIndex);
  if (!geometry || !field) return basePosition;

  const ropeReach = Math.max(1, settings.contactRopeReach);
  const graphDistance = field.graphDistances[pointIndex] ?? Number.POSITIVE_INFINITY;
  const frontDistance = 8 + gather * ropeReach * 1.72 + density * ropeReach * 0.48;
  const propagation = smoothstep(
    (frontDistance - graphDistance + ropeReach * 0.16) / (ropeReach * 0.32),
  );
  const falloff = Math.exp(-graphDistance / ropeReach);
  const influence = propagation * falloff;
  if (influence <= 0.0001) return basePosition;

  const anchorPoint = geometry.points[field.anchorPointIndex];
  const anchorPosition = linePointPosition(anchorPoint, echoIndex, time);
  const deltaX = contactOrigin.x - anchorPosition.designX;
  const deltaY = contactOrigin.y - anchorPosition.designY;
  const anchorDistance = Math.max(0.001, Math.hypot(deltaX, deltaY));
  const directionX = deltaX / anchorDistance;
  const directionY = deltaY / anchorDistance;
  const proximity = 0.3
    + smoothstep(1 - anchorDistance / (DESIGN_WIDTH * 0.62)) * 0.7;
  const tension = gather * 0.76 + density * 0.24;
  const pullDistance = Math.min(anchorDistance * 0.78, settings.contactRopePull)
    * tension
    * influence
    * proximity
    * contactTensionPulse(echoIndex);

  const tangentX = point.tangentX ?? 1;
  const tangentY = point.tangentY ?? 0;
  const normalX = -tangentY;
  const normalY = tangentX;
  const holdAge = phase === 'gathering'
    ? Math.max(0, lastNow - triggeredAt - contactReleaseTime())
    : releasedHoldAge;
  const ropePhase = elapsed * 7.5 + holdAge * 2.4;
  const slack = Math.sin(
    graphDistance * 0.11 - ropePhase + point.seed * 2.2,
  )
    * settings.contactRopeSlack
    * gather
    * (1 - density * 0.78)
    * influence
    * (1 - influence * 0.28);

  const designX = basePosition.designX + directionX * pullDistance + normalX * slack;
  const designY = basePosition.designY + directionY * pullDistance + normalY * slack;
  return {
    x: view.offsetX + designX * view.fit,
    y: view.offsetY + designY * view.fit,
    designX,
    designY,
  };
}

function spawnReferencePosition(
  position: PositionedPoint,
  echoIndex: number,
): PositionedPoint {
  if (!isNameDropWave() || isPreviousContactRelease()) return position;
  return gatheredPosition(position, echoIndex, contactReleaseTime());
}

function lineSpawnReferencePosition(
  point: FigurePoint,
  pointIndex: number,
  echoIndex: number,
  time: number,
  position = linePointPosition(point, echoIndex, time),
): PositionedPoint {
  if (!isNameDropWave() || isPreviousContactRelease()) return position;
  return gatheredLinePosition(
    point,
    pointIndex,
    echoIndex,
    time,
    contactReleaseTime(),
    position,
  );
}

function spawnTimeFor(designX: number, designY: number, point: FigurePoint, echoIndex: number): number {
  if (isNameDropWave()) {
    const distance = Math.hypot(designX - contactOrigin.x, designY - contactOrigin.y);
    const shuffledRelease = hash(point.x, point.y, echoIndex + 31) * settings.contactReleaseSpread;
    if (isPreviousContactRelease()) {
      const waveDelay = clamp(distance / (DESIGN_WIDTH * 0.72), 0, 1)
        * settings.contactWaveDuration;
      return contactReleaseTime() + waveDelay + shuffledRelease;
    }
    const distanceProgress = clamp(distance / Math.max(1, contactWaveExtent()), 0, 1);
    const waveDelay = contactWaveEaseInverse(distanceProgress) * settings.contactWaveDuration;
    return contactReleaseTime() + settings.contactBloomDuration + waveDelay + shuffledRelease;
  }

  const xProgress = clamp(designX / DESIGN_WIDTH, 0, 1);
  const jitter = (hash(point.x, point.y, echoIndex) - 0.5) * settings.sweepJitter;
  return settings.hold + xProgress * settings.sweepDuration + jitter;
}

function drawParticle(
  point: FigurePoint,
  pointIndex: number,
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
    ? lineMode
      ? gatheredLinePosition(
        point,
        pointIndex,
        echoIndex,
        originTime,
        contactReleaseTime(),
        baseOrigin,
      )
      : gatheredPosition(baseOrigin, echoIndex, contactReleaseTime())
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
    if (isPreviousContactRelease()) {
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
      const diffusionLife = Math.max(0.05, settings.contactDiffusionDuration);
      const diffusion = smoothstep(particleAge / diffusionLife);
      const release = smoothstep((particleAge - 0.08) / (diffusionLife * 0.82));
      const compressionPulse = Math.sin(
        Math.PI * clamp(particleAge / Math.max(0.08, settings.contactBloomDuration), 0, 1),
      );
      const maximumTravel = settings.contactForce * (0.68 + channelSeed * 0.46) * view.fit;
      const sidewaysTravel = (point.seed2 - 0.5)
        * settings.contactSpread
        * Math.sin(diffusion * Math.PI)
        * view.fit;
      const turbulence = Math.sin(diffusion * (5.2 + point.seed * 2.8) + point.seed2 * 19)
        * settings.turbulence
        * Math.sin(diffusion * Math.PI)
        * view.fit;
      const inwardTravel = compressionPulse
        * Math.min(4.5, settings.contactForce * 0.18)
        * view.fit;
      const outwardTravel = maximumTravel * release;

      x = origin.x
        + channelX[channelIndex] * channelOffset
        + directionX * (outwardTravel - inwardTravel)
        + tangentX * (sidewaysTravel + turbulence * 0.22);
      y = origin.y
        + channelY[channelIndex] * channelOffset
        + directionY * (outwardTravel - inwardTravel)
        + tangentY * (sidewaysTravel + turbulence * 0.22);
    }
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

  const useDensityParticle = isNameDropWave() && !isPreviousContactRelease();
  const life = useDensityParticle
    ? settings.contactDiffusionDuration * (0.82 + point.seed * 0.32)
    : settings.particleLife * (0.72 + point.seed * 0.48);
  const alpha = Math.pow(clamp(1 - particleAge / life, 0, 1), useDensityParticle ? 1.65 : 1.3)
    * (useDensityParticle ? 0.44 + point.seed * 0.46 : 0.48 + point.seed * 0.52);
  const interactionSize = isNameDropWave() ? settings.contactParticleSize : 1;
  const size = baseSize
    * (0.7 + channelSeed * 0.85)
    * settings.particleSize
    * interactionSize;
  const minimumSize = isNameDropWave() ? 0.3 : 0.65;

  if (alpha <= 0.01 || x < -8 || x > view.width + 8 || y < -8 || y > view.height + 8) return;

  artworkCtx.globalAlpha = alpha;
  if (useDensityParticle) {
    const pixelSize = Math.max(minimumSize, size * 1.05);
    artworkCtx.fillRect(
      x - pixelSize * 0.5,
      y - pixelSize * 0.5,
      pixelSize,
      pixelSize,
    );
  } else {
    artworkCtx.fillRect(
      x,
      y,
      Math.max(minimumSize, size),
      Math.max(minimumSize, size * (0.72 + point.seed2 * 0.55)),
    );
  }
}

function drawDragParticle(
  point: FigurePoint,
  state: DragParticleState,
  channelIndex: number,
  now: number,
  baseSize: number,
): void {
  const age = Math.max(0, now - state.spawnedAt);
  const life = settings.dragParticleLife * (0.72 + point.seed * 0.48);
  const alpha = Math.pow(clamp(1 - age / life, 0, 1), 1.45)
    * (0.5 + point.seed * 0.5);
  if (alpha <= 0.01) return;

  const channelSeed = hash(point.x, point.y, channelIndex + 19);
  const offset = settings.rgbOffset * view.fit;
  const curl = Math.sin(age * (5.2 + point.seed * 4.4) + point.seed2 * 17)
    * settings.turbulence
    * age;
  const velocityLength = Math.max(0.001, Math.hypot(state.velocityX, state.velocityY));
  const normalX = -state.velocityY / velocityLength;
  const normalY = state.velocityX / velocityLength;
  const travelX = state.originX + state.velocityX * age + normalX * curl;
  const travelY = state.originY + state.velocityY * age + normalY * curl;
  const x = view.offsetX + travelX * view.fit + channelX[channelIndex] * offset;
  const y = view.offsetY + travelY * view.fit + channelY[channelIndex] * offset;
  const size = baseSize
    * (0.68 + channelSeed * 0.72)
    * settings.particleSize
    * settings.dragParticleSize;

  if (x < -8 || x > view.width + 8 || y < -8 || y > view.height + 8) return;

  artworkCtx.globalAlpha = alpha;
  artworkCtx.fillRect(
    x,
    y,
    Math.max(0.3, size),
    Math.max(0.3, size * (0.75 + point.seed2 * 0.45)),
  );
}

function drawDragDissolvingLinePath(
  echoIndex: number,
  channelIndex: number,
  now: number,
): void {
  const geometry = echoLineGeometry[echoIndex];
  const states = dragPointStates[echoIndex];
  if (!geometry || !states) return;

  artworkCtx.beginPath();
  let drawing = false;

  for (let pointIndex = 0; pointIndex < geometry.points.length; pointIndex += 1) {
    const point = geometry.points[pointIndex];
    if (point.startsPath || states[pointIndex]) drawing = false;
    if (states[pointIndex]) continue;

    const position = linePointPosition(point, echoIndex, now);
    const offset = settings.rgbOffset * view.fit;
    const x = position.x + channelX[channelIndex] * offset;
    const y = position.y + channelY[channelIndex] * offset;
    if (drawing) artworkCtx.lineTo(x, y);
    else artworkCtx.moveTo(x, y);
    drawing = true;
  }

  artworkCtx.lineCap = 'round';
  artworkCtx.lineJoin = 'round';
  artworkCtx.lineWidth = geometry.strokeWidth * SVG_TO_DESIGN * settings.lineThickness * view.fit;
  artworkCtx.stroke();
}

function dragConnectorPoints(): [DesignPoint, DesignPoint] | null {
  if (dragPointers.size < 2) return null;
  const iterator = dragPointers.values();
  const first = iterator.next().value as DesignPoint | undefined;
  const second = iterator.next().value as DesignPoint | undefined;
  return first && second ? [first, second] : null;
}

function renderDragConnector(): void {
  if (phase !== 'dragging' || !isDragDissolve()) return;
  const connector = dragConnectorPoints();
  if (!connector) return;
  const [start, end] = connector;

  artworkCtx.save();
  artworkCtx.globalCompositeOperation = 'lighter';
  artworkCtx.lineCap = 'round';
  artworkCtx.lineWidth = Math.max(0.35, settings.dragConnectorWidth * view.fit);
  artworkCtx.globalAlpha = 0.68;

  for (let channelIndex = 0; channelIndex < channelColors.length; channelIndex += 1) {
    const offsetX = channelX[channelIndex] * settings.rgbOffset * view.fit;
    const offsetY = channelY[channelIndex] * settings.rgbOffset * view.fit;
    artworkCtx.beginPath();
    artworkCtx.moveTo(
      view.offsetX + start.x * view.fit + offsetX,
      view.offsetY + start.y * view.fit + offsetY,
    );
    artworkCtx.lineTo(
      view.offsetX + end.x * view.fit + offsetX,
      view.offsetY + end.y * view.fit + offsetY,
    );
    artworkCtx.strokeStyle = channelColors[channelIndex];
    artworkCtx.stroke();
  }

  artworkCtx.restore();
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
  const gatherElapsed = isNameDropWave() ? visualGatherElapsed(now) : elapsed;

  if (isNameDropWave() && !isPreviousContactRelease()) {
    const bucketCount = 6;
    const opacityBuckets = Array.from({ length: bucketCount }, () => new Path2D());
    const fadeDuration = Math.max(0.01, settings.contactLineFadeDuration);
    const channelOffset = settings.rgbOffset * view.fit;
    let previousPosition: PositionedPoint | null = null;
    let previousOpacity = 0;

    for (let pointIndex = 0; pointIndex < geometry.points.length; pointIndex += 1) {
      const point = geometry.points[pointIndex];
      if (point.startsPath) previousPosition = null;
      const basePosition = linePointPosition(point, echoIndex, now);
      const spawnPosition = lineSpawnReferencePosition(
        point,
        pointIndex,
        echoIndex,
        now,
        basePosition,
      );
      const spawnTime = spawnTimeFor(
        spawnPosition.designX,
        spawnPosition.designY,
        point,
        echoIndex,
      );
      const fadeStart = spawnTime - fadeDuration * 0.22;
      const opacity = 1 - smoothstep((elapsed - fadeStart) / fadeDuration);
      const position = gatheredLinePosition(
        point,
        pointIndex,
        echoIndex,
        now,
        gatherElapsed,
        basePosition,
      );
      const channelPosition = {
        ...position,
        x: position.x + channelX[channelIndex] * channelOffset,
        y: position.y + channelY[channelIndex] * channelOffset,
      };

      if (previousPosition) {
        const segmentOpacity = (previousOpacity + opacity) * 0.5;
        if (segmentOpacity > 0.01) {
          const bucketIndex = Math.min(
            bucketCount - 1,
            Math.floor(segmentOpacity * bucketCount),
          );
          const bucket = opacityBuckets[bucketIndex];
          bucket.moveTo(previousPosition.x, previousPosition.y);
          bucket.lineTo(channelPosition.x, channelPosition.y);
        }
      }

      previousPosition = channelPosition;
      previousOpacity = opacity;
    }

    artworkCtx.save();
    artworkCtx.lineCap = 'round';
    artworkCtx.lineJoin = 'round';
    artworkCtx.lineWidth = geometry.strokeWidth * SVG_TO_DESIGN * settings.lineThickness * view.fit;
    for (let bucketIndex = 0; bucketIndex < bucketCount; bucketIndex += 1) {
      artworkCtx.globalAlpha = 0.84 * ((bucketIndex + 1) / bucketCount);
      artworkCtx.stroke(opacityBuckets[bucketIndex]);
    }
    artworkCtx.restore();
    return;
  }

  artworkCtx.beginPath();
  let drawing = false;

  for (let pointIndex = 0; pointIndex < geometry.points.length; pointIndex += 1) {
    const point = geometry.points[pointIndex];
    if (point.startsPath) drawing = false;
    const basePosition = linePointPosition(point, echoIndex, now);
    const spawnPosition = lineSpawnReferencePosition(
      point,
      pointIndex,
      echoIndex,
      now,
      basePosition,
    );
    const remains = elapsed < spawnTimeFor(
      spawnPosition.designX,
      spawnPosition.designY,
      point,
      echoIndex,
    );

    if (!remains) {
      drawing = false;
      continue;
    }

    const position = gatheredLinePosition(
      point,
      pointIndex,
      echoIndex,
      now,
      gatherElapsed,
      basePosition,
    );
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
      artworkCtx.globalAlpha = 0.84;
      if (isDragDissolve() && phase === 'dragging') {
        ensureDragState();
        if (dragHitCounts[echoIndex] > 0) {
          drawDragDissolvingLinePath(echoIndex, channelIndex, now);
        } else {
          drawExactLinePath(echoIndex, channelIndex, now);
        }

        const geometry = echoLineGeometry[echoIndex];
        const states = dragPointStates[echoIndex];
        const baseSize = geometry.strokeWidth * SVG_TO_DESIGN * 0.68 * view.fit;
        for (let pointIndex = 0; pointIndex < geometry.points.length; pointIndex += 1) {
          const state = states[pointIndex];
          if (!state) continue;
          drawDragParticle(geometry.points[pointIndex], state, channelIndex, now, baseSize);
        }
        continue;
      }

      if (phase === 'idle') {
        drawExactLinePath(echoIndex, channelIndex, now);
        continue;
      }

      drawDissolvingLinePath(echoIndex, channelIndex, now, elapsed);
      const geometry = echoLineGeometry[echoIndex];
      const baseSize = geometry.strokeWidth * SVG_TO_DESIGN * 0.68 * view.fit;
      const particlePoints = isNameDropWave() ? geometry.points : geometry.samples;
      const sampleInterval = isNameDropWave()
        ? 3 / clamp(settings.contactParticleDensity, 0.5, 3)
        : 1;
      let nextSampleIndex = 0;

      for (let pointIndex = 0; pointIndex < particlePoints.length; pointIndex += 1) {
        if (pointIndex + 0.0001 < nextSampleIndex) continue;
        nextSampleIndex += sampleInterval;
        const point = particlePoints[pointIndex];
        const currentPosition = linePointPosition(point, echoIndex, now);
        const spawnPosition = lineSpawnReferencePosition(
          point,
          pointIndex,
          echoIndex,
          now,
          currentPosition,
        );
        const spawnTime = spawnTimeFor(
          spawnPosition.designX,
          spawnPosition.designY,
          point,
          echoIndex,
        );
        if (elapsed >= spawnTime) {
          drawParticle(
            point,
            pointIndex,
            echoIndex,
            channelIndex,
            spawnTime,
            elapsed - spawnTime,
            baseSize,
            true,
          );
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
  const gatherElapsed = isNameDropWave() ? visualGatherElapsed(now) : elapsed;

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
        const spawnPosition = spawnReferencePosition(currentPosition, echoIndex);
        const spawnTime = spawnTimeFor(
          spawnPosition.designX,
          spawnPosition.designY,
          point,
          echoIndex,
        );
        if (elapsed < spawnTime) {
          drawStableSolidPoint(point, echoIndex, channelIndex, now, baseSize, gatherElapsed);
        }
        else {
          drawParticle(
            point,
            -1,
            echoIndex,
            channelIndex,
            spawnTime,
            elapsed - spawnTime,
            baseSize,
            false,
          );
        }
      }
    }
  }
}

function renderFigures(now: number): void {
  const elapsed = motionElapsed(now);
  artworkCtx.globalCompositeOperation = 'lighter';

  if (settings.figure === 'Lines' || isDragDissolve()) renderLineFigures(now, elapsed);
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

  if (isPreviousContactRelease()) {
    const waveDuration = Math.max(0.001, settings.contactWaveDuration);
    const waveProgress = clamp(releaseAge / waveDuration, 0, 1);
    const fadeProgress = smoothstep(
      (releaseAge - waveDuration * 0.82) / (waveDuration * 0.32),
    );
    const waveRadius = Math.max(1, waveProgress * DESIGN_WIDTH * 0.72 * view.fit);
    const bandWidth = Math.max(1, settings.contactWaveBandWidth * view.fit);
    const alpha = smoothstep(releaseAge / 0.1) * (1 - fadeProgress) * 0.24;

    artworkCtx.save();
    artworkCtx.globalCompositeOperation = 'lighter';

    const drawPreviousWaveBand = (radius: number, width: number, opacity: number): void => {
      if (radius <= 0 || opacity <= 0) return;
      const innerRadius = Math.max(0, radius - width);
      const outerRadius = radius + width * 0.42;
      const gradient = artworkCtx.createRadialGradient(
        centerX,
        centerY,
        innerRadius,
        centerX,
        centerY,
        outerRadius,
      );
      gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
      gradient.addColorStop(0.32, 'rgba(98, 171, 216, 0.18)');
      gradient.addColorStop(0.68, 'rgba(194, 231, 246, 0.52)');
      gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
      artworkCtx.globalAlpha = opacity;
      artworkCtx.fillStyle = gradient;
      artworkCtx.fillRect(
        centerX - outerRadius,
        centerY - outerRadius,
        outerRadius * 2,
        outerRadius * 2,
      );
    };

    drawPreviousWaveBand(waveRadius - bandWidth * 1.15, bandWidth * 0.72, alpha * 0.34);
    drawPreviousWaveBand(waveRadius, bandWidth, alpha);
    artworkCtx.restore();
    return;
  }

  const waveAge = releaseAge - settings.contactBloomDuration;
  const waveDuration = Math.max(0.001, settings.contactWaveDuration);
  const waveProgress = clamp(waveAge / waveDuration, 0, 1);
  const fadeProgress = smoothstep(
    (waveAge - waveDuration * 0.78) / (waveDuration * 0.38),
  );
  const waveRadius = Math.max(
    1,
    contactWaveEase(waveProgress) * contactWaveExtent() * view.fit,
  );
  const bandWidth = Math.max(
    1,
    settings.contactWaveBandWidth * (0.82 + waveProgress * 0.36) * view.fit,
  );
  const alpha = smoothstep(waveAge / 0.14)
    * (1 - fadeProgress)
    * settings.contactWaveBrightness;
  const bloomProgress = smoothstep(
    releaseAge / Math.max(0.01, settings.contactBloomDuration),
  );
  const bloomFade = 1 - smoothstep(
    (releaseAge - settings.contactBloomDuration * 0.55)
    / Math.max(0.01, settings.contactBloomDuration * 1.8),
  );

  artworkCtx.save();
  artworkCtx.globalCompositeOperation = 'screen';
  artworkCtx.filter = `blur(${Math.max(1.2, 2.6 * view.fit)}px)`;

  if (releaseAge >= 0 && bloomFade > 0) {
    const bloomRadius = (12 + bloomProgress * 32) * view.fit;
    const bloom = artworkCtx.createRadialGradient(
      centerX,
      centerY,
      0,
      centerX,
      centerY,
      bloomRadius,
    );
    bloom.addColorStop(0, 'rgba(132, 202, 226, 0.14)');
    bloom.addColorStop(0.42, 'rgba(76, 142, 176, 0.08)');
    bloom.addColorStop(1, 'rgba(0, 0, 0, 0)');
    artworkCtx.globalAlpha = bloomFade * 0.72;
    artworkCtx.fillStyle = bloom;
    artworkCtx.fillRect(
      centerX - bloomRadius,
      centerY - bloomRadius,
      bloomRadius * 2,
      bloomRadius * 2,
    );
  }

  const drawWaveBand = (radius: number, width: number, opacity: number): void => {
    if (radius <= 0 || opacity <= 0) return;
    const innerRadius = Math.max(0, radius - width * 1.45);
    const outerRadius = radius + width * 0.38;
    const gradient = artworkCtx.createRadialGradient(
      centerX,
      centerY,
      innerRadius,
      centerX,
      centerY,
      outerRadius,
    );
    gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
    gradient.addColorStop(0.22, 'rgba(85, 126, 148, 0.055)');
    gradient.addColorStop(0.5, 'rgba(158, 193, 208, 0.18)');
    gradient.addColorStop(0.74, 'rgba(119, 165, 187, 0.1)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    artworkCtx.globalAlpha = opacity;
    artworkCtx.fillStyle = gradient;
    artworkCtx.fillRect(
      centerX - outerRadius,
      centerY - outerRadius,
      outerRadius * 2,
      outerRadius * 2,
    );
  };

  const drawWaveCrest = (radius: number, width: number, opacity: number): void => {
    if (radius <= 0 || opacity <= 0) return;
    const innerRadius = Math.max(0, radius - width * 0.86);
    const outerRadius = radius + width * 0.22;
    const gradient = artworkCtx.createRadialGradient(
      centerX,
      centerY,
      innerRadius,
      centerX,
      centerY,
      outerRadius,
    );
    gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
    gradient.addColorStop(0.42, 'rgba(178, 211, 224, 0.09)');
    gradient.addColorStop(0.67, 'rgba(229, 242, 247, 0.24)');
    gradient.addColorStop(0.8, 'rgba(240, 248, 251, 0.32)');
    gradient.addColorStop(0.9, 'rgba(204, 227, 236, 0.15)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    artworkCtx.globalAlpha = opacity;
    artworkCtx.fillStyle = gradient;
    artworkCtx.fillRect(
      centerX - outerRadius,
      centerY - outerRadius,
      outerRadius * 2,
      outerRadius * 2,
    );
  };

  drawWaveBand(waveRadius - bandWidth * 0.7, bandWidth * 1.34, alpha * 0.36);
  drawWaveBand(waveRadius, bandWidth, alpha * 0.62);
  artworkCtx.filter = `blur(${Math.max(1, 1.55 * view.fit)}px)`;
  drawWaveCrest(waveRadius, bandWidth, alpha * 0.86);

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
    if (!isPreviousContactRelease()) renderContactEffect(now);
    renderFigures(now);
    renderDragConnector();
    if (isPreviousContactRelease()) renderContactEffect(now);
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

  if (
    phase === 'dragging'
    && isDragDissolve()
    && dragPointers.size === 0
    && dragEndedAt > 0
    && now - dragEndedAt > settings.dragRestoreDelay + settings.dragParticleLife * 1.2
  ) {
    reset();
  }

  if (phase === 'dissolving') {
    const contactDuration = isPreviousContactRelease()
      ? settings.contactWaveDuration
        + settings.contactReleaseSpread
        + settings.particleLife / settings.contactReleaseSpeed
        + 0.8
      : settings.contactBloomDuration
        + settings.contactWaveDuration
        + settings.contactReleaseSpread
        + settings.contactDiffusionDuration / settings.contactReleaseSpeed
        + 0.65;
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
  ropeFieldCache.originX = Number.NaN;
  phase = 'gathering';
  triggeredAt = lastNow || performance.now() * 0.001;
  releasedAt = 0;
  releasedGatherElapsed = 0;
  releasedHoldAge = 0;
  hint.textContent = 'RELEASE TO BURST';
  hint.classList.remove('hidden');
  canvas.focus({ preventScroll: true });
}

function releaseGather(): void {
  if (phase !== 'gathering') return;
  const now = lastNow || performance.now() * 0.001;
  releasedGatherElapsed = Math.min(
    Math.max(0, now - triggeredAt),
    contactReleaseTime(),
  );
  releasedHoldAge = Math.max(0, now - triggeredAt - contactReleaseTime());
  phase = 'dissolving';
  releasedAt = now;
  hint.classList.add('hidden');
}

function beginDragDissolve(pointerId: number, point: DesignPoint): boolean {
  if (phase === 'gathering' || phase === 'dissolving') return false;
  if (dragPointers.size >= 2) return false;
  if (phase === 'blank') reset();
  if (phase !== 'dragging') {
    clearDragState();
    phase = 'dragging';
  }

  const now = lastNow || performance.now() * 0.001;
  dragEndedAt = 0;
  const joiningConnector = dragPointers.size === 1;
  dragPointers.set(pointerId, point);
  if (!joiningConnector) applyDragStroke(point, point, now);
  const connector = dragConnectorPoints();
  if (connector) {
    applyDragStroke(connector[0], connector[1], now, settings.dragConnectorRadius);
  }
  hint.classList.add('hidden');
  canvas.focus({ preventScroll: true });
  return true;
}

function moveDragDissolve(pointerId: number, point: DesignPoint): void {
  if (phase !== 'dragging') return;
  const previousPoint = dragPointers.get(pointerId);
  if (!previousPoint) return;
  const now = lastNow || performance.now() * 0.001;

  const entries = [...dragPointers.entries()];
  const movedIndex = entries.findIndex(([id]) => id === pointerId);
  const otherIndex = movedIndex === 0 ? 1 : 0;
  const otherPoint = entries[otherIndex]?.[1];
  if (otherPoint) {
    const travel = Math.hypot(point.x - previousPoint.x, point.y - previousPoint.y);
    const interpolationStep = Math.max(1.5, settings.dragConnectorRadius * 0.5);
    const steps = Math.max(1, Math.ceil(travel / interpolationStep));
    for (let step = 1; step <= steps; step += 1) {
      const progress = step / steps;
      const interpolated = {
        x: previousPoint.x + (point.x - previousPoint.x) * progress,
        y: previousPoint.y + (point.y - previousPoint.y) * progress,
      };
      const connectorStart = movedIndex === 0 ? interpolated : otherPoint;
      const connectorEnd = movedIndex === 0 ? otherPoint : interpolated;
      applyDragStroke(
        connectorStart,
        connectorEnd,
        now,
        settings.dragConnectorRadius,
      );
    }
  } else {
    applyDragStroke(previousPoint, point, now);
  }

  dragPointers.set(pointerId, point);
}

function endDragDissolve(pointerId: number, point?: DesignPoint): void {
  if (phase !== 'dragging') return;
  if (!dragPointers.has(pointerId)) return;
  if (point) moveDragDissolve(pointerId, point);
  dragPointers.delete(pointerId);
  if (dragPointers.size === 0) {
    dragEndedAt = lastNow || performance.now() * 0.001;
  }
}

function reset(): void {
  phase = 'idle';
  triggeredAt = 0;
  releasedAt = 0;
  releasedGatherElapsed = 0;
  releasedHoldAge = 0;
  activePointerId = null;
  clearDragState();
  hint.textContent = isNameDropWave()
    ? 'HOLD TO CONNECT'
    : isDragDissolve()
      ? 'DRAG · TWO-FINGER LINK'
      : 'TAP TO DISSOLVE';
  hint.classList.remove('hidden');
}

function replay(point?: DesignPoint): void {
  if (isNameDropWave()) {
    beginGather(point);
    releaseGather();
    return;
  }
  if (isDragDissolve()) {
    reset();
    return;
  }
  dissolve();
}

function designPointFromClient(
  clientX: number,
  clientY: number,
  constrainToArtwork = true,
): DesignPoint {
  const rect = canvas.getBoundingClientRect();
  const internalX = (clientX - rect.left) * (canvas.width / Math.max(1, rect.width));
  const internalY = (clientY - rect.top) * (canvas.height / Math.max(1, rect.height));

  const designX = (internalX - view.offsetX) / view.fit;
  const designY = (internalY - view.offsetY) / view.fit;
  if (!constrainToArtwork) return { x: designX, y: designY };

  return {
    x: clamp(designX, 0, DESIGN_WIDTH),
    y: clamp(designY, 0, DESIGN_HEIGHT),
  };
}

function setMode(mode: FigureMode): void {
  settings.figure = isDragDissolve() ? 'Lines' : mode;
  reset();
  figureController.updateDisplay();
}

function setInteraction(mode: InteractionMode): void {
  settings.interaction = mode;
  if (isDragDissolve()) settings.figure = 'Lines';
  reset();
  interactionController.updateDisplay();
  figureController.updateDisplay();
}

const gui = new GUI({ title: 'Afterbody' });
const interactionController = gui
  .add(settings, 'interaction', ['Original', 'NameDrop Wave', 'Drag Dissolve'])
  .name('Interaction')
  .onChange((mode: InteractionMode) => setInteraction(mode));
const figureController = gui
  .add(settings, 'figure', ['Lines', 'Solid'])
  .name('Figure')
  .onChange((mode: FigureMode) => setMode(mode));
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
contactFolder
  .add(settings, 'contactGatherStyle', ['Density Pull', 'Rope Pull'])
  .name('Gather style')
  .onChange((style: ContactGatherStyle) => {
    if (style === 'Rope Pull') settings.figure = 'Lines';
    reset();
    figureController.updateDisplay();
  });
contactFolder
  .add(settings, 'contactReleaseStyle', Object.keys(contactReleasePresets))
  .name('Release style')
  .onChange((style: ContactReleaseStyle) => {
    Object.assign(settings, contactReleasePresets[style]);
    reset();
    for (const controller of contactFolder.controllersRecursive()) controller.updateDisplay();
  });
contactFolder.add(settings, 'contactGatherDuration', 0.25, 1.8, 0.01).name('Gather time');
contactFolder.add(settings, 'contactDensityDuration', 0.15, 1.2, 0.01).name('Tension time');
contactFolder.add(settings, 'contactCompression', 0, 0.28, 0.005).name('Line pull');
contactFolder.add(settings, 'contactRopePull', 8, 100, 1).name('Rope pull');
contactFolder.add(settings, 'contactRopeReach', 16, 160, 1).name('Rope reach');
contactFolder.add(settings, 'contactRopeSlack', 0, 10, 0.1).name('Rope slack');
contactFolder.add(settings, 'contactBloomDuration', 0, 0.6, 0.01).name('Density peak');
contactFolder.add(settings, 'contactWaveDuration', 0.2, 4.8, 0.01).name('Wave duration');
contactFolder.add(settings, 'contactWaveBandWidth', 6, 100, 1).name('Wave width');
contactFolder.add(settings, 'contactWaveBrightness', 0, 1.5, 0.01).name('Wave brightness');
contactFolder.add(settings, 'contactLineFadeDuration', 0.08, 0.7, 0.01).name('Line crossfade');
contactFolder.add(settings, 'contactDiffusionDuration', 0.4, 3, 0.05).name('Diffusion life');
contactFolder.add(settings, 'contactParticleDensity', 0.5, 3, 0.05).name('SVG particle density');
contactFolder.add(settings, 'contactParticleSize', 0.25, 1.5, 0.05).name('Particle size');
contactFolder.add(settings, 'contactForce', 4, 160, 1).name('Particle travel');
contactFolder.add(settings, 'contactSpread', 0, 50, 1).name('Particle curl');
contactFolder.add(settings, 'contactReleaseSpread', 0, 0.7, 0.005).name('Release noise');
contactFolder.add(settings, 'contactReleaseSpeed', 0.05, 3, 0.05).name('Release speed');

const dragFolder = gui.addFolder('Drag Dissolve');
dragFolder.add(settings, 'dragRadius', 4, 60, 1).name('Brush radius');
dragFolder.add(settings, 'dragConnectorRadius', 1, 18, 0.5).name('Connector radius');
dragFolder.add(settings, 'dragConnectorWidth', 0.2, 3, 0.05).name('Connector width');
dragFolder.add(settings, 'dragParticleSize', 0.2, 1.5, 0.05).name('Particle size');
dragFolder.add(settings, 'dragForce', 5, 120, 1).name('Drag force');
dragFolder.add(settings, 'dragSpread', 0, 60, 1).name('Particle spread');
dragFolder.add(settings, 'dragParticleLife', 0.2, 4, 0.05).name('Particle lifetime');
dragFolder.add(settings, 'dragRestoreDelay', 0, 4, 0.05).name('Restore delay');

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
  if (isDragDissolve()) {
    const point = designPointFromClient(event.clientX, event.clientY);
    if (!beginDragDissolve(event.pointerId, point)) return;
    canvas.setPointerCapture(event.pointerId);
    return;
  }
  if (isNameDropWave()) {
    if (activePointerId !== null || phase === 'gathering' || phase === 'dissolving') return;
    beginGather(designPointFromClient(event.clientX, event.clientY, false));
    activePointerId = event.pointerId;
    canvas.setPointerCapture(event.pointerId);
    return;
  }
  replay();
});

canvas.addEventListener('pointermove', (event) => {
  if (isDragDissolve() && phase === 'dragging' && dragPointers.has(event.pointerId)) {
    event.preventDefault();
    moveDragDissolve(
      event.pointerId,
      designPointFromClient(event.clientX, event.clientY),
    );
    return;
  }
  if (!isNameDropWave() || phase !== 'gathering' || event.pointerId !== activePointerId) return;
  event.preventDefault();
  contactOrigin = designPointFromClient(event.clientX, event.clientY, false);
});

function finishPointerInteraction(event: PointerEvent): void {
  event.preventDefault();
  if (isDragDissolve()) {
    if (!dragPointers.has(event.pointerId)) return;
    const finalPoint = event.type === 'pointerup'
      ? designPointFromClient(event.clientX, event.clientY)
      : undefined;
    endDragDissolve(event.pointerId, finalPoint);
    return;
  }
  if (event.pointerId !== activePointerId) return;
  if (isNameDropWave() && event.type === 'pointerup') {
    contactOrigin = designPointFromClient(event.clientX, event.clientY, false);
  }
  activePointerId = null;
  releaseGather();
}

window.addEventListener('pointerup', finishPointerInteraction);
window.addEventListener('pointercancel', finishPointerInteraction);
canvas.addEventListener('lostpointercapture', (event) => {
  if (isDragDissolve()) {
    if (!dragPointers.has(event.pointerId)) return;
    endDragDissolve(event.pointerId);
    return;
  }
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
    } else if (!isDragDissolve()) replay();
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
    replay(designPointFromClient(clientX, clientY, false));
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
