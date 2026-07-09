import GUI from 'lil-gui';

type MarbleCircle = {
  x: number;
  y: number;
  z: number;
  radius: number;
  color: string;
};

type VisibleMarbleCircle = MarbleCircle & {
  cx: number;
  cy: number;
  dot: number;
  z: number;
  scale: number;
  fillAlpha: number;
  hazeAlpha: number;
  blur: number;
  back: boolean;
  strokeAlpha: number;
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
type Vec3 = [number, number, number];
type Matrix3 = [number, number, number, number, number, number, number, number, number];
type SurfaceProfile = 'convex' | 'concave' | 'lip';

type SurfaceSample = {
  slopeX: number;
  slopeY: number;
  height: number;
  rim: number;
};

type SourceEdgeSample = {
  edge: number;
  fill: number;
  normalX: number;
  normalY: number;
  color: RGBA;
};

type RenderParams = {
  view: View;
  controls: LayerControls;
  orientation: Matrix3;
};

type Renderer = {
  resize: (params: RenderParams) => void;
  render: (params: RenderParams) => void;
};

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

const surfaceFieldChannels = 3;
const maxSurfaceSlope = Math.tan((85 * Math.PI) / 180);

const maxMarbleCircleCount = 28;
const marbleCirclePalette = [
  '#f15b2e',
  '#ffe25f',
  '#a51b4e',
  '#ff8d24',
  '#0c2241',
  '#76d650',
  '#ff6d2b',
  '#159b80',
  '#4b9fd1',
  '#153f6a',
  '#f66a7c',
  '#35c7d2',
];

const layerControls = {
  backgroundColor: '#fffefb',
  shadowEnabled: true,
  marbleScale: 1.22,
  dragSensitivity: 1,
  contentOverscan: 0.46,
  circleCount: 10,
  circleSizeScale: 1.75,
  circleSizeVariance: 1,
  edgeScaleFloor: 0.5,
  edgePortalWidth: 0.06,
  portalInset: 0.9,
  circleStrokeEnabled: true,
  circleStrokeScale: 1,
  displacementEnabled: true,
  surfacePreviewEnabled: false,
  surfaceProfile: 'convex' as SurfaceProfile,
  bezelWidth: 0.2,
  thickness: 0.4,
  displacementFactor: 0.75,
  edgeFadeWidth: 0,
  displacementBlur: 3,
  ior: 1.5,
  refractionEnabled: true,
  chromaticEnabled: true,
  dispersion: 0.14,
  chromaticEdgeStrength: 1.12,
  chromaticEdgeWidth: 2.6,
  chromaticBoundaryStrength: 1.25,
  chromaticBoundaryWidth: 6.5,
  innerShadeEnabled: true,
  glassMilkEnabled: true,
  topWashEnabled: true,
  rimEnabled: true,
  hardRimEnabled: true,
  caRimEnabled: true,
  specAEnabled: true,
  specBEnabled: true,
  specCEnabled: true,
  outerStrokeEnabled: true,
};

type LayerControls = typeof layerControls;

class CanvasRenderer implements Renderer {
  resize(params: RenderParams): void {
    resizeRenderTargets(params);
  }

  render(params: RenderParams): void {
    drawScene(params);
  }
}

let contentData: ImageData | null = null;
let rawSurfaceField = new Float32Array();
let blurredSurfaceField = new Float32Array();
let tempSurfaceField = new Float32Array();
let activeSurfaceField = rawSurfaceField;
let surfaceFieldWidth = 0;
let surfaceFieldHeight = 0;
let surfaceFieldSignature = '';
let visibleCircles: VisibleMarbleCircle[] = [];
let view: View = {
  width: 1,
  height: 1,
  dpr: 1,
  cx: 0,
  cy: 0,
  radius: 1,
};

let sphereOrientation = multiplyMatrix3(
  rotationMatrixFromAxisAngle([0, 1, 0], 0.14),
  rotationMatrixFromAxisAngle([1, 0, 0], -0.1),
);
let spinAxis: Vec3 = [0, 0, 0];
let spinVelocity = 0;
let pointerId: number | null = null;
let lastPointerX = 0;
let lastPointerY = 0;
let lastPointerTime = 0;
let lastFrame = 0;
const renderer: Renderer = new CanvasRenderer();

function getRenderParams(): RenderParams {
  return {
    view,
    controls: layerControls,
    orientation: sphereOrientation,
  };
}

function pseudoRandom(index: number, salt: number): number {
  const value = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;

  return value - Math.floor(value);
}

function createMarbleCircles(count: number, controls: LayerControls = layerControls): MarbleCircle[] {
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));

  return Array.from({ length: count }, (_, index) => {
    const y = 1 - (2 * (index + 0.5)) / count;
    const radial = Math.sqrt(Math.max(1 - y * y, 0));
    const theta = index * goldenAngle + pseudoRandom(index, 1) * 0.42;
    const baseSize = 0.25;
    const variance = (pseudoRandom(index, 2) - 0.5) * 0.16 * controls.circleSizeVariance;
    const size = clamp(baseSize + variance, 0.05, 0.5);

    return {
      x: Math.cos(theta) * radial,
      y,
      z: Math.sin(theta) * radial,
      radius: size,
      color: marbleCirclePalette[Math.floor(pseudoRandom(index, 3) * marbleCirclePalette.length)],
    };
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function backgroundSample(controls: LayerControls = layerControls): RGBA {
  const hex = controls.backgroundColor.trim();
  const normalized = /^#[0-9a-f]{6}$/i.test(hex) ? hex.slice(1) : 'fffefb';

  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16),
    255,
  ];
}

function colorToRgba(color: string): RGBA {
  const normalized = /^#[0-9a-f]{6}$/i.test(color) ? color.slice(1) : 'ffffff';

  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16),
    255,
  ];
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function smootherstep(value: number): number {
  const x = clamp(value, 0, 1);
  return x * x * x * (x * (x * 6 - 15) + 10);
}

