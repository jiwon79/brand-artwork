import {
  GOOGLE_COLORS,
  TOKENS,
  buildCharacterBelt,
} from "./core.js";

type ShapeBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

type BeltGlyph = {
  char: string;
  distance: number;
  paintColor?: string;
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
  baseFontSize: number;
  glyphs: BeltGlyph[];
  fontSize: number;
  textPhase: number;
  gears: GearPoint[];
};

type FitTransform = {
  x: number;
  y: number;
  scale: number;
  width: number;
  height: number;
};

type PaintBrush = {
  x: number;
  y: number;
  radius: number;
  color: string;
};

type DragPaint = PaintBrush & {
  pointerId: number;
};

const ARTWORK_URL = new URL(
  "./assets/figma-g-polygon-reference.svg",
  import.meta.url,
).href;

const DEFAULT_ARTWORK_WIDTH = 1339;
const DEFAULT_ARTWORK_HEIGHT = 1339;
const SVG_NS = "http://www.w3.org/2000/svg";
const TANGENT_WINDOW_RATIO = 0.42;
const MIN_TANGENT_WINDOW = 3;
const MAX_TANGENT_WINDOW = 12;
const PAINT_BRUSH_RADIUS_PX = 36;
const PAINT_STROKE_STEP_RATIO = 0.42;
const MAX_STROKE_SAMPLES_PER_EVENT = 18;
const MAX_PENDING_PAINT_BRUSHES = 180;
const GLYPH_HIT_CENTER_RATIO = 0.46;
const PATH_TOKEN_PATTERN = /[AaCcHhLlMmQqSsTtVvZz]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi;
const TWO_PI = Math.PI * 2;
const reduceMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
const FONT_SCALE = 1.2;
const FONT_STACK = "Helvetica, Arial, sans-serif";

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
let artworkSize = { width: DEFAULT_ARTWORK_WIDTH, height: DEFAULT_ARTWORK_HEIGHT };
let fit: FitTransform = {
  x: 0,
  y: 0,
  scale: 1,
  width: DEFAULT_ARTWORK_WIDTH,
  height: DEFAULT_ARTWORK_HEIGHT,
};
let cycleStartedAt = performance.now();
let artworkLoaded = false;
let loadError = "";
let paintStrokeIndex = 0;
let dragPaint: DragPaint | null = null;
const pendingPaintBrushes: PaintBrush[] = [];
const shapeBrushes: PaintBrush[] = [];

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

function createMeasurementSvg(width: number, height: number) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("width", "0");
  svg.setAttribute("height", "0");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.style.position = "absolute";
  svg.style.width = "0";
  svg.style.height = "0";
  svg.style.overflow = "hidden";
  svg.style.pointerEvents = "none";
  document.body.append(svg);
  return svg;
}

function parseArtworkSize(svg: SVGSVGElement) {
  const viewBox = svg.getAttribute("viewBox")?.trim().split(/\s+/).map(Number);
  const widthAttr = Number(svg.getAttribute("width"));
  const heightAttr = Number(svg.getAttribute("height"));

  if (viewBox?.length === 4 && viewBox.every(Number.isFinite) && viewBox[2] > 0 && viewBox[3] > 0) {
    return { width: viewBox[2], height: viewBox[3] };
  }

  return {
    width: Number.isFinite(widthAttr) && widthAttr > 0 ? widthAttr : DEFAULT_ARTWORK_WIDTH,
    height: Number.isFinite(heightAttr) && heightAttr > 0 ? heightAttr : DEFAULT_ARTWORK_HEIGHT,
  };
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
  center: Point,
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
  const radius = clamp(distanceToArc * 0.58, fontSize * 0.32, fontSize * 0.68);
  const inward = normalizeVector(center.x - midpoint.x, center.y - midpoint.y, 0, 1);
  const inset = radius + fontSize * 0.18;

  return {
    x: midpoint.x + inward.x * inset,
    y: midpoint.y + inward.y * inset,
    radius,
    phase: (index * 0.91 + midpoint.x * 0.017 + midpoint.y * 0.011) % TWO_PI,
  };
}

