type MarbleCircle = {
  x: number;
  y: number;
  rx: number;
  ry: number;
  color: string;
  rotation: number;
};

type View = {
  width: number;
  height: number;
  dpr: number;
  bandY: number;
  bandHeight: number;
  cx: number;
  cy: number;
  radius: number;
};

const canvas = document.getElementById('artwork') as HTMLCanvasElement;
const ctx = canvas.getContext('2d', { alpha: false });

if (!ctx) {
  throw new Error('2D canvas is not supported.');
}

const ballCanvas = document.createElement('canvas');
const ballCtx = ballCanvas.getContext('2d');

if (!ballCtx) {
  throw new Error('2D canvas is not supported.');
}

const motifWidth = 2.34;
const motifHeight = 2.08;

const marbleCircles: MarbleCircle[] = [
  { x: -0.7, y: -0.62, rx: 0.42, ry: 0.28, color: '#f15b2e', rotation: -0.34 },
  { x: -0.18, y: -0.72, rx: 0.28, ry: 0.2, color: '#ffe25f', rotation: 0.14 },
  { x: 0.38, y: -0.65, rx: 0.42, ry: 0.27, color: '#a51b4e', rotation: 0.46 },
  { x: 0.82, y: -0.2, rx: 0.42, ry: 0.28, color: '#ff8d24', rotation: -0.2 },
  { x: -0.68, y: -0.02, rx: 0.48, ry: 0.3, color: '#0c2241', rotation: -0.48 },
  { x: -0.08, y: 0.18, rx: 0.5, ry: 0.32, color: '#76d650', rotation: -0.06 },
  { x: 0.44, y: 0.08, rx: 0.48, ry: 0.32, color: '#ff6d2b', rotation: 0.12 },
  { x: 0.82, y: 0.42, rx: 0.38, ry: 0.28, color: '#159b80', rotation: -0.2 },
  { x: -0.48, y: 0.52, rx: 0.38, ry: 0.25, color: '#4b9fd1', rotation: 0.3 },
  { x: 0.08, y: 0.72, rx: 0.5, ry: 0.32, color: '#153f6a', rotation: -0.44 },
  { x: 0.56, y: 0.7, rx: 0.36, ry: 0.25, color: '#f66a7c', rotation: 0.28 },
];

let view: View = {
  width: 1,
  height: 1,
  dpr: 1,
  bandY: 0,
  bandHeight: 1,
  cx: 0,
  cy: 0,
  radius: 1,
};

let offsetX = 0.08;
let offsetY = -0.08;
let targetOffsetX = 0.08;
let targetOffsetY = -0.08;
let velocityX = 0;
let velocityY = 0;
let pointerId: number | null = null;
let lastPointerX = 0;
let lastPointerY = 0;
let glintX = -0.34;
let glintY = -0.38;
let targetGlintX = -0.34;
let targetGlintY = -0.38;
let glintAlpha = 0.18;
let targetGlintAlpha = 0.18;
let lastFrame = 0;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function wrapCentered(value: number, period: number): number {
  return (((value + period * 0.5) % period) + period) % period - period * 0.5;
}

function normalDotCamera(x: number, y: number): number {
  const radial = clamp(Math.hypot(x, y), 0, 0.999);
  return Math.sqrt(1 - radial * radial);
}

function scaleFromNormalDot(dot: number): number {
  return mix(0.22, 1.04, dot ** 0.72);
}

function resize(): void {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const bandHeight = clamp(height * 0.26, 260, 360);
  const radius = clamp(Math.min(width * 0.18, bandHeight * 0.34), 82, 148);

  view = {
    width,
    height,
    dpr,
    bandY: (height - bandHeight) / 2,
    bandHeight,
    cx: width / 2,
    cy: height / 2 + radius * 0.06,
    radius,
  };

  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const ballSize = Math.max(2, Math.round(radius * 2 * dpr));
  ballCanvas.width = ballSize;
  ballCanvas.height = ballSize;
}