function smootherstepDerivative(value: number): number {
  const x = clamp(value, 0, 1);
  return 30 * x * x * (x * (x - 2) + 1);
}

function convexSurfaceProfile(progress: number): [number, number] {
  const u = 1 - clamp(progress, 0, 1);
  const inside = Math.max(1 - u ** 4, 0.0001);
  const height = Math.sqrt(inside);
  const derivative = (2 * u ** 3) / Math.sqrt(inside);

  return [height, derivative];
}

function concaveSurfaceProfile(progress: number): [number, number] {
  const [height, derivative] = convexSurfaceProfile(progress);

  return [1 - height, -derivative];
}

function evaluateSurfaceProfile(progress: number, controls: LayerControls = layerControls): [number, number] {
  if (controls.surfaceProfile === 'convex') {
    return convexSurfaceProfile(progress);
  }

  if (controls.surfaceProfile === 'concave') {
    return concaveSurfaceProfile(progress);
  }

  const [convexHeight, convexDerivative] = convexSurfaceProfile(progress);
  const [concaveHeight, concaveDerivative] = concaveSurfaceProfile(progress);
  const blend = smootherstep(progress);
  const blendDerivative = smootherstepDerivative(progress);
  const height = mix(convexHeight, concaveHeight, blend);
  const derivative =
    mix(convexDerivative, concaveDerivative, blend) +
    (concaveHeight - convexHeight) * blendDerivative;

  return [height, derivative];
}

function getBezelWidth(controls: LayerControls): number {
  return Math.max(controls.bezelWidth, 0.001);
}

function getContentOverscan(controls: LayerControls): number {
  return Math.max(controls.contentOverscan, 0);
}

function getContentSize(params: RenderParams): number {
  return params.view.radius * 2 * (1 + getContentOverscan(params.controls) * 2);
}

function getContentCenter(params: RenderParams): number {
  return params.view.radius * (1 + getContentOverscan(params.controls));
}

function getRimInfluence(radial: number, controls: LayerControls): number {
  return 1 - smoothstep(0, getBezelWidth(controls), Math.max(1 - radial, 0));
}

function getDisplacementEdgeFade(radial: number, controls: LayerControls): number {
  const width = Math.max(controls.edgeFadeWidth, 0);

  if (width <= 0.0001) {
    return 1;
  }

  return smoothstep(0, width, Math.max(1 - radial, 0));
}

function getSurfaceHeight(radial: number, params: RenderParams): number {
  const bezelWidth = getBezelWidth(params.controls);
  const inwardDistance = Math.max(1 - radial, 0);
  const progress = clamp(inwardDistance / bezelWidth, 0, 1);
  const [profileHeight] = evaluateSurfaceProfile(progress, params.controls);
  const [flatHeight] = evaluateSurfaceProfile(1, params.controls);
  const bevelHeight = (inwardDistance > bezelWidth ? flatHeight : profileHeight) * bezelWidth;

  return (params.controls.thickness + bevelHeight) * params.view.radius * params.controls.displacementFactor;
}

function refractCameraRay(slopeX: number, slopeY: number, ior: number): [number, number, number] {
  const normalLength = Math.hypot(slopeX, slopeY, 1);
  const nx = slopeX / normalLength;
  const ny = slopeY / normalLength;
  const nz = 1 / normalLength;
  const eta = 1 / Math.max(ior, 1.0001);
  const dotNI = -nz;
  const k = 1 - eta * eta * (1 - dotNI * dotNI);

  if (k < 0) {
    return [0, 0, -1];
  }

  const factor = eta * dotNI + Math.sqrt(k);
  return [-factor * nx, -factor * ny, -eta - factor * nz];
}

function rayToDisplacement(ray: [number, number, number], height: number): [number, number] {
  const z = Math.max(-ray[2], 0.0001);

  return [(ray[0] / z) * height, (ray[1] / z) * height];
}

function reflectVec3(incident: Vec3, normal: Vec3): Vec3 {
  const dot = incident[0] * normal[0] + incident[1] * normal[1] + incident[2] * normal[2];

  return [
    incident[0] - 2 * dot * normal[0],
    incident[1] - 2 * dot * normal[1],
    incident[2] - 2 * dot * normal[2],
  ];
}

function vectorLength([x, y, z]: Vec3): number {
  return Math.hypot(x, y, z);
}

