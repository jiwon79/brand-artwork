import GUI from 'lil-gui';

type Vec2 = {
  x: number;
  y: number;
};

type Mat2 = [number, number, number, number];

type Deformer = {
  id: number;
  anchor: Vec2;
  position: Vec2;
  target: Vec2;
  velocity: Vec2;
  influence: number;
  active: boolean;
  persistent: boolean;
  demoPhase: number;
};

type Residual = {
  anchor: Vec2;
  displacement: Vec2;
};

type ShapeState = {
  matrix: Mat2;
  inverse: Mat2;
  translation: Vec2;
  residuals: Residual[];
};

type View = {
  width: number;
  height: number;
  dpr: number;
  centerX: number;
  centerY: number;
  radius: number;
};

type DemoMode = 'none' | 'two' | 'three' | 'transition' | 'releaseAll' | 'singleReentry';

const maxDeformers = 10;
const identityMatrix: Mat2 = [1, 0, 0, 1];
const zeroVector = { x: 0, y: 0 };
const canvas = document.getElementById('elastic-canvas') as HTMLCanvasElement;
const gl = canvas.getContext('webgl2', {
  alpha: false,
  antialias: false,
  depth: false,
  stencil: false,
  powerPreference: 'high-performance',
});

if (!gl) {
  throw new Error('WebGL2 is required for the implicit elastic prototype.');
}

const query = new URLSearchParams(window.location.search);
const requestedDemo = query.get('demo');
const initialDemo: DemoMode = requestedDemo === '2'
  ? 'two'
  : requestedDemo === 'transition'
    ? 'transition'
    : requestedDemo === 'release-all'
      ? 'releaseAll'
      : requestedDemo === 'single-reentry'
        ? 'singleReentry'
    : requestedDemo === '3' || requestedDemo === '1'
      ? 'three'
      : 'none';

const controls = {
  maxStretch: 2.8,
  globalRigidity: 2,
  influenceRadius: 1.12,
  residualStrength: 1.3,
  maxLocalWarp: 0.42,
  centerLockRadius: 0.34,
  contactBlendDuration: 0.16,
  springFrequency: 3.1,
  springDamping: 0.34,
  baseColor: '#d8eff0',
  coolTint: '#4fa7ad',
  warmTint: '#f1a39b',
  edgeColor: '#ffffff',
  shadowStrength: 0.18,
  edgeWidth: 0.045,
  showContacts: false,
  normalDebug: false,
  demoMode: initialDemo,
};

const debugStats = {
  activeContacts: 0,
  returningContacts: 0,
  solverContacts: 0,
  solver: 'center anchored',
};

const vertexShaderSource = `#version 300 es
precision highp float;

const vec2 positions[3] = vec2[3](
  vec2(-1.0, -1.0),
  vec2(3.0, -1.0),
  vec2(-1.0, 3.0)
);

void main() {
  gl_Position = vec4(positions[gl_VertexID], 0.0, 1.0);
}
`;

