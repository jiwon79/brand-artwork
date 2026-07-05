import GUI from 'lil-gui';

type MarbleCircle = {
  x: number;
  y: number;
  radius: number;
  color: string;
};

type VisibleMarbleCircle = MarbleCircle & {
  cx: number;
  cy: number;
  dot: number;
  scaledRadius: number;
};

type View = {
  width: number;
  height: number;
  dpr: number;
  cx: number;
  cy: number;
  radius: number;
};

type RGBA = [number, number, number, number];

const canvas = document.getElementById('artwork') as HTMLCanvasElement;
const ctx = canvas.getContext('2d', { alpha: false });
const stage = document.getElementById('stage');

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

const layerControls = {
  backgroundColor: '#fffefb',
  shadowEnabled: true,
  displacementEnabled: true,
  edgeStart: 0.56,
  edgeEnd: 1,
  inwardPower: 1.75,
  inwardStrength: 0.045,
  contactPower: 2.15,
  contactInwardStrength: 0.36,
  contactWidth: 0.12,
  contactProbeRadius: 0.93,
  contactRadiusScale: 1.08,
  contactSharpness: 1.8,
  tangentPower: 1.45,
  tangentStrength: 0.14,
  tangentYScale: 0.58,
  chromaticEnabled: true,
  chromaticPower: 1.4,
  chromaticStrength: 0.045,
  smearEnabled: true,
  smearPower: 1.3,
  smearStrength: 0.18,
  smearMixStrength: 0.52,
  tangentSmearAX: 0.74,
  tangentSmearAY: 0.56,
  tangentSmearBX: 0.62,
  tangentSmearBY: 0.46,
  innerShadeEnabled: true,
  glassMilkEnabled: true,
  topWashEnabled: true,
  rimEnabled: true,
  hardRimEnabled: true,
  caRimEnabled: true,
  specAEnabled: true,
  specBEnabled: true,
  specCEnabled: true,
  pointerSpecEnabled: true,
  outerStrokeEnabled: true,
};

