import { SOURCE_X_LIMIT, SVG_TO_DESIGN } from './config';
import { hash } from './math';
import type { EchoLineGeometry, FigurePoint, LineGraphEdge } from './types';

const GENERATED_GEOMETRY_MAGIC = 0x31474542;
const generatedGeometryUrl = new URL('./assets/generated-line-geometry.bin', import.meta.url).href;

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

function buildLineGraph(
  points: FigurePoint[],
  joints: Array<[number, number, number]>,
): LineGraphEdge[][] {
  const graph = points.map(() => [] as LineGraphEdge[]);
  for (let pointIndex = 1; pointIndex < points.length; pointIndex += 1) {
    const point = points[pointIndex];
    const previousPoint = points[pointIndex - 1];
    if (point.pathIndex !== previousPoint.pathIndex) continue;
    const distance = Math.max(
      0.001,
      Math.hypot(point.x - previousPoint.x, point.y - previousPoint.y) * SVG_TO_DESIGN,
    );
    graph[pointIndex - 1].push({ pointIndex, distance });
    graph[pointIndex].push({ pointIndex: pointIndex - 1, distance });
  }
  for (const [startIndex, endIndex, distance] of joints) {
    graph[startIndex].push({ pointIndex: endIndex, distance });
    graph[endIndex].push({ pointIndex: startIndex, distance });
  }
  return graph;
}

function readGeneratedLineGeometry(buffer: ArrayBuffer): EchoLineGeometry[] {
  const view = new DataView(buffer);
  const decoder = new TextDecoder();
  let offset = 0;
  const readUint32 = (): number => {
    const value = view.getUint32(offset, true);
    offset += 4;
    return value;
  };
  const readFloat32 = (): number => {
    const value = view.getFloat32(offset, true);
    offset += 4;
    return value;
  };

  if (readUint32() !== GENERATED_GEOMETRY_MAGIC) {
    throw new Error('Body Echo geometry has an invalid header.');
  }

  const geometryCount = readUint32();
  const geometry: EchoLineGeometry[] = [];
  for (let echoIndex = 0; echoIndex < geometryCount; echoIndex += 1) {
    const strokeWidth = readFloat32();
    const viewBoxX = readFloat32();
    const viewBoxY = readFloat32();
    const width = readFloat32();
    const height = readFloat32();
    const pathDataLength = readUint32();
    const pathData = decoder.decode(new Uint8Array(buffer, offset, pathDataLength));
    offset += pathDataLength;

    const centerX = viewBoxX + width * 0.5;
    const centerY = viewBoxY + height * 0.5;
    const pointCount = readUint32();
    const points: FigurePoint[] = [];
    for (let pointIndex = 0; pointIndex < pointCount; pointIndex += 1) {
      const x = readFloat32();
      const y = readFloat32();
      const pathIndex = readFloat32();
      const pathDistance = readFloat32();
      points.push({
        x,
        y,
        seed: hash(x + centerX, y + centerY, echoIndex),
        seed2: hash(y + centerY, x + centerX, echoIndex + 7),
        startsPath: pathDistance === 0,
        pathIndex,
        pathDistance,
        tangentX: readFloat32(),
        tangentY: readFloat32(),
      });
    }

    const jointCount = readUint32();
    const joints: Array<[number, number, number]> = [];
    for (let jointIndex = 0; jointIndex < jointCount; jointIndex += 1) {
      joints.push([readUint32(), readUint32(), readFloat32()]);
    }
    geometry.push({
      path: new Path2D(pathData),
      points,
      samples: points.filter((_, index) => index % 3 === 0),
      graph: buildLineGraph(points, joints),
      strokeWidth,
      viewBoxX,
      viewBoxY,
      width,
      height,
    });
  }
  return geometry;
}

export async function loadLineAssets(
  onProgress?: (loaded: number, total: number) => void,
): Promise<EchoLineGeometry[]> {
  const response = await fetch(generatedGeometryUrl);
  if (!response.ok) throw new Error('Could not load generated Body Echo geometry.');
  const geometry = readGeneratedLineGeometry(await response.arrayBuffer());
  geometry.forEach((_, index) => onProgress?.(index + 1, geometry.length));
  return geometry;
}
