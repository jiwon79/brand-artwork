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

type DemoMode = 'none' | 'two' | 'three';

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
  : requestedDemo === '3' || requestedDemo === '1'
    ? 'three'
    : 'none';

const controls = {
  minCompression: 0.5,
  maxStretch: 2.8,
  transverseExponent: 0.5,
  globalRigidity: 2,
  influenceRadius: 1.12,
  residualStrength: 1.3,
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

  return displacement * uResidualStrength / max(1.0, weightSum);
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

function average(points: Vec2[]): Vec2 {
  if (points.length === 0) return { x: 0, y: 0 };
  const total = points.reduce((sum, point) => add(sum, point), { x: 0, y: 0 });
  return scale(total, 1 / points.length);
}

function twoPointTransform(items: Deformer[]): { matrix: Mat2; translation: Vec2 } {
  const restMidpoint = scale(add(items[0].anchor, items[1].anchor), 0.5);
  const currentMidpoint = scale(add(items[0].position, items[1].position), 0.5);
  const restAxis = subtract(items[1].anchor, items[0].anchor);
  const currentAxis = subtract(items[1].position, items[0].position);
  const restDistance = Math.max(length(restAxis), 0.08);
  const currentDistance = Math.max(length(currentAxis), 0.02);
  const majorScale = clamp(currentDistance / restDistance, controls.minCompression, controls.maxStretch);
  const minorScale = Math.pow(majorScale, -controls.transverseExponent);
  const restAngle = Math.atan2(restAxis.y, restAxis.x);
  const currentAngle = Math.atan2(currentAxis.y, currentAxis.x);
  const restCosine = Math.cos(restAngle);
  const restSine = Math.sin(restAngle);
  const currentCosine = Math.cos(currentAngle);
  const currentSine = Math.sin(currentAngle);
  const matrix: Mat2 = [
    currentCosine * majorScale * restCosine + currentSine * minorScale * restSine,
    currentCosine * majorScale * restSine - currentSine * minorScale * restCosine,
    currentSine * majorScale * restCosine - currentCosine * minorScale * restSine,
    currentSine * majorScale * restSine + currentCosine * minorScale * restCosine,
  ];
  const mappedMidpoint = applyMatrix(matrix, restMidpoint);
  return { matrix, translation: subtract(currentMidpoint, mappedMidpoint) };
}

function similarityFallback(items: Deformer[], restMean: Vec2, currentMean: Vec2): Mat2 {
  let dotSum = controls.globalRigidity;
  let crossSum = 0;
  let restEnergy = controls.globalRigidity;

  for (const item of items) {
    const rest = subtract(item.anchor, restMean);
    const current = subtract(item.position, currentMean);
    dotSum += current.x * rest.x + current.y * rest.y;
    crossSum += current.y * rest.x - current.x * rest.y;
    restEnergy += rest.x * rest.x + rest.y * rest.y;
  }

  const a = dotSum / restEnergy;
  const b = crossSum / restEnergy;
  return [a, -b, b, a];
}

function multiPointTransform(items: Deformer[]): { matrix: Mat2; translation: Vec2 } {
  const restMean = average(items.map((item) => item.anchor));
  const currentMean = average(items.map((item) => item.position));
  let sxx = controls.globalRigidity;
  let sxy = 0;
  let syy = controls.globalRigidity;
  let cxx = controls.globalRigidity;
  let cxy = 0;
  let cyx = 0;
  let cyy = controls.globalRigidity;

  for (const item of items) {
    const rest = subtract(item.anchor, restMean);
    const current = subtract(item.position, currentMean);
    sxx += rest.x * rest.x;
    sxy += rest.x * rest.y;
    syy += rest.y * rest.y;
    cxx += current.x * rest.x;
    cxy += current.x * rest.y;
    cyx += current.y * rest.x;
    cyy += current.y * rest.y;
  }

  const determinant = sxx * syy - sxy * sxy;
  let matrix: Mat2;

  if (Math.abs(determinant) < 0.0001) {
    matrix = similarityFallback(items, restMean, currentMean);
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
    matrix = similarityFallback(items, restMean, currentMean);
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

  const translation = subtract(currentMean, applyMatrix(matrix, restMean));
  return { matrix, translation };
}

function computeShapeState(): ShapeState {
  const items = [...deformers.values()].slice(0, maxDeformers);
  if (items.length === 0) {
    return { matrix: identityMatrix, inverse: identityMatrix, translation: zeroVector, residuals: [] };
  }

  if (items.length === 1) {
    const translation = subtract(items[0].position, items[0].anchor);
    return { matrix: identityMatrix, inverse: identityMatrix, translation, residuals: [] };
  }

  const transform = items.length === 2
    ? twoPointTransform(items)
    : multiPointTransform(items);
  const residuals = items.length < 3
    ? []
    : items.map((item) => {
      const mapped = add(applyMatrix(transform.matrix, item.anchor), transform.translation);
      return { anchor: item.anchor, displacement: subtract(item.position, mapped) };
    });

  return {
    matrix: transform.matrix,
    inverse: inverseMatrix(transform.matrix),
    translation: transform.translation,
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

  return scale(total, controls.residualStrength / Math.max(1, weightSum));
}

function inverseDeform(position: Vec2, state: ShapeState): Vec2 {
  let restPosition = applyMatrix(state.inverse, subtract(position, state.translation));

  for (let iteration = 0; iteration < 3; iteration += 1) {
    const localResidual = residualAt(restPosition, state);
    restPosition = applyMatrix(state.inverse, subtract(subtract(position, state.translation), localResidual));
  }

  return restPosition;
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
}

function clearDeformers(): void {
  deformers.clear();
  demoNeedsSetup = controls.demoMode !== 'none' && !prefersReducedMotion;
}

function createDemoDeformer(id: number, anchor: Vec2, phase: number): void {
  deformers.set(id, {
    id,
    anchor,
    position: { ...anchor },
    target: { ...anchor },
    velocity: { x: 0, y: 0 },
    active: true,
    persistent: true,
    demoPhase: phase,
  });
}

function setupDemo(): void {
  deformers.clear();
  demoTime = 0;

  if (controls.demoMode === 'two') {
    createDemoDeformer(-1, { x: -0.52, y: 0 }, 0);
    createDemoDeformer(-2, { x: 0.52, y: 0 }, Math.PI);
  } else if (controls.demoMode === 'three') {
    createDemoDeformer(-1, { x: -0.48, y: -0.28 }, 0);
    createDemoDeformer(-2, { x: 0.48, y: -0.28 }, Math.PI * 0.67);
    createDemoDeformer(-3, { x: 0, y: 0.56 }, Math.PI * 1.34);
  }

  demoNeedsSetup = false;
}

function updateDemo(delta: number): void {
  if (controls.demoMode === 'none' || prefersReducedMotion) return;
  if (demoNeedsSetup) setupDemo();
  demoTime += delta;

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

  for (const [id, item] of deformers) {
    if (item.active) {
      item.position = { ...item.target };
      continue;
    }

    const displacement = subtract(item.position, item.anchor);
    item.velocity.x += (-stiffness * displacement.x - damping * item.velocity.x) * delta;
    item.velocity.y += (-stiffness * displacement.y - damping * item.velocity.y) * delta;
    item.position.x += item.velocity.x * delta;
    item.position.y += item.velocity.y * delta;

    if (length(displacement) < 0.0015 && length(item.velocity) < 0.01) {
      deformers.delete(id);
    }
  }
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
    reset: () => {
      controls.demoMode = 'none';
      clearDeformers();
    },
  };

  gui.add(actions, 'demo2Point').name('2-point ellipse');
  gui.add(actions, 'demo3Point').name('3-point RBF');
  gui.add(actions, 'reset').name('reset');

  const shape = gui.addFolder('1 shape field');
  shape.add(controls, 'minCompression', 0.25, 1, 0.01).name('min compression');
  shape.add(controls, 'maxStretch', 1.2, 4, 0.05).name('max stretch');
  shape.add(controls, 'transverseExponent', 0, 1, 0.01).name('area preservation');
  shape.add(controls, 'globalRigidity', 0.02, 4, 0.01).name('global rigidity');
  shape.add(controls, 'influenceRadius', 0.2, 1.5, 0.01).name('RBF radius');
  shape.add(controls, 'residualStrength', 0, 1.8, 0.01).name('RBF strength');
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
  debug.close();
  gui.close();
}

resize();
setupGui();
requestAnimationFrame(animate);
