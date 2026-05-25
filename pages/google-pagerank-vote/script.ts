import { TOKENS, buildCharacterBelt } from "./core.js";

type ShapeBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

type BeltGlyph = {
  char: string;
  distance: number;
};

type PathSample = {
  x: number;
  y: number;
  angle: number;
};

type ArtworkShape = {
  id: number;
  path: Path2D;
  d: string;
  bounds: ShapeBounds;
  cx: number;
  cy: number;
  radius: number;
  phase: number;
  speed: number;
  direction: number;
  dash: number;
  gap: number;
  delay: number;
  length: number;
  sampleStep: number;
  samples: PathSample[];
  glyphs: BeltGlyph[];
  fontSize: number;
  textPhase: number;
};

type FitTransform = {
  x: number;
  y: number;
  scale: number;
  size: number;
};

const ARTWORK_URL = new URL(
  "./assets/figma-g-polygon-reference.svg",
  import.meta.url,
).href;

const SVG_SIZE = 1339;
const CYCLE_SECONDS = 10.5;
const BASE_STROKE_WIDTH = 9;
const SVG_NS = "http://www.w3.org/2000/svg";
const reduceMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

const canvas = document.querySelector<HTMLCanvasElement>("#scene");
const errorEl = document.querySelector<HTMLDivElement>("#error");

if (!canvas || !errorEl) {
  throw new Error("Google PageRank Vote stage is missing required elements.");
}

const ctx = canvas.getContext("2d", { alpha: false });

if (!ctx) {
  throw new Error("Canvas 2D context is not available.");
}

let pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
let shapes: ArtworkShape[] = [];
let fit: FitTransform = { x: 0, y: 0, scale: 1, size: SVG_SIZE };
let cycleStartedAt = performance.now();
let pointerArtworkX = Number.NaN;
let pointerArtworkY = Number.NaN;
let hoveredShapeId = -1;
let pointerIsDown = false;
let artworkLoaded = false;
let loadError = "";

function parsePathBounds(d: string): ShapeBounds {
  const numbers = d.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi)?.map(Number) ?? [];
  const bounds: ShapeBounds = {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  };

  for (let index = 0; index < numbers.length - 1; index += 2) {
    const x = numbers[index];
    const y = numbers[index + 1];
    bounds.minX = Math.min(bounds.minX, x);
    bounds.minY = Math.min(bounds.minY, y);
    bounds.maxX = Math.max(bounds.maxX, x);
    bounds.maxY = Math.max(bounds.maxY, y);
  }

  if (!Number.isFinite(bounds.minX)) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }

  return bounds;
}

function centerOf(bounds: ShapeBounds) {
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  };
}

function radiusOf(bounds: ShapeBounds) {
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  return Math.hypot(width, height) / 2;
}

function createMeasurementSvg() {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("width", "0");
  svg.setAttribute("height", "0");
  svg.setAttribute("viewBox", `0 0 ${SVG_SIZE} ${SVG_SIZE}`);
  svg.style.position = "absolute";
  svg.style.width = "0";
  svg.style.height = "0";
  svg.style.overflow = "hidden";
  svg.style.pointerEvents = "none";
  document.body.append(svg);
  return svg;
}

function makePathSample(
  metricPath: SVGPathElement,
  distance: number,
  length: number,
  centerX: number,
  centerY: number,
  inset: number,
): PathSample {
  const point = metricPath.getPointAtLength(mod(distance, length));
  const before = metricPath.getPointAtLength(mod(distance - 2, length));
  const after = metricPath.getPointAtLength(mod(distance + 2, length));
  const tangentX = after.x - before.x;
  const tangentY = after.y - before.y;
  const tangentLength = Math.hypot(tangentX, tangentY) || 1;
  const unitX = tangentX / tangentLength;
  const unitY = tangentY / tangentLength;
  let normalX = -unitY;
  let normalY = unitX;
  const insideX = centerX - point.x;
  const insideY = centerY - point.y;

  if (normalX * insideX + normalY * insideY < 0) {
    normalX *= -1;
    normalY *= -1;
  }

  return {
    x: point.x + normalX * inset,
    y: point.y + normalY * inset,
    angle: Math.atan2(unitY, unitX),
  };
}

function measurePathMotion(
  measurementSvg: SVGSVGElement,
  d: string,
  bounds: ShapeBounds,
) {
  const metricPath = document.createElementNS(SVG_NS, "path");
  const center = centerOf(bounds);
  const radius = radiusOf(bounds);
  const inset = clamp(radius * 0.1, 11, 18);

  metricPath.setAttribute("d", d);
  measurementSvg.append(metricPath);

  const length = Math.max(1, metricPath.getTotalLength());
  const sampleCount = Math.max(24, Math.ceil(length / 8));
  const sampleStep = length / sampleCount;
  const samples: PathSample[] = [];

  for (let index = 0; index < sampleCount; index += 1) {
    samples.push(
      makePathSample(
        metricPath,
        index * sampleStep,
        length,
        center.x,
        center.y,
        inset,
      ),
    );
  }

  metricPath.remove();

  return { length, sampleStep, samples };
}

