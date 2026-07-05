type Circle = {
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

const contentWidth = 1440;
const contentHeight = 920;
const contentCanvas = document.createElement('canvas');
contentCanvas.width = contentWidth;
contentCanvas.height = contentHeight;
const contentCtx = contentCanvas.getContext('2d');

if (!contentCtx) {
  throw new Error('2D canvas is not supported.');
}

const ballCanvas = document.createElement('canvas');
const ballCtx = ballCanvas.getContext('2d');

if (!ballCtx) {
  throw new Error('2D canvas is not supported.');
}

const circles: Circle[] = [
  { x: 195, y: 165, rx: 138, ry: 92, color: '#f05a2c', rotation: -0.34 },
  { x: 425, y: 135, rx: 94, ry: 82, color: '#ffe15d', rotation: 0.16 },
  { x: 665, y: 145, rx: 156, ry: 104, color: '#a8174a', rotation: 0.46 },
  { x: 1020, y: 130, rx: 122, ry: 76, color: '#ff8a25', rotation: -0.2 },
  { x: 1235, y: 218, rx: 78, ry: 108, color: '#2a53b7', rotation: 0.55 },
  { x: 305, y: 375, rx: 172, ry: 118, color: '#071c3a', rotation: -0.45 },
  { x: 555, y: 415, rx: 220, ry: 124, color: '#71d84f', rotation: -0.06 },
  { x: 840, y: 392, rx: 178, ry: 112, color: '#ff702b', rotation: 0.14 },
  { x: 1120, y: 430, rx: 170, ry: 124, color: '#ff4332', rotation: -0.22 },
  { x: 210, y: 650, rx: 130, ry: 94, color: '#2e97d2', rotation: 0.3 },
  { x: 445, y: 700, rx: 210, ry: 140, color: '#143a69', rotation: -0.48 },
  { x: 720, y: 690, rx: 152, ry: 106, color: '#f56a7a', rotation: 0.28 },
  { x: 985, y: 675, rx: 136, ry: 106, color: '#179b80', rotation: -0.34 },
  { x: 1220, y: 725, rx: 124, ry: 94, color: '#ffc642', rotation: 0.18 },
  { x: 1320, y: 520, rx: 84, ry: 84, color: '#8fd85e', rotation: 0.44 },
];

let contentData: ImageData;
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

let offsetX = -70;
let offsetY = -18;
let targetOffsetX = -70;
let targetOffsetY = -18;
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

function wrap(value: number, max: number): number {
  return ((value % max) + max) % max;
}

function hexToRgb(hex: string): RGB {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function drawContent(): void {
  contentCtx.fillStyle = '#fbfbf8';
  contentCtx.fillRect(0, 0, contentWidth, contentHeight);

  for (const circle of circles) {
    contentCtx.save();
    contentCtx.translate(circle.x, circle.y);
    contentCtx.rotate(circle.rotation);
    contentCtx.fillStyle = circle.color;
    contentCtx.beginPath();
    contentCtx.ellipse(0, 0, circle.rx, circle.ry, 0, 0, Math.PI * 2);
    contentCtx.fill();

    const [r, g, b] = hexToRgb(circle.color);
    contentCtx.globalCompositeOperation = 'multiply';
    contentCtx.fillStyle = `rgba(${Math.max(0, r - 55)}, ${Math.max(0, g - 55)}, ${Math.max(0, b - 55)}, 0.16)`;
    contentCtx.beginPath();
    contentCtx.ellipse(circle.rx * 0.18, circle.ry * 0.18, circle.rx * 0.86, circle.ry * 0.72, 0, 0, Math.PI * 2);
    contentCtx.fill();
    contentCtx.restore();
  }

  contentCtx.save();
  contentCtx.strokeStyle = '#fbfbf8';
  contentCtx.lineCap = 'round';
  contentCtx.lineJoin = 'round';
  contentCtx.lineWidth = 92;
  contentCtx.beginPath();
  contentCtx.moveTo(105, 505);
  contentCtx.bezierCurveTo(330, 382, 500, 272, 745, 438);
  contentCtx.bezierCurveTo(965, 590, 1085, 390, 1345, 330);
  contentCtx.stroke();
  contentCtx.lineWidth = 56;
  contentCtx.beginPath();
  contentCtx.moveTo(330, 850);
  contentCtx.bezierCurveTo(450, 610, 685, 590, 850, 835);
  contentCtx.stroke();
  contentCtx.restore();

  contentCtx.strokeStyle = 'rgba(18, 25, 30, 0.16)';
  contentCtx.lineWidth = 8;
  contentCtx.beginPath();
  contentCtx.moveTo(75, 575);
  contentCtx.bezierCurveTo(310, 735, 565, 375, 820, 595);
  contentCtx.bezierCurveTo(955, 710, 1110, 500, 1365, 610);
  contentCtx.stroke();

  contentCtx.strokeStyle = 'rgba(255, 255, 255, 0.72)';
  contentCtx.lineWidth = 14;
  contentCtx.beginPath();
  contentCtx.moveTo(55, 290);
  contentCtx.bezierCurveTo(330, 320, 600, 255, 900, 300);
  contentCtx.bezierCurveTo(1060, 326, 1220, 300, 1400, 242);
  contentCtx.stroke();

  contentData = contentCtx.getImageData(0, 0, contentWidth, contentHeight);
}

function sampleContent(x: number, y: number): RGB {
  const wrappedX = wrap(x, contentWidth);
  const wrappedY = wrap(y, contentHeight);
  const x0 = Math.floor(wrappedX);
  const y0 = Math.floor(wrappedY);
  const x1 = (x0 + 1) % contentWidth;
  const y1 = (y0 + 1) % contentHeight;
  const fx = wrappedX - x0;
  const fy = wrappedY - y0;

  const i00 = (y0 * contentWidth + x0) * 4;
  const i10 = (y0 * contentWidth + x1) * 4;
  const i01 = (y1 * contentWidth + x0) * 4;
  const i11 = (y1 * contentWidth + x1) * 4;
  const rgb: RGB = [0, 0, 0];

  for (let channel = 0; channel < 3; channel += 1) {
    const top = mix(contentData.data[i00 + channel], contentData.data[i10 + channel], fx);
    const bottom = mix(contentData.data[i01 + channel], contentData.data[i11 + channel], fx);
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
    cy: height / 2 + radius * 0.1,
    radius,
  };

  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const ballSize = Math.max(2, Math.round(radius * 2 * dpr));
  ballCanvas.width = ballSize;
  ballCanvas.height = ballSize;
}

function sampleLensContent(nx: number, ny: number, nz: number, edge: number, radiusPx: number): RGB {
  const radial = Math.hypot(nx, ny);
  const dirX = radial > 0.001 ? nx / radial : 0;
  const dirY = radial > 0.001 ? ny / radial : 0;
  const edgePull = edge ** 1.45;
  const radialGain = 0.18 + radial ** 1.72 * 0.98;
  const fold = edgePull * radiusPx * 0.78;
  const sourceScale = 1.72;
  const bendX = dirX * fold - ny * edgePull * radiusPx * 0.26;
  const bendY = dirY * fold + nx * edgePull * radiusPx * 0.16;
  const sourceX = contentWidth * 0.5 + offsetX + nx * radiusPx * sourceScale * radialGain + bendX;
  const sourceY = contentHeight * 0.5 + offsetY + ny * radiusPx * sourceScale * radialGain + bendY;
  const blur = edgePull * radiusPx * 0.3;
  const aberration = edgePull * 11;

  const red = sampleContent(sourceX + dirX * (aberration + blur), sourceY + dirY * blur);
  const green = sampleContent(sourceX, sourceY);
  const blue = sampleContent(sourceX - dirX * aberration, sourceY - dirY * aberration);
  const smear = sampleContent(sourceX + dirX * blur * 1.75, sourceY + dirY * blur * 1.75);
  const inverseSmear = sampleContent(sourceX - dirX * blur * 0.7, sourceY - dirY * blur * 0.7);
  const tangentX = -dirY;
  const tangentY = dirX;
  const tangentSmearA = sampleContent(sourceX + tangentX * blur * 1.05, sourceY + tangentY * blur * 1.05);
  const tangentSmearB = sampleContent(sourceX - tangentX * blur * 0.9, sourceY - tangentY * blur * 0.9);
  const smearMix = edgePull * 0.58;

  let r = mix(red[0], smear[0] * 0.72 + tangentSmearA[0] * 0.28, smearMix);
  let g = mix(green[1], smear[1] * 0.68 + tangentSmearB[1] * 0.32, smearMix * 0.78);
  let b = mix(blue[2], inverseSmear[2] * 0.72 + tangentSmearA[2] * 0.28, smearMix);

  const centerLift = smoothstep(1, 0, radial) * 12;
  const glassMilk = 0.05 + edgePull * 0.27 + smoothstep(0.9, 1, radial) * 0.2;
  r = mix(r + centerLift, 255, glassMilk);
  g = mix(g + centerLift, 255, glassMilk);
  b = mix(b + centerLift, 255, glassMilk * 0.88);

  const directionalLight = Math.max(0, nx * -0.36 + ny * -0.48 + nz * 0.88);
  const innerShade = 0.84 + nz * 0.18 + directionalLight * 0.1 - edgePull * 0.16;
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
      const edge = 1 - nz;
      const [sampleR, sampleG, sampleB] = sampleLensContent(nx, ny, nz, edge, radiusPx);
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
      const shell = specA * 155 + specB * 92 + specC * 16 + specD * 118 + pointerSpec * 150;

      let r = sampleR + shell + topWash * 20 + rim * 18 - hardRim * 8 + caRim * 14;
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
  ctx.clearRect(0, 0, view.width, view.height);
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, view.width, view.height);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, view.bandY, view.width, view.bandHeight);

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
  rim.addColorStop(0, 'rgba(255, 255, 255, 0.72)');
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

drawContent();
resize();
requestAnimationFrame(tick);