function normalizeVec3(vector: Vec3): Vec3 {
  const length = vectorLength(vector);

  if (length <= 0.000001) {
    return [0, 0, 1];
  }

  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function multiplyMatrix3(a: Matrix3, b: Matrix3): Matrix3 {
  return [
    a[0] * b[0] + a[1] * b[3] + a[2] * b[6],
    a[0] * b[1] + a[1] * b[4] + a[2] * b[7],
    a[0] * b[2] + a[1] * b[5] + a[2] * b[8],
    a[3] * b[0] + a[4] * b[3] + a[5] * b[6],
    a[3] * b[1] + a[4] * b[4] + a[5] * b[7],
    a[3] * b[2] + a[4] * b[5] + a[5] * b[8],
    a[6] * b[0] + a[7] * b[3] + a[8] * b[6],
    a[6] * b[1] + a[7] * b[4] + a[8] * b[7],
    a[6] * b[2] + a[7] * b[5] + a[8] * b[8],
  ];
}

function transposeMatrix3(matrix: Matrix3): Matrix3 {
  return [
    matrix[0],
    matrix[3],
    matrix[6],
    matrix[1],
    matrix[4],
    matrix[7],
    matrix[2],
    matrix[5],
    matrix[8],
  ];
}

function rotationMatrixFromAxisAngle(axis: Vec3, angle: number): Matrix3 {
  const [x, y, z] = normalizeVec3(axis);
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const t = 1 - cosine;

  return [
    t * x * x + cosine,
    t * x * y - sine * z,
    t * x * z + sine * y,
    t * x * y + sine * z,
    t * y * y + cosine,
    t * y * z - sine * x,
    t * x * z - sine * y,
    t * y * z + sine * x,
    t * z * z + cosine,
  ];
}

function applyMatrix3(matrix: Matrix3, [x, y, z]: Vec3): Vec3 {
  return [
    matrix[0] * x + matrix[1] * y + matrix[2] * z,
    matrix[3] * x + matrix[4] * y + matrix[5] * z,
    matrix[6] * x + matrix[7] * y + matrix[8] * z,
  ];
}

function getSpecularReflection(nx: number, ny: number, nz: number, inverseOrientation: Matrix3): Vec3 {
  const normal: Vec3 = [nx, ny, nz];
  const screenReflection = reflectVec3([0, 0, -1], normal);

  return normalizeVec3(applyMatrix3(inverseOrientation, screenReflection));
}

function areaWindowSpecular(
  reflection: Vec3,
  centerX: number,
  centerY: number,
  halfWidth: number,
  halfHeight: number,
  softness: number,
  power: number,
): number {
  const dx = Math.abs((reflection[0] - centerX) / halfWidth);
  const dy = Math.abs((reflection[1] - centerY) / halfHeight);
  const boxDistance = Math.max(dx, dy);
  const box = 1 - smoothstep(1 - softness, 1 + softness, boxDistance);
  const facing = smoothstep(-0.08, 0.36, reflection[2]);

  return Math.max(0, box) ** power * facing;
}

function applyScreenAxisRotation(axis: Vec3, angle: number): void {
  sphereOrientation = multiplyMatrix3(
    rotationMatrixFromAxisAngle(axis, angle),
    sphereOrientation,
  );
}

function applyBackgroundColor(): void {
  document.documentElement.style.backgroundColor = layerControls.backgroundColor;
  document.body.style.backgroundColor = layerControls.backgroundColor;
  canvas.style.backgroundColor = layerControls.backgroundColor;
  stage?.style.setProperty('background', layerControls.backgroundColor);
}

function rotateSpherePoint(orientation: Matrix3, x: number, y: number, z: number): Vec3 {
  return applyMatrix3(orientation, normalizeVec3([x, y, z]));
}

function projectMarbleCircle(circle: MarbleCircle, params: RenderParams): VisibleMarbleCircle {
  const [x, y, z] = rotateSpherePoint(params.orientation, circle.x, circle.y, circle.z);
  const portalWidth = Math.max(params.controls.edgePortalWidth, 0.001);
  const edgeScaleFloor = params.controls.edgeScaleFloor;

  if (z < 0) {
    const depth = smoothstep(0, 1, -z);
    const portalProgress = smoothstep(0, portalWidth, -z);
    const inset = mix(0.94, params.controls.portalInset, portalProgress);

    return {
      ...circle,
      cx: x * inset,
      cy: y * inset,
      dot: depth,
      z: -depth,
      scale: mix(edgeScaleFloor * 0.9, Math.max(0.58, edgeScaleFloor), depth ** 0.58),
      fillAlpha: mix(0.54, 0.76, depth ** 0.68),
      hazeAlpha: mix(0.18, 0.08, depth),
      blur: mix(1.35, 0.52, depth),
      back: true,
      strokeAlpha: 0,
    };
  }

  const displayDepth = clamp(z, 0, 1);
  const scale = mix(edgeScaleFloor, 1.04, displayDepth ** 1.7);
  const frontDepth = smoothstep(0, 0.86, displayDepth);

  return {
    ...circle,
    cx: x,
    cy: y,
    dot: displayDepth,
    z: displayDepth,
    scale,
    fillAlpha: mix(0.94, 1, frontDepth),
    hazeAlpha: mix(0.035, 0, frontDepth),
    blur: 0,
    back: false,
    strokeAlpha: mix(0.65, 1, frontDepth),
  };
}

function setupGui(): void {
  const gui = new GUI({ title: 'Guseul layers' });
  gui.domElement.addEventListener('pointerdown', (event) => {
    event.stopPropagation();
  });

  const scene = gui.addFolder('1 scene');
  scene.addColor(layerControls, 'backgroundColor').name('background').onChange(applyBackgroundColor);
  scene.add(layerControls, 'shadowEnabled').name('shadow');
  scene.add(layerControls, 'marbleScale', 0.7, 1.8, 0.01).name('marble scale').onChange(resize);
  scene.add(layerControls, 'dragSensitivity', 0.4, 1.8, 0.01).name('drag sensitivity');

  const source = gui.addFolder('2 source content');
  source.add(layerControls, 'contentOverscan', 0.1, 0.9, 0.01).name('overscan').onChange(resize);

  const circles = source.addFolder('circles');
  circles.add(layerControls, 'circleCount', 4, maxMarbleCircleCount, 1).name('count');
  circles.add(layerControls, 'circleSizeScale', 0.45, 2.6, 0.01).name('size');
  circles.add(layerControls, 'circleSizeVariance', 0, 2.5, 0.01).name('size variance');
  circles.add(layerControls, 'circleStrokeEnabled').name('white stroke');
  circles.add(layerControls, 'circleStrokeScale', 0, 2, 0.01).name('stroke scale');

  const edgeProjection = source.addFolder('edge projection');
  edgeProjection.add(layerControls, 'edgeScaleFloor', 0.08, 0.8, 0.01).name('edge min size');
  edgeProjection.add(layerControls, 'edgePortalWidth', 0.01, 0.3, 0.01).name('edge portal');
  edgeProjection.add(layerControls, 'portalInset', 0.5, 1, 0.01).name('portal inset');

  const surface = gui.addFolder('3 surface field debug');
  surface.add(layerControls, 'surfacePreviewEnabled').name('on');
  surface.add(layerControls, 'surfaceProfile', ['convex', 'concave', 'lip']).name('profile');
  surface.add(layerControls, 'bezelWidth', 0.04, 0.55, 0.01).name('bezel width');
  surface.add(layerControls, 'displacementBlur', 0, 18, 0.5).name('field blur');

  const refraction = gui.addFolder('4 refraction apply');
  refraction.add(layerControls, 'refractionEnabled').name('on');
  refraction.add(layerControls, 'thickness', 0, 0.9, 0.01).name('thickness');
  refraction.add(layerControls, 'displacementFactor', 0, 2, 0.01).name('displace factor');
  refraction.add(layerControls, 'edgeFadeWidth', 0, 0.18, 0.001).name('edge fade');
  refraction.add(layerControls, 'ior', 1.01, 2.4, 0.01).name('ior');
  refraction.add(layerControls, 'chromaticEnabled').name('chromatic');
  refraction.add(layerControls, 'dispersion', 0, 0.5, 0.001).name('dispersion');
  refraction.add(layerControls, 'chromaticEdgeStrength', 0, 4, 0.01).name('edge chroma');
  refraction.add(layerControls, 'chromaticEdgeWidth', 0, 12, 0.1).name('edge width');
  refraction.add(layerControls, 'chromaticBoundaryStrength', 0, 3, 0.01).name('source edge');
  refraction.add(layerControls, 'chromaticBoundaryWidth', 0.5, 14, 0.1).name('source feather');

  const shell = gui.addFolder('5 glass shell');
  shell.add(layerControls, 'innerShadeEnabled').name('innerShade');
  shell.add(layerControls, 'glassMilkEnabled').name('glassMilk');
  shell.add(layerControls, 'topWashEnabled').name('topWash');
  shell.add(layerControls, 'rimEnabled').name('rim');
  shell.add(layerControls, 'hardRimEnabled').name('hardRim');
  shell.add(layerControls, 'caRimEnabled').name('ca rim');
  shell.add(layerControls, 'specAEnabled').name('spec A');
  shell.add(layerControls, 'specBEnabled').name('spec B');
  shell.add(layerControls, 'specCEnabled').name('spec C');

  const composite = gui.addFolder('6 final composite');
  composite.add(layerControls, 'outerStrokeEnabled').name('outer stroke');

  circles.close();
  edgeProjection.close();
  scene.close();
  source.close();
  surface.close();
  refraction.close();
  shell.close();
  composite.close();
  gui.close();
}

function resizeRenderTargets(params: RenderParams): void {
  const renderView = params.view;

  canvas.width = Math.round(renderView.width * renderView.dpr);
  canvas.height = Math.round(renderView.height * renderView.dpr);
  ctx.setTransform(renderView.dpr, 0, 0, renderView.dpr, 0, 0);

  const ballSize = Math.max(2, Math.round(renderView.radius * 2 * renderView.dpr));
  const contentSize = Math.max(2, Math.round(getContentSize(params) * renderView.dpr));
  ballCanvas.width = ballSize;
  ballCanvas.height = ballSize;
  contentCanvas.width = contentSize;
  contentCanvas.height = contentSize;
  surfaceFieldSignature = '';
}

function resize(): void {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const baseRadius = clamp(Math.min(width, height) * 0.18, 82, 148);
  const maxRadius = Math.max(82, Math.min(width, height) * 0.34);
  const radius = clamp(baseRadius * layerControls.marbleScale, 82, maxRadius);

  view = {
    width,
    height,
    dpr,
    cx: width / 2,
    cy: height / 2,
    radius,
  };

  renderer.resize(getRenderParams());
}

function drawContentCircle(circle: VisibleMarbleCircle, params: RenderParams): void {
  const radius = params.view.radius;
  const center = getContentCenter(params);
  const size = circle.radius * params.controls.circleSizeScale * radius * circle.scale;
  const centerX = center + circle.cx * radius;
  const centerY = center + circle.cy * radius;
  const strokeWidth = params.controls.circleStrokeEnabled
    ? Math.min(size * 0.34, clamp(radius * 0.048, 4, 8)) * params.controls.circleStrokeScale
    : 0;

  contentCtx.save();
  contentCtx.filter = circle.blur > 0 ? `blur(${circle.blur}px)` : 'none';
  contentCtx.beginPath();
  contentCtx.arc(centerX, centerY, size, 0, Math.PI * 2);
  if (strokeWidth > 0 && !circle.back && circle.strokeAlpha > 0) {
    contentCtx.globalAlpha = circle.fillAlpha * circle.strokeAlpha;
    contentCtx.lineWidth = strokeWidth;
    contentCtx.strokeStyle = '#ffffff';
    contentCtx.stroke();
  }
  contentCtx.globalAlpha = circle.fillAlpha;
  contentCtx.fillStyle = circle.color;
  contentCtx.fill();
  if (circle.hazeAlpha > 0) {
    contentCtx.globalAlpha = circle.hazeAlpha;
    contentCtx.fillStyle = params.controls.backgroundColor;
    contentCtx.fill();
  }
  contentCtx.restore();
}

function collectVisibleCircles(params: RenderParams): VisibleMarbleCircle[] {
  const items: VisibleMarbleCircle[] = [];
  const count = clamp(Math.round(params.controls.circleCount), 1, maxMarbleCircleCount);
  const circles = createMarbleCircles(count, params.controls);

  for (const circle of circles) {
    items.push(projectMarbleCircle(circle, params));
  }

  return items.sort((a, b) => {
    if (a.back !== b.back) {
      return a.back ? -1 : 1;
    }

    return a.dot - b.dot;
  });
}

function drawContentLayer(params: RenderParams): void {
  const size = getContentSize(params);

  contentCtx.setTransform(1, 0, 0, 1, 0, 0);
  contentCtx.clearRect(0, 0, contentCanvas.width, contentCanvas.height);
  contentCtx.setTransform(params.view.dpr, 0, 0, params.view.dpr, 0, 0);

  contentCtx.fillStyle = params.controls.backgroundColor;
  contentCtx.fillRect(0, 0, size, size);

  visibleCircles = collectVisibleCircles(params);

  for (const item of visibleCircles) {
    drawContentCircle(item, params);
  }

  contentData = contentCtx.getImageData(0, 0, contentCanvas.width, contentCanvas.height);
}

function sampleContent(x: number, y: number, params: RenderParams): RGBA {
  if (!contentData) {
    return backgroundSample(params.controls);
  }

  const width = contentCanvas.width;
  const height = contentCanvas.height;
  const sampleX = (x + getContentOverscan(params.controls) * params.view.radius) * params.view.dpr;
  const sampleY = (y + getContentOverscan(params.controls) * params.view.radius) * params.view.dpr;

  if (sampleX < 0 || sampleY < 0 || sampleX > width - 1.001 || sampleY > height - 1.001) {
    return backgroundSample(params.controls);
  }

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

function ensureSurfaceFieldSize(width: number, height: number): void {
  const length = width * height * surfaceFieldChannels;

  if (surfaceFieldWidth === width && surfaceFieldHeight === height && rawSurfaceField.length === length) {
    return;
  }

  surfaceFieldWidth = width;
  surfaceFieldHeight = height;
  rawSurfaceField = new Float32Array(length);
  blurredSurfaceField = new Float32Array(length);
  tempSurfaceField = new Float32Array(length);
  activeSurfaceField = rawSurfaceField;
  surfaceFieldSignature = '';
}

function getSurfaceFieldSignature(params: RenderParams): string {
  return [
    ballCanvas.width,
    ballCanvas.height,
    params.view.dpr,
    params.controls.displacementEnabled,
    params.controls.surfaceProfile,
    params.controls.bezelWidth,
    params.controls.displacementBlur,
  ].join('|');
}

function writeRawSurfaceField(params: RenderParams): void {
  const width = surfaceFieldWidth;
  const height = surfaceFieldHeight;
  const radiusPx = width * 0.5;
  const bezelWidth = getBezelWidth(params.controls);

  rawSurfaceField.fill(0);

  if (!params.controls.displacementEnabled) {
    return;
  }

  for (let y = 0; y < height; y += 1) {
    const ny = (y + 0.5) / radiusPx - 1;

    for (let x = 0; x < width; x += 1) {
      const nx = (x + 0.5) / radiusPx - 1;
      const radial = Math.hypot(nx, ny);

      if (radial > 1) {
        continue;
      }

      const inwardDistance = Math.max(1 - radial, 0);

      if (inwardDistance > bezelWidth) {
        continue;
      }

      const progress = clamp(inwardDistance / bezelWidth, 0, 1);
      const [, derivative] = evaluateSurfaceProfile(progress, params.controls);
      const clampedSlope = clamp(derivative, -maxSurfaceSlope, maxSurfaceSlope);
      const dirX = radial > 0.001 ? nx / radial : 0;
      const dirY = radial > 0.001 ? ny / radial : 0;
      const fill = 1;
      const index = (y * width + x) * surfaceFieldChannels;

      rawSurfaceField[index] = dirX * clampedSlope * fill;
      rawSurfaceField[index + 1] = dirY * clampedSlope * fill;
      rawSurfaceField[index + 2] = fill;
    }
  }
}

function buildBlurKernel(radius: number): number[] {
  const kernel: number[] = [];
  const sigma = Math.max(radius * 0.45, 0.001);
  let sum = 0;

  for (let offset = -radius; offset <= radius; offset += 1) {
    const weight = Math.exp(-(offset * offset) / (2 * sigma * sigma));
    kernel.push(weight);
    sum += weight;
  }

  return kernel.map((weight) => weight / sum);
}

function blurSurfaceField(radius: number): void {
  if (radius <= 0) {
    activeSurfaceField = rawSurfaceField;
    return;
  }

  const width = surfaceFieldWidth;
  const height = surfaceFieldHeight;
  const kernel = buildBlurKernel(radius);
  const kernelRadius = Math.floor(kernel.length / 2);

  tempSurfaceField.fill(0);
  blurredSurfaceField.fill(0);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const targetIndex = (y * width + x) * surfaceFieldChannels;

      for (let offset = -kernelRadius; offset <= kernelRadius; offset += 1) {
        const sourceX = clamp(x + offset, 0, width - 1);
        const sourceIndex = (y * width + sourceX) * surfaceFieldChannels;
        const weight = kernel[offset + kernelRadius];

        tempSurfaceField[targetIndex] += rawSurfaceField[sourceIndex] * weight;
        tempSurfaceField[targetIndex + 1] += rawSurfaceField[sourceIndex + 1] * weight;
        tempSurfaceField[targetIndex + 2] += rawSurfaceField[sourceIndex + 2] * weight;
      }
    }
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const targetIndex = (y * width + x) * surfaceFieldChannels;

      for (let offset = -kernelRadius; offset <= kernelRadius; offset += 1) {
        const sourceY = clamp(y + offset, 0, height - 1);
        const sourceIndex = (sourceY * width + x) * surfaceFieldChannels;
        const weight = kernel[offset + kernelRadius];

        blurredSurfaceField[targetIndex] += tempSurfaceField[sourceIndex] * weight;
        blurredSurfaceField[targetIndex + 1] += tempSurfaceField[sourceIndex + 1] * weight;
        blurredSurfaceField[targetIndex + 2] += tempSurfaceField[sourceIndex + 2] * weight;
      }
    }
  }

  activeSurfaceField = blurredSurfaceField;
}

