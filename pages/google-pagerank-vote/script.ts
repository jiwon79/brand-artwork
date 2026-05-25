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

type Point = {
  x: number;
  y: number;
};

type GearPoint = Point & {
  radius: number;
  phase: number;
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
  metricPath: SVGPathElement;
  d: string;
  bounds: ShapeBounds;
  cx: number;
  cy: number;
  radius: number;
  speed: number;
  direction: number;
  length: number;
  glyphs: BeltGlyph[];
  fontSize: number;
  textPhase: number;
  gears: GearPoint[];
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
const TANGENT_WINDOW_RATIO = 0.42;
const MIN_TANGENT_WINDOW = 3;
const MAX_TANGENT_WINDOW = 12;
const PATH_TOKEN_PATTERN = /[AaCcHhLlMmQqSsTtVvZz]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi;
const TWO_PI = Math.PI * 2;
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
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("viewBox", `0 0 ${SVG_SIZE} ${SVG_SIZE}`);
  svg.style.position = "absolute";
  svg.style.width = "0";
  svg.style.height = "0";
  svg.style.overflow = "hidden";
  svg.style.pointerEvents = "none";
  document.body.append(svg);
  return svg;
}

function measurePathMotion(
  measurementSvg: SVGSVGElement,
  d: string,
) {
  const metricPath = document.createElementNS(SVG_NS, "path");

  metricPath.setAttribute("d", d);
  measurementSvg.append(metricPath);

  const length = Math.max(1, metricPath.getTotalLength());
  const bounds = metricPath.getBBox();

  return {
    length,
    metricPath,
    bounds: {
      minX: bounds.x,
      minY: bounds.y,
      maxX: bounds.x + bounds.width,
      maxY: bounds.y + bounds.height,
    },
  };
}

function cubicPoint(start: Point, controlA: Point, controlB: Point, end: Point, t: number) {
  const u = 1 - t;
  const tt = t * t;
  const uu = u * u;

  return {
    x: uu * u * start.x + 3 * uu * t * controlA.x + 3 * u * tt * controlB.x + tt * t * end.x,
    y: uu * u * start.y + 3 * uu * t * controlA.y + 3 * u * tt * controlB.y + tt * t * end.y,
  };
}

function lineIntersection(originA: Point, vectorA: Point, originB: Point, vectorB: Point) {
  const denominator = vectorA.x * vectorB.y - vectorA.y * vectorB.x;

  if (Math.abs(denominator) < 0.0001) {
    return null;
  }

  const offsetX = originB.x - originA.x;
  const offsetY = originB.y - originA.y;
  const amount = (offsetX * vectorB.y - offsetY * vectorB.x) / denominator;

  return {
    x: originA.x + vectorA.x * amount,
    y: originA.y + vectorA.y * amount,
  };
}

function createGearPoint(
  start: Point,
  controlA: Point,
  controlB: Point,
  end: Point,
  fontSize: number,
  index: number,
) {
  const entry = normalizeVector(controlA.x - start.x, controlA.y - start.y, 1, 0);
  const exit = normalizeVector(end.x - controlB.x, end.y - controlB.y, 1, 0);
  const angle = Math.acos(clamp(entry.x * exit.x + entry.y * exit.y, -1, 1));

  if (angle < 0.18) {
    return null;
  }

  const midpoint = cubicPoint(start, controlA, controlB, end, 0.5);
  const vertex = lineIntersection(start, entry, end, exit) ?? midpoint;
  const distanceToArc = Math.hypot(vertex.x - midpoint.x, vertex.y - midpoint.y);
  const radius = clamp(distanceToArc * 0.68, fontSize * 0.36, fontSize * 0.76);
  const gearCenter = distanceToArc > fontSize * 3.2 ? midpoint : vertex;

  return {
    x: gearCenter.x,
    y: gearCenter.y,
    radius,
    phase: (index * 0.91 + midpoint.x * 0.017 + midpoint.y * 0.011) % TWO_PI,
  };
}

