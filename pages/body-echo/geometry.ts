import {
  SOURCE_X_LIMIT,
  SVG_NAMESPACE,
  SVG_SAMPLE_STEP,
  SVG_TO_DESIGN,
  lineAssetUrls,
} from './config';
import { hash } from './math';
import type { EchoLineGeometry, FigurePoint, LineGraphEdge } from './types';

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

export function buildSolidPoints(image: HTMLImageElement): FigurePoint[] {
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
  const points: FigurePoint[] = [];

  for (let y = 0; y < sourceCanvas.height; y += 1) {
    for (let x = 0; x < sourceCanvas.width; x += 1) {
      if (mask[y * sourceCanvas.width + x] === 0 || x % 2 !== 0 || y % 2 !== 0) continue;
      points.push({
        x: x - centerX,
        y: y - centerY,
        seed: hash(x, y),
        seed2: hash(y, x, 3),
      });
    }
  }

  return points;
}

function readNumber(value: string | null, fallback: number): number {
  if (value === null) return fallback;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function buildLineGraph(points: FigurePoint[]): LineGraphEdge[][] {
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

  // Separate SVG contours remain visually disconnected. These nearest-endpoint
  // joints exist only in the tension graph so a held strand can affect the body.
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

export async function loadLineAsset(url: string, echoIndex: number): Promise<EchoLineGeometry> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load line figure ${echoIndex + 1}.`);

  const source = await response.text();
  const documentSvg = new DOMParser().parseFromString(source, 'image/svg+xml');
  if (documentSvg.querySelector('parsererror')) {
    throw new Error(`Line figure ${echoIndex + 1} is not valid SVG.`);
  }

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

export async function loadLineAssets(
  onProgress?: (loaded: number, total: number) => void,
): Promise<EchoLineGeometry[]> {
  let loaded = 0;
  const total = lineAssetUrls.length;

  return Promise.all(
    lineAssetUrls.map(async (url, echoIndex) => {
      const geometry = await loadLineAsset(url, echoIndex);
      loaded += 1;
      onProgress?.(loaded, total);
      return geometry;
    }),
  );
}
