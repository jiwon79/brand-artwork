import GUI from 'lil-gui';

type Vec2 = {
  x: number;
  y: number;
};

type Contact = {
  id: number;
  anchor: Vec2;
  position: Vec2;
  target: Vec2;
  velocity: Vec2;
  influence: number;
  releaseAge: number | null;
  releaseOffset: Vec2;
  releaseAngle: number;
  active: boolean;
  persistent: boolean;
  demoPhase: number;
};

type View = {
  width: number;
  height: number;
  dpr: number;
  centerX: number;
  centerY: number;
  radius: number;
};

type AreaSolution = {
  offset: number;
  targetArea: number;
  actualArea: number;
  unconstrainedArea: number;
  minimumNeckLimited: boolean;
};

type ShapeMetrics = {
  effectiveSeedCount: number;
  seedRadius: number;
  bridgeRadius: number;
  contactRadii: number[];
};

type MembraneLink = {
  start: Vec2;
  end: Vec2;
  startRadius: number;
  endRadius: number;
  influence: number;
  fillTriangle: number;
};

type DemoMode =
  | 'none'
  | 'two'
  | 'three'
  | 'transition'
  | 'releaseAll'
  | 'singleReentry'
  | 'cornerRelease';

const maxContacts = 10;
const maxMembraneLinks = maxContacts * 2;
const areaSampleResolution = 76;
const baseArea = Math.PI;
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
        : requestedDemo === 'corner-release'
          ? 'cornerRelease'
          : requestedDemo === '3' || requestedDemo === '1'
            ? 'three'
            : 'none';

const controls = {
  seedRadiusScale: 0.74,
  bridgeRadiusRatio: 0.02,
  contactRadiusShrinkStart: 0.47,
  contactRadiusShrinkEnd: 3.6,
  contactRadiusMinScale: 0.58,
  contactFill: 1,
  edgeConcavity: 0.1,
  fieldSmoothness: 0.7,
  contactBlendDuration: 0.12,
  areaPreservation: 0.92,
  minimumNeckWidth: 0.18,
  pressureResponse: 22,
  releaseHoldDuration: 0.04,
  releaseLifetime: 0.26,
  springFrequency: 4.2,
  springDamping: 0.48,
  baseColor: '#d8eff0',
  coolTint: '#4fa7ad',
  warmTint: '#f1a39b',
  edgeColor: '#ffffff',
  shadowStrength: 0.18,
  edgeWidth: 0.035,
  showContacts: true,
  showSkeleton: false,
  normalDebug: false,
  demoMode: initialDemo,
};

