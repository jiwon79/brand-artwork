type MarbleCircle = {
  x: number;
  y: number;
  radius: number;
  color: string;
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

type RGBA = [number, number, number, number];

const canvas = document.getElementById('artwork') as HTMLCanvasElement;
const ctx = canvas.getContext('2d', { alpha: false });

if (!ctx) {
  throw new Error('2D canvas is not supported.');
}

const contentCanvas = document.createElement('canvas');
const contentCtx = contentCanvas.getContext('2d', { alpha: false });

if (!contentCtx) {
  throw new Error('2D canvas is not supported.');
}

const ballCanvas = document.createElement('canvas');
const ballCtx = ballCanvas.getContext('2d');

if (!ballCtx) {
  throw new Error('2D canvas is not supported.');
}

const motifWidth = 2.22;
const motifHeight = 2.02;

const marbleCircles: MarbleCircle[] = [
  { x: -0.7, y: -0.6, radius: 0.26, color: '#f15b2e' },
  { x: -0.2, y: -0.72, radius: 0.2, color: '#ffe25f' },
  { x: 0.36, y: -0.66, radius: 0.28, color: '#a51b4e' },
  { x: 0.82, y: -0.23, radius: 0.3, color: '#ff8d24' },
  { x: -0.68, y: -0.03, radius: 0.34, color: '#0c2241' },
  { x: -0.1, y: 0.2, radius: 0.36, color: '#76d650' },
  { x: 0.42, y: 0.08, radius: 0.34, color: '#ff6d2b' },
  { x: 0.84, y: 0.42, radius: 0.28, color: '#159b80' },
  { x: -0.48, y: 0.54, radius: 0.28, color: '#4b9fd1' },
  { x: 0.1, y: 0.74, radius: 0.34, color: '#153f6a' },
  { x: 0.58, y: 0.7, radius: 0.25, color: '#f66a7c' },
];

let contentData: ImageData | null = null;
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
  return mix(0.2, 1.02, dot ** 0.72);
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
  contentCanvas.width = ballSize;
  contentCanvas.height = ballSize;
}

function drawContentCircle(circle: MarbleCircle, x: number, y: number, dot: number): void {
  const radius = view.radius;
  const size = circle.radius * radius * scaleFromNormalDot(dot);
  const alpha = mix(0.76, 1, smoothstep(0, 0.86, dot));

  contentCtx.save();
  contentCtx.globalAlpha = alpha;
  contentCtx.fillStyle = circle.color;
  contentCtx.beginPath();
  contentCtx.arc(radius + x * radius, radius + y * radius, size, 0, Math.PI * 2);
  contentCtx.fill();
  contentCtx.restore();
}

function drawContentLayer(): void {
  const radius = view.radius;
  const size = radius * 2;
  const wrappedX = wrapCentered(offsetX, motifWidth);
  const wrappedY = wrapCentered(offsetY, motifHeight);
  const visibleItems: Array<MarbleCircle & { cx: number; cy: number; dot: number }> = [];

  contentCtx.setTransform(1, 0, 0, 1, 0, 0);
  contentCtx.clearRect(0, 0, contentCanvas.width, contentCanvas.height);
  contentCtx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);

  contentCtx.fillStyle = '#fffefb';
  contentCtx.fillRect(0, 0, size, size);

  contentCtx.save();
  contentCtx.beginPath();
  contentCtx.arc(radius, radius, radius, 0, Math.PI * 2);
  contentCtx.clip();

  for (let tileY = -1; tileY <= 1; tileY += 1) {
    for (let tileX = -1; tileX <= 1; tileX += 1) {
      for (const circle of marbleCircles) {
        const cx = circle.x + wrappedX + tileX * motifWidth;
        const cy = circle.y + wrappedY + tileY * motifHeight;
        const reach = circle.radius * 1.15;

        if (Math.hypot(cx, cy) > 1 + reach) {
          continue;
        }

        visibleItems.push({ ...circle, cx, cy, dot: normalDotCamera(cx, cy) });
      }
    }
  }

  visibleItems.sort((a, b) => a.dot - b.dot);

  for (const item of visibleItems) {
    drawContentCircle(item, item.cx, item.cy, item.dot);
  }

  contentCtx.restore();
  contentData = contentCtx.getImageData(0, 0, contentCanvas.width, contentCanvas.height);
}

function sampleContent(x: number, y: number): RGBA {
  if (!contentData) {
    return [255, 254, 251, 255];
  }

  const width = contentCanvas.width;
  const height = contentCanvas.height;
  const sampleX = clamp(x * view.dpr, 0, width - 1.001);
  const sampleY = clamp(y * view.dpr, 0, height - 1.001);
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
  const rgba: RGBA = [0, 0, 0, 0];

  for (let channel = 0; channel < 4; channel += 1) {
    const top = mix(contentData.data[i00 + channel], contentData.data[i10 + channel], fx);
    const bottom = mix(contentData.data[i01 + channel], contentData.data[i11 + channel], fx);
    rgba[channel] = mix(top, bottom, fy);
  }

  return rgba;
}