function distanceBetween(a: ArtworkShape, b: ArtworkShape) {
  return Math.hypot(a.cx - b.cx, a.cy - b.cy);
}

function edgeWeight(a: ArtworkShape, b: ArtworkShape) {
  const gap = Math.max(0, distanceBetween(a, b) - (a.radius + b.radius) * 0.58);
  return 0.16 + gap / 270;
}

function chooseDefaultSeed() {
  const target = { x: SVG_SIZE * 0.3, y: SVG_SIZE * 0.18 };
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const shape of shapes) {
    const distance = Math.hypot(shape.cx - target.x, shape.cy - target.y);

    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = shape.id;
    }
  }

  return bestIndex;
}

function computePropagation(seedIndex = chooseDefaultSeed()) {
  const distances = shapes.map(() => Number.POSITIVE_INFINITY);
  const visited = shapes.map(() => false);
  distances[seedIndex] = 0;

  for (let step = 0; step < shapes.length; step += 1) {
    let current = -1;
    let best = Number.POSITIVE_INFINITY;

    for (let index = 0; index < distances.length; index += 1) {
      if (!visited[index] && distances[index] < best) {
        current = index;
        best = distances[index];
      }
    }

    if (current === -1) {
      break;
    }

    visited[current] = true;

    for (let next = 0; next < shapes.length; next += 1) {
      if (visited[next] || next === current) {
        continue;
      }

      const candidate =
        distances[current] + edgeWeight(shapes[current], shapes[next]);

      if (candidate < distances[next]) {
        distances[next] = candidate;
      }
    }
  }

  const maxDistance = Math.max(...distances.filter(Number.isFinite), 1);

  for (const shape of shapes) {
    const normalized = distances[shape.id] / maxDistance;
    shape.delay = 0.55 + normalized * 7.7;
  }
}

async function loadArtwork() {
  const response = await fetch(ARTWORK_URL);

  if (!response.ok) {
    throw new Error(`Could not load Figma artwork (${response.status}).`);
  }

  const svgText = await response.text();
  const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
  const paths = Array.from(doc.querySelectorAll("path[stroke='#F8F8F8']"));
  const measurementSvg = createMeasurementSvg();

  shapes = paths.map((pathEl, index) => {
    const d = pathEl.getAttribute("d") ?? "";
    const bounds = parsePathBounds(d);
    const center = centerOf(bounds);
    const radius = radiusOf(bounds);
    const motion = measurePathMotion(measurementSvg, d, bounds);
    const fontSize = clamp(radius * 0.17, 22, 38);

    return {
      id: index,
      path: new Path2D(d),
      d,
      bounds,
      cx: center.x,
      cy: center.y,
      radius,
      phase: (index * 37) % 160,
      speed: 32 + (index % 7) * 7,
      direction: index % 2 === 0 ? 1 : -1,
      dash: 28 + (index % 4) * 6,
      gap: 24 + (index % 5) * 4,
      delay: 0,
      length: motion.length,
      sampleStep: motion.sampleStep,
      samples: motion.samples,
      glyphs: buildCharacterBelt(
        TOKENS,
        fontSize * 0.78,
        motion.length + fontSize * 2,
        index * 2,
      ),
      fontSize,
      textPhase: (index * 53) % motion.length,
    };
  });

  measurementSvg.remove();

  if (shapes.length === 0) {
    throw new Error("Figma artwork does not contain polygon stroke paths.");
  }

  computePropagation();
  artworkLoaded = true;
}