function renderSurfaceField(params: RenderParams): void {
  ensureSurfaceFieldSize(ballCanvas.width, ballCanvas.height);

  const signature = getSurfaceFieldSignature(params);

  if (signature === surfaceFieldSignature) {
    return;
  }

  writeRawSurfaceField(params);
  blurSurfaceField(Math.min(Math.round(params.controls.displacementBlur * params.view.dpr), 18));
  surfaceFieldSignature = signature;
}

function sampleSurfaceField(nx: number, ny: number, radial: number, params: RenderParams): SurfaceSample {
  if (!params.controls.displacementEnabled || surfaceFieldWidth <= 0 || surfaceFieldHeight <= 0) {
    return { slopeX: 0, slopeY: 0, height: 0, rim: 0 };
  }

  const radiusPx = surfaceFieldWidth * 0.5;
  const sampleX = clamp((nx + 1) * radiusPx - 0.5, 0, surfaceFieldWidth - 1.001);
  const sampleY = clamp((ny + 1) * radiusPx - 0.5, 0, surfaceFieldHeight - 1.001);
  const x0 = Math.floor(sampleX);
  const y0 = Math.floor(sampleY);
  const x1 = Math.min(x0 + 1, surfaceFieldWidth - 1);
  const y1 = Math.min(y0 + 1, surfaceFieldHeight - 1);
  const fx = sampleX - x0;
  const fy = sampleY - y0;

  const sampleChannel = (channel: number): number => {
    const i00 = (y0 * surfaceFieldWidth + x0) * surfaceFieldChannels + channel;
    const i10 = (y0 * surfaceFieldWidth + x1) * surfaceFieldChannels + channel;
    const i01 = (y1 * surfaceFieldWidth + x0) * surfaceFieldChannels + channel;
    const i11 = (y1 * surfaceFieldWidth + x1) * surfaceFieldChannels + channel;
    const top = mix(activeSurfaceField[i00], activeSurfaceField[i10], fx);
    const bottom = mix(activeSurfaceField[i01], activeSurfaceField[i11], fx);

    return mix(top, bottom, fy);
  };

  const fill = sampleChannel(2);
  const slopeX = fill > 0.0001 ? sampleChannel(0) / fill : 0;
  const slopeY = fill > 0.0001 ? sampleChannel(1) / fill : 0;

  return {
    slopeX,
    slopeY,
    height: getSurfaceHeight(radial, params),
    rim: getRimInfluence(radial, params.controls),
  };
}