function sampleLiquidGlass(nx: number, ny: number, nz: number, radial: number): RGBA {
  const radius = view.radius;
  const dirX = radial > 0.001 ? nx / radial : 0;
  const dirY = radial > 0.001 ? ny / radial : 0;
  const tangentX = -dirY;
  const tangentY = dirX;
  const edgeT = smoothstep(0.56, 1, radial);
  const edgeFold = edgeT ** 1.75 * radius * 0.34;
  const tangentSlip = edgeT ** 1.45 * radius * 0.14;
  const sourceX = radius + nx * radius - dirX * edgeFold + tangentX * tangentSlip;
  const sourceY = radius + ny * radius - dirY * edgeFold + tangentY * tangentSlip * 0.58;
  const smear = edgeT ** 1.3 * radius * 0.18;
  const aberration = edgeT ** 1.4 * radius * 0.045;

  const red = sampleContent(sourceX + dirX * aberration, sourceY + dirY * aberration);
  const green = sampleContent(sourceX, sourceY);
  const blue = sampleContent(sourceX - dirX * aberration, sourceY - dirY * aberration);
  const radialSmear = sampleContent(sourceX - dirX * smear, sourceY - dirY * smear);
  const tangentSmearA = sampleContent(sourceX + tangentX * smear * 0.74, sourceY + tangentY * smear * 0.56);
  const tangentSmearB = sampleContent(sourceX - tangentX * smear * 0.62, sourceY - tangentY * smear * 0.46);
  const smearMix = edgeT * 0.52;

  return [
    mix(red[0], radialSmear[0] * 0.64 + tangentSmearA[0] * 0.36, smearMix),
    mix(green[1], radialSmear[1] * 0.5 + tangentSmearB[1] * 0.5, smearMix * 0.86),
    mix(blue[2], radialSmear[2] * 0.56 + tangentSmearA[2] * 0.44, smearMix),
    255,
  ];
}

function renderGlassBall(): void {
  drawContentLayer();

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
      const edgeT = smoothstep(0.68, 1, radial);
      const [sampleR, sampleG, sampleB] = sampleLiquidGlass(nx, ny, nz, radial);
      const directionalLight = Math.max(0, nx * -0.36 + ny * -0.48 + nz * 0.88);
      const innerShade = 0.88 + nz * 0.12 + directionalLight * 0.08 - edgeT * 0.08;
      const glassMilk = 0.025 + edgeT * 0.22 + smoothstep(0.92, 1, radial) * 0.18;
      const topWash = smoothstep(0.18, -0.82, ny) * smoothstep(0.98, 0.16, radial);
      const rim = smoothstep(0.72, 1, radial);
      const hardRim = smoothstep(0.93, 1, radial);
      const caRim = smoothstep(0.8, 1, radial);
      const specA = Math.max(0, 1 - Math.hypot(nx + 0.42, ny + 0.52) / 0.2) ** 3.8;
      const specB = Math.max(0, 1 - Math.hypot(nx - 0.35, ny + 0.22) / 0.28) ** 4.6;
      const specC = Math.max(0, 1 - Math.hypot(nx + 0.04, ny + 0.28) / 0.48) ** 5.8;
      const pointerSpec = Math.max(0, 1 - Math.hypot(nx - glintX, ny - glintY) / 0.2) ** 3.6 * glintAlpha;
      const shell = specA * 136 + specB * 74 + specC * 14 + pointerSpec * 132;

      let r = mix(sampleR * innerShade, 255, glassMilk) + shell + topWash * 18 + rim * 12 - hardRim * 6 + caRim * 10;
      let g = mix(sampleG * innerShade, 255, glassMilk) + shell + topWash * 20 + rim * 14 - hardRim * 8;
      let b = mix(sampleB * innerShade, 255, glassMilk * 0.9) + shell + topWash * 28 + rim * 30 - hardRim * 1;

      data[index] = clamp(r, 0, 255);
      data[index + 1] = clamp(g, 0, 255);
      data[index + 2] = clamp(b, 0, 255);
      data[index + 3] = smoothstep(1, 0.982, radial) * 255;
    }
  }

  ballCtx.setTransform(1, 0, 0, 1, 0, 0);
  ballCtx.putImageData(image, 0, 0);
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

  const rim = ctx.createLinearGradient(
    view.cx - view.radius,
    view.cy - view.radius,
    view.cx + view.radius,
    view.cy + view.radius,
  );
  rim.addColorStop(0, 'rgba(255, 255, 255, 0.72)');
  rim.addColorStop(0.36, 'rgba(255, 255, 255, 0.1)');
  rim.addColorStop(0.68, 'rgba(84, 90, 126, 0.24)');
  rim.addColorStop(1, 'rgba(255, 255, 255, 0.58)');

  ctx.lineWidth = Math.max(1.2, view.radius * 0.025);
  ctx.strokeStyle = rim;
  ctx.beginPath();
  ctx.arc(view.cx, view.cy, view.radius - ctx.lineWidth * 0.5, 0, Math.PI * 2);
  ctx.stroke();
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