const fragmentShaderSource = `#version 300 es
precision highp float;

#define MAX_DEFORMERS 10

uniform vec2 uResolution;
uniform vec2 uCenter;
uniform float uRadius;
uniform mat2 uInverseMatrix;
uniform vec2 uTranslation;
uniform int uResidualCount;
uniform vec2 uAnchors[MAX_DEFORMERS];
uniform vec2 uResiduals[MAX_DEFORMERS];
uniform int uHandleCount;
uniform vec2 uHandles[MAX_DEFORMERS];
uniform float uInfluenceRadius;
uniform float uResidualStrength;
uniform float uCenterLockRadius;
uniform vec3 uBaseColor;
uniform vec3 uCoolTint;
uniform vec3 uWarmTint;
uniform vec3 uEdgeColor;
uniform float uShadowStrength;
uniform float uEdgeWidth;
uniform bool uShowContacts;
uniform bool uNormalDebug;

out vec4 outputColor;

float wendland(float normalizedDistance) {
  float t = max(1.0 - normalizedDistance, 0.0);
  return t * t * t * t * (4.0 * normalizedDistance + 1.0);
}

vec2 residualAt(vec2 restPosition) {
  vec2 displacement = vec2(0.0);
  float weightSum = 0.0;

  for (int i = 0; i < MAX_DEFORMERS; i += 1) {
    if (i >= uResidualCount) break;
    float normalizedDistance = length(restPosition - uAnchors[i]) / uInfluenceRadius;
    float weight = wendland(normalizedDistance);
    displacement += uResiduals[i] * weight;
    weightSum += weight;
  }

  float centerGate = smoothstep(0.0, uCenterLockRadius, length(restPosition));
  return displacement * uResidualStrength * centerGate / max(1.0, weightSum);
}

vec2 inverseDeform(vec2 screenPosition) {
  vec2 restPosition = uInverseMatrix * (screenPosition - uTranslation);

  for (int iteration = 0; iteration < 3; iteration += 1) {
    vec2 localResidual = residualAt(restPosition);
    restPosition = uInverseMatrix * (screenPosition - uTranslation - localResidual);
  }

  return restPosition;
}

float signedDistance(vec2 screenPosition) {
  return length(inverseDeform(screenPosition)) - 1.0;
}

void main() {
  vec2 pixel = vec2(gl_FragCoord.x, uResolution.y - gl_FragCoord.y);
  vec2 position = (pixel - uCenter) / uRadius;
  float distanceToShape = signedDistance(position);
  float antialiasWidth = max(fwidth(distanceToShape) * 1.25, 0.0015);
  float shapeMask = 1.0 - smoothstep(-antialiasWidth, antialiasWidth, distanceToShape);

  float shadowDistance = signedDistance(position - vec2(0.0, 0.085));
  float shadowMask = 1.0 - smoothstep(-0.015, 0.17, shadowDistance);
  vec3 color = vec3(0.973, 0.976, 0.969);
  color = mix(color, vec3(0.12, 0.25, 0.26), shadowMask * uShadowStrength * (1.0 - shapeMask));

  vec2 gradientDerivative = vec2(dFdx(distanceToShape), dFdy(distanceToShape));
  vec2 gradient = length(gradientDerivative) > 0.0001
    ? normalize(gradientDerivative)
    : vec2(-0.55, -0.82);
  vec2 restPosition = inverseDeform(position);
  float diagonal = clamp((restPosition.x + restPosition.y + 1.5) / 3.0, 0.0, 1.0);
  float surfaceHeight = sqrt(max(1.0 - dot(restPosition, restPosition), 0.001));
  vec3 surfaceNormal = normalize(vec3(-restPosition.x, -restPosition.y, surfaceHeight));
  float light = clamp(dot(surfaceNormal, normalize(vec3(-0.48, -0.62, 0.82))) * 0.5 + 0.5, 0.0, 1.0);

  vec3 body = mix(uCoolTint, uBaseColor, light * 0.74 + 0.18);
  float warmField = exp(-5.2 * dot(restPosition - vec2(0.34, 0.34), restPosition - vec2(0.34, 0.34)));
  body = mix(body, uWarmTint, warmField * 0.32);
  body += vec3(1.0) * pow(max(1.0 - length(restPosition - vec2(-0.32, -0.38)), 0.0), 3.0) * 0.34;
  body *= mix(0.88, 1.08, diagonal);

  float innerRim = 1.0 - smoothstep(0.0, uEdgeWidth, abs(distanceToShape));
  body = mix(body, uEdgeColor, innerRim * 0.7);
  color = mix(color, body, shapeMask);

  if (uNormalDebug && shapeMask > 0.0) {
    color = vec3(gradient * 0.5 + 0.5, 0.5);
  }

  if (uShowContacts) {
    for (int i = 0; i < MAX_DEFORMERS; i += 1) {
      if (i >= uHandleCount) break;
      float handleDistance = length(position - uHandles[i]);
      float dotMask = 1.0 - smoothstep(0.014, 0.024, handleDistance);
      float ringMask = 1.0 - smoothstep(0.006, 0.014, abs(handleDistance - 0.065));
      color = mix(color, vec3(0.06, 0.22, 0.23), dotMask * 0.82);
      color = mix(color, vec3(1.0), ringMask * 0.5);
    }

    float centerDistance = length(position);
    float centerDot = 1.0 - smoothstep(0.016, 0.026, centerDistance);
    float centerRing = 1.0 - smoothstep(0.006, 0.014, abs(centerDistance - 0.078));
    color = mix(color, vec3(0.03, 0.13, 0.14), centerDot * 0.92);
    color = mix(color, vec3(0.35, 0.95, 0.88), centerRing * 0.72);
  }

  outputColor = vec4(color, 1.0);
}
`;

