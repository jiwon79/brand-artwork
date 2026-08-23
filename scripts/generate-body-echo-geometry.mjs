import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { svgPathProperties } from 'svg-path-properties';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const assetDirectory = resolve(projectRoot, 'pages/body-echo/assets/sori');
const outputPath = resolve(projectRoot, 'pages/body-echo/assets/generated-line-geometry.bin');
const sampleStep = 3.2;
const svgToDesign = 0.32;

function rounded(value, precision = 5) {
  return Number(value.toFixed(precision));
}

function attribute(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}="([^"]+)"`));
  return match?.[1] ?? null;
}

function numberAttribute(tag, name, fallback) {
  const value = attribute(tag, name);
  if (value === null) return fallback;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function buildGraphJoints(points) {
  const pathGroups = new Map();

  for (let pointIndex = 0; pointIndex < points.length; pointIndex += 1) {
    const point = points[pointIndex];
    const pathIndex = point.pathIndex;
    const group = pathGroups.get(pathIndex) ?? [];
    group.push(pointIndex);
    pathGroups.set(pathIndex, group);
  }

  const groups = [...pathGroups.entries()];
  if (groups.length <= 1) return [];

  const mainPath = groups.reduce((longest, candidate) => (
    candidate[1].length > longest[1].length ? candidate : longest
  ));
  const connectedPaths = new Set([mainPath[0]]);
  const joints = [];

  while (connectedPaths.size < groups.length) {
    let closest = null;

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
    const jointDistance = Math.max(1.5, closest.distance * svgToDesign * 0.72);
    joints.push([closest.endpointIndex, closest.targetIndex, rounded(jointDistance)]);
    connectedPaths.add(closest.pathIndex);
  }

  return joints;
}

async function generateGeometry(echoIndex) {
  const source = await readFile(resolve(assetDirectory, `figure-${echoIndex + 1}.svg`), 'utf8');
  const svgTag = source.match(/<svg\b[^>]*>/)?.[0];
  const pathTag = source.match(/<path\b[^>]*>/)?.[0];
  if (!svgTag || !pathTag) throw new Error(`Figure ${echoIndex + 1} is missing SVG geometry.`);

  const pathData = attribute(pathTag, 'd');
  if (!pathData) throw new Error(`Figure ${echoIndex + 1} has no path data.`);

  const fallbackWidth = numberAttribute(svgTag, 'width', 1);
  const fallbackHeight = numberAttribute(svgTag, 'height', 1);
  const viewBox = (attribute(svgTag, 'viewBox') ?? `0 0 ${fallbackWidth} ${fallbackHeight}`)
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (viewBox.length !== 4 || viewBox.some((value) => !Number.isFinite(value))) {
    throw new Error(`Figure ${echoIndex + 1} has an invalid viewBox.`);
  }

  const [viewBoxX, viewBoxY, width, height] = viewBox;
  const centerX = viewBoxX + width * 0.5;
  const centerY = viewBoxY + height * 0.5;
  const subpaths = pathData.match(/[Mm][^Mm]*/g) ?? [pathData];
  const points = [];

  for (let pathIndex = 0; pathIndex < subpaths.length; pathIndex += 1) {
    const properties = new svgPathProperties(subpaths[pathIndex]);
    const length = properties.getTotalLength();

    for (let distance = 0; distance < length; distance += sampleStep) {
      const point = properties.getPointAtLength(distance);
      const tangentStart = properties.getPointAtLength(Math.max(0, distance - sampleStep));
      const tangentEnd = properties.getPointAtLength(Math.min(length, distance + sampleStep));
      const tangentLength = Math.max(
        0.001,
        Math.hypot(tangentEnd.x - tangentStart.x, tangentEnd.y - tangentStart.y),
      );
      points.push({
        x: point.x - centerX,
        y: point.y - centerY,
        pathIndex,
        pathDistance: distance,
        tangentX: (tangentEnd.x - tangentStart.x) / tangentLength,
        tangentY: (tangentEnd.y - tangentStart.y) / tangentLength,
      });
    }

    const finalPoint = properties.getPointAtLength(length);
    const finalTangentStart = properties.getPointAtLength(Math.max(0, length - sampleStep));
    const finalTangentLength = Math.max(
      0.001,
      Math.hypot(finalPoint.x - finalTangentStart.x, finalPoint.y - finalTangentStart.y),
    );
    points.push({
      x: finalPoint.x - centerX,
      y: finalPoint.y - centerY,
      pathIndex,
      pathDistance: length,
      tangentX: (finalPoint.x - finalTangentStart.x) / finalTangentLength,
      tangentY: (finalPoint.y - finalTangentStart.y) / finalTangentLength,
    });
  }

  return {
    pathData,
    points: points.map((point) => [
      rounded(point.x),
      rounded(point.y),
      point.pathIndex,
      rounded(point.pathDistance),
      rounded(point.tangentX, 7),
      rounded(point.tangentY, 7),
    ]),
    joints: buildGraphJoints(points),
    strokeWidth: numberAttribute(pathTag, 'stroke-width', 1),
    viewBoxX,
    viewBoxY,
    width,
    height,
  };
}

const geometry = await Promise.all(Array.from({ length: 6 }, (_, index) => generateGeometry(index)));
const chunks = [Buffer.from('BEG1')];

function uint32(value) {
  const buffer = Buffer.allocUnsafe(4);
  buffer.writeUInt32LE(value);
  return buffer;
}

function float32(value) {
  const buffer = Buffer.allocUnsafe(4);
  buffer.writeFloatLE(value);
  return buffer;
}

chunks.push(uint32(geometry.length));
for (const item of geometry) {
  chunks.push(
    float32(item.strokeWidth),
    float32(item.viewBoxX),
    float32(item.viewBoxY),
    float32(item.width),
    float32(item.height),
  );
  const pathData = Buffer.from(item.pathData, 'utf8');
  chunks.push(uint32(pathData.length), pathData, uint32(item.points.length));
  for (const point of item.points) {
    for (const value of point) chunks.push(float32(value));
  }
  chunks.push(uint32(item.joints.length));
  for (const [startIndex, endIndex, distance] of item.joints) {
    chunks.push(uint32(startIndex), uint32(endIndex), float32(distance));
  }
}

const output = Buffer.concat(chunks);
await writeFile(outputPath, output);
console.log(
  `Generated ${geometry.reduce((total, item) => total + item.points.length, 0)} Body Echo points (${output.byteLength} bytes).`,
);