function sampleSurfaceFieldPreview(nx: number, ny: number, radial: number, params: RenderParams): RGBA {
  const surface = sampleSurfaceField(nx, ny, radial, params);
  const rim = surface.rim;
  const slopeX = clamp(surface.slopeX / maxSurfaceSlope, -1, 1);
  const slopeY = clamp(surface.slopeY / maxSurfaceSlope, -1, 1);
  const height = clamp(surface.height / (params.view.radius * 0.8), 0, 1);

  return [
    mix(248, 128 + slopeX * 96, rim),
    mix(248, 128 + slopeY * 96, rim),
    mix(248, 126 + height * 104, rim),
    255,
  ];
}

function colorDistance(a: RGBA, b: RGBA): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function colorSaturation([r, g, b]: RGBA): number {
  const maxChannel = Math.max(r, g, b);
  const minChannel = Math.min(r, g, b);

  return maxChannel <= 0 ? 0 : (maxChannel - minChannel) / maxChannel;
}

function mixRgba(a: RGBA, b: RGBA, t: number): RGBA {
  return [
    mix(a[0], b[0], t),
    mix(a[1], b[1], t),
    mix(a[2], b[2], t),
    mix(a[3], b[3], t),
  ];
}

function averageRgba(samples: RGBA[]): RGBA {
  const sum = samples.reduce<RGBA>(
    (total, sample) => [
      total[0] + sample[0],
      total[1] + sample[1],
      total[2] + sample[2],
      total[3] + sample[3],
    ],
    [0, 0, 0, 0],
  );

  return [
    sum[0] / samples.length,
    sum[1] / samples.length,
    sum[2] / samples.length,
    sum[3] / samples.length,
  ];
}