function drawCircleItem(
  context: CanvasRenderingContext2D,
  circle: MarbleCircle,
  x: number,
  y: number,
  dot: number,
): void {
  const radius = view.radius;
  const sizeScale = scaleFromNormalDot(dot);
  const squash = mix(0.68, 1, smoothstep(0, 0.82, dot));
  const alpha = mix(0.74, 1, smoothstep(0, 0.9, dot));
  const cx = radius + x * radius;
  const cy = radius + y * radius;

  context.save();
  context.translate(cx, cy);
  context.rotate(circle.rotation + offsetX * 0.08 - offsetY * 0.04);
  context.scale(sizeScale, sizeScale * squash);
  context.globalAlpha = alpha;
  context.fillStyle = circle.color;
  context.beginPath();
  context.ellipse(0, 0, circle.rx * radius, circle.ry * radius, 0, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

function drawInternalCuts(context: CanvasRenderingContext2D, originX: number, originY: number): void {
  const radius = view.radius;

  context.save();
  context.translate(radius + originX * radius, radius + originY * radius);
  context.scale(radius, radius);
  context.strokeStyle = '#fffefb';
  context.lineCap = 'round';
  context.lineJoin = 'round';

  context.lineWidth = 0.16;
  context.beginPath();
  context.moveTo(-1.08, -0.1);
  context.bezierCurveTo(-0.7, -0.52, -0.24, -0.58, 0.2, -0.22);
  context.bezierCurveTo(0.58, 0.08, 0.88, -0.02, 1.08, -0.28);
  context.stroke();

  context.lineWidth = 0.12;
  context.beginPath();
  context.moveTo(-0.64, 0.92);
  context.bezierCurveTo(-0.38, 0.38, 0.18, 0.32, 0.56, 0.86);
  context.stroke();

  context.lineWidth = 0.07;
  context.strokeStyle = 'rgba(255, 254, 251, 0.72)';
  context.beginPath();
  context.moveTo(-0.96, -0.74);
  context.bezierCurveTo(-0.46, -0.5, 0.06, -0.62, 0.62, -0.52);
  context.bezierCurveTo(0.9, -0.48, 1.1, -0.58, 1.26, -0.74);
  context.stroke();
  context.restore();
}

function drawMarbleContents(): void {
  const wrappedX = wrapCentered(offsetX, motifWidth);
  const wrappedY = wrapCentered(offsetY, motifHeight);
  const visibleItems: Array<MarbleCircle & { cx: number; cy: number; dot: number }> = [];

  for (let tileY = -1; tileY <= 1; tileY += 1) {
    for (let tileX = -1; tileX <= 1; tileX += 1) {
      for (const circle of marbleCircles) {
        const cx = circle.x + wrappedX + tileX * motifWidth;
        const cy = circle.y + wrappedY + tileY * motifHeight;
        const reach = Math.max(circle.rx, circle.ry) * 1.15;

        if (Math.hypot(cx, cy) > 1 + reach) {
          continue;
        }

        visibleItems.push({ ...circle, cx, cy, dot: normalDotCamera(cx, cy) });
      }
    }
  }

  visibleItems.sort((a, b) => a.dot - b.dot);

  for (const item of visibleItems) {
    drawCircleItem(ballCtx, item, item.cx, item.cy, item.dot);
  }

  for (let tileY = -1; tileY <= 1; tileY += 1) {
    for (let tileX = -1; tileX <= 1; tileX += 1) {
      const originX = wrappedX + tileX * motifWidth;
      const originY = wrappedY + tileY * motifHeight;

      if (Math.hypot(originX, originY) < 1.62) {
        drawInternalCuts(ballCtx, originX, originY);
      }
    }
  }
}

function drawGlassShell(): void {
  const radius = view.radius;
  const size = radius * 2;

  ballCtx.save();
  ballCtx.beginPath();
  ballCtx.arc(radius, radius, radius, 0, Math.PI * 2);
  ballCtx.clip();

  const milk = ballCtx.createRadialGradient(radius * 0.44, radius * 0.38, radius * 0.18, radius, radius, radius);
  milk.addColorStop(0, 'rgba(255, 255, 255, 0.08)');
  milk.addColorStop(0.48, 'rgba(255, 255, 255, 0.02)');
  milk.addColorStop(0.76, 'rgba(255, 255, 255, 0.08)');
  milk.addColorStop(1, 'rgba(232, 238, 255, 0.24)');
  ballCtx.fillStyle = milk;
  ballCtx.fillRect(0, 0, size, size);

  const shade = ballCtx.createLinearGradient(0, 0, size, size);
  shade.addColorStop(0, 'rgba(255, 255, 255, 0.1)');
  shade.addColorStop(0.42, 'rgba(255, 255, 255, 0)');
  shade.addColorStop(1, 'rgba(80, 84, 124, 0.12)');
  ballCtx.fillStyle = shade;
  ballCtx.fillRect(0, 0, size, size);
  ballCtx.restore();

  const rim = ballCtx.createLinearGradient(0, 0, size, size);
  rim.addColorStop(0, 'rgba(255, 255, 255, 0.74)');
  rim.addColorStop(0.36, 'rgba(255, 255, 255, 0.12)');
  rim.addColorStop(0.68, 'rgba(78, 86, 128, 0.24)');
  rim.addColorStop(1, 'rgba(255, 255, 255, 0.58)');

  ballCtx.lineWidth = Math.max(1.2, radius * 0.026);
  ballCtx.strokeStyle = rim;
  ballCtx.beginPath();
  ballCtx.arc(radius, radius, radius - ballCtx.lineWidth * 0.5, 0, Math.PI * 2);
  ballCtx.stroke();

  ballCtx.save();
  ballCtx.globalCompositeOperation = 'screen';

  ballCtx.fillStyle = 'rgba(255, 255, 255, 0.58)';
  ballCtx.beginPath();
  ballCtx.ellipse(radius * 0.66, radius * 0.46, radius * 0.18, radius * 0.055, -0.52, 0, Math.PI * 2);
  ballCtx.fill();

  ballCtx.fillStyle = `rgba(255, 255, 255, ${0.16 + glintAlpha * 0.5})`;
  ballCtx.beginPath();
  ballCtx.ellipse(
    radius + glintX * radius,
    radius + glintY * radius,
    radius * 0.1,
    radius * 0.04,
    -0.5,
    0,
    Math.PI * 2,
  );
  ballCtx.fill();
  ballCtx.restore();
}

function renderGlassBall(): void {
  const radius = view.radius;
  const size = radius * 2;

  ballCtx.setTransform(1, 0, 0, 1, 0, 0);
  ballCtx.clearRect(0, 0, ballCanvas.width, ballCanvas.height);
  ballCtx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);

  ballCtx.save();
  ballCtx.beginPath();
  ballCtx.arc(radius, radius, radius, 0, Math.PI * 2);
  ballCtx.clip();

  const base = ballCtx.createRadialGradient(radius * 0.5, radius * 0.42, radius * 0.2, radius, radius, radius);
  base.addColorStop(0, 'rgba(255, 255, 255, 0.12)');
  base.addColorStop(0.72, 'rgba(255, 255, 255, 0.02)');
  base.addColorStop(1, 'rgba(255, 255, 255, 0.16)');
  ballCtx.fillStyle = base;
  ballCtx.fillRect(0, 0, size, size);

  drawMarbleContents();
  ballCtx.restore();

  drawGlassShell();
}

function drawScene(): void {
  ctx.clearRect(0, 0, view.width, view.height);
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, view.width, view.height);
  ctx.fillStyle = '#fffefb';
  ctx.fillRect(0, view.bandY, view.width, view.bandHeight);

  const shadow = ctx.createRadialGradient(
    view.cx,
    view.cy + view.radius * 0.94,
    view.radius * 0.08,
    view.cx,
    view.cy + view.radius * 0.94,
    view.radius * 0.96,
  );
  shadow.addColorStop(0, 'rgba(0, 0, 0, 0.22)');
  shadow.addColorStop(0.5, 'rgba(0, 0, 0, 0.08)');
  shadow.addColorStop(1, 'rgba(0, 0, 0, 0)');

  ctx.save();
  ctx.scale(1, 0.22);
  ctx.fillStyle = shadow;
  ctx.beginPath();
  ctx.ellipse(
    view.cx,
    (view.cy + view.radius * 0.94) / 0.22,
    view.radius * 0.9,
    view.radius * 0.52,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.restore();

  renderGlassBall();
  ctx.drawImage(
    ballCanvas,
    view.cx - view.radius,
    view.cy - view.radius,
    view.radius * 2,
    view.radius * 2,
  );
}

function updateGlintFromPointer(clientX: number, clientY: number, active: boolean): void {
  const dx = (clientX - view.cx) / view.radius;
  const dy = (clientY - view.cy) / view.radius;
  const inside = dx * dx + dy * dy <= 1.12;

  if (inside) {
    targetGlintX = clamp(dx, -0.82, 0.82);
    targetGlintY = clamp(dy, -0.82, 0.82);
    targetGlintAlpha = active ? 1 : 0.42;
  } else {
    targetGlintX = -0.34;
    targetGlintY = -0.38;
    targetGlintAlpha = 0.18;
  }
}

function tick(now: number): void {
  const dt = Math.min(0.05, Math.max(0.001, (now - lastFrame) / 1000 || 0.016));
  lastFrame = now;

  if (pointerId === null) {
    targetOffsetX += velocityX * dt;
    targetOffsetY += velocityY * dt;
    velocityX *= 0.92;
    velocityY *= 0.92;

    if (Math.abs(velocityX) < 0.01) {
      velocityX = 0;
    }

    if (Math.abs(velocityY) < 0.01) {
      velocityY = 0;
    }
  }

  offsetX = mix(offsetX, targetOffsetX, 0.18);
  offsetY = mix(offsetY, targetOffsetY, 0.18);
  glintX = mix(glintX, targetGlintX, 0.18);
  glintY = mix(glintY, targetGlintY, 0.18);
  glintAlpha = mix(glintAlpha, targetGlintAlpha, 0.16);

  drawScene();
  requestAnimationFrame(tick);
}

canvas.addEventListener('pointerdown', (event) => {
  const dx = event.clientX - view.cx;
  const dy = event.clientY - view.cy;

  if (dx * dx + dy * dy > view.radius * view.radius * 1.28) {
    return;
  }

  pointerId = event.pointerId;
  lastPointerX = event.clientX;
  lastPointerY = event.clientY;
  velocityX = 0;
  velocityY = 0;
  canvas.setPointerCapture(event.pointerId);
  updateGlintFromPointer(event.clientX, event.clientY, true);
});

canvas.addEventListener('pointermove', (event) => {
  updateGlintFromPointer(event.clientX, event.clientY, pointerId === event.pointerId);

  if (pointerId !== event.pointerId) {
    return;
  }

  const dx = event.clientX - lastPointerX;
  const dy = event.clientY - lastPointerY;
  lastPointerX = event.clientX;
  lastPointerY = event.clientY;
  targetOffsetX += (dx / view.radius) * 0.52;
  targetOffsetY += (dy / view.radius) * 0.52;
  velocityX = (dx / view.radius) * 5.5;
  velocityY = (dy / view.radius) * 5.5;
});

canvas.addEventListener('pointerup', (event) => {
  if (pointerId !== event.pointerId) {
    return;
  }

  pointerId = null;
  targetGlintAlpha = 0.28;
  canvas.releasePointerCapture(event.pointerId);
});

canvas.addEventListener('pointercancel', (event) => {
  if (pointerId !== event.pointerId) {
    return;
  }

  pointerId = null;
  targetGlintAlpha = 0.18;
});

canvas.addEventListener('pointerleave', () => {
  if (pointerId === null) {
    targetGlintAlpha = 0.18;
  }
});

window.addEventListener('resize', resize);

resize();
requestAnimationFrame(tick);