function parseCornerGears(d: string, fontSize: number, center: Point) {
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
        const gear = createGearPoint(
          start,
          controlA,
          controlB,
          end,
          fontSize,
          center,
          gears.length,
        );

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

function rebuildTypography() {
  for (const shape of shapes) {
    shape.fontSize = clamp(shape.baseFontSize * FONT_SCALE, 8, 96);
    shape.glyphs = buildCharacterBelt(
      TOKENS,
      shape.fontSize * 0.78,
      shape.length + shape.fontSize * 2,
      shape.id * 2,
    );
    shape.gears = parseCornerGears(shape.d, shape.fontSize, { x: shape.cx, y: shape.cy });
  }
}

async function loadArtwork() {
  const response = await fetch(ARTWORK_URL);

  if (!response.ok) {
    throw new Error(`Could not load Figma artwork (${response.status}).`);
  }

  const svgText = await response.text();
  const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
  artworkSize = parseArtworkSize(doc.documentElement as unknown as SVGSVGElement);
  const paths = Array.from(doc.querySelectorAll("path[stroke='#F8F8F8']"));
  const measurementSvg = createMeasurementSvg(artworkSize.width, artworkSize.height);

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
      baseFontSize: fontSize,
      glyphs: [],
      fontSize,
      textPhase: (index * 53) % motion.length,
      gears: [],
    };
  });

  if (shapes.length === 0) {
    throw new Error("Figma artwork does not contain polygon stroke paths.");
  }

  rebuildTypography();
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
  const isPortrait = height > width;
  const marginX = isPortrait ? 1 : 0.94;
  const marginY = isPortrait ? 0.98 : 0.92;
  const scale = Math.min(
    (width * marginX) / artworkSize.width,
    (height * marginY) / artworkSize.height,
  );

  fit = {
    width: artworkSize.width,
    height: artworkSize.height,
    scale,
    x: (width - artworkSize.width * scale) / 2,
    y: (height - artworkSize.height * scale) / 2,
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

function glyphDistanceForShape(
  shape: ArtworkShape,
  glyph: BeltGlyph,
  elapsedSeconds: number,
) {
  const motion = reduceMotionQuery.matches
    ? 0
    : elapsedSeconds * shape.speed * 0.92 * shape.direction;

  return glyph.distance + shape.textPhase + motion;
}

function pointerToArtworkPoint(event: PointerEvent) {
  const bounds = canvas.getBoundingClientRect();
  const x = event.clientX - bounds.left;
  const y = event.clientY - bounds.top;

  if (fit.scale <= 0) return null;

  return {
    x: (x - fit.x) / fit.scale,
    y: (y - fit.y) / fit.scale,
  };
}

function createPaintBrush(point: Point, color: string): PaintBrush {
  return {
    x: point.x,
    y: point.y,
    radius: PAINT_BRUSH_RADIUS_PX / Math.max(0.001, fit.scale),
    color,
  };
}

function queuePaintBrush(brush: PaintBrush) {
  pendingPaintBrushes.push(brush);

  if (pendingPaintBrushes.length > MAX_PENDING_PAINT_BRUSHES) {
    pendingPaintBrushes.splice(0, pendingPaintBrushes.length - MAX_PENDING_PAINT_BRUSHES);
  }
}

function queuePaintStroke(from: Point, to: Point, color: string) {
  const radius = PAINT_BRUSH_RADIUS_PX / Math.max(0.001, fit.scale);
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const steps = Math.min(
    MAX_STROKE_SAMPLES_PER_EVENT,
    Math.max(1, Math.ceil(distance / Math.max(1, radius * PAINT_STROKE_STEP_RATIO))),
  );

  for (let step = 1; step <= steps; step++) {
    const t = step / steps;
    queuePaintBrush({
      x: from.x + (to.x - from.x) * t,
      y: from.y + (to.y - from.y) * t,
      radius,
      color,
    });
  }
}

function collectShapeBrushes(shape: ArtworkShape) {
  shapeBrushes.length = 0;

  for (const brush of pendingPaintBrushes) {
    const reach = brush.radius + shape.fontSize;

    if (
      brush.x + reach >= shape.bounds.minX &&
      brush.x - reach <= shape.bounds.maxX &&
      brush.y + reach >= shape.bounds.minY &&
      brush.y - reach <= shape.bounds.maxY
    ) {
      shapeBrushes.push(brush);
    }
  }

  return shapeBrushes;
}

function paintGlyphAtPoint(glyph: BeltGlyph, x: number, y: number, brushes: PaintBrush[]) {
  for (const brush of brushes) {
    const dx = x - brush.x;
    const dy = y - brush.y;

    if (dx * dx + dy * dy <= brush.radius * brush.radius) {
      glyph.paintColor = brush.color;
    }
  }
}

function startDragPaint(event: PointerEvent) {
  const point = pointerToArtworkPoint(event);
  if (!point) return;

  event.preventDefault();
  const color = GOOGLE_COLORS[paintStrokeIndex % GOOGLE_COLORS.length];
  paintStrokeIndex++;
  dragPaint = {
    ...createPaintBrush(point, color),
    pointerId: event.pointerId,
  };
  canvas.setPointerCapture(event.pointerId);
  queuePaintBrush({ ...dragPaint });
}

function moveDragPaint(event: PointerEvent) {
  if (!dragPaint || dragPaint.pointerId !== event.pointerId) return;

  const point = pointerToArtworkPoint(event);
  if (!point) return;

  event.preventDefault();
  queuePaintStroke(dragPaint, point, dragPaint.color);
  dragPaint.x = point.x;
  dragPaint.y = point.y;
  dragPaint.radius = PAINT_BRUSH_RADIUS_PX / Math.max(0.001, fit.scale);
}

function stopDragPaint(event: PointerEvent) {
  if (!dragPaint || dragPaint.pointerId !== event.pointerId) return;

  if (canvas.hasPointerCapture(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }

  dragPaint = null;
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
  const brushes = pendingPaintBrushes.length > 0 ? collectShapeBrushes(shape) : null;

  ctx.save();
  ctx.font = `800 ${shape.fontSize}px ${FONT_STACK}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.shadowBlur = 0;

  for (const glyph of shape.glyphs) {
    const point = pointAtShape(shape, glyphDistanceForShape(shape, glyph, elapsedSeconds));

    if (brushes && brushes.length > 0) {
      paintGlyphAtPoint(
        glyph,
        point.x - point.nx * shape.fontSize * GLYPH_HIT_CENTER_RATIO,
        point.y - point.ny * shape.fontSize * GLYPH_HIT_CENTER_RATIO,
        brushes,
      );
    }

    ctx.save();
    ctx.transform(point.tx, point.ty, point.nx, point.ny, point.x, point.y);
    ctx.fillStyle = glyph.paintColor ?? "rgba(248, 248, 248, 0.84)";
    ctx.shadowColor = glyph.paintColor ?? "transparent";
    ctx.shadowBlur = glyph.paintColor ? Math.max(1.5, shape.fontSize * 0.1) : 0;
    ctx.fillText(glyph.char, 0, 0);
    ctx.restore();
  }

  ctx.restore();
}

function drawGear(gear: GearPoint, shape: ArtworkShape, elapsedSeconds: number) {
  const spin = reduceMotionQuery.matches
    ? gear.phase
    : gear.phase + (elapsedSeconds * shape.speed * shape.direction) / Math.max(1, gear.radius);
  const dashLength = Math.max(4, gear.radius * 0.58);
  const gapLength = Math.max(3, gear.radius * 0.34);

  ctx.save();
  ctx.translate(gear.x, gear.y);
  ctx.rotate(spin);
  ctx.strokeStyle = "rgba(248, 248, 248, 0.96)";
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(3.5, gear.radius * 0.24);
  ctx.setLineDash([dashLength, gapLength]);

  ctx.beginPath();
  ctx.arc(0, 0, gear.radius, 0, TWO_PI);
  ctx.stroke();

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

  pendingPaintBrushes.length = 0;

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

canvas.addEventListener("pointerdown", startDragPaint);
canvas.addEventListener("pointermove", moveDragPaint);
canvas.addEventListener("pointerup", stopDragPaint);
canvas.addEventListener("pointercancel", stopDragPaint);
canvas.addEventListener("lostpointercapture", () => {
  dragPaint = null;
});

void loadArtwork().catch((error: unknown) => {
  loadError = error instanceof Error ? error.message : "Failed to load artwork.";
});

requestAnimationFrame(render);