function sampleSourceCircleEdge(x: number, y: number, params: RenderParams): SourceEdgeSample {
  const radius = params.view.radius;
  const boundaryWidth = Math.max(params.controls.chromaticBoundaryWidth, 0.001);
  const empty: SourceEdgeSample = {
    edge: 0,
    fill: 0,
    normalX: 0,
    normalY: 0,
    color: backgroundSample(params.controls),
  };

  for (let index = visibleCircles.length - 1; index >= 0; index -= 1) {
    const circle = visibleCircles[index];
    const circleRadius = circle.radius * params.controls.circleSizeScale * radius * circle.scale;

    if (circleRadius <= 0.001 || circle.fillAlpha <= 0.001) {
      continue;
    }

    const centerX = radius + circle.cx * radius;
    const centerY = radius + circle.cy * radius;
    const dx = x - centerX;
    const dy = y - centerY;
    const distance = Math.hypot(dx, dy);
    const edgeDistance = Math.abs(distance - circleRadius);
    const edge = (1 - smoothstep(boundaryWidth * 0.2, boundaryWidth, edgeDistance)) * circle.fillAlpha;
    const fill = smoothstep(circleRadius + boundaryWidth, circleRadius - boundaryWidth, distance) * circle.fillAlpha;

    if (edge > empty.edge) {
      empty.edge = edge;
      empty.fill = fill;
      empty.normalX = distance > 0.001 ? dx / distance : 0;
      empty.normalY = distance > 0.001 ? dy / distance : 0;
      empty.color = colorToRgba(circle.color);
    }
  }

  return empty;
}