function parseCornerGears(d: string, fontSize: number) {
  const tokens = d.match(PATH_TOKEN_PATTERN) ?? [];
  const gears: GearPoint[] = [];
  let index = 0;
  let command = "";
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;

  function isCommand(token: string) {
    return /^[A-Za-z]$/.test(token);
  }

  function readPoint(relative: boolean): Point {
    const nextX = Number(tokens[index++]);
    const nextY = Number(tokens[index++]);
    return {
      x: relative ? x + nextX : nextX,
      y: relative ? y + nextY : nextY,
    };
  }

  while (index < tokens.length) {
    if (isCommand(tokens[index])) {
      command = tokens[index++];
    }

    const relative = command === command.toLowerCase();

    if (command === "M" || command === "m") {
      const point = readPoint(relative);
      x = point.x;
      y = point.y;
      startX = x;
      startY = y;
      command = relative ? "l" : "L";
    } else if (command === "L" || command === "l") {
      while (index < tokens.length && !isCommand(tokens[index])) {
        const point = readPoint(relative);
        x = point.x;
        y = point.y;
      }
    } else if (command === "H" || command === "h") {
      while (index < tokens.length && !isCommand(tokens[index])) {
        const nextX = Number(tokens[index++]);
        x = relative ? x + nextX : nextX;
      }
    } else if (command === "V" || command === "v") {
      while (index < tokens.length && !isCommand(tokens[index])) {
        const nextY = Number(tokens[index++]);
        y = relative ? y + nextY : nextY;
      }
    } else if (command === "C" || command === "c") {
      while (index < tokens.length && !isCommand(tokens[index])) {
        const start = { x, y };
        const controlA = readPoint(relative);
        const controlB = readPoint(relative);
        const end = readPoint(relative);
        const gear = createGearPoint(start, controlA, controlB, end, fontSize, gears.length);

        if (gear) {
          gears.push(gear);
        }

        x = end.x;
        y = end.y;
      }
    } else if (command === "Z" || command === "z") {
      x = startX;
      y = startY;
      command = "";
    } else {
      break;
    }
  }

  return gears;
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
    const motion = measurePathMotion(measurementSvg, d);
    const bounds = motion.bounds;
    const center = centerOf(bounds);
    const radius = radiusOf(bounds);
    const fontSize = clamp(radius * 0.145, 17, 31);

    return {
      id: index,
      metricPath: motion.metricPath,
      d,
      bounds,
      cx: center.x,
      cy: center.y,
      radius,
      speed: 32 + (index % 7) * 7,
      direction: index % 2 === 0 ? 1 : -1,
      length: motion.length,
      glyphs: buildCharacterBelt(
        TOKENS,
        fontSize * 0.78,
        motion.length + fontSize * 2,
        index * 2,
      ),
      fontSize,
      textPhase: (index * 53) % motion.length,
      gears: parseCornerGears(d, fontSize),
    };
  });

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
  const target = mod(distance, shape.length);
  const point = shape.metricPath.getPointAtLength(target);
  const tangentWindow = clamp(
    shape.fontSize * TANGENT_WINDOW_RATIO,
    MIN_TANGENT_WINDOW,
    Math.min(MAX_TANGENT_WINDOW, shape.length * 0.08),
  );
  const before = shape.metricPath.getPointAtLength(
    mod(target - tangentWindow, shape.length),
  );
  const after = shape.metricPath.getPointAtLength(
    mod(target + tangentWindow, shape.length),
  );
  let tangent = normalizeVector(
    after.x - before.x,
    after.y - before.y,
    1,
    0,
  );
  let normalX = -tangent.y;
  let normalY = tangent.x;
  const insideX = shape.cx - point.x;
  const insideY = shape.cy - point.y;

  if (normalX * insideX + normalY * insideY < 0) {
    normalX *= -1;
    normalY *= -1;
    tangent = {
      x: -tangent.x,
      y: -tangent.y,
    };
  }

  return {
    x: point.x,
    y: point.y,
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

function drawGear(gear: GearPoint, shape: ArtworkShape, elapsedSeconds: number) {
  const spin = reduceMotionQuery.matches
    ? gear.phase
    : gear.phase + (elapsedSeconds * shape.speed * shape.direction) / Math.max(1, gear.radius);
  const toothCount = 8;

  ctx.save();
  ctx.translate(gear.x, gear.y);
  ctx.rotate(spin);
  ctx.fillStyle = "rgba(5, 5, 5, 0.9)";
  ctx.strokeStyle = "rgba(248, 248, 248, 0.82)";
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(1.4, gear.radius * 0.14);

  ctx.beginPath();
  ctx.arc(0, 0, gear.radius, 0, TWO_PI);
  ctx.fill();
  ctx.stroke();

  ctx.lineWidth = Math.max(1, gear.radius * 0.1);
  ctx.beginPath();
  ctx.arc(0, 0, gear.radius * 0.32, 0, TWO_PI);
  ctx.stroke();

  for (let index = 0; index < toothCount; index += 1) {
    const angle = (index / toothCount) * TWO_PI;
    const inner = gear.radius * 0.42;
    const outer = gear.radius * 0.86;

    ctx.beginPath();
    ctx.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner);
    ctx.lineTo(Math.cos(angle) * outer, Math.sin(angle) * outer);
    ctx.stroke();
  }

  ctx.restore();
}

function drawShapeGears(shape: ArtworkShape, elapsedSeconds: number) {
  ctx.save();

  for (const gear of shape.gears) {
    drawGear(gear, shape, elapsedSeconds);
  }

  ctx.restore();
}

function drawShape(shape: ArtworkShape, elapsedSeconds: number) {
  ctx.save();

  drawShapeGears(shape, elapsedSeconds);
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
