type PlaneBlob = {
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

type RGB = [number, number, number];

const canvas = document.getElementById('artwork') as HTMLCanvasElement;
const ctx = canvas.getContext('2d', { alpha: false });

if (!ctx) {
  throw new Error('2D canvas is not supported.');
}

const sourceCanvas = document.createElement('canvas');
const sourceCtx = sourceCanvas.getContext('2d', { alpha: false });

if (!sourceCtx) {
  throw new Error('2D canvas is not supported.');
}

const ballCanvas = document.createElement('canvas');
const ballCtx = ballCanvas.getContext('2d');

if (!ballCtx) {
  throw new Error('2D canvas is not supported.');
}

const planeBlobs: PlaneBlob[] = [
  { x: -1.2, y: -0.64, rx: 0.58, ry: 0.34, color: '#f15b2e', rotation: -0.34 },
  { x: -0.35, y: -0.76, rx: 0.42, ry: 0.3, color: '#ffe25f', rotation: 0.22 },
  { x: 0.48, y: -0.68, rx: 0.62, ry: 0.38, color: '#a51b4e', rotation: 0.42 },
  { x: 1.28, y: -0.38, rx: 0.48, ry: 0.34, color: '#ff8d24', rotation: -0.18 },
  { x: -1.02, y: 0.1, rx: 0.68, ry: 0.4, color: '#0c2241', rotation: -0.5 },
  { x: -0.22, y: 0.36, rx: 0.74, ry: 0.45, color: '#76d650', rotation: -0.05 },
  { x: 0.74, y: 0.12, rx: 0.68, ry: 0.42, color: '#ff6d2b', rotation: 0.12 },
  { x: 1.42, y: 0.36, rx: 0.5, ry: 0.4, color: '#ff4434', rotation: -0.24 },
  { x: -0.85, y: 0.92, rx: 0.54, ry: 0.36, color: '#2d98d1', rotation: 0.34 },
  { x: -0.05, y: 1.08, rx: 0.78, ry: 0.48, color: '#153f6a', rotation: -0.46 },
  { x: 0.86, y: 0.96, rx: 0.56, ry: 0.38, color: '#f66a7c', rotation: 0.28 },
  { x: 1.52, y: 1.0, rx: 0.5, ry: 0.34, color: '#159b80', rotation: -0.34 },
];

let sourceData: ImageData | null = null;
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

let offsetX = -34;
let offsetY = -12;
let targetOffsetX = -34;
let targetOffsetY = -12;
let velocityX = 18;
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

function drawBlob(context: CanvasRenderingContext2D, blob: PlaneBlob, originX: number, originY: number): void {
  const radius = view.radius;

  context.save();
  context.translate(originX + blob.x * radius, originY + blob.y * radius);
  context.rotate(blob.rotation);
  context.fillStyle = blob.color;
  context.beginPath();
  context.ellipse(0, 0, blob.rx * radius, blob.ry * radius, 0, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

function drawNegativeSpace(context: CanvasRenderingContext2D, originX: number, originY: number): void {
  const radius = view.radius;

  context.save();
  context.translate(originX, originY);
  context.strokeStyle = '#fffefb';
  context.lineCap = 'round';
  context.lineJoin = 'round';

  context.lineWidth = radius * 0.34;
  context.beginPath();
  context.moveTo(-1.72 * radius, -0.02 * radius);
  context.bezierCurveTo(-1.08 * radius, -0.64 * radius, -0.38 * radius, -0.82 * radius, 0.36 * radius, -0.24 * radius);
  context.bezierCurveTo(0.96 * radius, 0.22 * radius, 1.46 * radius, -0.08 * radius, 1.86 * radius, -0.52 * radius);
  context.stroke();

  context.lineWidth = radius * 0.22;
  context.beginPath();
  context.moveTo(-0.9 * radius, 1.28 * radius);
  context.bezierCurveTo(-0.42 * radius, 0.46 * radius, 0.28 * radius, 0.44 * radius, 0.84 * radius, 1.22 * radius);
  context.stroke();

  context.lineWidth = radius * 0.14;
  context.strokeStyle = 'rgba(255, 254, 251, 0.76)';
  context.beginPath();
  context.moveTo(-1.64 * radius, -0.88 * radius);
  context.bezierCurveTo(-0.86 * radius, -0.62 * radius, -0.1 * radius, -0.86 * radius, 0.7 * radius, -0.7 * radius);
  context.bezierCurveTo(1.18 * radius, -0.62 * radius, 1.54 * radius, -0.72 * radius, 1.92 * radius, -1.0 * radius);
  context.stroke();
  context.restore();
}

function drawPlaneMotif(context: CanvasRenderingContext2D, originX: number, originY: number): void {
  for (const blob of planeBlobs) {
    drawBlob(context, blob, originX, originY);
  }

  drawNegativeSpace(context, originX, originY);
}

function drawSourcePlane(): void {
  const repeatX = view.radius * 7.6;
  const repeatY = view.radius * 4.2;
  const shiftX = Math.sin(offsetX / (view.radius * 2.4)) * view.radius * 0.86;
  const shiftY = Math.sin(offsetY / (view.radius * 2.1)) * view.radius * 0.42;

  sourceCtx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  sourceCtx.fillStyle = '#000000';
  sourceCtx.fillRect(0, 0, view.width, view.height);
  sourceCtx.fillStyle = '#fffefb';
  sourceCtx.fillRect(0, view.bandY, view.width, view.bandHeight);

  sourceCtx.save();
  sourceCtx.beginPath();
  sourceCtx.rect(0, view.bandY, view.width, view.bandHeight);
  sourceCtx.clip();

  const startX = view.cx + shiftX - repeatX * 2;
  const endX = view.width + repeatX * 2;
  const startY = view.cy + shiftY - repeatY * 2;
  const endY = view.height + repeatY * 2;

  for (let y = startY; y < endY; y += repeatY) {
    for (let x = startX; x < endX; x += repeatX) {
      drawPlaneMotif(sourceCtx, x, y);
    }
  }

  sourceCtx.globalCompositeOperation = 'multiply';
  sourceCtx.strokeStyle = 'rgba(21, 31, 40, 0.12)';
  sourceCtx.lineWidth = view.radius * 0.048;
  sourceCtx.beginPath();
  sourceCtx.moveTo(view.cx - view.radius * 2.0 + shiftX * 0.2, view.cy + view.radius * 0.32 + shiftY * 0.1);
  sourceCtx.bezierCurveTo(
    view.cx - view.radius * 1.0,
    view.cy + view.radius * 1.0,
    view.cx + view.radius * 0.24,
    view.cy - view.radius * 0.38,
    view.cx + view.radius * 1.68,
    view.cy + view.radius * 0.58,
  );
  sourceCtx.stroke();
  sourceCtx.restore();

  sourceData = sourceCtx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
}

function sampleSourcePlane(x: number, y: number): RGB {
  if (!sourceData) {
    return [255, 255, 255];
  }

  const width = sourceCanvas.width;
  const height = sourceCanvas.height;
  const minY = (view.bandY + 2) * view.dpr;
  const maxY = (view.bandY + view.bandHeight - 2) * view.dpr;
  const sampleX = clamp(x * view.dpr, 0, width - 1.001);
  const sampleY = clamp(y * view.dpr, minY, Math.min(maxY, height - 1.001));
  const x0 = Math.floor(sampleX);
  const y0 = Math.floor(sampleY);
  const x1 = Math.min(x0 + 1, width - 1);
  const y1 = Math.min(y0 + 1, height - 1);
  const fx = sampleX - x0;
  const fy = sampleY - y0;

  const i00 = (y0 * width + x0) * 4;
  const i10 = (y0 * width + x1) * 4;
  const i01 = (y1 * width + x0) * 4;
  const i11 = (y1 * width + x1) * 4;
  const rgb: RGB = [0, 0, 0];

  for (let channel = 0; channel < 3; channel += 1) {
    const top = mix(sourceData.data[i00 + channel], sourceData.data[i10 + channel], fx);
    const bottom = mix(sourceData.data[i01 + channel], sourceData.data[i11 + channel], fx);
    rgb[channel] = mix(top, bottom, fy);
  }

  return rgb;
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

  sourceCanvas.width = canvas.width;
  sourceCanvas.height = canvas.height;

  const ballSize = Math.max(2, Math.round(radius * 2 * dpr));
  ballCanvas.width = ballSize;
  ballCanvas.height = ballSize;
}

function sampleLensContent(nx: number, ny: number, nz: number, radial: number): RGB {
  const dirX = radial > 0.001 ? nx / radial : 0;
  const dirY = radial > 0.001 ? ny / radial : 0;
  const tangentX = -dirY;
  const tangentY = dirX;
  const screenX = view.cx + nx * view.radius;
  const screenY = view.cy + ny * view.radius;
  const edgeT = smoothstep(0.54, 1, radial);
  const glassBend = (1 - nz) * view.radius * 0.16;
  const rimPull = edgeT ** 1.75 * view.radius * 0.86;
  const radialPull = radial ** 2.2 * view.radius * 0.12;
  const swirl = edgeT ** 1.55 * view.radius * 0.19;
  const sourceX = screenX + dirX * (glassBend + rimPull + radialPull) + tangentX * swirl;
  const sourceY = screenY + dirY * (glassBend + rimPull * 0.74 + radialPull) + tangentY * swirl * 0.52;
  const smear = edgeT ** 1.35 * view.radius * 0.42;
  const aberration = edgeT ** 1.45 * view.radius * 0.055;

  const red = sampleSourcePlane(sourceX + dirX * aberration + tangentX * aberration * 0.35, sourceY + dirY * aberration);
  const green = sampleSourcePlane(sourceX, sourceY);
  const blue = sampleSourcePlane(sourceX - dirX * aberration, sourceY - dirY * aberration + tangentY * aberration * 0.28);
  const radialFar = sampleSourcePlane(sourceX + dirX * smear * 1.38, sourceY + dirY * smear * 1.08);
  const radialNear = sampleSourcePlane(sourceX - dirX * smear * 0.68, sourceY - dirY * smear * 0.52);
  const tangentA = sampleSourcePlane(sourceX + tangentX * smear * 0.72, sourceY + tangentY * smear * 0.52);
  const tangentB = sampleSourcePlane(sourceX - tangentX * smear * 0.64, sourceY - tangentY * smear * 0.5);
  const smearMix = edgeT * 0.66;

  let r = mix(red[0], radialFar[0] * 0.66 + tangentA[0] * 0.34, smearMix);
  let g = mix(green[1], radialFar[1] * 0.44 + radialNear[1] * 0.28 + tangentB[1] * 0.28, smearMix * 0.82);
  let b = mix(blue[2], radialNear[2] * 0.58 + tangentA[2] * 0.42, smearMix);

  const centerLift = smoothstep(0.88, 0, radial) * 10;
  const glassMilk = 0.04 + edgeT * 0.26 + smoothstep(0.86, 1, radial) * 0.2;
  r = mix(r + centerLift, 255, glassMilk);
  g = mix(g + centerLift, 255, glassMilk);
  b = mix(b + centerLift, 255, glassMilk * 0.9);

  const directionalLight = Math.max(0, nx * -0.36 + ny * -0.48 + nz * 0.88);
  const innerShade = 0.86 + nz * 0.16 + directionalLight * 0.08 - edgeT * 0.12;
  return [
    clamp(r * innerShade, 0, 255),
    clamp(g * innerShade, 0, 255),
    clamp(b * innerShade, 0, 255),
  ];
}

function renderGlassBall(): void {
  const size = ballCanvas.width;
  const image = ballCtx.createImageData(size, size);
  const data = image.data;
  const radiusPx = size * 0.5;

  for (let y = 0; y < size; y += 1) {
    const ny = (y + 0.5) / radiusPx - 1;
    for (let x = 0; x < size; x += 1) {
      const nx = (x + 0.5) / radiusPx - 1;
      const radialSq = nx * nx + ny * ny;
      const index = (y * size + x) * 4;

      if (radialSq > 1) {
        data[index + 3] = 0;
        continue;
      }

      const radial = Math.sqrt(radialSq);
      const nz = Math.sqrt(1 - radialSq);
      const [sampleR, sampleG, sampleB] = sampleLensContent(nx, ny, nz, radial);
      const rim = smoothstep(0.7, 1, radial);
      const hardRim = smoothstep(0.9, 1, radial);
      const topWash = smoothstep(0.2, -0.82, ny) * smoothstep(0.98, 0.18, radial);
      const sideCool = smoothstep(0.45, 1, radial) * smoothstep(-0.1, 0.85, nx);
      const caRim = smoothstep(0.78, 1, radial);
      const specA = Math.max(0, 1 - Math.hypot(nx + 0.42, ny + 0.52) / 0.21) ** 3.8;
      const specB = Math.max(0, 1 - Math.hypot(nx - 0.36, ny + 0.24) / 0.28) ** 4.6;
      const specC = Math.max(0, 1 - Math.hypot(nx + 0.04, ny + 0.28) / 0.48) ** 5.8;
      const specD = Math.max(0, 1 - Math.hypot(nx - 0.1, ny + 0.46) / 0.17) ** 4.2;
      const pointerSpec = Math.max(0, 1 - Math.hypot(nx - glintX, ny - glintY) / 0.2) ** 3.6 * glintAlpha;
      const shell = specA * 150 + specB * 88 + specC * 16 + specD * 112 + pointerSpec * 150;

      let r = sampleR + shell + topWash * 20 + rim * 18 - hardRim * 8 + caRim * 13;
      let g = sampleG + shell + topWash * 22 + rim * 20 - hardRim * 10;
      let b = sampleB + shell + topWash * 30 + rim * 38 + sideCool * 12 - hardRim * 2;

      const edgeAlpha = smoothstep(1, 0.982, radial);
      data[index] = clamp(r, 0, 255);
      data[index + 1] = clamp(g, 0, 255);
      data[index + 2] = clamp(b, 0, 255);
      data[index + 3] = edgeAlpha * 255;
    }
  }

  ballCtx.putImageData(image, 0, 0);
}

function drawScene(): void {
  drawSourcePlane();
  ctx.clearRect(0, 0, view.width, view.height);
  ctx.drawImage(sourceCanvas, 0, 0, view.width, view.height);

  const shadow = ctx.createRadialGradient(
    view.cx,
    view.cy + view.radius * 0.93,
    view.radius * 0.08,
    view.cx,
    view.cy + view.radius * 0.93,
    view.radius * 0.96,
  );
  shadow.addColorStop(0, 'rgba(0, 0, 0, 0.2)');
  shadow.addColorStop(0.48, 'rgba(0, 0, 0, 0.08)');
  shadow.addColorStop(1, 'rgba(0, 0, 0, 0)');

  ctx.save();
  ctx.scale(1, 0.22);
  ctx.fillStyle = shadow;
  ctx.beginPath();
  ctx.ellipse(
    view.cx,
    (view.cy + view.radius * 0.93) / 0.22,
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

  const rim = ctx.createLinearGradient(
    view.cx - view.radius,
    view.cy - view.radius,
    view.cx + view.radius,
    view.cy + view.radius,
  );
  rim.addColorStop(0, 'rgba(255, 255, 255, 0.74)');
  rim.addColorStop(0.36, 'rgba(255, 255, 255, 0.1)');
  rim.addColorStop(0.68, 'rgba(84, 90, 126, 0.28)');
  rim.addColorStop(1, 'rgba(255, 255, 255, 0.58)');

  ctx.lineWidth = Math.max(1.2, view.radius * 0.025);
  ctx.strokeStyle = rim;
  ctx.beginPath();
  ctx.arc(view.cx, view.cy, view.radius - ctx.lineWidth * 0.5, 0, Math.PI * 2);
  ctx.stroke();

  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.42)';
  ctx.beginPath();
  ctx.ellipse(
    view.cx - view.radius * 0.34,
    view.cy - view.radius * 0.45,
    view.radius * 0.17,
    view.radius * 0.052,
    -0.52,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.restore();
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
    velocityX *= 0.992;
    velocityY *= 0.992;
    if (Math.abs(velocityX) < 6) {
      velocityX = 6;
    }
  }

  offsetX = mix(offsetX, targetOffsetX, 0.14);
  offsetY = mix(offsetY, targetOffsetY, 0.14);
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
  targetOffsetX -= dx * 2.8;
  targetOffsetY -= dy * 2.1;
  velocityX = -dx * 8;
  velocityY = -dy * 5.5;
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