function sampleLiquidGlass(nx: number, ny: number, radial: number, params: RenderParams): RGBA {
  const radius = params.view.radius;

  if (!params.controls.refractionEnabled) {
    return sampleContent(radius + nx * radius, radius + ny * radius, params);
  }

  const surface = sampleSurfaceField(nx, ny, radial, params);
  const refractionHeight = surface.height * getDisplacementEdgeFade(radial, params.controls);
  const baseRay = refractCameraRay(surface.slopeX, surface.slopeY, params.controls.ior);
  const [baseOffsetX, baseOffsetY] = rayToDisplacement(baseRay, refractionHeight);
  const redSource = params.controls.chromaticEnabled
    ? rayToDisplacement(
      refractCameraRay(surface.slopeX, surface.slopeY, params.controls.ior + params.controls.dispersion),
      refractionHeight,
    )
    : [baseOffsetX, baseOffsetY];
  const blueSource = params.controls.chromaticEnabled
    ? rayToDisplacement(
      refractCameraRay(surface.slopeX, surface.slopeY, Math.max(params.controls.ior - params.controls.dispersion, 1.0001)),
      refractionHeight,
    )
    : [baseOffsetX, baseOffsetY];

  const sampleAtOffset = ([offsetX, offsetY]: number[]): RGBA => sampleContent(
    radius + nx * radius + offsetX,
    radius + ny * radius + offsetY,
    params,
  );
  const red = sampleAtOffset(redSource);
  const base = sampleAtOffset([baseOffsetX, baseOffsetY]);
  const blue = sampleAtOffset(blueSource);
  let sample = base;

  if (params.controls.chromaticEnabled) {
    const separationX = blueSource[0] - redSource[0];
    const separationY = blueSource[1] - redSource[1];
    const separation = Math.hypot(separationX, separationY);
    const baseSourceX = radius + nx * radius + baseOffsetX;
    const baseSourceY = radius + ny * radius + baseOffsetY;
    const sourceEdge = sampleSourceCircleEdge(baseSourceX, baseSourceY, params);
    const sourceEdgeGate =
      sourceEdge.edge *
      params.controls.chromaticBoundaryStrength *
      smoothstep(0.42, 0.98, radial) *
      (0.48 + surface.rim * 0.52);
    const sourceSaturation = colorSaturation(sourceEdge.color);
    const dispersionBlur = clamp(
      params.controls.dispersion * (surface.rim * 1.2 + sourceEdgeGate * 0.85),
      0,
      0.46,
    );
    const spectralBlur = averageRgba([red, base, base, blue]);

    sample = mixRgba(sample, spectralBlur, dispersionBlur);

    const sourceContrast = Math.max(colorDistance(red, base), colorDistance(blue, base)) / 441.672;
    const refractedEdgeGate =
      smoothstep(0.04, 0.24, sourceContrast) *
      smoothstep(0.25, 2.6, separation) *
      smoothstep(0.56, 1, radial) *
      surface.rim;
    const edgeGate = Math.max(refractedEdgeGate, sourceEdgeGate);

    if (edgeGate > 0.001 && params.controls.chromaticEdgeStrength > 0) {
      const refractDirectionX = separation > 0.0001 ? separationX / separation : sourceEdge.normalX;
      const refractDirectionY = separation > 0.0001 ? separationY / separation : sourceEdge.normalY;
      const boundaryDirectionMix = clamp(sourceEdgeGate / (sourceEdgeGate + refractedEdgeGate + 0.001), 0, 1);
      const mixedDirectionX = mix(refractDirectionX, sourceEdge.normalX, boundaryDirectionMix * 0.9);
      const mixedDirectionY = mix(refractDirectionY, sourceEdge.normalY, boundaryDirectionMix * 0.9);
      const mixedDirectionLength = Math.hypot(mixedDirectionX, mixedDirectionY);
      const directionX = mixedDirectionLength > 0.0001 ? mixedDirectionX / mixedDirectionLength : refractDirectionX;
      const directionY = mixedDirectionLength > 0.0001 ? mixedDirectionY / mixedDirectionLength : refractDirectionY;
      const strength = params.controls.chromaticEdgeStrength * edgeGate;
      const boost = 1 + strength * 1.8;
      const spread = params.controls.chromaticEdgeWidth * (0.32 + strength);
      const redWide = sampleAtOffset([
        baseOffsetX + (redSource[0] - baseOffsetX) * boost - directionX * spread * 0.35,
        baseOffsetY + (redSource[1] - baseOffsetY) * boost - directionY * spread * 0.35,
      ]);
      const blueWide = sampleAtOffset([
        baseOffsetX + (blueSource[0] - baseOffsetX) * boost + directionX * spread * 0.35,
        baseOffsetY + (blueSource[1] - baseOffsetY) * boost + directionY * spread * 0.35,
      ]);
      const wideBlur = averageRgba([redWide, base, blueWide]);
      const colorFollow = mixRgba(wideBlur, sourceEdge.color, clamp(sourceEdgeGate * sourceSaturation * 0.5, 0, 0.46));
      const wideMix = clamp(strength * 0.85 + sourceEdgeGate * 0.32, 0, 0.94);
      const splitMix = clamp(strength * 0.2 + sourceEdgeGate * 0.1, 0, 0.34);

      sample = mixRgba(sample, colorFollow, wideMix);
      sample = [
        mix(sample[0], redWide[0], splitMix),
        mix(sample[1], colorFollow[1], splitMix * 0.62),
        mix(sample[2], blueWide[2], splitMix),
        255,
      ];
    }
  }

  return [
    sample[0],
    sample[1],
    sample[2],
    255,
  ];
}