function compileShader(type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Unable to create WebGL shader.');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) ?? 'Unknown shader compile error.';
    gl.deleteShader(shader);
    throw new Error(message);
  }

  return shader;
}

function createProgram(): WebGLProgram {
  const program = gl.createProgram();
  if (!program) throw new Error('Unable to create WebGL program.');
  const vertexShader = compileShader(gl.VERTEX_SHADER, vertexShaderSource);
  const fragmentShader = compileShader(gl.FRAGMENT_SHADER, fragmentShaderSource);
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) ?? 'Unknown WebGL link error.';
    gl.deleteProgram(program);
    throw new Error(message);
  }

  return program;
}

const program = createProgram();
const uniform = {
  resolution: gl.getUniformLocation(program, 'uResolution'),
  center: gl.getUniformLocation(program, 'uCenter'),
  radius: gl.getUniformLocation(program, 'uRadius'),
  inverseMatrix: gl.getUniformLocation(program, 'uInverseMatrix'),
  translation: gl.getUniformLocation(program, 'uTranslation'),
  residualCount: gl.getUniformLocation(program, 'uResidualCount'),
  anchors: gl.getUniformLocation(program, 'uAnchors[0]'),
  residuals: gl.getUniformLocation(program, 'uResiduals[0]'),
  handleCount: gl.getUniformLocation(program, 'uHandleCount'),
  handles: gl.getUniformLocation(program, 'uHandles[0]'),
  influenceRadius: gl.getUniformLocation(program, 'uInfluenceRadius'),
  residualStrength: gl.getUniformLocation(program, 'uResidualStrength'),
  centerLockRadius: gl.getUniformLocation(program, 'uCenterLockRadius'),
  baseColor: gl.getUniformLocation(program, 'uBaseColor'),
  coolTint: gl.getUniformLocation(program, 'uCoolTint'),
  warmTint: gl.getUniformLocation(program, 'uWarmTint'),
  edgeColor: gl.getUniformLocation(program, 'uEdgeColor'),
  shadowStrength: gl.getUniformLocation(program, 'uShadowStrength'),
  edgeWidth: gl.getUniformLocation(program, 'uEdgeWidth'),
  showContacts: gl.getUniformLocation(program, 'uShowContacts'),
  normalDebug: gl.getUniformLocation(program, 'uNormalDebug'),
};

const deformers = new Map<number, Deformer>();
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let view: View;
let shapeState: ShapeState = {
  matrix: identityMatrix,
  inverse: identityMatrix,
  translation: zeroVector,
  residuals: [],
};
let previousTime = performance.now();
let demoTime = 0;
let demoNeedsSetup = controls.demoMode !== 'none' && !prefersReducedMotion;
let transitionThirdStart: Vec2 | null = null;
let demoReleased = false;
let demoAddedContact = false;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

