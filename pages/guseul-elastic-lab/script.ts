import GUI from 'lil-gui';

type Vec2 = {
  x: number;
  y: number;
};

type Deformer = {
  id: number;
  anchor: Vec2;
  position: Vec2;
  target: Vec2;
  velocity: Vec2;
  influence: number;
  releaseAge: number | null;
  active: boolean;
  persistent: boolean;
  demoPhase: number;
};

type Pull = {
  anchor: Vec2;
  coefficient: Vec2;
};

type ShapeState = {
  pulls: Pull[];
  surfaceShrink: number;
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
  pullWidth: 0.55,
  gripRadius: 0.1,
  coreBlend: 0.55,
  tailStart: 2.2,
  tailEnd: 4,
  solverRegularization: 0.012,
  contactBlendDuration: 0.16,
  surfaceTension: 0.12,
  surfaceStart: 0.64,
  maximumSurfaceShrink: 0.16,
  contractionEnabled: true,
  poissonExponent: 0.48,
  contractionStrength: 0.62,
  contractionWidth: 0.54,
  contractionStart: 0.08,
  contractionEnd: 1.72,
  minimumWidth: 0.7,
  releaseHoldDuration: 0.16,
  releaseLifetime: 0.32,
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
  maxContactError: 0,
  solver: 'local capsule least squares',
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
uniform int uPullCount;
uniform vec2 uAnchors[MAX_DEFORMERS];
uniform vec2 uPullCoefficients[MAX_DEFORMERS];
uniform int uHandleCount;
uniform vec2 uHandles[MAX_DEFORMERS];
uniform float uPullWidth;
uniform float uGripRadius;
uniform float uCoreBlend;
uniform float uTailStart;
uniform float uTailEnd;
uniform float uSurfaceShrink;
uniform float uSurfaceStart;
uniform bool uContractionEnabled;
uniform float uPoissonExponent;
uniform float uContractionStrength;
uniform float uContractionWidth;
uniform float uContractionStart;
uniform float uContractionEnd;
uniform float uMinimumWidth;
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

float smoothMaximumOne(float value) {
  float delta = value - 1.0;
  return 0.5 * (1.0 + value + sqrt(delta * delta + 0.04));
}

float capsuleWeight(vec2 restPosition, vec2 anchor) {
  float restLength = length(anchor);
  if (restLength < 0.08) return 0.0;
  vec2 axis = anchor / restLength;
  vec2 perpendicular = vec2(-axis.y, axis.x);
  float along = dot(restPosition, axis) / restLength;
  float transverse = dot(restPosition, perpendicular);
  float centerRise = smoothstep(0.0, max(uCoreBlend, 0.05), along);
  float outerTail = 1.0 - smoothstep(uTailStart, max(uTailEnd, uTailStart + 0.05), along);
  float width = max(uPullWidth, 0.05);
  float gripRadius = min(max(uGripRadius, 0.0), width - 0.01);
  float lateral = 1.0 - smoothstep(gripRadius, width, abs(transverse));
  return centerRise * outerTail * lateral;
}

vec2 pullAt(vec2 restPosition) {
  vec2 displacement = vec2(0.0);

  for (int i = 0; i < MAX_DEFORMERS; i += 1) {
    if (i >= uPullCount) break;
    displacement += uPullCoefficients[i] * capsuleWeight(restPosition, uAnchors[i]);
  }

  return displacement;
}

vec2 contractionAt(vec2 restPosition) {
  if (!uContractionEnabled) return vec2(0.0);
  vec2 displacement = vec2(0.0);
  float weightSum = 0.0;

  for (int i = 0; i < MAX_DEFORMERS; i += 1) {
    if (i >= uPullCount) break;
    vec2 anchor = uAnchors[i];
    vec2 coefficient = uPullCoefficients[i];
    float restLength = length(anchor);
    if (restLength < 0.08) continue;

    vec2 restAxis = anchor / restLength;
    vec2 restPerpendicular = vec2(-restAxis.y, restAxis.x);
    float axialDelta = max(dot(coefficient, restAxis), 0.0);
    if (axialDelta <= 0.0001) continue;
    vec2 currentAxis = normalize(anchor + coefficient);
    vec2 currentPerpendicular = vec2(-currentAxis.y, currentAxis.x);
    float along = dot(restPosition, restAxis) / restLength;
    float transverse = dot(restPosition, restPerpendicular);
    float start = max(uContractionStart, 0.0);
    float end = max(uContractionEnd, start + 0.1);
    float segmentWindow = smoothstep(start, start + 0.28, along)
      * (1.0 - smoothstep(end - 0.38, end, along));
    float width = max(uContractionWidth, 0.05);
    float lateralWeight = wendland(abs(transverse) / width);
    float stretch = 1.0 + axialDelta / restLength;
    float contraction = (1.0 - pow(stretch, -uPoissonExponent)) * uContractionStrength;
    contraction = clamp(contraction, 0.0, 1.0 - uMinimumWidth);
    float weight = segmentWindow * lateralWeight;
    displacement -= currentPerpendicular * transverse * contraction * weight;
    weightSum += weight;
  }

  return displacement / smoothMaximumOne(weightSum);
}

vec2 surfaceTensionAt(vec2 restPosition) {
  float radius = length(restPosition);
  float surfaceWeight = smoothstep(uSurfaceStart, 1.0, radius);
  return -restPosition * uSurfaceShrink * surfaceWeight;
}

vec2 localDeformationAt(vec2 restPosition) {
  return pullAt(restPosition)
    + contractionAt(restPosition)
    + surfaceTensionAt(restPosition);
}

vec2 inverseDeform(vec2 screenPosition) {
  vec2 restPosition = screenPosition;
  const float timeStep = 1.0 / 16.0;

  for (int iteration = 0; iteration < 16; iteration += 1) {
    restPosition -= localDeformationAt(restPosition) * timeStep;
  }

  return restPosition;
}

float signedDistance(vec2 screenPosition) {
  return length(inverseDeform(screenPosition)) - 1.0;
}

void main() {
  vec2 pixel = vec2(gl_FragCoord.x, uResolution.y - gl_FragCoord.y);
  vec2 position = (pixel - uCenter) / uRadius;
  vec2 restPosition = inverseDeform(position);
  float distanceToShape = length(restPosition) - 1.0;
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
  pullCount: gl.getUniformLocation(program, 'uPullCount'),
  anchors: gl.getUniformLocation(program, 'uAnchors[0]'),
  pullCoefficients: gl.getUniformLocation(program, 'uPullCoefficients[0]'),
  handleCount: gl.getUniformLocation(program, 'uHandleCount'),
  handles: gl.getUniformLocation(program, 'uHandles[0]'),
  pullWidth: gl.getUniformLocation(program, 'uPullWidth'),
  gripRadius: gl.getUniformLocation(program, 'uGripRadius'),
  coreBlend: gl.getUniformLocation(program, 'uCoreBlend'),
  tailStart: gl.getUniformLocation(program, 'uTailStart'),
  tailEnd: gl.getUniformLocation(program, 'uTailEnd'),
  surfaceShrink: gl.getUniformLocation(program, 'uSurfaceShrink'),
  surfaceStart: gl.getUniformLocation(program, 'uSurfaceStart'),
  contractionEnabled: gl.getUniformLocation(program, 'uContractionEnabled'),
  poissonExponent: gl.getUniformLocation(program, 'uPoissonExponent'),
  contractionStrength: gl.getUniformLocation(program, 'uContractionStrength'),
  contractionWidth: gl.getUniformLocation(program, 'uContractionWidth'),
  contractionStart: gl.getUniformLocation(program, 'uContractionStart'),
  contractionEnd: gl.getUniformLocation(program, 'uContractionEnd'),
  minimumWidth: gl.getUniformLocation(program, 'uMinimumWidth'),
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
let shapeState: ShapeState = { pulls: [], surfaceShrink: 0 };
let previousTime = performance.now();
let demoTime = 0;
let demoNeedsSetup = controls.demoMode !== 'none' && !prefersReducedMotion;
let transitionThirdStart: Vec2 | null = null;
let demoReleased = false;
let demoAddedContact = false;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function smoothstep(min: number, max: number, value: number): number {
  const progress = clamp((value - min) / Math.max(max - min, 0.0001), 0, 1);
  return progress * progress * (3 - 2 * progress);
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

function wendland(normalizedDistance: number): number {
  const t = Math.max(1 - normalizedDistance, 0);
  return t * t * t * t * (4 * normalizedDistance + 1);
}

function smoothMaximumOne(value: number): number {
  const delta = value - 1;
  return 0.5 * (1 + value + Math.sqrt(delta * delta + 0.04));
}

function capsuleWeight(restPosition: Vec2, anchor: Vec2): number {
  const restLength = length(anchor);
  if (restLength < 0.08) return 0;
  const axis = scale(anchor, 1 / restLength);
  const perpendicular = { x: -axis.y, y: axis.x };
  const along = (
    restPosition.x * axis.x + restPosition.y * axis.y
  ) / restLength;
  const transverse = restPosition.x * perpendicular.x + restPosition.y * perpendicular.y;
  const centerRise = smoothstep(0, Math.max(controls.coreBlend, 0.05), along);
  const outerTail = 1 - smoothstep(
    controls.tailStart,
    Math.max(controls.tailEnd, controls.tailStart + 0.05),
    along,
  );
  const width = Math.max(controls.pullWidth, 0.05);
  const gripRadius = Math.min(Math.max(controls.gripRadius, 0), width - 0.01);
  const lateral = 1 - smoothstep(gripRadius, width, Math.abs(transverse));
  return centerRise * outerTail * lateral;
}

function solveLinearSystem(matrix: number[][], rightHandSide: number[]): number[] {
  const size = rightHandSide.length;
  const rows = matrix.map((row, index) => [...row, rightHandSide[index]]);

  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
    }
    [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
    const pivotValue = rows[column][column];
    if (Math.abs(pivotValue) < 0.000001) continue;

    for (let entry = column; entry <= size; entry += 1) {
      rows[column][entry] /= pivotValue;
    }
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = rows[row][column];
      if (Math.abs(factor) < 0.000001) continue;
      for (let entry = column; entry <= size; entry += 1) {
        rows[row][entry] -= factor * rows[column][entry];
      }
    }
  }

  return rows.map((row) => row[size]);
}

function computeShapeState(): ShapeState {
  const items = [...deformers.values()].slice(0, maxDeformers);
  const count = items.length;
  if (count === 0) return { pulls: [], surfaceShrink: 0 };

  const basis = Array.from({ length: count }, (_, row) => (
    Array.from({ length: count }, (_, column) => (
      items[column].influence * capsuleWeight(items[row].anchor, items[column].anchor)
    ))
  ));
  const normalMatrix = Array.from({ length: count }, () => Array(count).fill(0));
  const rightX = Array(count).fill(0);
  const rightY = Array(count).fill(0);

  for (let column = 0; column < count; column += 1) {
    for (let otherColumn = 0; otherColumn < count; otherColumn += 1) {
      let value = column === otherColumn ? controls.solverRegularization : 0;
      for (let row = 0; row < count; row += 1) {
        value += items[row].influence * basis[row][column] * basis[row][otherColumn];
      }
      normalMatrix[column][otherColumn] = value;
    }

    for (let row = 0; row < count; row += 1) {
      const displacement = subtract(items[row].position, items[row].anchor);
      const weightedBasis = items[row].influence * basis[row][column];
      rightX[column] += weightedBasis * displacement.x;
      rightY[column] += weightedBasis * displacement.y;
    }
  }

  const coefficientX = solveLinearSystem(normalMatrix, rightX);
  const coefficientY = solveLinearSystem(normalMatrix, rightY);
  let pulls = items.map((item, index) => ({
    anchor: item.anchor,
    coefficient: {
      x: coefficientX[index] * item.influence,
      y: coefficientY[index] * item.influence,
    },
  }));
  const totalInfluence = items.reduce((total, item) => total + item.influence, 0);
  const computeSurfaceShrink = (currentPulls: Pull[]): number => {
    const radialStrainSum = currentPulls.reduce((total, pull) => {
      const restLength = Math.max(length(pull.anchor), 0.08);
      const axis = scale(pull.anchor, 1 / restLength);
      const axialDelta = Math.max(
        pull.coefficient.x * axis.x + pull.coefficient.y * axis.y,
        0,
      );
      return total + axialDelta / restLength;
    }, 0);
    const averageRadialStrain = radialStrainSum / Math.max(totalInfluence, 0.001);
    return Math.min(
      averageRadialStrain * controls.surfaceTension,
      controls.maximumSurfaceShrink,
    );
  };

  for (let iteration = 0; iteration < 2; iteration += 1) {
    const provisionalState = { pulls, surfaceShrink: computeSurfaceShrink(pulls) };
    pulls = pulls.map((pull, index) => {
      const error = subtract(
        items[index].position,
        forwardDeform(pull.anchor, provisionalState),
      );
      return {
        ...pull,
        coefficient: add(
          pull.coefficient,
          scale(error, 0.85 * items[index].influence),
        ),
      };
    });
  }

  return {
    pulls,
    surfaceShrink: computeSurfaceShrink(pulls),
  };
}

function pullAt(restPosition: Vec2, state: ShapeState): Vec2 {
  let displacement = { x: 0, y: 0 };
  for (const pull of state.pulls) {
    displacement = add(
      displacement,
      scale(pull.coefficient, capsuleWeight(restPosition, pull.anchor)),
    );
  }
  return displacement;
}

function contractionAt(restPosition: Vec2, state: ShapeState): Vec2 {
  if (!controls.contractionEnabled) return { x: 0, y: 0 };
  let displacement = { x: 0, y: 0 };
  let weightSum = 0;

  for (const pull of state.pulls) {
    const restLength = length(pull.anchor);
    if (restLength < 0.08) continue;
    const restAxis = scale(pull.anchor, 1 / restLength);
    const axialDelta = Math.max(
      pull.coefficient.x * restAxis.x + pull.coefficient.y * restAxis.y,
      0,
    );
    if (axialDelta <= 0.0001) continue;

    const restPerpendicular = { x: -restAxis.y, y: restAxis.x };
    const currentAxisVector = add(pull.anchor, pull.coefficient);
    const currentAxisLength = Math.max(length(currentAxisVector), 0.0001);
    const currentAxis = scale(currentAxisVector, 1 / currentAxisLength);
    const currentPerpendicular = { x: -currentAxis.y, y: currentAxis.x };
    const along = (
      restPosition.x * restAxis.x + restPosition.y * restAxis.y
    ) / restLength;
    const transverse = (
      restPosition.x * restPerpendicular.x + restPosition.y * restPerpendicular.y
    );
    const start = Math.max(controls.contractionStart, 0);
    const end = Math.max(controls.contractionEnd, start + 0.1);
    const segmentWindow = smoothstep(start, start + 0.28, along)
      * (1 - smoothstep(end - 0.38, end, along));
    const lateralWeight = wendland(
      Math.abs(transverse) / Math.max(controls.contractionWidth, 0.05),
    );
    const stretch = 1 + axialDelta / restLength;
    const contraction = clamp(
      (1 - Math.pow(stretch, -controls.poissonExponent)) * controls.contractionStrength,
      0,
      1 - controls.minimumWidth,
    );
    const weight = segmentWindow * lateralWeight;
    displacement = add(
      displacement,
      scale(currentPerpendicular, -transverse * contraction * weight),
    );
    weightSum += weight;
  }

  return scale(displacement, 1 / smoothMaximumOne(weightSum));
}

function localDeformation(restPosition: Vec2, state: ShapeState): Vec2 {
  const radius = length(restPosition);
  const surfaceWeight = smoothstep(controls.surfaceStart, 1, radius);
  const surfaceTension = scale(restPosition, -state.surfaceShrink * surfaceWeight);
  return add(
    add(pullAt(restPosition, state), contractionAt(restPosition, state)),
    surfaceTension,
  );
}

function inverseDeform(position: Vec2, state: ShapeState): Vec2 {
  let restPosition = { ...position };
  const timeStep = 1 / 16;

  for (let iteration = 0; iteration < 16; iteration += 1) {
    restPosition = subtract(
      restPosition,
      scale(localDeformation(restPosition, state), timeStep),
    );
  }

  return restPosition;
}

function forwardDeform(restPosition: Vec2, state: ShapeState): Vec2 {
  let screenPosition = { ...restPosition };
  const timeStep = 1 / 16;
  for (let iteration = 0; iteration < 16; iteration += 1) {
    screenPosition = add(
      screenPosition,
      scale(localDeformation(screenPosition, state), timeStep),
    );
  }
  return screenPosition;
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
    releaseAge: null,
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
    item.releaseAge = 0;
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
    first.releaseAge = 0;
    first.persistent = false;
    first.target = { ...first.anchor };
    first.velocity = { x: 0, y: 0 };
  }

  if (demoTime >= 1.18 && !demoAddedContact) {
    addDemoContact(-2, { x: -0.48, y: -0.08 });
    demoAddedContact = true;
  }

  const second = deformers.get(-2);
  if (second?.active) {
    const progress = clamp((demoTime - 1.18) / 0.9, 0, 1);
    const easedProgress = progress * progress * (3 - 2 * progress);
    second.target = add(second.anchor, scale({ x: -0.46, y: -0.28 }, easedProgress));
    second.position = { ...second.target };
    if (demoTime >= 2.48) releaseDemoContacts();
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
  const contactsToRemove: number[] = [];

  for (const [id, item] of deformers) {
    if (item.active) {
      item.influence = Math.min(1, item.influence + blendStep);
      item.position = { ...item.target };
      continue;
    }

    item.releaseAge = (item.releaseAge ?? 0) + delta;
    const displacement = subtract(item.position, item.anchor);
    item.velocity.x += (-stiffness * displacement.x - damping * item.velocity.x) * delta;
    item.velocity.y += (-stiffness * displacement.y - damping * item.velocity.y) * delta;
    item.position.x += item.velocity.x * delta;
    item.position.y += item.velocity.y * delta;

    if (item.releaseAge > controls.releaseHoldDuration) {
      const fadeDuration = Math.max(
        controls.releaseLifetime - controls.releaseHoldDuration,
        0.001,
      );
      const fadeProgress = clamp(
        (item.releaseAge - controls.releaseHoldDuration) / fadeDuration,
        0,
        1,
      );
      const easedFade = fadeProgress * fadeProgress * (3 - 2 * fadeProgress);
      item.influence = Math.min(item.influence, 1 - easedFade);
    }

    if (item.releaseAge >= controls.releaseLifetime) contactsToRemove.push(id);
  }

  for (const id of contactsToRemove) deformers.delete(id);
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
  const pulls = shapeState.pulls.slice(0, maxDeformers);

  gl.useProgram(program);
  gl.uniform2f(uniform.resolution, canvas.width, canvas.height);
  gl.uniform2f(uniform.center, view.centerX * view.dpr, view.centerY * view.dpr);
  gl.uniform1f(uniform.radius, view.radius * view.dpr);
  gl.uniform1i(uniform.pullCount, pulls.length);
  gl.uniform2fv(uniform.anchors, packVectors(pulls.map((pull) => pull.anchor)));
  gl.uniform2fv(
    uniform.pullCoefficients,
    packVectors(pulls.map((pull) => pull.coefficient)),
  );
  gl.uniform1i(uniform.handleCount, items.length);
  gl.uniform2fv(uniform.handles, packVectors(items.map((item) => item.position)));
  gl.uniform1f(uniform.pullWidth, controls.pullWidth);
  gl.uniform1f(uniform.gripRadius, controls.gripRadius);
  gl.uniform1f(uniform.coreBlend, controls.coreBlend);
  gl.uniform1f(uniform.tailStart, controls.tailStart);
  gl.uniform1f(uniform.tailEnd, controls.tailEnd);
  gl.uniform1f(uniform.surfaceShrink, shapeState.surfaceShrink);
  gl.uniform1f(uniform.surfaceStart, controls.surfaceStart);
  gl.uniform1i(uniform.contractionEnabled, controls.contractionEnabled ? 1 : 0);
  gl.uniform1f(uniform.poissonExponent, controls.poissonExponent);
  gl.uniform1f(uniform.contractionStrength, controls.contractionStrength);
  gl.uniform1f(uniform.contractionWidth, controls.contractionWidth);
  gl.uniform1f(uniform.contractionStart, controls.contractionStart);
  gl.uniform1f(uniform.contractionEnd, controls.contractionEnd);
  gl.uniform1f(uniform.minimumWidth, controls.minimumWidth);
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
  debugStats.maxContactError = items.reduce((maximum, item) => Math.max(
    maximum,
    length(subtract(forwardDeform(item.anchor, shapeState), item.position)),
  ), 0);
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
    releaseAge: null,
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
    item.releaseAge = 0;
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
  gui.add(actions, 'demo3Point').name('3-point local pull');
  gui.add(actions, 'demoTransition').name('2 + add third');
  gui.add(actions, 'demoReleaseAll').name('regression: release all');
  gui.add(actions, 'demoSingleReentry').name('regression: re-entry');
  gui.add(actions, 'reset').name('reset');

  const shape = gui.addFolder('1 local pull');
  shape.add(controls, 'pullWidth', 0.15, 1.1, 0.01).name('capsule width');
  shape.add(controls, 'gripRadius', 0, 0.4, 0.01).name('grip radius');
  shape.add(controls, 'coreBlend', 0.1, 1.2, 0.01).name('center blend');
  shape.add(controls, 'tailStart', 1, 3.5, 0.01).name('tail start');
  shape.add(controls, 'tailEnd', 1.2, 5, 0.01).name('tail end');
  shape.add(controls, 'solverRegularization', 0.001, 0.08, 0.001).name('regularization');
  shape.add(controls, 'contactBlendDuration', 0, 0.5, 0.01).name('contact blend');
  shape.close();

  const contraction = gui.addFolder('2 local contraction');
  contraction.add(controls, 'contractionEnabled').name('on');
  contraction.add(controls, 'poissonExponent', 0, 1.2, 0.01).name('poisson exponent');
  contraction.add(controls, 'contractionStrength', 0, 1.5, 0.01).name('strength');
  contraction.add(controls, 'contractionWidth', 0.1, 1.2, 0.01).name('width');
  contraction.add(controls, 'contractionStart', 0, 0.8, 0.01).name('start');
  contraction.add(controls, 'contractionEnd', 0.8, 2.5, 0.01).name('end');
  contraction.add(controls, 'minimumWidth', 0.3, 1, 0.01).name('minimum width');
  contraction.add(controls, 'surfaceTension', 0, 0.3, 0.01).name('surface tension');
  contraction.add(controls, 'surfaceStart', 0.2, 0.9, 0.01).name('surface start');
  contraction.add(controls, 'maximumSurfaceShrink', 0, 0.3, 0.01).name('max surface shrink');
  contraction.close();

  const spring = gui.addFolder('3 release spring');
  spring.add(controls, 'springFrequency', 0.5, 8, 0.1).name('frequency');
  spring.add(controls, 'springDamping', 0.05, 1.2, 0.01).name('damping');
  spring.add(controls, 'releaseHoldDuration', 0, 0.4, 0.01).name('contact hold');
  spring.add(controls, 'releaseLifetime', 0.1, 0.8, 0.01).name('contact lifetime');
  spring.close();

  const material = gui.addFolder('4 material');
  material.addColor(controls, 'baseColor').name('base');
  material.addColor(controls, 'coolTint').name('cool tint');
  material.addColor(controls, 'warmTint').name('warm tint');
  material.addColor(controls, 'edgeColor').name('edge');
  material.add(controls, 'edgeWidth', 0.005, 0.12, 0.001).name('edge width');
  material.add(controls, 'shadowStrength', 0, 0.4, 0.01).name('shadow');
  material.close();

  const debug = gui.addFolder('5 debug');
  debug.add(controls, 'showContacts').name('contacts');
  debug.add(controls, 'normalDebug').name('field normal');
  debug.add(debugStats, 'activeContacts').name('active').listen().disable();
  debug.add(debugStats, 'returningContacts').name('returning').listen().disable();
  debug.add(debugStats, 'solverContacts').name('solver contacts').listen().disable();
  debug.add(debugStats, 'maxContactError').name('max contact error').listen().disable();
  debug.add(debugStats, 'solver').name('solver').listen().disable();
  debug.close();
  gui.close();
}

resize();
setupGui();
requestAnimationFrame(animate);