function renderGlassBall(params: RenderParams): void {
  drawContentLayer(params);
  renderSurfaceField(params);

  const size = ballCanvas.width;
  const image = ballCtx.createImageData(size, size);
  const data = image.data;
  const radiusPx = size * 0.5;
  const inverseOrientation = transposeMatrix3(params.orientation);

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
      const previewSurface = params.controls.surfacePreviewEnabled;
      const [sampleR, sampleG, sampleB] = previewSurface
        ? sampleSurfaceFieldPreview(nx, ny, radial, params)
        : sampleLiquidGlass(nx, ny, radial, params);
      const directionalLight = Math.max(0, nx * -0.36 + ny * -0.48 + nz * 0.88);
      const innerShade = !previewSurface && params.controls.innerShadeEnabled
        ? 0.88 + nz * 0.12 + directionalLight * 0.08 - edgeT * 0.08
        : 1;
      const glassMilk = !previewSurface && params.controls.glassMilkEnabled
        ? 0.025 + edgeT * 0.22 + smoothstep(0.92, 1, radial) * 0.18
        : 0;
      const topWash = !previewSurface && params.controls.topWashEnabled
        ? smoothstep(0.18, -0.82, ny) * smoothstep(0.98, 0.16, radial)
        : 0;
      const rim = !previewSurface && params.controls.rimEnabled ? smoothstep(0.72, 1, radial) : 0;
      const hardRim = !previewSurface && params.controls.hardRimEnabled ? smoothstep(0.93, 1, radial) : 0;
      const caRim = !previewSurface && params.controls.caRimEnabled ? smoothstep(0.8, 1, radial) : 0;
      const hasAreaSpec =
        !previewSurface &&
        (params.controls.specAEnabled || params.controls.specBEnabled || params.controls.specCEnabled);
      const specReflection: Vec3 = hasAreaSpec ? getSpecularReflection(nx, ny, nz, inverseOrientation) : [0, 0, 1];
      const specA = !previewSurface && params.controls.specAEnabled
        ? areaWindowSpecular(specReflection, -0.58, -0.62, 0.24, 0.11, 0.36, 1.45)
        : 0;
      const specB = !previewSurface && params.controls.specBEnabled
        ? areaWindowSpecular(specReflection, 0.5, -0.2, 0.12, 0.18, 0.42, 1.65)
        : 0;
      const specC = !previewSurface && params.controls.specCEnabled
        ? areaWindowSpecular(specReflection, -0.06, -0.42, 0.46, 0.14, 0.48, 1.25)
        : 0;
      const shell = specA * 34 + specB * 22 + specC * 6;

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

function drawScene(params: RenderParams): void {
  const renderView = params.view;

  ctx.clearRect(0, 0, renderView.width, renderView.height);
  ctx.fillStyle = params.controls.backgroundColor;
  ctx.fillRect(0, 0, renderView.width, renderView.height);

  if (params.controls.shadowEnabled) {
    const shadow = ctx.createRadialGradient(
      renderView.cx,
      renderView.cy + renderView.radius * 0.94,
      renderView.radius * 0.08,
      renderView.cx,
      renderView.cy + renderView.radius * 0.94,
      renderView.radius * 0.96,
    );
    shadow.addColorStop(0, 'rgba(0, 0, 0, 0.22)');
    shadow.addColorStop(0.5, 'rgba(0, 0, 0, 0.08)');
    shadow.addColorStop(1, 'rgba(0, 0, 0, 0)');

    ctx.save();
    ctx.scale(1, 0.22);
    ctx.fillStyle = shadow;
    ctx.beginPath();
    ctx.ellipse(
      renderView.cx,
      (renderView.cy + renderView.radius * 0.94) / 0.22,
      renderView.radius * 0.9,
      renderView.radius * 0.52,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    ctx.restore();
  }

  renderGlassBall(params);
  ctx.drawImage(
    ballCanvas,
    renderView.cx - renderView.radius,
    renderView.cy - renderView.radius,
    renderView.radius * 2,
    renderView.radius * 2,
  );

  if (params.controls.outerStrokeEnabled) {
    const rim = ctx.createLinearGradient(
      renderView.cx - renderView.radius,
      renderView.cy - renderView.radius,
      renderView.cx + renderView.radius,
      renderView.cy + renderView.radius,
    );
    rim.addColorStop(0, 'rgba(255, 255, 255, 0.5)');
    rim.addColorStop(0.36, 'rgba(255, 255, 255, 0.08)');
    rim.addColorStop(0.68, 'rgba(214, 205, 190, 0.1)');
    rim.addColorStop(1, 'rgba(255, 255, 255, 0.34)');

    ctx.lineWidth = Math.max(0.8, renderView.radius * 0.012);
    ctx.strokeStyle = rim;
    ctx.beginPath();
    ctx.arc(renderView.cx, renderView.cy, renderView.radius - ctx.lineWidth * 0.5, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function tick(now: number): void {
  const dt = Math.min(0.05, Math.max(0.001, (now - lastFrame) / 1000 || 0.016));
  lastFrame = now;

  if (pointerId === null) {
    if (spinVelocity > 0) {
      applyScreenAxisRotation(spinAxis, spinVelocity * dt);
      spinVelocity *= 0.92;
    }

    if (spinVelocity < 0.01) {
      spinVelocity = 0;
    }
  }

  renderer.render(getRenderParams());
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
  lastPointerTime = event.timeStamp || performance.now();
  spinVelocity = 0;
  canvas.setPointerCapture(event.pointerId);
});

canvas.addEventListener('pointermove', (event) => {
  if (pointerId !== event.pointerId) {
    return;
  }

  event.preventDefault();
  const dx = event.clientX - lastPointerX;
  const dy = event.clientY - lastPointerY;
  const distance = Math.hypot(dx, dy);

  if (distance > 0.001) {
    const normalizedAxis: Vec3 = [-dy / distance, dx / distance, 0];
    const angle = (distance / view.radius) * layerControls.dragSensitivity;
    const now = event.timeStamp || performance.now();
    const dt = Math.max((now - lastPointerTime) / 1000, 0.016);

    applyScreenAxisRotation(normalizedAxis, angle);
    spinAxis = normalizedAxis;
    spinVelocity = Math.min(angle / dt, 9);
    lastPointerTime = now;
  }

  lastPointerX = event.clientX;
  lastPointerY = event.clientY;
});

canvas.addEventListener('pointerup', (event) => {
  if (pointerId !== event.pointerId) {
    return;
  }

  pointerId = null;
  event.preventDefault();
  canvas.releasePointerCapture(event.pointerId);
});

canvas.addEventListener('pointercancel', (event) => {
  if (pointerId !== event.pointerId) {
    return;
  }

  pointerId = null;
  event.preventDefault();
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