function subtract(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

function scale(vector: Vec2, amount: number): Vec2 {
  return { x: vector.x * amount, y: vector.y * amount };
}

function length(vector: Vec2): number {
  return Math.hypot(vector.x, vector.y);
}

function applyMatrix(matrix: Mat2, vector: Vec2): Vec2 {
  return {
    x: matrix[0] * vector.x + matrix[1] * vector.y,
    y: matrix[2] * vector.x + matrix[3] * vector.y,
  };
}

function inverseMatrix(matrix: Mat2): Mat2 {
  const determinant = matrix[0] * matrix[3] - matrix[1] * matrix[2];
  if (Math.abs(determinant) < 0.0001) return identityMatrix;
  const inverseDeterminant = 1 / determinant;
  return [
    matrix[3] * inverseDeterminant,
    -matrix[1] * inverseDeterminant,
    -matrix[2] * inverseDeterminant,
    matrix[0] * inverseDeterminant,
  ];
}

function anchoredSimilarityFallback(items: Deformer[]): Mat2 {
  let dotSum = controls.globalRigidity;
  let crossSum = 0;
  let restEnergy = controls.globalRigidity;

  for (const item of items) {
    dotSum += item.influence * (
      item.position.x * item.anchor.x + item.position.y * item.anchor.y
    );
    crossSum += item.influence * (
      item.position.y * item.anchor.x - item.position.x * item.anchor.y
    );
    restEnergy += item.influence * (
      item.anchor.x * item.anchor.x + item.anchor.y * item.anchor.y
    );
  }

  const a = dotSum / restEnergy;
  const b = crossSum / restEnergy;
  return [a, -b, b, a];
}

function anchoredTransform(items: Deformer[]): Mat2 {
  let sxx = controls.globalRigidity;
  let sxy = 0;
  let syy = controls.globalRigidity;
  let cxx = controls.globalRigidity;
  let cxy = 0;
  let cyx = 0;
  let cyy = controls.globalRigidity;

  for (const item of items) {
    const weight = item.influence;
    sxx += weight * item.anchor.x * item.anchor.x;
    sxy += weight * item.anchor.x * item.anchor.y;
    syy += weight * item.anchor.y * item.anchor.y;
    cxx += weight * item.position.x * item.anchor.x;
    cxy += weight * item.position.x * item.anchor.y;
    cyx += weight * item.position.y * item.anchor.x;
    cyy += weight * item.position.y * item.anchor.y;
  }

  const determinant = sxx * syy - sxy * sxy;
  let matrix: Mat2;

  if (Math.abs(determinant) < 0.0001) {
    matrix = anchoredSimilarityFallback(items);
  } else {
    const inverseSxx = syy / determinant;
    const inverseSxy = -sxy / determinant;
    const inverseSyy = sxx / determinant;
    matrix = [
      cxx * inverseSxx + cxy * inverseSxy,
      cxx * inverseSxy + cxy * inverseSyy,
      cyx * inverseSxx + cyy * inverseSxy,
      cyx * inverseSxy + cyy * inverseSyy,
    ];
  }

  const matrixDeterminant = matrix[0] * matrix[3] - matrix[1] * matrix[2];
  if (matrixDeterminant < 0.12) {
    matrix = anchoredSimilarityFallback(items);
  }

  const maxComponent = Math.max(...matrix.map((component) => Math.abs(component)));
  if (maxComponent > controls.maxStretch) {
    const componentScale = controls.maxStretch / maxComponent;
    matrix = [
      1 + (matrix[0] - 1) * componentScale,
      matrix[1] * componentScale,
      matrix[2] * componentScale,
      1 + (matrix[3] - 1) * componentScale,
    ];
  }

  return matrix;
}

function computeShapeState(): ShapeState {
  const items = [...deformers.values()].slice(0, maxDeformers);
  if (items.length === 0) {
    return { matrix: identityMatrix, inverse: identityMatrix, translation: zeroVector, residuals: [] };
  }

  const matrix = anchoredTransform(items);
  let residuals = items.map((item) => ({
    anchor: item.anchor,
    displacement: scale(
      subtract(item.position, applyMatrix(matrix, item.anchor)),
      item.influence,
    ),
  }));

  const maximumResidual = residuals.reduce(
    (maximum, residual) => Math.max(maximum, length(residual.displacement)),
    0,
  );
  const safeResidual = controls.influenceRadius * controls.maxLocalWarp;
  const effectiveMaximum = maximumResidual * controls.residualStrength;
  if (effectiveMaximum > 0.0001 && safeResidual > 0.0001) {
    const limitedResidual = Math.tanh(effectiveMaximum / safeResidual) * safeResidual;
    const residualScale = limitedResidual / effectiveMaximum;
    residuals = residuals.map((residual) => ({
      anchor: residual.anchor,
      displacement: scale(residual.displacement, residualScale),
    }));
  }

  return {
    matrix,
    inverse: inverseMatrix(matrix),
    translation: zeroVector,
    residuals,
  };
}

function wendland(normalizedDistance: number): number {
  const t = Math.max(1 - normalizedDistance, 0);
  return t * t * t * t * (4 * normalizedDistance + 1);
}

function residualAt(restPosition: Vec2, state: ShapeState): Vec2 {
  let total = { x: 0, y: 0 };
  let weightSum = 0;

  for (const residual of state.residuals) {
    const normalizedDistance = length(subtract(restPosition, residual.anchor)) / controls.influenceRadius;
    const weight = wendland(normalizedDistance);
    total = add(total, scale(residual.displacement, weight));
    weightSum += weight;
  }

  const centerGate = clamp(length(restPosition) / controls.centerLockRadius, 0, 1);
  const smoothCenterGate = centerGate * centerGate * (3 - 2 * centerGate);
  return scale(
    total,
    controls.residualStrength * smoothCenterGate / Math.max(1, weightSum),
  );
}

function inverseDeform(position: Vec2, state: ShapeState): Vec2 {
  let restPosition = applyMatrix(state.inverse, subtract(position, state.translation));

  for (let iteration = 0; iteration < 3; iteration += 1) {
    const localResidual = residualAt(restPosition, state);
    restPosition = applyMatrix(state.inverse, subtract(subtract(position, state.translation), localResidual));
  }

  return restPosition;
}

function forwardDeform(restPosition: Vec2, state: ShapeState): Vec2 {
  return add(
    add(applyMatrix(state.matrix, restPosition), state.translation),
    residualAt(restPosition, state),
  );
}

function resize(): void {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const radius = clamp(Math.min(width, height) * 0.3, 118, 330);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  gl.viewport(0, 0, canvas.width, canvas.height);
  view = {
    width,
    height,
    dpr,
    centerX: width * 0.5,
    centerY: height * 0.5,
    radius,
  };
}

function normalizedPointer(event: PointerEvent): Vec2 {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left - view.centerX) / view.radius,
    y: (event.clientY - rect.top - view.centerY) / view.radius,
  };
}