let contentData: ImageData | null = null;
let visibleCircles: VisibleMarbleCircle[] = [];
let view: View = {
  width: 1,
  height: 1,
  dpr: 1,
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

function applyBackgroundColor(): void {
  document.documentElement.style.backgroundColor = layerControls.backgroundColor;
  document.body.style.backgroundColor = layerControls.backgroundColor;
  canvas.style.backgroundColor = layerControls.backgroundColor;
  stage?.style.setProperty('background', layerControls.backgroundColor);
}

function setupGui(): void {
  const gui = new GUI({ title: 'Guseul layers' });
  gui.domElement.addEventListener('pointerdown', (event) => {
    event.stopPropagation();
  });

  const background = gui.addFolder('background');
  background.addColor(layerControls, 'backgroundColor').name('color').onChange(applyBackgroundColor);
  background.add(layerControls, 'shadowEnabled').name('shadow');

  const displacement = gui.addFolder('5 sampling / displacement');
  displacement.add(layerControls, 'displacementEnabled').name('on');
  displacement.add(layerControls, 'edgeStart', 0, 0.98, 0.01).name('edge start');
  displacement.add(layerControls, 'edgeEnd', 0.02, 1, 0.01).name('edge end');
  displacement.add(layerControls, 'inwardPower', 0.1, 4, 0.01).name('inward power');
  displacement.add(layerControls, 'inwardStrength', 0, 0.3, 0.001).name('idle amount');
  displacement.add(layerControls, 'contactPower', 0.1, 5, 0.01).name('contact power');
  displacement.add(layerControls, 'contactInwardStrength', 0, 0.9, 0.01).name('contact amount');
  displacement.add(layerControls, 'contactWidth', 0.01, 0.35, 0.001).name('contact width');
  displacement.add(layerControls, 'contactProbeRadius', 0.7, 1, 0.001).name('contact probe');
  displacement.add(layerControls, 'contactRadiusScale', 0.5, 1.8, 0.01).name('contact radius');
  displacement.add(layerControls, 'contactSharpness', 0.3, 4, 0.01).name('contact sharp');
  displacement.add(layerControls, 'tangentPower', 0.1, 4, 0.01).name('tangent power');
  displacement.add(layerControls, 'tangentStrength', 0, 0.5, 0.01).name('tangent amount');
  displacement.add(layerControls, 'tangentYScale', 0, 1.5, 0.01).name('tangent y');

  const chromatic = gui.addFolder('6 chromatic');
  chromatic.add(layerControls, 'chromaticEnabled').name('on');
  chromatic.add(layerControls, 'chromaticPower', 0.1, 4, 0.01).name('power');
  chromatic.add(layerControls, 'chromaticStrength', 0, 0.2, 0.001).name('amount');

  const smear = gui.addFolder('7 smear / stretch');
  smear.add(layerControls, 'smearEnabled').name('on');
  smear.add(layerControls, 'smearPower', 0.1, 4, 0.01).name('power');
  smear.add(layerControls, 'smearStrength', 0, 0.7, 0.01).name('distance');
  smear.add(layerControls, 'smearMixStrength', 0, 1, 0.01).name('mix');
  smear.add(layerControls, 'tangentSmearAX', 0, 1.5, 0.01).name('tangent A x');
  smear.add(layerControls, 'tangentSmearAY', 0, 1.5, 0.01).name('tangent A y');
  smear.add(layerControls, 'tangentSmearBX', 0, 1.5, 0.01).name('tangent B x');
  smear.add(layerControls, 'tangentSmearBY', 0, 1.5, 0.01).name('tangent B y');

  const shell = gui.addFolder('8 glass shell');
  shell.add(layerControls, 'innerShadeEnabled').name('innerShade');
  shell.add(layerControls, 'glassMilkEnabled').name('glassMilk');
  shell.add(layerControls, 'topWashEnabled').name('topWash');
  shell.add(layerControls, 'rimEnabled').name('rim');
  shell.add(layerControls, 'hardRimEnabled').name('hardRim');
  shell.add(layerControls, 'caRimEnabled').name('ca rim');
  shell.add(layerControls, 'specAEnabled').name('spec A');
  shell.add(layerControls, 'specBEnabled').name('spec B');
  shell.add(layerControls, 'specCEnabled').name('spec C');
  shell.add(layerControls, 'pointerSpecEnabled').name('pointerSpec');
  shell.add(layerControls, 'outerStrokeEnabled').name('outer stroke');
}

function resize(): void {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const radius = clamp(Math.min(width, height) * 0.18, 82, 148);

  view = {
    width,
    height,
    dpr,
    cx: width / 2,
    cy: height / 2,
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

function collectVisibleCircles(): VisibleMarbleCircle[] {
  const wrappedX = wrapCentered(offsetX, motifWidth);
  const wrappedY = wrapCentered(offsetY, motifHeight);
  const items: VisibleMarbleCircle[] = [];

  for (let tileY = -1; tileY <= 1; tileY += 1) {
    for (let tileX = -1; tileX <= 1; tileX += 1) {
      for (const circle of marbleCircles) {
        const cx = circle.x + wrappedX + tileX * motifWidth;
        const cy = circle.y + wrappedY + tileY * motifHeight;
        const dot = normalDotCamera(cx, cy);
        const scaledRadius = circle.radius * scaleFromNormalDot(dot);
        const reach = Math.max(circle.radius, scaledRadius) * layerControls.contactRadiusScale + layerControls.contactWidth;

        if (Math.hypot(cx, cy) > 1 + reach) {
          continue;
        }

        items.push({ ...circle, cx, cy, dot, scaledRadius });
      }
    }
  }

  return items.sort((a, b) => a.dot - b.dot);
}

function drawContentLayer(): void {
  const radius = view.radius;
  const size = radius * 2;

  contentCtx.setTransform(1, 0, 0, 1, 0, 0);
  contentCtx.clearRect(0, 0, contentCanvas.width, contentCanvas.height);
  contentCtx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);

  contentCtx.fillStyle = layerControls.backgroundColor;
  contentCtx.fillRect(0, 0, size, size);

  contentCtx.save();
  contentCtx.beginPath();
  contentCtx.arc(radius, radius, radius, 0, Math.PI * 2);
  contentCtx.clip();

  visibleCircles = collectVisibleCircles();

  for (const item of visibleCircles) {
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

function contactGateForDirection(dirX: number, dirY: number): number {
  if (visibleCircles.length === 0) {
    return 0;
  }

  const probeRadius = layerControls.contactProbeRadius;
  const probeX = dirX * probeRadius;
  const probeY = dirY * probeRadius;
  const contactWidth = Math.max(0.001, layerControls.contactWidth);
  let contact = 0;

  for (const circle of visibleCircles) {
    const radius = circle.scaledRadius * layerControls.contactRadiusScale;
    const surfaceDistance = Math.hypot(probeX - circle.cx, probeY - circle.cy) - radius;
    const circleContact = 1 - smoothstep(0, contactWidth, surfaceDistance);
    contact = Math.max(contact, circleContact);
  }

  return contact ** layerControls.contactSharpness;
}

function sampleLiquidGlass(nx: number, ny: number, radial: number): RGBA {
  const radius = view.radius;
  const dirX = radial > 0.001 ? nx / radial : 0;
  const dirY = radial > 0.001 ? ny / radial : 0;
  const tangentX = -dirY;
  const tangentY = dirX;
  const edgeStart = Math.min(layerControls.edgeStart, layerControls.edgeEnd - 0.001);
  const edgeEnd = Math.max(layerControls.edgeEnd, edgeStart + 0.001);
  const edgeT = smoothstep(edgeStart, edgeEnd, radial);
  const contact = layerControls.displacementEnabled && edgeT > 0 ? contactGateForDirection(dirX, dirY) : 0;
  const idleFold = layerControls.displacementEnabled
    ? edgeT ** layerControls.inwardPower * radius * layerControls.inwardStrength
    : 0;
  const contactFold = layerControls.displacementEnabled
    ? edgeT ** layerControls.contactPower * radius * layerControls.contactInwardStrength * contact
    : 0;
  const edgeFold = idleFold + contactFold;
  const tangentSlip = layerControls.displacementEnabled
    ? edgeT ** layerControls.tangentPower * radius * layerControls.tangentStrength
    : 0;
  const sourceX = radius + nx * radius - dirX * edgeFold + tangentX * tangentSlip;
  const sourceY = radius + ny * radius - dirY * edgeFold + tangentY * tangentSlip * layerControls.tangentYScale;
  const smear = layerControls.smearEnabled
    ? edgeT ** layerControls.smearPower * radius * layerControls.smearStrength
    : 0;
  const aberration = layerControls.chromaticEnabled
    ? edgeT ** layerControls.chromaticPower * radius * layerControls.chromaticStrength
    : 0;

  const red = sampleContent(sourceX + dirX * aberration, sourceY + dirY * aberration);
  const green = sampleContent(sourceX, sourceY);
  const blue = sampleContent(sourceX - dirX * aberration, sourceY - dirY * aberration);
  const radialSmear = sampleContent(sourceX - dirX * smear, sourceY - dirY * smear);
  const tangentSmearA = sampleContent(
    sourceX + tangentX * smear * layerControls.tangentSmearAX,
    sourceY + tangentY * smear * layerControls.tangentSmearAY,
  );
  const tangentSmearB = sampleContent(
    sourceX - tangentX * smear * layerControls.tangentSmearBX,
    sourceY - tangentY * smear * layerControls.tangentSmearBY,
  );
  const smearMix = layerControls.smearEnabled ? edgeT * layerControls.smearMixStrength : 0;

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
      const [sampleR, sampleG, sampleB] = sampleLiquidGlass(nx, ny, radial);
      const directionalLight = Math.max(0, nx * -0.36 + ny * -0.48 + nz * 0.88);
      const innerShade = layerControls.innerShadeEnabled
        ? 0.88 + nz * 0.12 + directionalLight * 0.08 - edgeT * 0.08
        : 1;
      const glassMilk = layerControls.glassMilkEnabled
        ? 0.025 + edgeT * 0.22 + smoothstep(0.92, 1, radial) * 0.18
        : 0;
      const topWash = layerControls.topWashEnabled
        ? smoothstep(0.18, -0.82, ny) * smoothstep(0.98, 0.16, radial)
        : 0;
      const rim = layerControls.rimEnabled ? smoothstep(0.72, 1, radial) : 0;
      const hardRim = layerControls.hardRimEnabled ? smoothstep(0.93, 1, radial) : 0;
      const caRim = layerControls.caRimEnabled ? smoothstep(0.8, 1, radial) : 0;
      const specA = layerControls.specAEnabled
        ? Math.max(0, 1 - Math.hypot(nx + 0.42, ny + 0.52) / 0.2) ** 3.8
        : 0;
      const specB = layerControls.specBEnabled
        ? Math.max(0, 1 - Math.hypot(nx - 0.35, ny + 0.22) / 0.28) ** 4.6
        : 0;
      const specC = layerControls.specCEnabled
        ? Math.max(0, 1 - Math.hypot(nx + 0.04, ny + 0.28) / 0.48) ** 5.8
        : 0;
      const pointerSpec = layerControls.pointerSpecEnabled
        ? Math.max(0, 1 - Math.hypot(nx - glintX, ny - glintY) / 0.2) ** 3.6 * glintAlpha
        : 0;
      const shell = specA * 136 + specB * 74 + specC * 14 + pointerSpec * 132;

      let r = mix(sampleR * innerShade, 255, glassMilk) + shell + topWash * 18 + rim * 10 - hardRim * 5 + caRim * 6;
      let g = mix(sampleG * innerShade, 255, glassMilk) + shell + topWash * 19 + rim * 11 - hardRim * 6;
      let b = mix(sampleB * innerShade, 255, glassMilk * 0.94) + shell + topWash * 21 + rim * 15 - hardRim * 2;

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
  ctx.fillStyle = layerControls.backgroundColor;
  ctx.fillRect(0, 0, view.width, view.height);

  if (layerControls.shadowEnabled) {
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
  }

  renderGlassBall();
  ctx.drawImage(
    ballCanvas,
    view.cx - view.radius,
    view.cy - view.radius,
    view.radius * 2,
    view.radius * 2,
  );

  if (layerControls.outerStrokeEnabled) {
    const rim = ctx.createLinearGradient(
      view.cx - view.radius,
      view.cy - view.radius,
      view.cx + view.radius,
      view.cy + view.radius,
    );
    rim.addColorStop(0, 'rgba(255, 255, 255, 0.5)');
    rim.addColorStop(0.36, 'rgba(255, 255, 255, 0.08)');
    rim.addColorStop(0.68, 'rgba(214, 205, 190, 0.1)');
    rim.addColorStop(1, 'rgba(255, 255, 255, 0.34)');

    ctx.lineWidth = Math.max(0.8, view.radius * 0.012);
    ctx.strokeStyle = rim;
    ctx.beginPath();
    ctx.arc(view.cx, view.cy, view.radius - ctx.lineWidth * 0.5, 0, Math.PI * 2);
    ctx.stroke();
  }
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

  offsetX = targetOffsetX;
  offsetY = targetOffsetY;
  if (pointerId === null) {
    glintX = mix(glintX, targetGlintX, 0.18);
    glintY = mix(glintY, targetGlintY, 0.18);
    glintAlpha = mix(glintAlpha, targetGlintAlpha, 0.16);
  } else {
    glintX = targetGlintX;
    glintY = targetGlintY;
    glintAlpha = targetGlintAlpha;
  }

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
  event.preventDefault();
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

  event.preventDefault();
  const dx = event.clientX - lastPointerX;
  const dy = event.clientY - lastPointerY;
  lastPointerX = event.clientX;
  lastPointerY = event.clientY;
  targetOffsetX += (dx / view.radius) * 0.52;
  targetOffsetY += (dy / view.radius) * 0.52;
  offsetX = targetOffsetX;
  offsetY = targetOffsetY;
  velocityX = (dx / view.radius) * 5.5;
  velocityY = (dy / view.radius) * 5.5;
});

canvas.addEventListener('pointerup', (event) => {
  if (pointerId !== event.pointerId) {
    return;
  }

  pointerId = null;
  event.preventDefault();
  targetGlintAlpha = 0.28;
  canvas.releasePointerCapture(event.pointerId);
});

canvas.addEventListener('pointercancel', (event) => {
  if (pointerId !== event.pointerId) {
    return;
  }

  pointerId = null;
  event.preventDefault();
  targetGlintAlpha = 0.18;
});

canvas.addEventListener('pointerleave', () => {
  if (pointerId === null) {
    targetGlintAlpha = 0.18;
  }
});

document.addEventListener('selectstart', (event) => {
  event.preventDefault();
});

document.addEventListener('dragstart', (event) => {
  event.preventDefault();
});

document.addEventListener('contextmenu', (event) => {
  event.preventDefault();
});

window.addEventListener('resize', resize);

setupGui();
applyBackgroundColor();
resize();
requestAnimationFrame(tick);