const debugStats = {
  activeContacts: 0,
  returningContacts: 0,
  fieldSeeds: 1,
  effectiveSeeds: 1,
  seedRadius: 1,
  bridgeRadius: 0.54,
  membraneLinks: 0,
  areaRatio: 1,
  targetAreaRatio: 1,
  contourOffset: 0,
  minimumNeckLimited: false,
  solver: 'contact membrane SDF + area pressure',
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

#define MAX_CONTACTS 10
#define MAX_MEMBRANE_LINKS 20

uniform vec2 uResolution;
uniform vec2 uCenter;
uniform float uRadius;
uniform int uContactCount;
uniform vec2 uContacts[MAX_CONTACTS];
uniform float uInfluences[MAX_CONTACTS];
uniform float uContactRadii[MAX_CONTACTS];
uniform int uMembraneLinkCount;
uniform vec2 uMembraneStarts[MAX_MEMBRANE_LINKS];
uniform vec2 uMembraneEnds[MAX_MEMBRANE_LINKS];
uniform float uMembraneStartRadii[MAX_MEMBRANE_LINKS];
uniform float uMembraneEndRadii[MAX_MEMBRANE_LINKS];
uniform float uMembraneInfluences[MAX_MEMBRANE_LINKS];
uniform float uMembraneTriangles[MAX_MEMBRANE_LINKS];
uniform float uContactRadius;
uniform float uBridgeRadius;
uniform float uEdgeConcavity;
uniform float uFieldSmoothness;
uniform float uContourOffset;
uniform vec3 uBaseColor;
uniform vec3 uCoolTint;
uniform vec3 uWarmTint;
uniform vec3 uEdgeColor;
uniform float uShadowStrength;
uniform float uEdgeWidth;
uniform bool uShowContacts;
uniform bool uShowSkeleton;
uniform bool uNormalDebug;

out vec4 outputColor;

float smoothMinimum(float first, float second, float radius) {
  float safeRadius = max(radius, 0.0001);
  float blend = max(safeRadius - abs(first - second), 0.0) / safeRadius;
  return min(first, second) - blend * blend * safeRadius * 0.25;
}

float smoothMaximum(float first, float second, float radius) {
  return -smoothMinimum(-first, -second, radius);
}

float distanceToSegment(vec2 point, vec2 start, vec2 end) {
  vec2 segment = end - start;
  float denominator = max(dot(segment, segment), 0.0001);
  float progress = clamp(dot(point - start, segment) / denominator, 0.0, 1.0);
  return length(point - (start + segment * progress));
}

float signedDistanceToTriangle(vec2 point, vec2 first, vec2 second, vec2 third) {
  vec2 edge0 = second - first;
  vec2 edge1 = third - second;
  vec2 edge2 = first - third;
  vec2 value0 = point - first;
  vec2 value1 = point - second;
  vec2 value2 = point - third;
  vec2 nearest0 = value0 - edge0 * clamp(dot(value0, edge0) / max(dot(edge0, edge0), 0.0001), 0.0, 1.0);
  vec2 nearest1 = value1 - edge1 * clamp(dot(value1, edge1) / max(dot(edge1, edge1), 0.0001), 0.0, 1.0);
  vec2 nearest2 = value2 - edge2 * clamp(dot(value2, edge2) / max(dot(edge2, edge2), 0.0001), 0.0, 1.0);
  float orientation = sign(edge0.x * edge2.y - edge0.y * edge2.x);
  vec2 distanceAndSide = min(
    min(
      vec2(dot(nearest0, nearest0), orientation * (value0.x * edge0.y - value0.y * edge0.x)),
      vec2(dot(nearest1, nearest1), orientation * (value1.x * edge1.y - value1.y * edge1.x))
    ),
    vec2(dot(nearest2, nearest2), orientation * (value2.x * edge2.y - value2.y * edge2.x))
  );
  return -sqrt(distanceAndSide.x) * sign(distanceAndSide.y);
}

float signedDistanceToCurvedFanEdge(
  vec2 point,
  vec2 start,
  vec2 end,
  float startRadius,
  float endRadius
) {
  // The quartic bell is tangent to both contact circles and bows toward the center.
  vec2 segment = end - start;
  float segmentLength = max(length(segment), 0.0001);
  vec2 tangent = segment / segmentLength;
  vec2 inwardNormal = vec2(-tangent.y, tangent.x);
  float centerSide = dot(-start, inwardNormal) >= 0.0 ? 1.0 : -1.0;
  inwardNormal *= centerSide;

  float progress = clamp(dot(point - start, tangent) / segmentLength, 0.0, 1.0);
  float easedProgress = progress * progress * (3.0 - 2.0 * progress);
  float bell = 16.0 * progress * progress
    * (1.0 - progress) * (1.0 - progress);
  float centerDepth = max(dot(-start, inwardNormal), 0.0);
  float endpointRadius = mix(startRadius, endRadius, easedProgress);
  float bulge = (0.5 * (startRadius + endRadius) + centerDepth * uEdgeConcavity) * bell;
  float curveHeight = -endpointRadius + bulge;

  float radiusDerivative = (endRadius - startRadius)
    * 6.0 * progress * (1.0 - progress);
  float bellDerivative = 32.0 * progress * (1.0 - progress) * (1.0 - 2.0 * progress);
  float curveDerivative = -radiusDerivative
    + (0.5 * (startRadius + endRadius) + centerDepth * uEdgeConcavity)
      * bellDerivative;
  float slope = curveDerivative / segmentLength;
  float pointHeight = dot(point - start, inwardNormal);
  return (curveHeight - pointHeight) / sqrt(1.0 + slope * slope);
}

float contactField(vec2 position) {
  // The center keeps a fixed seed radius; dragged contacts shrink only with distance.
  float distanceToShape = length(position) - uContactRadius;

  for (int index = 0; index < MAX_CONTACTS; index += 1) {
    if (index >= uContactCount) break;
    float influence = smoothstep(0.0, 1.0, uInfluences[index]);
    vec2 contact = uContacts[index];
    float pointDistance = length(position - contact) - uContactRadii[index];
    float contactBridgeRadius = min(uBridgeRadius, uContactRadii[index] * 0.88);
    float bridgeDistance = distanceToSegment(position, vec2(0.0), contact)
      - contactBridgeRadius;
    float branchDistance = smoothMinimum(
      pointDistance,
      bridgeDistance,
      uFieldSmoothness * 0.72
    );
    float combinedDistance = smoothMinimum(
      distanceToShape,
      branchDistance,
      uFieldSmoothness
    );
    distanceToShape = mix(distanceToShape, combinedDistance, influence);
  }

  for (int index = 0; index < MAX_MEMBRANE_LINKS; index += 1) {
    if (index >= uMembraneLinkCount) break;
    vec2 start = uMembraneStarts[index];
    vec2 end = uMembraneEnds[index];
    float linkDistance = distanceToSegment(position, start, end) - uBridgeRadius;
    if (uMembraneTriangles[index] > 0.5) {
      float triangleDistance = signedDistanceToTriangle(position, vec2(0.0), start, end);
      float roundedTriangleDistance = triangleDistance - uBridgeRadius;
      float curvedEdgeDistance = signedDistanceToCurvedFanEdge(
        position,
        start,
        end,
        uMembraneStartRadii[index],
        uMembraneEndRadii[index]
      );
      linkDistance = smoothMaximum(
        roundedTriangleDistance,
        curvedEdgeDistance,
        uFieldSmoothness * 0.32
      );
    }
    float combinedDistance = smoothMinimum(
      distanceToShape,
      linkDistance,
      uFieldSmoothness
    );
    distanceToShape = mix(
      distanceToShape,
      combinedDistance,
      smoothstep(0.0, 1.0, uMembraneInfluences[index])
    );
  }

  return distanceToShape;
}

void main() {
  vec2 pixel = vec2(gl_FragCoord.x, uResolution.y - gl_FragCoord.y);
  vec2 position = (pixel - uCenter) / uRadius;
  float rawDistance = contactField(position);
  float distanceToShape = rawDistance - uContourOffset;
  float antialiasWidth = max(fwidth(distanceToShape) * 1.25, 0.0015);
  float shapeMask = 1.0 - smoothstep(-antialiasWidth, antialiasWidth, distanceToShape);

  float shadowDistance = contactField(position - vec2(0.0, 0.085)) - uContourOffset;
  float shadowMask = 1.0 - smoothstep(-0.015, 0.17, shadowDistance);
  vec3 color = vec3(0.973, 0.976, 0.969);
  color = mix(color, vec3(0.12, 0.25, 0.26), shadowMask * uShadowStrength * (1.0 - shapeMask));

  float diagonal = clamp((position.x + position.y + 1.8) / 3.6, 0.0, 1.0);
  float coolField = smoothstep(-1.2, 0.9, -position.x + position.y * 0.35);
  vec3 body = mix(uWarmTint, uCoolTint, coolField * 0.72);
  body = mix(body, uBaseColor, 0.34 + diagonal * 0.24);
  float softHighlight = exp(-4.6 * dot(position - vec2(-0.38, -0.42), position - vec2(-0.38, -0.42)));
  body += vec3(1.0) * softHighlight * 0.24;

  float innerRim = 1.0 - smoothstep(0.0, uEdgeWidth, abs(distanceToShape));
  body = mix(body, uEdgeColor, innerRim * 0.7);
  color = mix(color, body, shapeMask);

  vec2 gradientDerivative = vec2(dFdx(rawDistance), dFdy(rawDistance));
  vec2 gradient = length(gradientDerivative) > 0.0001
    ? normalize(gradientDerivative)
    : vec2(-0.55, -0.82);
  if (uNormalDebug && shapeMask > 0.0) {
    color = vec3(gradient * 0.5 + 0.5, 0.5);
  }

  if (uShowSkeleton) {
    for (int index = 0; index < MAX_CONTACTS; index += 1) {
      if (index >= uContactCount) break;
      float lineDistance = distanceToSegment(position, vec2(0.0), uContacts[index]);
      float lineMask = 1.0 - smoothstep(0.009, 0.015, lineDistance);
      color = mix(color, vec3(0.08, 0.14, 0.15), lineMask * uInfluences[index] * 0.56);
    }
    for (int index = 0; index < MAX_MEMBRANE_LINKS; index += 1) {
      if (index >= uMembraneLinkCount) break;
      float lineDistance = distanceToSegment(
        position,
        uMembraneStarts[index],
        uMembraneEnds[index]
      );
      float lineMask = 1.0 - smoothstep(0.011, 0.018, lineDistance);
      color = mix(
        color,
        vec3(0.83, 0.22, 0.27),
        lineMask * uMembraneInfluences[index] * 0.72
      );
    }
  }

  if (uShowContacts) {
    for (int index = 0; index < MAX_CONTACTS; index += 1) {
      if (index >= uContactCount) break;
      float handleDistance = length(position - uContacts[index]);
      float dotMask = 1.0 - smoothstep(0.014, 0.024, handleDistance);
      float ringMask = 1.0 - smoothstep(0.006, 0.014, abs(handleDistance - 0.065));
      color = mix(color, vec3(0.06, 0.22, 0.23), dotMask * 0.9);
      color = mix(color, vec3(1.0), ringMask * uInfluences[index] * 0.62);
    }

    float centerDistance = length(position);
    float centerDot = 1.0 - smoothstep(0.016, 0.026, centerDistance);
    float centerRing = 1.0 - smoothstep(0.006, 0.014, abs(centerDistance - 0.078));
    color = mix(color, vec3(0.03, 0.13, 0.14), centerDot * 0.94);
    color = mix(color, vec3(0.35, 0.95, 0.88), centerRing * 0.78);
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
    const message = gl.getProgramInfoLog(program) ?? 'Unknown program link error.';
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
  contactCount: gl.getUniformLocation(program, 'uContactCount'),
  contacts: gl.getUniformLocation(program, 'uContacts[0]'),
  influences: gl.getUniformLocation(program, 'uInfluences[0]'),
  contactRadii: gl.getUniformLocation(program, 'uContactRadii[0]'),
  membraneLinkCount: gl.getUniformLocation(program, 'uMembraneLinkCount'),
  membraneStarts: gl.getUniformLocation(program, 'uMembraneStarts[0]'),
  membraneEnds: gl.getUniformLocation(program, 'uMembraneEnds[0]'),
  membraneStartRadii: gl.getUniformLocation(program, 'uMembraneStartRadii[0]'),
  membraneEndRadii: gl.getUniformLocation(program, 'uMembraneEndRadii[0]'),
  membraneInfluences: gl.getUniformLocation(program, 'uMembraneInfluences[0]'),
  membraneTriangles: gl.getUniformLocation(program, 'uMembraneTriangles[0]'),
  contactRadius: gl.getUniformLocation(program, 'uContactRadius'),
  bridgeRadius: gl.getUniformLocation(program, 'uBridgeRadius'),
  edgeConcavity: gl.getUniformLocation(program, 'uEdgeConcavity'),
  fieldSmoothness: gl.getUniformLocation(program, 'uFieldSmoothness'),
  contourOffset: gl.getUniformLocation(program, 'uContourOffset'),
  baseColor: gl.getUniformLocation(program, 'uBaseColor'),
  coolTint: gl.getUniformLocation(program, 'uCoolTint'),
  warmTint: gl.getUniformLocation(program, 'uWarmTint'),
  edgeColor: gl.getUniformLocation(program, 'uEdgeColor'),
  shadowStrength: gl.getUniformLocation(program, 'uShadowStrength'),
  edgeWidth: gl.getUniformLocation(program, 'uEdgeWidth'),
  showContacts: gl.getUniformLocation(program, 'uShowContacts'),
  showSkeleton: gl.getUniformLocation(program, 'uShowSkeleton'),
  normalDebug: gl.getUniformLocation(program, 'uNormalDebug'),
};

const contacts = new Map<number, Contact>();
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let view: View;
let previousTime = performance.now();
let contourOffset = 0;
let latestAreaSolution: AreaSolution = {
  offset: 0,
  targetArea: baseArea,
  actualArea: baseArea,
  unconstrainedArea: baseArea,
  minimumNeckLimited: false,
};
let demoTime = 0;
let demoNeedsSetup = controls.demoMode !== 'none' && !prefersReducedMotion;
let demoReleased = false;
let demoAddedContact = false;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function add(first: Vec2, second: Vec2): Vec2 {
  return { x: first.x + second.x, y: first.y + second.y };
}

function subtract(first: Vec2, second: Vec2): Vec2 {
  return { x: first.x - second.x, y: first.y - second.y };
}

function scale(vector: Vec2, amount: number): Vec2 {
  return { x: vector.x * amount, y: vector.y * amount };
}

function length(vector: Vec2): number {
  return Math.hypot(vector.x, vector.y);
}

function dot(first: Vec2, second: Vec2): number {
  return first.x * second.x + first.y * second.y;
}

function smoothMinimum(first: number, second: number, radius: number): number {
  const safeRadius = Math.max(radius, 0.0001);
  const blend = Math.max(safeRadius - Math.abs(first - second), 0) / safeRadius;
  return Math.min(first, second) - blend * blend * safeRadius * 0.25;
}

function smoothMaximum(first: number, second: number, radius: number): number {
  return -smoothMinimum(-first, -second, radius);
}

function distanceToSegment(point: Vec2, start: Vec2, end: Vec2): number {
  const segment = subtract(end, start);
  const denominator = Math.max(segment.x * segment.x + segment.y * segment.y, 0.0001);
  const progress = clamp(
    ((point.x - start.x) * segment.x + (point.y - start.y) * segment.y) / denominator,
    0,
    1,
  );
  return length(subtract(point, add(start, scale(segment, progress))));
}

function cross(first: Vec2, second: Vec2): number {
  return first.x * second.y - first.y * second.x;
}

function signedDistanceToTriangle(
  point: Vec2,
  first: Vec2,
  second: Vec2,
  third: Vec2,
): number {
  const edges = [
    subtract(second, first),
    subtract(third, second),
    subtract(first, third),
  ];
  const values = [
    subtract(point, first),
    subtract(point, second),
    subtract(point, third),
  ];
  const orientation = Math.sign(cross(edges[0], edges[2])) || 1;
  let minimumDistanceSquared = Number.POSITIVE_INFINITY;
  let minimumSide = Number.POSITIVE_INFINITY;

  for (let index = 0; index < 3; index += 1) {
    const edge = edges[index];
    const value = values[index];
    const edgeLengthSquared = Math.max(edge.x * edge.x + edge.y * edge.y, 0.0001);
    const progress = clamp(
      (value.x * edge.x + value.y * edge.y) / edgeLengthSquared,
      0,
      1,
    );
    const nearest = subtract(value, scale(edge, progress));
    minimumDistanceSquared = Math.min(
      minimumDistanceSquared,
      nearest.x * nearest.x + nearest.y * nearest.y,
    );
    minimumSide = Math.min(minimumSide, orientation * cross(value, edge));
  }

  return -Math.sqrt(minimumDistanceSquared) * Math.sign(minimumSide);
}

function signedDistanceToCurvedFanEdge(
  point: Vec2,
  start: Vec2,
  end: Vec2,
  startRadius: number,
  endRadius: number,
): number {
  // The quartic bell is tangent to both contact circles and bows toward the center.
  const segment = subtract(end, start);
  const segmentLength = Math.max(length(segment), 0.0001);
  const tangent = scale(segment, 1 / segmentLength);
  let inwardNormal = { x: -tangent.y, y: tangent.x };
  if (dot(scale(start, -1), inwardNormal) < 0) {
    inwardNormal = scale(inwardNormal, -1);
  }

  const progress = clamp(dot(subtract(point, start), tangent) / segmentLength, 0, 1);
  const easedProgress = progress * progress * (3 - 2 * progress);
  const bell = 16 * progress * progress * (1 - progress) * (1 - progress);
  const centerDepth = Math.max(dot(scale(start, -1), inwardNormal), 0);
  const endpointRadius = startRadius
    + (endRadius - startRadius) * easedProgress;
  const bulgeAmplitude = 0.5 * (startRadius + endRadius)
    + centerDepth * controls.edgeConcavity;
  const curveHeight = -endpointRadius + bulgeAmplitude * bell;

  const radiusDerivative = (endRadius - startRadius)
    * 6 * progress * (1 - progress);
  const bellDerivative = 32 * progress * (1 - progress) * (1 - 2 * progress);
  const curveDerivative = -radiusDerivative + bulgeAmplitude * bellDerivative;
  const slope = curveDerivative / segmentLength;
  const pointHeight = dot(subtract(point, start), inwardNormal);
  return (curveHeight - pointHeight) / Math.sqrt(1 + slope * slope);
}

function smoothInfluence(influence: number): number {
  const value = clamp(influence, 0, 1);
  return value * value * (3 - 2 * value);
}

function contactSortAngle(item: Contact): number {
  return item.active || item.releaseAge === null
    ? Math.atan2(item.position.y, item.position.x)
    : item.releaseAngle;
}

function buildMembraneLinks(items: Contact[], metrics: ShapeMetrics): MembraneLink[] {
  if (items.length < 2 || controls.contactFill <= 0) return [];
  const ordered = [...items].sort((first, second) => (
    contactSortAngle(first) - contactSortAngle(second)
  ));
  const links = new Map<string, MembraneLink>();
  const radiusById = new Map(items.map((item, index) => (
    [item.id, metrics.contactRadii[index]]
  )));

  const addLink = (first: Contact, second: Contact, influence: number): void => {
    const weightedInfluence = clamp(influence * controls.contactFill, 0, 1);
    if (weightedInfluence <= 0.0001) return;
    const key = first.id < second.id
      ? `${first.id}:${second.id}`
      : `${second.id}:${first.id}`;
    const fillTriangle = Math.abs(cross(first.position, second.position)) > 0.015 ? 1 : 0;
    const previous = links.get(key);
    if (previous && previous.influence >= weightedInfluence) return;
    links.set(key, {
      start: first.position,
      end: second.position,
      startRadius: radiusById.get(first.id) ?? metrics.seedRadius,
      endRadius: radiusById.get(second.id) ?? metrics.seedRadius,
      influence: weightedInfluence,
      fillTriangle,
    });
  };

  if (ordered.length === 2) {
    addLink(
      ordered[0],
      ordered[1],
      Math.min(smoothInfluence(ordered[0].influence), smoothInfluence(ordered[1].influence)),
    );
    return [...links.values()];
  }

  for (let index = 0; index < ordered.length; index += 1) {
    const current = ordered[index];
    const next = ordered[(index + 1) % ordered.length];
    addLink(
      current,
      next,
      Math.min(smoothInfluence(current.influence), smoothInfluence(next.influence)),
    );
  }

  // Preserve the old neighboring edge while a newly inserted contact fades in or out.
  if (ordered.length > 3) {
    for (let index = 0; index < ordered.length; index += 1) {
      const current = ordered[index];
      const previous = ordered[(index - 1 + ordered.length) % ordered.length];
      const next = ordered[(index + 1) % ordered.length];
      addLink(
        previous,
        next,
        Math.min(smoothInfluence(previous.influence), smoothInfluence(next.influence))
          * (1 - smoothInfluence(current.influence)),
      );
    }
  }

  return [...links.values()].slice(0, maxMembraneLinks);
}

function computeShapeMetrics(items: Contact[]): ShapeMetrics {
  const effectiveSeedCount = 1 + items.reduce(
    (total, item) => total + smoothInfluence(item.influence),
    0,
  );
  const seedRadius = controls.seedRadiusScale;
  const shrinkRange = Math.max(
    controls.contactRadiusShrinkEnd - controls.contactRadiusShrinkStart,
    0.001,
  );
  const contactRadii = items.map((item) => {
    const progress = clamp(
      (length(item.position) - controls.contactRadiusShrinkStart) / shrinkRange,
      0,
      1,
    );
    const easedProgress = progress * progress * (3 - 2 * progress);
    const radiusScale = 1
      - (1 - controls.contactRadiusMinScale) * easedProgress;
    const releaseWobble = item.active || item.releaseAge === null
      ? 1
      : 1 + Math.sin(Math.PI * 2 * controls.springFrequency * item.releaseAge)
        * Math.exp(
          -Math.PI * 2 * controls.springFrequency
            * controls.springDamping * item.releaseAge,
        ) * 0.14;
    return seedRadius * radiusScale * releaseWobble;
  });
  return {
    effectiveSeedCount,
    seedRadius,
    bridgeRadius: seedRadius * controls.bridgeRadiusRatio,
    contactRadii,
  };
}

function rawShapeDistance(
  position: Vec2,
  items: Contact[],
  membraneLinks: MembraneLink[],
  metrics: ShapeMetrics,
): number {
  let distanceToShape = length(position) - metrics.seedRadius;

  for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
    const item = items[itemIndex];
    const influence = smoothInfluence(item.influence);
    const pointDistance = length(subtract(position, item.position))
      - metrics.contactRadii[itemIndex];
    const contactBridgeRadius = Math.min(
      metrics.bridgeRadius,
      metrics.contactRadii[itemIndex] * 0.88,
    );
    const bridgeDistance = distanceToSegment(
      position,
      { x: 0, y: 0 },
      item.position,
    ) - contactBridgeRadius;
    const branchDistance = smoothMinimum(
      pointDistance,
      bridgeDistance,
      controls.fieldSmoothness * 0.72,
    );
    const combinedDistance = smoothMinimum(
      distanceToShape,
      branchDistance,
      controls.fieldSmoothness,
    );
    distanceToShape += (combinedDistance - distanceToShape) * influence;
  }

  for (const link of membraneLinks) {
    let linkDistance = distanceToSegment(position, link.start, link.end)
      - metrics.bridgeRadius;
    if (link.fillTriangle > 0.5) {
      const triangleDistance = signedDistanceToTriangle(
        position,
        { x: 0, y: 0 },
        link.start,
        link.end,
      );
      const roundedTriangleDistance = triangleDistance - metrics.bridgeRadius;
      const curvedEdgeDistance = signedDistanceToCurvedFanEdge(
        position,
        link.start,
        link.end,
        link.startRadius,
        link.endRadius,
      );
      linkDistance = smoothMaximum(
        roundedTriangleDistance,
        curvedEdgeDistance,
        controls.fieldSmoothness * 0.32,
      );
    }
    const combinedDistance = smoothMinimum(
      distanceToShape,
      linkDistance,
      controls.fieldSmoothness,
    );
    distanceToShape += (combinedDistance - distanceToShape) * link.influence;
  }

  return distanceToShape;
}

function estimateArea(values: Float32Array, offset: number, cellArea: number): number {
  let insideSamples = 0;
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] <= offset) insideSamples += 1;
  }
  return insideSamples * cellArea;
}