function isInsideShape(position: Vec2): boolean {
  return length(inverseDeform(position, shapeState)) <= 1.06;
}

function stopDemo(): void {
  controls.demoMode = 'none';
  for (const id of [...deformers.keys()]) {
    if (id < 0) deformers.delete(id);
  }
  transitionThirdStart = null;
  demoReleased = false;
  demoAddedContact = false;
}

function clearDeformers(): void {
  deformers.clear();
  transitionThirdStart = null;
  demoReleased = false;
  demoAddedContact = false;
  demoNeedsSetup = controls.demoMode !== 'none' && !prefersReducedMotion;
}

function createDemoDeformer(
  id: number,
  anchor: Vec2,
  phase: number,
  influence = 1,
  position = anchor,
): void {
  deformers.set(id, {
    id,
    anchor,
    position: { ...position },
    target: { ...position },
    velocity: { x: 0, y: 0 },
    influence,
    active: true,
    persistent: true,
    demoPhase: phase,
  });
}

function setupDemo(): void {
  deformers.clear();
  demoTime = 0;
  demoReleased = false;
  demoAddedContact = false;
  transitionThirdStart = null;

  if (
    controls.demoMode === 'two'
    || controls.demoMode === 'transition'
    || controls.demoMode === 'releaseAll'
  ) {
    createDemoDeformer(-1, { x: -0.52, y: 0 }, 0);
    createDemoDeformer(-2, { x: 0.52, y: 0 }, Math.PI);
  } else if (controls.demoMode === 'three') {
    createDemoDeformer(-1, { x: -0.48, y: -0.28 }, 0);
    createDemoDeformer(-2, { x: 0.48, y: -0.28 }, Math.PI * 0.67);
    createDemoDeformer(-3, { x: 0, y: 0.56 }, Math.PI * 1.34);
  } else if (controls.demoMode === 'singleReentry') {
    createDemoDeformer(-1, { x: 0.48, y: 0.02 }, 0);
  }

  demoNeedsSetup = false;
}

function addDemoContact(id: number, screenPosition: Vec2): Deformer {
  const anchor = inverseDeform(screenPosition, shapeState);
  createDemoDeformer(id, anchor, 0, 0, screenPosition);
  const item = deformers.get(id);
  if (!item) throw new Error('Unable to create demo contact.');
  return item;
}

function releaseDemoContacts(): void {
  for (const item of deformers.values()) {
    item.active = false;
    item.persistent = false;
    item.target = { ...item.anchor };
    item.velocity = { x: 0, y: 0 };
  }
  demoReleased = true;
}

