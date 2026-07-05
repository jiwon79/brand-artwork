type Circle = {
  x: number;
  y: number;
  r: number;
  colors: [string, string];
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

const textureSize = 1024;
const textureCanvas = document.createElement('canvas');
textureCanvas.width = textureSize;
textureCanvas.height = textureSize;
const textureCtx = textureCanvas.getContext('2d');

if (!textureCtx) {
  throw new Error('2D canvas is not supported.');
}

const ballCanvas = document.createElement('canvas');
const ballCtx = ballCanvas.getContext('2d');

if (!ballCtx) {
  throw new Error('2D canvas is not supported.');
}

const circles: Circle[] = [
  { x: 0.14, y: 0.18, r: 0.16, colors: ['#ff4d31', '#ffd04a'] },
  { x: 0.38, y: 0.13, r: 0.1, colors: ['#ffe455', '#ffffff'] },
  { x: 0.63, y: 0.12, r: 0.16, colors: ['#b40f4a', '#ff7a2e'] },
  { x: 0.87, y: 0.24, r: 0.09, colors: ['#224fa8', '#ffffff'] },
  { x: 0.36, y: 0.38, r: 0.14, colors: ['#ff2f1f', '#ffba37'] },
  { x: 0.58, y: 0.38, r: 0.13, colors: ['#7d0f58', '#ff7035'] },
  { x: 0.18, y: 0.48, r: 0.13, colors: ['#111321', '#3ca4ff'] },
  { x: 0.45, y: 0.51, r: 0.2, colors: ['#2a7f45', '#b7e25c'] },
  { x: 0.72, y: 0.51, r: 0.19, colors: ['#ff6428', '#ffb237'] },
  { x: 0.23, y: 0.75, r: 0.18, colors: ['#092343', '#ff6d45'] },
  { x: 0.55, y: 0.73, r: 0.16, colors: ['#f35b6a', '#ffb345'] },
  { x: 0.78, y: 0.76, r: 0.1, colors: ['#008b72', '#8ad982'] },
  { x: 0.08, y: 0.86, r: 0.09, colors: ['#ffe45c', '#ff7438'] },
];

let textureData: ImageData;
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

let yaw = -0.34;
let pitch = 0;
let targetYaw = -0.34;
let targetPitch = 0;
let yawVelocity = 0.18;
let pointerId: number | null = null;
let lastPointerX = 0;
let lastPointerY = 0;
let glintX = -0.32;
let glintY = -0.34;
let targetGlintX = -0.32;
let targetGlintY = -0.34;
let glintAlpha = 0;
let targetGlintAlpha = 0;
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

function wrap01(value: number): number {
  return ((value % 1) + 1) % 1;
}

function drawTexture(): void {
  textureCtx.fillStyle = '#f7f7f2';
  textureCtx.fillRect(0, 0, textureSize, textureSize);

  for (const circle of circles) {
    const x = circle.x * textureSize;
    const y = circle.y * textureSize;
    const r = circle.r * textureSize;
    const gradient = textureCtx.createRadialGradient(
      x - r * 0.25,
      y - r * 0.35,
      r * 0.12,
      x,
      y,
      r,
    );
    gradient.addColorStop(0, '#ffffff');
    gradient.addColorStop(0.1, circle.colors[1]);
    gradient.addColorStop(0.58, circle.colors[0]);
    gradient.addColorStop(0.92, circle.colors[0]);
    gradient.addColorStop(1, '#fffdf6');

    textureCtx.save();
    textureCtx.fillStyle = gradient;
    textureCtx.beginPath();
    textureCtx.ellipse(
      x,
      y,
      r * (0.84 + circle.y * 0.34),
      r * (0.72 + circle.x * 0.36),
      (circle.x * 9.7 + circle.y * 4.3) % Math.PI,
      0,
      Math.PI * 2,
    );
    textureCtx.fill();

    textureCtx.globalCompositeOperation = 'screen';
    textureCtx.fillStyle = 'rgba(255, 255, 255, 0.58)';
    textureCtx.beginPath();
    textureCtx.ellipse(
      x - r * 0.26,
      y - r * 0.28,
      r * 0.2,
      r * 0.08,
      -0.55,
      0,
      Math.PI * 2,
    );
    textureCtx.fill();
    textureCtx.restore();
  }

  textureCtx.strokeStyle = 'rgba(10, 20, 26, 0.12)';
  textureCtx.lineWidth = 9;
  textureCtx.beginPath();
  textureCtx.moveTo(140, 630);
  textureCtx.bezierCurveTo(320, 740, 520, 430, 760, 625);
  textureCtx.stroke();

  textureData = textureCtx.getImageData(0, 0, textureSize, textureSize);
}

function sampleTexture(u: number, v: number): [number, number, number] {
  const x = Math.floor(wrap01(u) * (textureSize - 1));
  const y = Math.floor(wrap01(v) * (textureSize - 1));
  const index = (y * textureSize + x) * 4;
  return [
    textureData.data[index],
    textureData.data[index + 1],
    textureData.data[index + 2],
  ];
}

function resize(): void {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const bandHeight = clamp(height * 0.26, 260, 360);
  const radius = clamp(Math.min(width * 0.185, bandHeight * 0.34), 78, 150);

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

function renderBall(): void {
  const size = ballCanvas.width;
  const image = ballCtx.createImageData(size, size);
  const data = image.data;
  const cosYaw = Math.cos(yaw);
  const sinYaw = Math.sin(yaw);
  const cosPitch = Math.cos(pitch);
  const sinPitch = Math.sin(pitch);
  const lightLength = Math.hypot(-0.42 - glintX * 0.22, -0.58 - glintY * 0.2, 0.9);
  const lightX = (-0.42 - glintX * 0.22) / lightLength;
  const lightY = (-0.58 - glintY * 0.2) / lightLength;
  const lightZ = 0.9 / lightLength;

  for (let y = 0; y < size; y += 1) {
    const ny = (y + 0.5) / size * 2 - 1;
    for (let x = 0; x < size; x += 1) {
      const nx = (x + 0.5) / size * 2 - 1;
      const radialSq = nx * nx + ny * ny;
      const index = (y * size + x) * 4;

      if (radialSq > 1) {
        data[index + 3] = 0;
        continue;
      }

      const radial = Math.sqrt(radialSq);
      const nz = Math.sqrt(1 - radialSq);

      const rotX = cosYaw * nx + sinYaw * nz;
      const yawZ = -sinYaw * nx + cosYaw * nz;
      const rotY = cosPitch * ny - sinPitch * yawZ;
      const rotZ = sinPitch * ny + cosPitch * yawZ;
      const aberration = (1 - nz) * 0.009;
      const u = Math.atan2(rotX, rotZ) / (Math.PI * 2) + 0.5;
      const v = Math.acos(clamp(rotY, -1, 1)) / Math.PI;

      const red = sampleTexture(u + nx * aberration, v + ny * aberration);
      const green = sampleTexture(u, v);
      const blue = sampleTexture(u - nx * aberration, v - ny * aberration);

      let r = 128 + (red[0] - 128) * 1.18;
      let g = 128 + (green[1] - 128) * 1.18;
      let b = 128 + (blue[2] - 128) * 1.18;

      const diffuse = Math.max(0, nx * lightX + ny * lightY + nz * lightZ);
      const light = 0.76 + nz * 0.24 + diffuse * 0.22;
      const rim = smoothstep(0.62, 1, radial);
      const edgeDark = smoothstep(0.72, 1, radial) * 34;
      const edgeGlow = smoothstep(0.76, 0.98, radial) * 44;
      const topSheen = smoothstep(0.28, -0.68, ny) * smoothstep(0.95, 0.2, radial) * 18;
      const glintDist = Math.hypot(nx - glintX, ny - glintY);
      const glint = Math.max(0, 1 - glintDist / 0.18) ** 3 * glintAlpha * 150;
      const specA = Math.max(0, 1 - Math.hypot(nx + 0.42, ny + 0.42) / 0.18) ** 4 * 110;
      const specB = Math.max(0, 1 - Math.hypot(nx - 0.34, ny + 0.24) / 0.22) ** 4 * 54;
      const innerWhite = smoothstep(1, 0.2, radial) * 5;

      r = r * light - edgeDark + edgeGlow + topSheen + specA + specB + glint + innerWhite;
      g = g * light - edgeDark + edgeGlow + topSheen + specA + specB + glint + innerWhite;
      b = b * light - edgeDark + edgeGlow * 1.15 + topSheen + specA + specB + glint + innerWhite + rim * 12;

      const alpha = smoothstep(1, 0.985, radial) * 255;
      data[index] = clamp(r, 0, 255);
      data[index + 1] = clamp(g, 0, 255);
      data[index + 2] = clamp(b, 0, 255);
      data[index + 3] = alpha;
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
    view.cy + view.radius * 0.92,
    view.radius * 0.08,
    view.cx,
    view.cy + view.radius * 0.92,
    view.radius * 0.92,
  );
  shadow.addColorStop(0, 'rgba(0, 0, 0, 0.22)');
  shadow.addColorStop(0.45, 'rgba(0, 0, 0, 0.09)');
  shadow.addColorStop(1, 'rgba(0, 0, 0, 0)');

  ctx.save();
  ctx.scale(1, 0.23);
  ctx.fillStyle = shadow;
  ctx.beginPath();
  ctx.ellipse(
    view.cx,
    (view.cy + view.radius * 0.92) / 0.23,
    view.radius * 0.88,
    view.radius * 0.5,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.restore();

  renderBall();
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
  rim.addColorStop(0, 'rgba(255, 255, 255, 0.7)');
  rim.addColorStop(0.38, 'rgba(255, 255, 255, 0.08)');
  rim.addColorStop(0.72, 'rgba(40, 53, 68, 0.18)');
  rim.addColorStop(1, 'rgba(255, 255, 255, 0.42)');

  ctx.lineWidth = Math.max(1, view.radius * 0.025);
  ctx.strokeStyle = rim;
  ctx.beginPath();
  ctx.arc(view.cx, view.cy, view.radius - ctx.lineWidth * 0.5, 0, Math.PI * 2);
  ctx.stroke();

  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.52)';
  ctx.beginPath();
  ctx.ellipse(
    view.cx - view.radius * 0.34,
    view.cy - view.radius * 0.43,
    view.radius * 0.16,
    view.radius * 0.055,
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
  const inside = dx * dx + dy * dy <= 1.08;

  if (inside) {
    targetGlintX = clamp(dx, -0.82, 0.82);
    targetGlintY = clamp(dy, -0.82, 0.82);
    targetGlintAlpha = active ? 1 : 0.45;
  } else {
    targetGlintX = -0.32;
    targetGlintY = -0.34;
    targetGlintAlpha = 0;
  }
}

function tick(now: number): void {
  const dt = Math.min(0.05, Math.max(0.001, (now - lastFrame) / 1000 || 0.016));
  lastFrame = now;

  if (pointerId === null) {
    targetYaw += yawVelocity * dt;
    yawVelocity *= 0.992;
    if (Math.abs(yawVelocity) < 0.04) {
      yawVelocity = 0.04;
    }
  }

  yaw = mix(yaw, targetYaw, 0.12);
  pitch = mix(pitch, targetPitch, 0.12);
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
  yawVelocity = 0;
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
  targetYaw += dx * 0.011;
  targetPitch = clamp(targetPitch - dy * 0.008, -0.8, 0.8);
  yawVelocity = dx * 0.018;
});

canvas.addEventListener('pointerup', (event) => {
  if (pointerId !== event.pointerId) {
    return;
  }

  pointerId = null;
  targetGlintAlpha = 0.25;
  canvas.releasePointerCapture(event.pointerId);
});

canvas.addEventListener('pointercancel', (event) => {
  if (pointerId !== event.pointerId) {
    return;
  }

  pointerId = null;
  targetGlintAlpha = 0;
});

canvas.addEventListener('pointerleave', () => {
  if (pointerId === null) {
    targetGlintAlpha = 0;
  }
});

window.addEventListener('resize', resize);

drawTexture();
resize();
requestAnimationFrame(tick);