function solveAreaPressure(
  items: Contact[],
  membraneLinks: MembraneLink[],
  metrics: ShapeMetrics,
): AreaSolution {
  const farthestContact = items.reduce(
    (maximum, item) => Math.max(maximum, length(item.position)),
    0,
  );
  const boundsRadius = Math.max(1.45, farthestContact + metrics.seedRadius + 0.42);
  const cellSize = (boundsRadius * 2) / areaSampleResolution;
  const cellArea = cellSize * cellSize;
  const values = new Float32Array(areaSampleResolution * areaSampleResolution);
  let valueIndex = 0;

  for (let row = 0; row < areaSampleResolution; row += 1) {
    const y = -boundsRadius + (row + 0.5) * cellSize;
    for (let column = 0; column < areaSampleResolution; column += 1) {
      const x = -boundsRadius + (column + 0.5) * cellSize;
      values[valueIndex] = rawShapeDistance({ x, y }, items, membraneLinks, metrics);
      valueIndex += 1;
    }
  }

  const unconstrainedArea = estimateArea(values, 0, cellArea);
  const expansion = Math.max(unconstrainedArea - baseArea, 0);
  const targetArea = baseArea + expansion * (1 - controls.areaPreservation);
  const minimumNeckRadius = controls.minimumNeckWidth * 0.5;
  const minimumOffset = Math.min(minimumNeckRadius - metrics.bridgeRadius, 0);
  let low = minimumOffset;
  let high = 0.12;
  const minimumArea = estimateArea(values, low, cellArea);
  let solvedOffset = low;
  let minimumNeckLimited = minimumArea > targetArea;

  if (!minimumNeckLimited) {
    for (let iteration = 0; iteration < 13; iteration += 1) {
      const midpoint = (low + high) * 0.5;
      const area = estimateArea(values, midpoint, cellArea);
      if (area < targetArea) {
        low = midpoint;
      } else {
        high = midpoint;
      }
    }
    solvedOffset = (low + high) * 0.5;
  }

  return {
    offset: solvedOffset,
    targetArea,
    actualArea: estimateArea(values, solvedOffset, cellArea),
    unconstrainedArea,
    minimumNeckLimited,
  };
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

function currentContacts(): Contact[] {
  return [...contacts.values()].slice(0, maxContacts);
}

function isInsideShape(position: Vec2): boolean {
  const items = currentContacts();
  const metrics = computeShapeMetrics(items);
  return rawShapeDistance(
    position,
    items,
    buildMembraneLinks(items, metrics),
    metrics,
  ) <= contourOffset + 0.06;
}

function stopDemo(): void {
  controls.demoMode = 'none';
  for (const id of [...contacts.keys()]) {
    if (id < 0) contacts.delete(id);
  }
  demoReleased = false;
  demoAddedContact = false;
}

function clearContacts(): void {
  contacts.clear();
  contourOffset = 0;
  demoReleased = false;
  demoAddedContact = false;
  demoNeedsSetup = controls.demoMode !== 'none' && !prefersReducedMotion;
}

function createDemoContact(
  id: number,
  anchor: Vec2,
  phase: number,
  influence = 1,
  position = anchor,
): void {
  contacts.set(id, {
    id,
    anchor,
    position: { ...position },
    target: { ...position },
    velocity: { x: 0, y: 0 },
    influence,
    releaseAge: null,
    releaseOffset: { x: 0, y: 0 },
    releaseAngle: Math.atan2(position.y, position.x),
    active: true,
    persistent: true,
    demoPhase: phase,
  });
}

function setupDemo(): void {
  contacts.clear();
  contourOffset = 0;
  demoTime = 0;
  demoReleased = false;
  demoAddedContact = false;

  if (
    controls.demoMode === 'two'
    || controls.demoMode === 'transition'
    || controls.demoMode === 'releaseAll'
  ) {
    createDemoContact(-1, { x: -0.52, y: 0 }, 0);
    createDemoContact(-2, { x: 0.52, y: 0 }, Math.PI);
  } else if (controls.demoMode === 'three') {
    createDemoContact(-1, { x: -0.48, y: -0.28 }, 0);
    createDemoContact(-2, { x: 0.48, y: -0.28 }, Math.PI * 0.67);
    createDemoContact(-3, { x: 0, y: 0.56 }, Math.PI * 1.34);
  } else if (controls.demoMode === 'singleReentry') {
    createDemoContact(-1, { x: 0.48, y: 0.02 }, 0);
  } else if (controls.demoMode === 'cornerRelease') {
    createDemoContact(
      -1,
      { x: -0.18, y: -0.14 },
      0,
      1,
      { x: -1.2, y: -0.82 },
    );
    createDemoContact(
      -2,
      { x: 0.05, y: -0.05 },
      0,
      1,
      { x: 1.18, y: -0.82 },
    );
    createDemoContact(
      -3,
      { x: 0.18, y: 0.14 },
      0,
      1,
      { x: 1.18, y: 0.82 },
    );
    createDemoContact(
      -4,
      { x: -0.18, y: 0.14 },
      0,
      1,
      { x: -1.2, y: 0.82 },
    );
  }

  demoNeedsSetup = false;
}

function beginContactRelease(item: Contact): void {
  if (!item.active) return;
  item.releaseOffset = subtract(item.position, item.anchor);
  item.releaseAngle = Math.atan2(item.position.y, item.position.x);
  item.active = false;
  item.releaseAge = 0;
  item.persistent = false;
  item.target = { ...item.anchor };
  item.velocity = { x: 0, y: 0 };
}

function releaseDemoContacts(): void {
  for (const item of contacts.values()) {
    beginContactRelease(item);
  }
  demoReleased = true;
}

function updateTransitionDemo(releaseAtEnd: boolean): void {
  if (demoReleased) return;

  for (const id of [-1, -2]) {
    const item = contacts.get(id);
    if (!item) continue;
    const direction = Math.sign(item.anchor.x);
    item.target = { x: item.anchor.x + direction * 0.62, y: item.anchor.y };
    item.position = { ...item.target };
  }

  const addTime = releaseAtEnd ? 1.2 : 1.5;
  if (demoTime >= addTime && !demoAddedContact) {
    createDemoContact(-3, { x: 0, y: 0.52 }, 0, 0);
    demoAddedContact = true;
  }

  const third = contacts.get(-3);
  if (third) {
    const progress = clamp((demoTime - addTime) / 1.05, 0, 1);
    const easedProgress = progress * progress * (3 - 2 * progress);
    third.target = {
      x: 0.06 * easedProgress,
      y: 0.52 + 0.72 * easedProgress,
    };
    third.position = { ...third.target };
  }

  if (releaseAtEnd && demoTime >= 2.75) releaseDemoContacts();
}

function updateSingleReentryDemo(): void {
  if (demoReleased) return;
  const first = contacts.get(-1);

  if (first?.active && demoTime < 1) {
    const progress = clamp(demoTime / 0.75, 0, 1);
    const easedProgress = progress * progress * (3 - 2 * progress);
    first.target = add(first.anchor, scale({ x: 0.62, y: 0.18 }, easedProgress));
    first.position = { ...first.target };
  } else if (first?.active) {
    beginContactRelease(first);
  }

  if (demoTime >= 1.18 && !demoAddedContact) {
    createDemoContact(-2, { x: -0.48, y: -0.08 }, 0, 0);
    demoAddedContact = true;
  }

  const second = contacts.get(-2);
  if (second?.active) {
    const progress = clamp((demoTime - 1.18) / 0.9, 0, 1);
    const easedProgress = progress * progress * (3 - 2 * progress);
    second.target = add(second.anchor, scale({ x: -0.56, y: -0.3 }, easedProgress));
    second.position = { ...second.target };
    if (demoTime >= 2.48) releaseDemoContacts();
  }
}

function updateCornerReleaseDemo(): void {
  if (demoReleased || demoTime < 1.5) return;
  const upperRight = contacts.get(-2);
  if (!upperRight) return;
  beginContactRelease(upperRight);
  demoReleased = true;
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
  if (controls.demoMode === 'cornerRelease') {
    updateCornerReleaseDemo();
    return;
  }

  for (const item of contacts.values()) {
    if (item.id >= 0) continue;
    const anchorLength = Math.max(length(item.anchor), 0.01);
    const radial = scale(item.anchor, 1 / anchorLength);
    const tangent = { x: -radial.y, y: radial.x };
    const threePointBase = item.id === -1 ? 0.62 : item.id === -2 ? 0.5 : 0.56;
    const outward = controls.demoMode === 'two'
      ? 0.48 + Math.sin(demoTime * 1.25) * 0.16
      : threePointBase + Math.sin(demoTime * 1.1 + item.demoPhase) * 0.09;
    const sway = controls.demoMode === 'two'
      ? Math.sin(demoTime * 0.65) * 0.08 * Math.sign(item.anchor.x)
      : Math.sin(demoTime * 0.72 + item.demoPhase * 1.4) * 0.08;
    item.target = add(item.anchor, add(scale(radial, outward), scale(tangent, sway)));
    item.position = { ...item.target };
  }
}

function updateContactDynamics(delta: number): void {
  const angularFrequency = Math.PI * 2 * controls.springFrequency;
  const blendStep = controls.contactBlendDuration <= 0
    ? 1
    : delta / controls.contactBlendDuration;
  const contactsToRemove: number[] = [];

  for (const [id, item] of contacts) {
    if (item.active) {
      item.influence = Math.min(1, item.influence + blendStep);
      item.position = { ...item.target };
      continue;
    }

    item.releaseAge = (item.releaseAge ?? 0) + delta;
    // Keep the returning contact on its release ray; elasticity lives in its radius.
    const returnScale = (1 + angularFrequency * item.releaseAge)
      * Math.exp(-angularFrequency * item.releaseAge);
    const returnVelocity = -angularFrequency * angularFrequency * item.releaseAge
      * Math.exp(-angularFrequency * item.releaseAge);
    item.position = add(item.anchor, scale(item.releaseOffset, returnScale));
    item.velocity = scale(item.releaseOffset, returnVelocity);

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

    const returnGate = smoothInfluence(clamp((returnScale - 0.04) / 0.31, 0, 1));
    item.influence = Math.min(item.influence, returnGate);

    if (
      item.releaseAge >= controls.releaseLifetime
      || (returnScale <= 0.02 && item.influence <= 0.01)
    ) {
      contactsToRemove.push(id);
    }
  }

  for (const id of contactsToRemove) contacts.delete(id);
}

function hexToRgb(color: string): [number, number, number] {
  const value = Number.parseInt(color.slice(1), 16);
  return [
    ((value >> 16) & 255) / 255,
    ((value >> 8) & 255) / 255,
    (value & 255) / 255,
  ];
}

function packVectors(items: Vec2[], capacity = maxContacts): Float32Array {
  const packed = new Float32Array(capacity * 2);
  for (let index = 0; index < Math.min(items.length, capacity); index += 1) {
    packed[index * 2] = items[index].x;
    packed[index * 2 + 1] = items[index].y;
  }
  return packed;
}

function packScalars(items: number[], capacity = maxContacts): Float32Array {
  const packed = new Float32Array(capacity);
  for (let index = 0; index < Math.min(items.length, capacity); index += 1) {
    packed[index] = items[index];
  }
  return packed;
}

function render(
  items: Contact[],
  membraneLinks: MembraneLink[],
  metrics: ShapeMetrics,
): void {
  gl.useProgram(program);
  gl.uniform2f(uniform.resolution, canvas.width, canvas.height);
  gl.uniform2f(uniform.center, view.centerX * view.dpr, view.centerY * view.dpr);
  gl.uniform1f(uniform.radius, view.radius * view.dpr);
  gl.uniform1i(uniform.contactCount, items.length);
  gl.uniform2fv(uniform.contacts, packVectors(items.map((item) => item.position)));
  gl.uniform1fv(uniform.influences, packScalars(items.map((item) => item.influence)));
  gl.uniform1fv(uniform.contactRadii, packScalars(metrics.contactRadii));
  gl.uniform1i(uniform.membraneLinkCount, membraneLinks.length);
  gl.uniform2fv(
    uniform.membraneStarts,
    packVectors(membraneLinks.map((link) => link.start), maxMembraneLinks),
  );
  gl.uniform2fv(
    uniform.membraneEnds,
    packVectors(membraneLinks.map((link) => link.end), maxMembraneLinks),
  );
  gl.uniform1fv(
    uniform.membraneStartRadii,
    packScalars(membraneLinks.map((link) => link.startRadius), maxMembraneLinks),
  );
  gl.uniform1fv(
    uniform.membraneEndRadii,
    packScalars(membraneLinks.map((link) => link.endRadius), maxMembraneLinks),
  );
  gl.uniform1fv(
    uniform.membraneInfluences,
    packScalars(membraneLinks.map((link) => link.influence), maxMembraneLinks),
  );
  gl.uniform1fv(
    uniform.membraneTriangles,
    packScalars(membraneLinks.map((link) => link.fillTriangle), maxMembraneLinks),
  );
  gl.uniform1f(uniform.contactRadius, metrics.seedRadius);
  gl.uniform1f(uniform.bridgeRadius, metrics.bridgeRadius);
  gl.uniform1f(uniform.edgeConcavity, controls.edgeConcavity);
  gl.uniform1f(uniform.fieldSmoothness, controls.fieldSmoothness);
  gl.uniform1f(uniform.contourOffset, contourOffset);
  gl.uniform3fv(uniform.baseColor, hexToRgb(controls.baseColor));
  gl.uniform3fv(uniform.coolTint, hexToRgb(controls.coolTint));
  gl.uniform3fv(uniform.warmTint, hexToRgb(controls.warmTint));
  gl.uniform3fv(uniform.edgeColor, hexToRgb(controls.edgeColor));
  gl.uniform1f(uniform.shadowStrength, controls.shadowStrength);
  gl.uniform1f(uniform.edgeWidth, controls.edgeWidth);
  gl.uniform1i(uniform.showContacts, controls.showContacts ? 1 : 0);
  gl.uniform1i(uniform.showSkeleton, controls.showSkeleton ? 1 : 0);
  gl.uniform1i(uniform.normalDebug, controls.normalDebug ? 1 : 0);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

function animate(time: number): void {
  const delta = Math.min((time - previousTime) / 1000, 1 / 20);
  previousTime = time;
  updateDemo(delta);
  updateContactDynamics(delta);
  const items = currentContacts();
  const metrics = computeShapeMetrics(items);
  const membraneLinks = buildMembraneLinks(items, metrics);
  latestAreaSolution = solveAreaPressure(items, membraneLinks, metrics);
  const pressureBlend = 1 - Math.exp(-controls.pressureResponse * delta);
  contourOffset += (latestAreaSolution.offset - contourOffset) * pressureBlend;

  debugStats.activeContacts = items.filter((item) => item.active).length;
  debugStats.returningContacts = items.filter((item) => !item.active).length;
  debugStats.fieldSeeds = items.length + 1;
  debugStats.effectiveSeeds = metrics.effectiveSeedCount;
  debugStats.seedRadius = metrics.seedRadius;
  debugStats.bridgeRadius = metrics.bridgeRadius;
  debugStats.membraneLinks = membraneLinks.length;
  debugStats.areaRatio = latestAreaSolution.actualArea / baseArea;
  debugStats.targetAreaRatio = latestAreaSolution.targetArea / baseArea;
  debugStats.contourOffset = contourOffset;
  debugStats.minimumNeckLimited = latestAreaSolution.minimumNeckLimited;
  render(items, membraneLinks, metrics);
  requestAnimationFrame(animate);
}

canvas.addEventListener('pointerdown', (event) => {
  if (controls.demoMode !== 'none') stopDemo();
  if (contacts.size >= maxContacts) return;
  const position = normalizedPointer(event);
  if (!isInsideShape(position)) return;
  const persistent = event.pointerType === 'mouse' && event.shiftKey;
  contacts.set(event.pointerId, {
    id: event.pointerId,
    anchor: { ...position },
    position: { ...position },
    target: { ...position },
    velocity: { x: 0, y: 0 },
    influence: 0,
    releaseAge: null,
    releaseOffset: { x: 0, y: 0 },
    releaseAngle: Math.atan2(position.y, position.x),
    active: true,
    persistent,
    demoPhase: 0,
  });
  canvas.setPointerCapture(event.pointerId);
  event.preventDefault();
});

canvas.addEventListener('pointermove', (event) => {
  const item = contacts.get(event.pointerId);
  if (!item || !item.active) return;
  const position = normalizedPointer(event);
  const movement = subtract(position, item.position);
  item.velocity = scale(movement, 60);
  item.target = position;
  item.position = { ...position };
  event.preventDefault();
});

function releasePointer(event: PointerEvent): void {
  const item = contacts.get(event.pointerId);
  if (item && !item.persistent) {
    beginContactRelease(item);
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
  clearContacts();
}

function setupGui(): void {
  const gui = new GUI({ title: 'Contact outline lab' });
  const actions = {
    demo2Point: () => startDemo('two'),
    demo3Point: () => startDemo('three'),
    demoTransition: () => startDemo('transition'),
    demoReleaseAll: () => startDemo('releaseAll'),
    demoSingleReentry: () => startDemo('singleReentry'),
    demoCornerRelease: () => startDemo('cornerRelease'),
    reset: () => {
      controls.demoMode = 'none';
      clearContacts();
    },
  };

  gui.add(actions, 'demo2Point').name('2-point pull');
  gui.add(actions, 'demo3Point').name('3-point pull');
  gui.add(actions, 'demoTransition').name('2 + add third');
  gui.add(actions, 'demoReleaseAll').name('regression: release all');
  gui.add(actions, 'demoSingleReentry').name('regression: re-entry');
  gui.add(actions, 'demoCornerRelease').name('regression: corner release');
  gui.add(actions, 'reset').name('reset');

  const field = gui.addFolder('1 contact field');
  field.add(controls, 'seedRadiusScale', 0.25, 3, 0.01).name('seed radius scale');
  field.add(controls, 'bridgeRadiusRatio', 0.02, 2, 0.01).name('bridge / seed');
  field.add(controls, 'contactRadiusShrinkStart', 0, 3, 0.01).name('radius shrink start');
  field.add(controls, 'contactRadiusShrinkEnd', 0.05, 6, 0.01).name('radius shrink end');
  field.add(controls, 'contactRadiusMinScale', 0.02, 1, 0.01).name('minimum radius');
  field.add(controls, 'contactFill', 0, 1, 0.01).name('contact fill');
  field.add(controls, 'edgeConcavity', -1, 2.5, 0.01).name('edge concavity');
  field.add(controls, 'fieldSmoothness', 0.001, 1.5, 0.001).name('smooth union');
  field.add(controls, 'contactBlendDuration', 0, 3, 0.01).name('contact blend');
  field.close();

  const pressure = gui.addFolder('2 area pressure');
  pressure.add(controls, 'areaPreservation', 0, 1, 0.01).name('area preservation');
  pressure.add(controls, 'minimumNeckWidth', 0.04, 0.5, 0.01).name('minimum neck');
  pressure.add(controls, 'pressureResponse', 1, 40, 0.5).name('response');
  pressure.close();

  const spring = gui.addFolder('3 release spring');
  spring.add(controls, 'springFrequency', 0.5, 10, 0.1).name('frequency');
  spring.add(controls, 'springDamping', 0.05, 1.2, 0.01).name('damping');
  spring.add(controls, 'releaseHoldDuration', 0, 0.25, 0.01).name('contact hold');
  spring.add(controls, 'releaseLifetime', 0.08, 0.6, 0.01).name('contact lifetime');
  spring.close();

  const material = gui.addFolder('4 flat material');
  material.addColor(controls, 'baseColor').name('base');
  material.addColor(controls, 'coolTint').name('cool tint');
  material.addColor(controls, 'warmTint').name('warm tint');
  material.addColor(controls, 'edgeColor').name('edge');
  material.add(controls, 'edgeWidth', 0.005, 0.12, 0.001).name('edge width');
  material.add(controls, 'shadowStrength', 0, 0.4, 0.01).name('shadow');
  material.close();

  const debug = gui.addFolder('5 debug');
  debug.add(controls, 'showContacts').name('contacts');
  debug.add(controls, 'showSkeleton').name('all bridges');
  debug.add(controls, 'normalDebug').name('field normal');
  debug.add(debugStats, 'activeContacts').name('active').listen().disable();
  debug.add(debugStats, 'returningContacts').name('returning').listen().disable();
  debug.add(debugStats, 'fieldSeeds').name('field seeds').listen().disable();
  debug.add(debugStats, 'effectiveSeeds').name('effective seeds').listen().decimals(2).disable();
  debug.add(debugStats, 'seedRadius').name('seed radius').listen().decimals(3).disable();
  debug.add(debugStats, 'bridgeRadius').name('bridge radius').listen().decimals(3).disable();
  debug.add(debugStats, 'membraneLinks').name('membrane links').listen().disable();
  debug.add(debugStats, 'areaRatio').name('area ratio').listen().decimals(3).disable();
  debug.add(debugStats, 'targetAreaRatio').name('target ratio').listen().decimals(3).disable();
  debug.add(debugStats, 'contourOffset').name('contour offset').listen().decimals(3).disable();
  debug.add(debugStats, 'minimumNeckLimited').name('neck limited').listen().disable();
  debug.add(debugStats, 'solver').name('solver').listen().disable();
  debug.close();
  gui.close();
}

resize();
setupGui();
requestAnimationFrame(animate);
