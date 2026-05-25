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
  tx: number;
  ty: number;
  nx: number;
  ny: number;
  distance: number;
};

type ArtworkShape = {
  id: number;
  path: Path2D;
  d: string;
  bounds: ShapeBounds;
  cx: number;
  cy: number;
  radius: number;
  speed: number;
  direction: number;
  length: number;
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
    x: point.x,
    y: point.y,
    tx: unitX,
    ty: unitY,
    nx: normalX,
    ny: normalY,
    distance: 0,
  };
}

function completeMotionSamples(
  samples: PathSample[],
  centerX: number,
  centerY: number,
) {
  if (samples.length === 0) {
    return 0;
  }

  let totalLength = 0;
  samples[0].distance = 0;

  for (let index = 1; index < samples.length; index += 1) {
    totalLength += Math.hypot(
      samples[index].x - samples[index - 1].x,
      samples[index].y - samples[index - 1].y,
    );
    samples[index].distance = totalLength;
  }

  totalLength += Math.hypot(
    samples[0].x - samples[samples.length - 1].x,
    samples[0].y - samples[samples.length - 1].y,
  );

  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    const prev = samples[mod(index - 1, samples.length)];
    const next = samples[(index + 1) % samples.length];
    const tangent = normalizeVector(
      next.x - prev.x,
      next.y - prev.y,
      sample.tx,
      sample.ty,
    );
    let normalX = -tangent.y;
    let normalY = tangent.x;
    const insideX = centerX - sample.x;
    const insideY = centerY - sample.y;

    if (normalX * insideX + normalY * insideY < 0) {
      normalX *= -1;
      normalY *= -1;
    }

    sample.tx = tangent.x;
    sample.ty = tangent.y;
    sample.nx = normalX;
    sample.ny = normalY;
  }

  return Math.max(1, totalLength);
}

function measurePathMotion(
  measurementSvg: SVGSVGElement,
  d: string,
  bounds: ShapeBounds,
) {
  const metricPath = document.createElementNS(SVG_NS, "path");
  const center = centerOf(bounds);

  metricPath.setAttribute("d", d);
  measurementSvg.append(metricPath);

  const length = Math.max(1, metricPath.getTotalLength());
  const sampleCount = Math.max(48, Math.ceil(length / 5));
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
      ),
    );
  }

  const motionLength = completeMotionSamples(samples, center.x, center.y);

  metricPath.remove();

  return { length: motionLength, samples };
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
    const fontSize = clamp(radius * 0.115, 13, 24);
    const motion = measurePathMotion(measurementSvg, d, bounds);

    return {
      id: index,
      path: new Path2D(d),
      d,
      bounds,
      cx: center.x,
      cy: center.y,
      radius,
      speed: 32 + (index % 7) * 7,
      direction: index % 2 === 0 ? 1 : -1,
      length: motion.length,
      samples: motion.samples,
      glyphs: buildCharacterBelt(
        TOKENS,
        fontSize * 1.85,
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

function mod(value: number, divisor: number) {
  return ((value % divisor) + divisor) % divisor;
}

function normalizeVector(x: number, y: number, fallbackX: number, fallbackY: number) {
  const length = Math.hypot(x, y);

  if (length < 0.0001) {
    return { x: fallbackX, y: fallbackY };
  }

  return { x: x / length, y: y / length };
}

function pointAtShape(shape: ArtworkShape, distance: number): PathSample {
  const samples = shape.samples;

  if (samples.length === 0) {
    return {
      x: shape.cx,
      y: shape.cy,
      tx: 1,
      ty: 0,
      nx: 0,
      ny: 1,
      distance: 0,
    };
  }

  const target = mod(distance, shape.length);
  let index = samples.length - 1;

  for (let sampleIndex = 0; sampleIndex < samples.length; sampleIndex += 1) {
    const start = samples[sampleIndex].distance;
    const end =
      sampleIndex === samples.length - 1
        ? shape.length
        : samples[sampleIndex + 1].distance;

    if (target >= start && target < end) {
      index = sampleIndex;
      break;
    }
  }

  const nextIndex = (index + 1) % samples.length;
  const current = samples[index];
  const next = samples[nextIndex];
  const startDistance = current.distance;
  const endDistance = index === samples.length - 1 ? shape.length : next.distance;
  const amount = clamp((target - startDistance) / Math.max(1, endDistance - startDistance), 0, 1);
  const x = current.x + (next.x - current.x) * amount;
  const y = current.y + (next.y - current.y) * amount;
  const tangent = normalizeVector(
    current.tx + (next.tx - current.tx) * amount,
    current.ty + (next.ty - current.ty) * amount,
    current.tx,
    current.ty,
  );
  let normalX = -tangent.y;
  let normalY = tangent.x;
  const insideX = shape.cx - x;
  const insideY = shape.cy - y;

  if (normalX * insideX + normalY * insideY < 0) {
    normalX *= -1;
    normalY *= -1;
  }

  return {
    x,
    y,
    tx: tangent.x,
    ty: tangent.y,
    nx: normalX,
    ny: normalY,
    distance: target,
  };
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
  elapsedSeconds: number,
) {
  const reduced = reduceMotionQuery.matches;
  const motion = reduced
    ? 0
    : elapsedSeconds * shape.speed * 0.92 * shape.direction;

  ctx.save();
  ctx.font = `800 ${shape.fontSize}px "Arial Black", Impact, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillStyle = "rgba(248, 248, 248, 0.84)";
  ctx.shadowBlur = 0;

  for (const glyph of shape.glyphs) {
    const point = pointAtShape(shape, glyph.distance + shape.textPhase + motion);

    ctx.save();
    ctx.transform(point.tx, point.ty, point.nx, point.ny, point.x, point.y);
    ctx.fillText(glyph.char, 0, 0);
    ctx.restore();
  }

  ctx.restore();
}

function drawShape(shape: ArtworkShape, elapsedSeconds: number) {
  ctx.save();

  drawShapeGlyphs(shape, elapsedSeconds);

  ctx.restore();
}

function drawArtwork(time: number) {
  const elapsedSeconds = (time - cycleStartedAt) / 1000;

  ctx.save();
  ctx.translate(fit.x, fit.y);
  ctx.scale(fit.scale, fit.scale);

  for (const shape of shapes) {
    drawShape(shape, elapsedSeconds);
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

void loadArtwork().catch((error: unknown) => {
  loadError = error instanceof Error ? error.message : "Failed to load artwork.";
});

requestAnimationFrame(render);