function updateTransitionDemo(releaseAtEnd: boolean): void {
  if (demoReleased) return;

  for (const id of [-1, -2]) {
    const item = deformers.get(id);
    if (!item) continue;
    const direction = Math.sign(item.anchor.x);
    item.target = { x: item.anchor.x + direction * 0.42, y: item.anchor.y };
    item.position = { ...item.target };
  }

  const addTime = releaseAtEnd ? 1.2 : 1.5;
  if (demoTime >= addTime && !demoAddedContact) {
    const anchor = { x: 0, y: 0.56 };
    transitionThirdStart = forwardDeform(anchor, shapeState);
    createDemoDeformer(-3, anchor, 0, 0, transitionThirdStart);
    demoAddedContact = true;
  }

  const third = deformers.get(-3);
  if (third && transitionThirdStart) {
    const progress = clamp((demoTime - addTime) / 1.05, 0, 1);
    const easedProgress = progress * progress * (3 - 2 * progress);
    const destination = { x: 0.06, y: 1.16 };
    third.target = add(
      scale(transitionThirdStart, 1 - easedProgress),
      scale(destination, easedProgress),
    );
    third.position = { ...third.target };
  }

  if (releaseAtEnd && demoTime >= 2.75) releaseDemoContacts();
}

function updateSingleReentryDemo(): void {
  if (demoReleased) return;
  const first = deformers.get(-1);

  if (first?.active && demoTime < 1) {
    const progress = clamp(demoTime / 0.75, 0, 1);
    const easedProgress = progress * progress * (3 - 2 * progress);
    first.target = add(first.anchor, scale({ x: 0.55, y: 0.18 }, easedProgress));
    first.position = { ...first.target };
  } else if (first?.active) {
    first.active = false;
    first.persistent = false;
    first.target = { ...first.anchor };
    first.velocity = { x: 0, y: 0 };
  }

  if (demoTime >= 1.35 && !demoAddedContact) {
    addDemoContact(-2, { x: -0.48, y: -0.08 });
    demoAddedContact = true;
  }

  const second = deformers.get(-2);
  if (second?.active) {
    const progress = clamp((demoTime - 1.35) / 0.9, 0, 1);
    const easedProgress = progress * progress * (3 - 2 * progress);
    second.target = add(second.anchor, scale({ x: -0.46, y: -0.28 }, easedProgress));
    second.position = { ...second.target };
    if (demoTime >= 2.65) releaseDemoContacts();
  }
}

function updateDemo(delta: number): void {
  if (controls.demoMode === 'none' || prefersReducedMotion) return;
  if (demoNeedsSetup) setupDemo();
  demoTime += delta;

  if (controls.demoMode === 'transition') {
    updateTransitionDemo(false);
    return;
  }
  if (controls.demoMode === 'releaseAll') {
    updateTransitionDemo(true);
    return;
  }
  if (controls.demoMode === 'singleReentry') {
    updateSingleReentryDemo();
    return;
  }

  for (const item of deformers.values()) {
    if (item.id >= 0) continue;
    const radialLength = Math.max(length(item.anchor), 0.01);
    const radial = scale(item.anchor, 1 / radialLength);
    const tangent = { x: -radial.y, y: radial.x };

    const threePointBase = item.id === -1 ? 0.66 : item.id === -2 ? 0.38 : 0.56;
    const outward = controls.demoMode === 'two'
      ? 0.28 + Math.sin(demoTime * 1.25) * 0.2
      : threePointBase + Math.sin(demoTime * 1.1 + item.demoPhase) * 0.08;
    const sway = controls.demoMode === 'two'
      ? Math.sin(demoTime * 0.65) * 0.12 * Math.sign(item.anchor.x)
      : Math.sin(demoTime * 0.72 + item.demoPhase * 1.4) * 0.08;
    item.target = add(item.anchor, add(scale(radial, outward), scale(tangent, sway)));
    item.position = { ...item.target };
  }
}