function resizeCanvas() {
  const bounds = canvas.getBoundingClientRect();
  const nextRatio = Math.min(window.devicePixelRatio || 1, 2);
  const nextWidth = Math.max(1, Math.round(bounds.width * nextRatio));
  const nextHeight = Math.max(1, Math.round(bounds.height * nextRatio));

  if (
    canvas.width !== nextWidth ||
    canvas.height !== nextHeight ||
    pixelRatio !== nextRatio
  ) {
    pixelRatio = nextRatio;
    canvas.width = nextWidth;
    canvas.height = nextHeight;
  }

  const width = canvas.width / pixelRatio;
  const height = canvas.height / pixelRatio;
  const size = Math.min(width * 0.96, height * 0.74);

  fit = {
    size,
    scale: size / SVG_SIZE,
    x: (width - size) / 2,
    y: (height - size) / 2,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function smoothstep(value: number) {
  const x = clamp(value, 0, 1);
  return x * x * (3 - 2 * x);
}

function mod(value: number, divisor: number) {
  return ((value % divisor) + divisor) % divisor;
}

function lerpAngle(from: number, to: number, amount: number) {
  const delta = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + delta * amount;
}

function pointAtShape(shape: ArtworkShape, distance: number): PathSample {
  const samples = shape.samples;

  if (samples.length === 0) {
    return { x: shape.cx, y: shape.cy, angle: 0 };
  }

  const target = mod(distance, shape.length);
  const rawIndex = target / shape.sampleStep;
  const index = Math.floor(rawIndex) % samples.length;
  const nextIndex = (index + 1) % samples.length;
  const amount = rawIndex - Math.floor(rawIndex);
  const current = samples[index];
  const next = samples[nextIndex];

  return {
    x: current.x + (next.x - current.x) * amount,
    y: current.y + (next.y - current.y) * amount,
    angle: lerpAngle(current.angle, next.angle, amount),
  };
}

function shapeActivation(shape: ArtworkShape, cycleTime: number) {
  const age = cycleTime - shape.delay;

  if (age < 0) {
    return 0;
  }

  const arrival = smoothstep(age / 0.72);
  const tail = 1 - smoothstep((age - 1.65) / 1.2);
  return clamp(arrival * tail, 0, 1);
}

function shapePointerLift(shape: ArtworkShape) {
  if (!Number.isFinite(pointerArtworkX) || !Number.isFinite(pointerArtworkY)) {
    return 0;
  }

  const distance = Math.hypot(pointerArtworkX - shape.cx, pointerArtworkY - shape.cy);
  return 1 - smoothstep(distance / Math.max(120, shape.radius * 1.05));
}

function drawBackground(width: number, height: number, time: number) {
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  ctx.fillStyle = "#030303";
  ctx.fillRect(0, 0, width, height);

  const grainStep = 3;
  const grainAlpha = reduceMotionQuery.matches ? 0.018 : 0.025;
  ctx.fillStyle = `rgba(255, 255, 255, ${grainAlpha})`;

  for (let y = (Math.floor(time * 19) % grainStep) - grainStep; y < height; y += grainStep) {
    for (let x = (Math.floor(time * 13) % grainStep) - grainStep; x < width; x += grainStep) {
      const value = Math.sin(x * 11.7 + y * 5.3 + time * 0.001);

      if (value > 0.72) {
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }
}

function drawLoading(width: number, height: number) {
  ctx.save();
  ctx.fillStyle = "rgba(248, 248, 248, 0.72)";
  ctx.font = "500 13px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("Loading Figma artwork", width / 2, height / 2);
  ctx.restore();
}

function drawShapeGlyphs(
  shape: ArtworkShape,
  activation: number,
  pointerLift: number,
  elapsedSeconds: number,
) {
  const reduced = reduceMotionQuery.matches;
  const pointerBoost = pointerIsDown ? pointerLift * 46 : pointerLift * 18;
  const motion = reduced
    ? 0
    : elapsedSeconds * (shape.speed * 0.92 + pointerBoost) * shape.direction;
  const alpha = clamp(0.38 + activation * 0.5 + pointerLift * 0.26, 0, 0.94);

  ctx.save();
  ctx.clip(shape.path);
  ctx.font = `800 ${shape.fontSize}px "Arial Black", Impact, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = `rgba(248, 248, 248, ${alpha})`;
  ctx.shadowColor = `rgba(255, 255, 255, ${activation * 0.3})`;
  ctx.shadowBlur = reduced ? 0 : 3 + activation * 9 + pointerLift * 5;

  for (const glyph of shape.glyphs) {
    const point = pointAtShape(shape, glyph.distance + shape.textPhase + motion);
    const shimmer = reduced
      ? 1
      : 0.78 +
        Math.sin(elapsedSeconds * 4.2 + glyph.distance * 0.05 + shape.id) * 0.22;

    ctx.save();
    ctx.globalAlpha = shimmer;
    ctx.translate(point.x, point.y);
    ctx.rotate(point.angle);
    ctx.fillText(glyph.char, 0, 0);
    ctx.restore();
  }

  ctx.restore();
}

function drawShape(shape: ArtworkShape, cycleTime: number, elapsedSeconds: number) {
  const reduced = reduceMotionQuery.matches;
  const activation = reduced ? 0.72 : shapeActivation(shape, cycleTime);
  const pointerLift = shapePointerLift(shape);
  const hoverLift = hoveredShapeId === shape.id ? 0.32 : 0;
  const intensity = clamp(0.36 + activation * 0.5 + pointerLift * 0.28 + hoverLift, 0, 1);
  const lineWidth = BASE_STROKE_WIDTH + activation * 1.8 + pointerLift * 1.4;

  ctx.save();
  ctx.fillStyle = "#030303";
  ctx.fill(shape.path);

  drawShapeGlyphs(shape, activation, pointerLift, elapsedSeconds);

  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.lineWidth = lineWidth;
  ctx.shadowColor = "rgba(255, 255, 255, 0)";
  ctx.setLineDash([]);
  ctx.strokeStyle = `rgba(248, 248, 248, ${0.3 + intensity * 0.28})`;
  ctx.stroke(shape.path);

  if (!reduced) {
    const pointerBoost = pointerIsDown ? pointerLift * 70 : pointerLift * 28;
    const motion = elapsedSeconds * (shape.speed + pointerBoost) * shape.direction;

    ctx.shadowColor = `rgba(255, 255, 255, ${0.16 + activation * 0.24})`;
    ctx.shadowBlur = 6 + activation * 18 + pointerLift * 12;
    ctx.lineWidth = lineWidth + activation * 0.8;
    ctx.setLineDash([shape.dash, shape.gap]);
    ctx.lineDashOffset = shape.phase - motion;
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.64 + intensity * 0.34})`;
    ctx.stroke(shape.path);

    ctx.shadowBlur = 0;
    ctx.lineWidth = Math.max(2, lineWidth * 0.32);
    ctx.setLineDash([4, shape.dash + shape.gap + 18]);
    ctx.lineDashOffset = -shape.phase * 0.7 - motion * 1.55;
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.28 + activation * 0.48})`;
    ctx.stroke(shape.path);
  }

  ctx.restore();
}

function drawArtwork(time: number) {
  const elapsedSeconds = (time - cycleStartedAt) / 1000;
  const cycleTime = ((elapsedSeconds % CYCLE_SECONDS) + CYCLE_SECONDS) % CYCLE_SECONDS;

  ctx.save();
  ctx.translate(fit.x, fit.y);
  ctx.scale(fit.scale, fit.scale);

  for (const shape of shapes) {
    drawShape(shape, cycleTime, elapsedSeconds);
  }

  ctx.restore();
}

function render(time: number) {
  resizeCanvas();

  const width = canvas.width / pixelRatio;
  const height = canvas.height / pixelRatio;

  drawBackground(width, height, time);

  if (loadError) {
    errorEl.textContent = loadError;
    errorEl.classList.add("show");
  } else {
    errorEl.classList.remove("show");

    if (artworkLoaded) {
      drawArtwork(time);
    } else {
      drawLoading(width, height);
    }
  }

  requestAnimationFrame(render);
}

function eventToArtworkPoint(event: PointerEvent) {
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;

  return {
    x: (x - fit.x) / fit.scale,
    y: (y - fit.y) / fit.scale,
  };
}

function distanceToBounds(x: number, y: number, bounds: ShapeBounds) {
  const dx = Math.max(bounds.minX - x, 0, x - bounds.maxX);
  const dy = Math.max(bounds.minY - y, 0, y - bounds.maxY);
  return Math.hypot(dx, dy);
}

function findNearestShape(x: number, y: number) {
  let bestShape: ArtworkShape | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const shape of shapes) {
    const distance =
      distanceToBounds(x, y, shape.bounds) +
      Math.hypot(x - shape.cx, y - shape.cy) * 0.08;

    if (distance < bestDistance) {
      bestDistance = distance;
      bestShape = shape;
    }
  }

  if (!bestShape || bestDistance > Math.max(85, bestShape.radius * 0.68)) {
    return undefined;
  }

  return bestShape;
}

function updatePointer(event: PointerEvent) {
  const point = eventToArtworkPoint(event);
  pointerArtworkX = point.x;
  pointerArtworkY = point.y;
  hoveredShapeId = findNearestShape(point.x, point.y)?.id ?? -1;
}

canvas.addEventListener("pointermove", updatePointer);

canvas.addEventListener("pointerdown", (event) => {
  canvas.setPointerCapture(event.pointerId);
  pointerIsDown = true;
  updatePointer(event);

  const nearest = findNearestShape(pointerArtworkX, pointerArtworkY);

  if (nearest) {
    computePropagation(nearest.id);
    cycleStartedAt = performance.now() - 180;
  }
});

canvas.addEventListener("pointerup", (event) => {
  pointerIsDown = false;
  canvas.releasePointerCapture(event.pointerId);
});

canvas.addEventListener("pointerleave", () => {
  pointerArtworkX = Number.NaN;
  pointerArtworkY = Number.NaN;
  hoveredShapeId = -1;
  pointerIsDown = false;
});

void loadArtwork().catch((error: unknown) => {
  loadError = error instanceof Error ? error.message : "Failed to load artwork.";
});

requestAnimationFrame(render);