function updateSprings(delta: number): void {
  const angularFrequency = Math.PI * 2 * controls.springFrequency;
  const damping = 2 * controls.springDamping * angularFrequency;
  const stiffness = angularFrequency * angularFrequency;
  const blendStep = controls.contactBlendDuration <= 0
    ? 1
    : delta / controls.contactBlendDuration;

  for (const item of deformers.values()) {
    item.influence = Math.min(1, item.influence + blendStep);
    if (item.active) {
      item.position = { ...item.target };
      continue;
    }

    const displacement = subtract(item.position, item.anchor);
    item.velocity.x += (-stiffness * displacement.x - damping * item.velocity.x) * delta;
    item.velocity.y += (-stiffness * displacement.y - damping * item.velocity.y) * delta;
    item.position.x += item.velocity.x * delta;
    item.position.y += item.velocity.y * delta;
  }

  const items = [...deformers.values()];
  const hasActiveContacts = items.some((item) => item.active);
  const allContactsSettled = items.length > 0 && items.every((item) => (
    length(subtract(item.position, item.anchor)) < 0.0015
    && length(item.velocity) < 0.01
  ));
  if (!hasActiveContacts && allContactsSettled) deformers.clear();
}

function hexToRgb(color: string): [number, number, number] {
  const value = Number.parseInt(color.slice(1), 16);
  return [
    ((value >> 16) & 255) / 255,
    ((value >> 8) & 255) / 255,
    (value & 255) / 255,
  ];
}

function packVectors(items: Vec2[]): Float32Array {
  const packed = new Float32Array(maxDeformers * 2);
  for (let index = 0; index < Math.min(items.length, maxDeformers); index += 1) {
    packed[index * 2] = items[index].x;
    packed[index * 2 + 1] = items[index].y;
  }
  return packed;
}

function render(): void {
  const items = [...deformers.values()].slice(0, maxDeformers);
  const residuals = shapeState.residuals.slice(0, maxDeformers);
  const matrix = shapeState.inverse;

  gl.useProgram(program);
  gl.uniform2f(uniform.resolution, canvas.width, canvas.height);
  gl.uniform2f(uniform.center, view.centerX * view.dpr, view.centerY * view.dpr);
  gl.uniform1f(uniform.radius, view.radius * view.dpr);
  gl.uniformMatrix2fv(uniform.inverseMatrix, false, new Float32Array([
    matrix[0], matrix[2], matrix[1], matrix[3],
  ]));
  gl.uniform2f(uniform.translation, shapeState.translation.x, shapeState.translation.y);
  gl.uniform1i(uniform.residualCount, residuals.length);
  gl.uniform2fv(uniform.anchors, packVectors(residuals.map((item) => item.anchor)));
  gl.uniform2fv(uniform.residuals, packVectors(residuals.map((item) => item.displacement)));
  gl.uniform1i(uniform.handleCount, items.length);
  gl.uniform2fv(uniform.handles, packVectors(items.map((item) => item.position)));
  gl.uniform1f(uniform.influenceRadius, controls.influenceRadius);
  gl.uniform1f(uniform.residualStrength, controls.residualStrength);
  gl.uniform1f(uniform.centerLockRadius, controls.centerLockRadius);
  gl.uniform3fv(uniform.baseColor, hexToRgb(controls.baseColor));
  gl.uniform3fv(uniform.coolTint, hexToRgb(controls.coolTint));
  gl.uniform3fv(uniform.warmTint, hexToRgb(controls.warmTint));
  gl.uniform3fv(uniform.edgeColor, hexToRgb(controls.edgeColor));
  gl.uniform1f(uniform.shadowStrength, controls.shadowStrength);
  gl.uniform1f(uniform.edgeWidth, controls.edgeWidth);
  gl.uniform1i(uniform.showContacts, controls.showContacts ? 1 : 0);
  gl.uniform1i(uniform.normalDebug, controls.normalDebug ? 1 : 0);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

function animate(time: number): void {
  const delta = Math.min((time - previousTime) / 1000, 1 / 20);
  previousTime = time;
  updateDemo(delta);
  updateSprings(delta);
  shapeState = computeShapeState();
  const items = [...deformers.values()];
  debugStats.activeContacts = items.filter((item) => item.active).length;
  debugStats.returningContacts = items.filter((item) => !item.active).length;
  debugStats.solverContacts = items.length + 1;
  render();
  requestAnimationFrame(animate);
}

canvas.addEventListener('pointerdown', (event) => {
  if (controls.demoMode !== 'none') stopDemo();
  if (deformers.size >= maxDeformers) return;
  const position = normalizedPointer(event);
  if (!isInsideShape(position)) return;
  const anchor = inverseDeform(position, shapeState);
  const persistent = event.pointerType === 'mouse' && event.shiftKey;
  deformers.set(event.pointerId, {
    id: event.pointerId,
    anchor,
    position: { ...position },
    target: { ...position },
    velocity: { x: 0, y: 0 },
    influence: 0,
    active: true,
    persistent,
    demoPhase: 0,
  });
  canvas.setPointerCapture(event.pointerId);
  event.preventDefault();
});

canvas.addEventListener('pointermove', (event) => {
  const item = deformers.get(event.pointerId);
  if (!item || !item.active) return;
  const position = normalizedPointer(event);
  const movement = subtract(position, item.position);
  item.velocity = scale(movement, 60);
  item.target = position;
  item.position = { ...position };
  event.preventDefault();
});

function releasePointer(event: PointerEvent): void {
  const item = deformers.get(event.pointerId);
  if (item && !item.persistent) {
    item.active = false;
    item.target = { ...item.anchor };
  }
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  event.preventDefault();
}

canvas.addEventListener('pointerup', releasePointer);
canvas.addEventListener('pointercancel', releasePointer);
canvas.addEventListener('contextmenu', (event) => event.preventDefault());
window.addEventListener('resize', resize);

function startDemo(mode: DemoMode): void {
  controls.demoMode = mode;
  clearDeformers();
}

function setupGui(): void {
  const gui = new GUI({ title: 'Implicit elastic lab' });
  const actions = {
    demo2Point: () => startDemo('two'),
    demo3Point: () => startDemo('three'),
    demoTransition: () => startDemo('transition'),
    demoReleaseAll: () => startDemo('releaseAll'),
    demoSingleReentry: () => startDemo('singleReentry'),
    reset: () => {
      controls.demoMode = 'none';
      clearDeformers();
    },
  };

  gui.add(actions, 'demo2Point').name('2-point anchored');
  gui.add(actions, 'demo3Point').name('3-point RBF');
  gui.add(actions, 'demoTransition').name('2 + add third');
  gui.add(actions, 'demoReleaseAll').name('regression: release all');
  gui.add(actions, 'demoSingleReentry').name('regression: re-entry');
  gui.add(actions, 'reset').name('reset');

  const shape = gui.addFolder('1 shape field');
  shape.add(controls, 'maxStretch', 1.2, 4, 0.05).name('max stretch');
  shape.add(controls, 'globalRigidity', 0.02, 4, 0.01).name('global rigidity');
  shape.add(controls, 'influenceRadius', 0.2, 1.5, 0.01).name('RBF radius');
  shape.add(controls, 'residualStrength', 0, 1.8, 0.01).name('RBF strength');
  shape.add(controls, 'maxLocalWarp', 0.1, 0.8, 0.01).name('fold limit');
  shape.add(controls, 'centerLockRadius', 0.05, 0.8, 0.01).name('center lock radius');
  shape.add(controls, 'contactBlendDuration', 0, 0.5, 0.01).name('contact blend');
  shape.close();

  const spring = gui.addFolder('2 release spring');
  spring.add(controls, 'springFrequency', 0.5, 8, 0.1).name('frequency');
  spring.add(controls, 'springDamping', 0.05, 1.2, 0.01).name('damping');
  spring.close();

  const material = gui.addFolder('3 material');
  material.addColor(controls, 'baseColor').name('base');
  material.addColor(controls, 'coolTint').name('cool tint');
  material.addColor(controls, 'warmTint').name('warm tint');
  material.addColor(controls, 'edgeColor').name('edge');
  material.add(controls, 'edgeWidth', 0.005, 0.12, 0.001).name('edge width');
  material.add(controls, 'shadowStrength', 0, 0.4, 0.01).name('shadow');
  material.close();

  const debug = gui.addFolder('4 debug');
  debug.add(controls, 'showContacts').name('contacts');
  debug.add(controls, 'normalDebug').name('field normal');
  debug.add(debugStats, 'activeContacts').name('active').listen().disable();
  debug.add(debugStats, 'returningContacts').name('returning').listen().disable();
  debug.add(debugStats, 'solverContacts').name('solver contacts').listen().disable();
  debug.add(debugStats, 'solver').name('solver').listen().disable();
  debug.close();
  gui.close();
}

resize();
setupGui();
requestAnimationFrame(animate);
