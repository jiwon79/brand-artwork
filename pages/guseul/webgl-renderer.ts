import {
  elasticSpecWarpExtent,
  elasticSpecWarpResolution,
  type ElasticShapeFrame,
} from './elastic-contact-field';

export const maxGpuCircles = 10;
export const maxGpuSpecs = 11;
export const maxGpuContacts = 10;
export const maxGpuMembraneLinks = 20;

export type GpuCircle = {
  centerX: number;
  centerY: number;
  radius: number;
  alpha: number;
};

export type GpuSpec = {
  sourceDirection: [number, number, number];
  axisX: [number, number, number];
  axisY: [number, number, number];
  halfWidth: number;
  halfHeight: number;
  softness: number;
  shape: 'rect' | 'circle';
  power: number;
  intensity: number;
  visibility: number;
};

export type GpuGlassControls = {
  background: [number, number, number];
  contentOverscan: number;
  sourceFollow: number;
  displacementEnabled: boolean;
  surfacePreviewEnabled: boolean;
  surfaceProfile: 'convex' | 'concave' | 'lip';
  bezelWidth: number;
  thickness: number;
  displacementFactor: number;
  edgeFadeWidth: number;
  ior: number;
  refractionEnabled: boolean;
  chromaticEnabled: boolean;
  dispersion: number;
  chromaticEdgeStrength: number;
  chromaticEdgeWidth: number;
  chromaticBoundaryStrength: number;
  chromaticBoundaryWidth: number;
  innerShadeEnabled: boolean;
  glassMilkEnabled: boolean;
  topWashEnabled: boolean;
  rimEnabled: boolean;
  hardRimEnabled: boolean;
  caRimEnabled: boolean;
  specDebugEnabled: boolean;
  specDebugColor: 'red' | 'black';
  specDebugOpacity: number;
  outerStrokeEnabled: boolean;
  showElasticContacts: boolean;
};

export type GpuGlassFrame = {
  contentCanvas: HTMLCanvasElement;
  viewportCss: [number, number];
  centerCss: [number, number];
  radiusCss: number;
  elasticShape: ElasticShapeFrame;
  controls: GpuGlassControls;
  circles: GpuCircle[];
  specs: GpuSpec[];
};

const vertexShaderSource = `#version 300 es
precision highp float;

out vec2 vUv;

void main() {
  vec2 positions[3] = vec2[3](
    vec2(-1.0, -1.0),
    vec2(3.0, -1.0),
    vec2(-1.0, 3.0)
  );
  vec2 position = positions[gl_VertexID];
  vUv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const fragmentShaderSource = `#version 300 es
precision highp float;
precision highp sampler2D;

#define MAX_CIRCLES 10
#define MAX_SPECS 11
#define MAX_CONTACTS 10
#define MAX_MEMBRANE_LINKS 20

in vec2 vUv;
out vec4 outputColor;

uniform sampler2D uContent;
uniform vec2 uViewportCss;
uniform vec2 uCenterCss;
uniform float uRadiusCss;
uniform vec3 uBackground;
uniform float uOverscan;
uniform float uSourceFollow;
uniform sampler2D uSpecWarpMap;
uniform float uSpecWarpExtent;
uniform int uContactCount;
uniform vec4 uContacts[MAX_CONTACTS];
uniform vec2 uContactAnchors[MAX_CONTACTS];
uniform int uMembraneLinkCount;
uniform vec4 uMembraneStarts[MAX_MEMBRANE_LINKS];
uniform vec4 uMembraneEnds[MAX_MEMBRANE_LINKS];
uniform float uContactRadius;
uniform float uBridgeRadius;
uniform float uMembraneBridgeRadius;
uniform float uEdgeConcavity;
uniform float uFieldSmoothness;
uniform float uContourOffset;
uniform int uDisplacementEnabled;
uniform int uSurfacePreviewEnabled;
uniform int uSurfaceProfile;
uniform float uBezelWidth;
uniform float uThickness;
uniform float uDisplacementFactor;
uniform float uEdgeFadeWidth;
uniform float uIor;
uniform int uRefractionEnabled;
uniform int uChromaticEnabled;
uniform float uDispersion;
uniform float uChromaticEdgeStrength;
uniform float uChromaticEdgeWidth;
uniform float uChromaticBoundaryStrength;
uniform float uChromaticBoundaryWidth;
uniform int uInnerShadeEnabled;
uniform int uGlassMilkEnabled;
uniform int uTopWashEnabled;
uniform int uRimEnabled;
uniform int uHardRimEnabled;
uniform int uCaRimEnabled;
uniform int uSpecDebugEnabled;
uniform vec3 uSpecDebugColor;
uniform float uSpecDebugOpacity;
uniform int uOuterStrokeEnabled;
uniform int uShowElasticContacts;
uniform int uCircleCount;
uniform vec4 uCircles[MAX_CIRCLES];
uniform int uSpecCount;
uniform vec4 uSpecSource[MAX_SPECS];
uniform vec4 uSpecAxisX[MAX_SPECS];
uniform vec4 uSpecAxisY[MAX_SPECS];
uniform vec4 uSpecShape[MAX_SPECS];
uniform vec4 uSpecRender[MAX_SPECS];

const float MAX_SURFACE_SLOPE = 11.4300523;
float smoothRange(float edge0, float edge1, float value) {
  float denominator = edge1 - edge0;
  if (abs(denominator) < 0.000001) {
    return value < edge0 ? 0.0 : 1.0;
  }
  float t = clamp((value - edge0) / denominator, 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

float smoother(float value) {
  float x = clamp(value, 0.0, 1.0);
  return x * x * x * (x * (x * 6.0 - 15.0) + 10.0);
}

vec2 convexProfile(float progress) {
  float u = 1.0 - clamp(progress, 0.0, 1.0);
  float inside = max(1.0 - pow(u, 4.0), 0.0001);
  float height = sqrt(inside);
  float derivative = (2.0 * pow(u, 3.0)) / sqrt(inside);
  return vec2(height, derivative);
}

vec2 surfaceProfile(float progress) {
  vec2 convex = convexProfile(progress);
  if (uSurfaceProfile == 0) {
    return convex;
  }

  vec2 concave = vec2(1.0 - convex.x, -convex.y);
  if (uSurfaceProfile == 1) {
    return concave;
  }

  float blend = smoother(progress);
  float x = clamp(progress, 0.0, 1.0);
  float blendDerivative = 30.0 * x * x * (x * (x - 2.0) + 1.0);
  float height = mix(convex.x, concave.x, blend);
  float derivative = mix(convex.y, concave.y, blend) + (concave.x - convex.x) * blendDerivative;
  return vec2(height, derivative);
}

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
  vec2 segment = end - start;
  float segmentLength = max(length(segment), 0.0001);
  vec2 tangent = segment / segmentLength;
  vec2 inwardNormal = vec2(-tangent.y, tangent.x);
  float centerSide = dot(-start, inwardNormal) >= 0.0 ? 1.0 : -1.0;
  inwardNormal *= centerSide;
  float progress = clamp(dot(point - start, tangent) / segmentLength, 0.0, 1.0);
  float easedProgress = progress * progress * (3.0 - 2.0 * progress);
  float bell = 16.0 * progress * progress * (1.0 - progress) * (1.0 - progress);
  float centerDepth = max(dot(-start, inwardNormal), 0.0);
  float endpointRadius = mix(startRadius, endRadius, easedProgress);
  float bulge = (0.5 * (startRadius + endRadius) + centerDepth * uEdgeConcavity) * bell;
  float curveHeight = -endpointRadius + bulge;
  float radiusDerivative = (endRadius - startRadius) * 6.0 * progress * (1.0 - progress);
  float bellDerivative = 32.0 * progress * (1.0 - progress) * (1.0 - 2.0 * progress);
  float curveDerivative = -radiusDerivative
    + (0.5 * (startRadius + endRadius) + centerDepth * uEdgeConcavity) * bellDerivative;
  float slope = curveDerivative / segmentLength;
  float pointHeight = dot(point - start, inwardNormal);
  return (curveHeight - pointHeight) / sqrt(1.0 + slope * slope);
}

float contactField(vec2 position) {
  float distanceToShape = length(position) - uContactRadius;

  for (int index = 0; index < MAX_CONTACTS; index += 1) {
    if (index >= uContactCount) break;
    vec4 contact = uContacts[index];
    float influence = smoothRange(0.0, 1.0, contact.w);
    float pointDistance = length(position - contact.xy) - contact.z;
    float contactBridgeRadius = min(uBridgeRadius, contact.z * 0.88);
    float bridgeDistance = distanceToSegment(position, vec2(0.0), contact.xy)
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
    vec4 startData = uMembraneStarts[index];
    vec4 endData = uMembraneEnds[index];
    float linkDistance = distanceToSegment(position, startData.xy, endData.xy)
      - uMembraneBridgeRadius;
    if (endData.w > 0.5) {
      float triangleDistance = signedDistanceToTriangle(
        position,
        vec2(0.0),
        startData.xy,
        endData.xy
      );
      float curvedEdgeDistance = signedDistanceToCurvedFanEdge(
        position,
        startData.xy,
        endData.xy,
        startData.z,
        endData.z
      );
      linkDistance = smoothMaximum(
        triangleDistance - uMembraneBridgeRadius,
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
      smoothRange(0.0, 1.0, startData.w)
    );
  }

  return distanceToShape;
}

vec3 surfaceSample(float inwardDistance, vec2 edgeNormal) {
  if (uDisplacementEnabled == 0) {
    return vec3(0.0);
  }

  float bezelWidth = max(uBezelWidth, 0.001);
  float progress = clamp(inwardDistance / bezelWidth, 0.0, 1.0);
  vec2 profile = surfaceProfile(progress);
  float derivative = clamp(profile.y, -MAX_SURFACE_SLOPE, MAX_SURFACE_SLOPE);
  float flatHeight = surfaceProfile(1.0).x;
  float bevelHeight = (inwardDistance > bezelWidth ? flatHeight : profile.x) * bezelWidth;
  float height = (uThickness + bevelHeight) * uDisplacementFactor;

  return vec3(edgeNormal * derivative, height);
}

float rimInfluence(float inwardDistance) {
  return 1.0 - smoothRange(0.0, max(uBezelWidth, 0.001), inwardDistance);
}

float displacementEdgeFade(float inwardDistance) {
  if (uEdgeFadeWidth <= 0.0001) {
    return 1.0;
  }
  return smoothRange(0.0, uEdgeFadeWidth, inwardDistance);
}

vec3 refractCameraRay(vec2 slope, float ior) {
  vec3 normal = normalize(vec3(slope, 1.0));
  float eta = 1.0 / max(ior, 1.0001);
  float dotNI = -normal.z;
  float k = 1.0 - eta * eta * (1.0 - dotNI * dotNI);
  if (k < 0.0) {
    return vec3(0.0, 0.0, -1.0);
  }
  float factor = eta * dotNI + sqrt(k);
  return vec3(-factor * normal.xy, -eta - factor * normal.z);
}

vec2 rayDisplacement(vec3 ray, float height) {
  return ray.xy / max(-ray.z, 0.0001) * height;
}

vec2 contentUv(vec2 sourcePoint) {
  float denominator = 2.0 * (1.0 + uOverscan * 2.0);
  return (vec2(1.0 + uOverscan) + sourcePoint) / denominator;
}

vec4 sampleContent(vec2 sourcePoint) {
  vec2 uv = contentUv(sourcePoint);
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) {
    return vec4(uBackground, 1.0);
  }
  return texture(uContent, uv);
}

vec2 elasticDisplacement(vec2 point) {
  vec2 displacement = vec2(0.0);
  float weightSum = 0.0;

  for (int index = 0; index < MAX_CONTACTS; index += 1) {
    if (index >= uContactCount) break;
    vec4 contact = uContacts[index];
    float influence = smoothRange(0.0, 1.0, contact.w);
    float reach = max(contact.z * 1.8, uContactRadius * 0.72);
    float distanceToContact = length(point - contact.xy);
    float weight = (1.0 - smoothRange(contact.z * 0.08, reach, distanceToContact))
      * influence;
    displacement += (contact.xy - uContactAnchors[index]) * weight;
    weightSum += weight;
  }

  if (weightSum > 0.0001) {
    displacement /= max(weightSum, 1.0);
  }

  return displacement;
}

vec2 inverseElasticPoint(vec2 point, float follow) {
  return point - elasticDisplacement(point) * clamp(follow, 0.0, 1.0);
}

vec2 transformSourcePoint(vec2 point) {
  return inverseElasticPoint(point, uSourceFollow);
}

vec2 inverseSpecWarp(vec2 point) {
  vec2 uv = point / (uSpecWarpExtent * 2.0) + 0.5;
  vec2 canonicalPoint = texture(uSpecWarpMap, clamp(uv, 0.0, 1.0)).rg;
  float canonicalRadius = length(canonicalPoint);
  if (canonicalRadius > 0.999) canonicalPoint *= 0.999 / canonicalRadius;
  return canonicalPoint;
}

struct SourceEdge {
  float edge;
  float alpha;
  float signedDistance;
  vec2 normal;
  vec3 color;
};

SourceEdge sampleSourceEdge(vec2 sourcePoint) {
  SourceEdge result;
  result.edge = 0.0;
  result.alpha = 0.0;
  result.signedDistance = 0.0;
  result.normal = vec2(0.0);
  result.color = uBackground;
  float width = max(uChromaticBoundaryWidth / uRadiusCss, 0.000001);

  for (int step = 0; step < MAX_CIRCLES; step += 1) {
    int index = MAX_CIRCLES - 1 - step;
    if (index >= uCircleCount) {
      continue;
    }

    vec4 circle = uCircles[index];
    vec2 delta = sourcePoint - circle.xy;
    float distanceToCenter = length(delta);
    float signedDistance = distanceToCenter - circle.z;
    float edgeDistance = abs(signedDistance);
    float edge = (1.0 - smoothRange(width * 0.2, width, edgeDistance)) * circle.w;
    float fill = smoothRange(circle.z + width, circle.z - width, distanceToCenter) * circle.w;

    if (edge <= 0.001 && fill <= 0.04) {
      continue;
    }

    vec2 normal = distanceToCenter > 0.000001 ? delta / distanceToCenter : vec2(0.0);
    result.edge = edge;
    result.alpha = circle.w;
    result.signedDistance = signedDistance;
    result.normal = normal;
    result.color = sampleContent(sourcePoint - normal * width).rgb;
    break;
  }

  return result;
}

float colorDistance(vec3 a, vec3 b) {
  return length(a - b) / sqrt(3.0);
}

float coverageFromSignedDistance(float signedDistance, float feather) {
  return smoothRange(feather, -feather, signedDistance);
}

vec3 sampleLiquidGlass(
  vec2 point,
  float radial,
  float inwardDistance,
  vec3 surface,
  float rim
) {
  if (uRefractionEnabled == 0) {
    return sampleContent(transformSourcePoint(point)).rgb;
  }

  float height = surface.z * displacementEdgeFade(inwardDistance);
  vec2 baseOffset = rayDisplacement(refractCameraRay(surface.xy, uIor), height);
  vec2 redOffset = baseOffset;
  vec2 blueOffset = baseOffset;

  if (uChromaticEnabled == 1) {
    redOffset = rayDisplacement(refractCameraRay(surface.xy, uIor + uDispersion), height);
    blueOffset = rayDisplacement(refractCameraRay(surface.xy, max(uIor - uDispersion, 1.0001)), height);
  }

  vec2 redPoint = transformSourcePoint(point + redOffset);
  vec2 basePoint = transformSourcePoint(point + baseOffset);
  vec2 bluePoint = transformSourcePoint(point + blueOffset);
  vec3 red = sampleContent(redPoint).rgb;
  vec3 base = sampleContent(basePoint).rgb;
  vec3 blue = sampleContent(bluePoint).rgb;
  vec3 sampleColor = base;

  if (uChromaticEnabled == 1) {
    vec2 separationVector = bluePoint - redPoint;
    float separationPixels = length(separationVector) * uRadiusCss;
    SourceEdge sourceEdge = sampleSourceEdge(basePoint);
    float sourceEdgeGate = sourceEdge.edge * uChromaticBoundaryStrength
      * smoothRange(0.42, 0.98, radial) * (0.48 + rim * 0.52);
    float dispersionMix = clamp(uDispersion * (rim * 1.2 + sourceEdgeGate * 0.85), 0.0, 0.54);
    sampleColor = mix(sampleColor, vec3(red.r, base.g, blue.b), dispersionMix);

    float sourceContrast = max(colorDistance(red, base), colorDistance(blue, base));
    float refractedEdgeGate = smoothRange(0.04, 0.24, sourceContrast)
      * smoothRange(0.25, 2.6, separationPixels)
      * smoothRange(0.56, 1.0, radial) * rim;
    float edgeGate = max(refractedEdgeGate, sourceEdgeGate);

    if (edgeGate > 0.001 && uChromaticEdgeStrength > 0.0) {
      float separationLength = length(separationVector);
      vec2 refractDirection = separationLength > 0.000001
        ? separationVector / separationLength
        : sourceEdge.normal;
      float directionMix = clamp(sourceEdgeGate / (sourceEdgeGate + refractedEdgeGate + 0.001), 0.0, 1.0);
      vec2 mixedDirection = mix(refractDirection, sourceEdge.normal, directionMix * 0.9);
      vec2 direction = length(mixedDirection) > 0.000001 ? normalize(mixedDirection) : refractDirection;
      float strength = uChromaticEdgeStrength * edgeGate;
      float boost = 1.0 + strength * 1.8;
      float spread = (uChromaticEdgeWidth / uRadiusCss) * (0.32 + strength);
      vec3 redWide = sampleContent(basePoint + (redPoint - basePoint) * boost - direction * spread * 0.35).rgb;
      vec3 blueWide = sampleContent(basePoint + (bluePoint - basePoint) * boost + direction * spread * 0.35).rgb;
      vec3 refractedSplit = vec3(redWide.r, sampleColor.g, blueWide.b);
      sampleColor = mix(sampleColor, refractedSplit, clamp(strength * 0.28, 0.0, 0.46));

      float channelFeather = clamp(uChromaticBoundaryWidth * 0.22, 0.75, 2.4) / uRadiusCss;
      float sourceShift = (uChromaticEdgeWidth / uRadiusCss) * clamp(0.35 + sourceEdgeGate * 0.9, 0.0, 1.8);
      float redCoverage = coverageFromSignedDistance(sourceEdge.signedDistance - sourceShift, channelFeather) * sourceEdge.alpha;
      float greenCoverage = coverageFromSignedDistance(sourceEdge.signedDistance, channelFeather) * sourceEdge.alpha;
      float blueCoverage = coverageFromSignedDistance(sourceEdge.signedDistance + sourceShift, channelFeather) * sourceEdge.alpha;
      vec3 sourceSplit = vec3(
        mix(uBackground.r, sourceEdge.color.r, redCoverage),
        mix(uBackground.g, sourceEdge.color.g, greenCoverage),
        mix(uBackground.b, sourceEdge.color.b, blueCoverage)
      );
      sampleColor = mix(sampleColor, sourceSplit, clamp(sourceEdgeGate * 0.72, 0.0, 0.86));
    }
  }

  return sampleColor;
}

vec2 sampleSpecs(vec3 reflection) {
  float shell = 0.0;
  float debugMask = 0.0;

  for (int index = 0; index < MAX_SPECS; index += 1) {
    if (index >= uSpecCount) {
      break;
    }

    vec4 shape = uSpecShape[index];
    vec4 render = uSpecRender[index];
    float dx = abs(dot(reflection, uSpecAxisX[index].xyz) / shape.x);
    float dy = abs(dot(reflection, uSpecAxisY[index].xyz) / shape.y);
    float distanceToSpec = shape.w > 0.5 ? length(vec2(dx, dy)) : max(dx, dy);
    float box = 1.0 - smoothRange(1.0 - shape.z, 1.0 + shape.z, distanceToSpec);
    float sourceFacing = smoothRange(-0.04, 0.24, dot(reflection, uSpecSource[index].xyz));
    float value = pow(max(box, 0.0), render.x) * sourceFacing * render.z;
    shell += value * render.y;
    debugMask = max(debugMask, value);
  }

  return vec2(shell, debugMask);
}

void main() {
  vec2 pixelCss = vec2(vUv.x * uViewportCss.x, (1.0 - vUv.y) * uViewportCss.y);
  vec2 point = (pixelCss - uCenterCss) / uRadiusCss;
  float rawDistance = contactField(point);
  float shapeDistance = rawDistance - uContourOffset;
  float antialiasWidth = max(fwidth(shapeDistance) * 1.25, 0.0015);
  float shapeMask = 1.0 - smoothRange(-antialiasWidth, antialiasWidth, shapeDistance);

  if (shapeMask <= 0.0001) {
    outputColor = vec4(0.0);
    return;
  }

  vec2 derivative = vec2(dFdx(rawDistance), -dFdy(rawDistance));
  vec2 fallbackNormal = length(point) > 0.0001 ? normalize(point) : vec2(-0.55, -0.82);
  vec2 edgeNormal = length(derivative) > 0.000001 ? normalize(derivative) : fallbackNormal;
  float inwardDistance = max(-shapeDistance, 0.0);
  float radial = 1.0 - clamp(inwardDistance, 0.0, 1.0);
  float nz = sqrt(max(1.0 - radial * radial, 0.0));
  vec3 surface = surfaceSample(inwardDistance, edgeNormal);
  float rimField = uDisplacementEnabled == 1 ? rimInfluence(inwardDistance) : 0.0;
  bool preview = uSurfacePreviewEnabled == 1;
  vec3 sampleColor;

  if (preview) {
    vec2 slope = clamp(surface.xy / MAX_SURFACE_SLOPE, -1.0, 1.0);
    float height = clamp(surface.z / 0.8, 0.0, 1.0);
    sampleColor = vec3(
      mix(248.0, 128.0 + slope.x * 96.0, rimField),
      mix(248.0, 128.0 + slope.y * 96.0, rimField),
      mix(248.0, 126.0 + height * 104.0, rimField)
    ) / 255.0;
  } else {
    sampleColor = sampleLiquidGlass(point, radial, inwardDistance, surface, rimField);
  }

  float edgeT = smoothRange(0.68, 1.0, radial);
  vec3 normal = normalize(vec3(edgeNormal * radial, nz));
  float directionalLight = max(0.0, dot(normal, normalize(vec3(-0.36, -0.48, 0.88))));
  float innerShade = !preview && uInnerShadeEnabled == 1
    ? 0.88 + nz * 0.12 + directionalLight * 0.08 - edgeT * 0.08
    : 1.0;
  float glassMilk = !preview && uGlassMilkEnabled == 1
    ? 0.005 + edgeT * 0.1 + smoothRange(0.92, 1.0, radial) * 0.08
    : 0.0;
  float topWash = !preview && uTopWashEnabled == 1
    ? smoothRange(0.18, -0.82, point.y) * smoothRange(0.98, 0.16, radial)
    : 0.0;
  float rim = !preview && uRimEnabled == 1 ? smoothRange(0.72, 1.0, radial) : 0.0;
  float hardRim = !preview && uHardRimEnabled == 1 ? smoothRange(0.93, 1.0, radial) : 0.0;
  float caRim = !preview && uCaRimEnabled == 1 ? smoothRange(0.8, 1.0, radial) : 0.0;
  vec2 specPoint = inverseSpecWarp(point);
  float specRadiusSquared = min(dot(specPoint, specPoint), 0.999);
  vec3 specNormal = normalize(vec3(
    specPoint,
    sqrt(max(1.0 - specRadiusSquared, 0.001))
  ));
  vec3 reflection = normalize(reflect(vec3(0.0, 0.0, -1.0), specNormal));
  vec2 spec = preview ? vec2(0.0) : sampleSpecs(reflection);
  float shell = uSpecDebugEnabled == 1 ? 0.0 : spec.x;

  vec3 color = mix(sampleColor * innerShade, vec3(1.0), vec3(glassMilk, glassMilk, glassMilk * 0.94));
  color += vec3(shell / 255.0);
  color += topWash * vec3(8.0, 9.0, 10.0) / 255.0;
  color += rim * vec3(10.0, 11.0, 15.0) / 255.0;
  color -= hardRim * vec3(5.0, 6.0, 2.0) / 255.0;
  color += caRim * vec3(6.0) / 255.0;

  if (uSpecDebugEnabled == 1 && spec.y > 0.01) {
    float debugAlpha = clamp(spec.y * uSpecDebugOpacity * 1.35, 0.0, 1.0);
    color = mix(color, uSpecDebugColor, debugAlpha);
  }

  if (uOuterStrokeEnabled == 1) {
    float strokeWidth = max(0.9 / uRadiusCss, antialiasWidth * 1.4);
    float stroke = 1.0 - smoothRange(strokeWidth * 0.18, strokeWidth, abs(shapeDistance));
    float diagonal = smoothRange(-1.4, 1.6, point.x + point.y);
    vec3 strokeColor = mix(vec3(1.0), vec3(0.86, 0.84, 0.8), diagonal * 0.2);
    color = mix(color, strokeColor, stroke * 0.38);
  }

  if (uShowElasticContacts == 1) {
    for (int index = 0; index < MAX_CONTACTS; index += 1) {
      if (index >= uContactCount) break;
      float handleDistance = length(point - uContacts[index].xy);
      float dotMask = 1.0 - smoothRange(0.014, 0.024, handleDistance);
      float ringMask = 1.0 - smoothRange(0.006, 0.014, abs(handleDistance - 0.065));
      color = mix(color, vec3(0.06, 0.22, 0.23), dotMask * 0.9);
      color = mix(color, vec3(1.0), ringMask * uContacts[index].w * 0.62);
    }
  }

  outputColor = vec4(clamp(color, 0.0, 1.0), shapeMask);
}
`;

type UniformMap = Record<string, WebGLUniformLocation>;

function createShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) {
    throw new Error('Unable to create a WebGL shader.');
  }

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || 'Unknown shader compile error.';
    gl.deleteShader(shader);
    throw new Error(message);
  }

  return shader;
}

function createProgram(gl: WebGL2RenderingContext): WebGLProgram {
  const vertex = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
  const fragment = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
  const program = gl.createProgram();

  if (!program) {
    throw new Error('Unable to create a WebGL program.');
  }

  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) || 'Unknown WebGL program link error.';
    gl.deleteProgram(program);
    throw new Error(message);
  }

  return program;
}

function createTexture(gl: WebGL2RenderingContext): WebGLTexture {
  const texture = gl.createTexture();
  if (!texture) {
    throw new Error('Unable to create a WebGL texture.');
  }

  return texture;
}

function getUniforms(gl: WebGL2RenderingContext, program: WebGLProgram, names: string[]): UniformMap {
  return Object.fromEntries(names.map((name) => {
    const location = gl.getUniformLocation(program, name);
    if (!location) {
      throw new Error(`Missing WebGL uniform: ${name}`);
    }
    return [name, location];
  }));
}

function profileIndex(profile: GpuGlassControls['surfaceProfile']): number {
  if (profile === 'concave') return 1;
  if (profile === 'lip') return 2;
  return 0;
}

export class GuseulWebGLRenderer {
  readonly canvas = document.createElement('canvas');
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly vertexArray: WebGLVertexArrayObject;
  private readonly contentTexture: WebGLTexture;
  private readonly specWarpTexture: WebGLTexture;
  private readonly uniforms: UniformMap;
  private contentWidth = 0;
  private contentHeight = 0;
  private specWarpRevision = -1;

  constructor() {
    const gl = this.canvas.getContext('webgl2', {
      alpha: true,
      antialias: false,
      depth: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
    });

    if (!gl) {
      throw new Error('WebGL2 is not supported.');
    }

    const program = createProgram(gl);
    const vertexArray = gl.createVertexArray();
    if (!vertexArray) {
      throw new Error('Unable to create a WebGL vertex array.');
    }

    this.gl = gl;
    this.program = program;
    this.vertexArray = vertexArray;
    this.contentTexture = createTexture(gl);
    this.specWarpTexture = createTexture(gl);
    this.uniforms = getUniforms(gl, program, [
      'uContent', 'uViewportCss', 'uCenterCss', 'uRadiusCss', 'uBackground', 'uOverscan',
      'uSourceFollow', 'uSpecWarpMap', 'uSpecWarpExtent',
      'uContactCount', 'uContacts[0]', 'uContactAnchors[0]',
      'uMembraneLinkCount', 'uMembraneStarts[0]', 'uMembraneEnds[0]',
      'uContactRadius', 'uBridgeRadius', 'uMembraneBridgeRadius', 'uEdgeConcavity',
      'uFieldSmoothness',
      'uContourOffset',
      'uDisplacementEnabled', 'uSurfacePreviewEnabled', 'uSurfaceProfile', 'uBezelWidth',
      'uThickness', 'uDisplacementFactor', 'uEdgeFadeWidth', 'uIor', 'uRefractionEnabled',
      'uChromaticEnabled', 'uDispersion', 'uChromaticEdgeStrength', 'uChromaticEdgeWidth',
      'uChromaticBoundaryStrength', 'uChromaticBoundaryWidth', 'uInnerShadeEnabled',
      'uGlassMilkEnabled', 'uTopWashEnabled', 'uRimEnabled', 'uHardRimEnabled',
      'uCaRimEnabled', 'uSpecDebugEnabled', 'uSpecDebugColor', 'uSpecDebugOpacity',
      'uOuterStrokeEnabled', 'uShowElasticContacts',
      'uCircleCount', 'uCircles[0]', 'uSpecCount', 'uSpecSource[0]', 'uSpecAxisX[0]',
      'uSpecAxisY[0]', 'uSpecShape[0]', 'uSpecRender[0]',
    ]);

    gl.useProgram(program);
    gl.uniform1i(this.uniforms.uContent, 0);
    gl.uniform1i(this.uniforms.uSpecWarpMap, 1);
    gl.uniform1f(this.uniforms.uSpecWarpExtent, elasticSpecWarpExtent);
    gl.bindVertexArray(vertexArray);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.contentTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.specWarpTexture);
    // RG16F is linearly filterable in WebGL2. Checking the float-linear
    // extension here incorrectly forced Safari onto a visibly blocky grid.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RG16F,
      elasticSpecWarpResolution,
      elasticSpecWarpResolution,
      0,
      gl.RG,
      gl.FLOAT,
      null,
    );
  }

  resize(pixelWidth: number, pixelHeight: number): void {
    if (this.canvas.width === pixelWidth && this.canvas.height === pixelHeight) {
      return;
    }

    this.canvas.width = pixelWidth;
    this.canvas.height = pixelHeight;
  }

  private uploadContent(content: HTMLCanvasElement): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.contentTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);

    if (this.contentWidth !== content.width || this.contentHeight !== content.height) {
      this.contentWidth = content.width;
      this.contentHeight = content.height;
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, content);
      return;
    }

    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, content);
  }

  private uploadElasticShape(shape: ElasticShapeFrame): void {
    const contactCount = Math.min(shape.contacts.length, maxGpuContacts);
    const contacts = new Float32Array(maxGpuContacts * 4);
    const anchors = new Float32Array(maxGpuContacts * 2);

    for (let index = 0; index < contactCount; index += 1) {
      const contact = shape.contacts[index];
      contacts.set(
        [contact.position.x, contact.position.y, contact.radius, contact.influence],
        index * 4,
      );
      anchors.set([contact.anchor.x, contact.anchor.y], index * 2);
    }

    const linkCount = Math.min(shape.membraneLinks.length, maxGpuMembraneLinks);
    const starts = new Float32Array(maxGpuMembraneLinks * 4);
    const ends = new Float32Array(maxGpuMembraneLinks * 4);

    for (let index = 0; index < linkCount; index += 1) {
      const link = shape.membraneLinks[index];
      starts.set(
        [link.start.x, link.start.y, link.startRadius, link.influence],
        index * 4,
      );
      ends.set(
        [link.end.x, link.end.y, link.endRadius, link.fillTriangle],
        index * 4,
      );
    }

    const gl = this.gl;
    gl.uniform1i(this.uniforms.uContactCount, contactCount);
    gl.uniform4fv(this.uniforms['uContacts[0]'], contacts);
    gl.uniform2fv(this.uniforms['uContactAnchors[0]'], anchors);
    gl.uniform1i(this.uniforms.uMembraneLinkCount, linkCount);
    gl.uniform4fv(this.uniforms['uMembraneStarts[0]'], starts);
    gl.uniform4fv(this.uniforms['uMembraneEnds[0]'], ends);
    gl.uniform1f(this.uniforms.uContactRadius, shape.contactRadius);
    gl.uniform1f(this.uniforms.uBridgeRadius, shape.bridgeRadius);
    gl.uniform1f(this.uniforms.uMembraneBridgeRadius, shape.membraneBridgeRadius);
    gl.uniform1f(this.uniforms.uEdgeConcavity, shape.edgeConcavity);
    gl.uniform1f(this.uniforms.uFieldSmoothness, shape.fieldSmoothness);
    gl.uniform1f(this.uniforms.uContourOffset, shape.contourOffset);

    if (shape.specWarpRevision !== this.specWarpRevision) {
      this.specWarpRevision = shape.specWarpRevision;
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.specWarpTexture);
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        0,
        0,
        elasticSpecWarpResolution,
        elasticSpecWarpResolution,
        gl.RG,
        gl.FLOAT,
        shape.specWarpMap,
      );
    }
  }

  private uploadCircles(circles: GpuCircle[]): void {
    const values = new Float32Array(maxGpuCircles * 4);
    const count = Math.min(circles.length, maxGpuCircles);

    for (let index = 0; index < count; index += 1) {
      const circle = circles[index];
      values.set([circle.centerX, circle.centerY, circle.radius, circle.alpha], index * 4);
    }

    this.gl.uniform1i(this.uniforms.uCircleCount, count);
    this.gl.uniform4fv(this.uniforms['uCircles[0]'], values);
  }

  private uploadSpecs(specs: GpuSpec[]): void {
    const count = Math.min(specs.length, maxGpuSpecs);
    const source = new Float32Array(maxGpuSpecs * 4);
    const axisX = new Float32Array(maxGpuSpecs * 4);
    const axisY = new Float32Array(maxGpuSpecs * 4);
    const shape = new Float32Array(maxGpuSpecs * 4);
    const render = new Float32Array(maxGpuSpecs * 4);

    for (let index = 0; index < count; index += 1) {
      const spec = specs[index];
      source.set([...spec.sourceDirection, 0], index * 4);
      axisX.set([...spec.axisX, 0], index * 4);
      axisY.set([...spec.axisY, 0], index * 4);
      shape.set([spec.halfWidth, spec.halfHeight, spec.softness, spec.shape === 'circle' ? 1 : 0], index * 4);
      render.set([spec.power, spec.intensity, spec.visibility, 0], index * 4);
    }

    const gl = this.gl;
    gl.uniform1i(this.uniforms.uSpecCount, count);
    gl.uniform4fv(this.uniforms['uSpecSource[0]'], source);
    gl.uniform4fv(this.uniforms['uSpecAxisX[0]'], axisX);
    gl.uniform4fv(this.uniforms['uSpecAxisY[0]'], axisY);
    gl.uniform4fv(this.uniforms['uSpecShape[0]'], shape);
    gl.uniform4fv(this.uniforms['uSpecRender[0]'], render);
  }

  render(frame: GpuGlassFrame): void {
    this.uploadContent(frame.contentCanvas);

    const gl = this.gl;
    const controls = frame.controls;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.disable(gl.BLEND);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vertexArray);
    gl.uniform2fv(this.uniforms.uViewportCss, frame.viewportCss);
    gl.uniform2fv(this.uniforms.uCenterCss, frame.centerCss);
    gl.uniform1f(this.uniforms.uRadiusCss, frame.radiusCss);
    gl.uniform3fv(this.uniforms.uBackground, controls.background);
    gl.uniform1f(this.uniforms.uOverscan, controls.contentOverscan);
    gl.uniform1f(this.uniforms.uSourceFollow, controls.sourceFollow);
    gl.uniform1i(this.uniforms.uDisplacementEnabled, Number(controls.displacementEnabled));
    gl.uniform1i(this.uniforms.uSurfacePreviewEnabled, Number(controls.surfacePreviewEnabled));
    gl.uniform1i(this.uniforms.uSurfaceProfile, profileIndex(controls.surfaceProfile));
    gl.uniform1f(this.uniforms.uBezelWidth, controls.bezelWidth);
    gl.uniform1f(this.uniforms.uThickness, controls.thickness);
    gl.uniform1f(this.uniforms.uDisplacementFactor, controls.displacementFactor);
    gl.uniform1f(this.uniforms.uEdgeFadeWidth, controls.edgeFadeWidth);
    gl.uniform1f(this.uniforms.uIor, controls.ior);
    gl.uniform1i(this.uniforms.uRefractionEnabled, Number(controls.refractionEnabled));
    gl.uniform1i(this.uniforms.uChromaticEnabled, Number(controls.chromaticEnabled));
    gl.uniform1f(this.uniforms.uDispersion, controls.dispersion);
    gl.uniform1f(this.uniforms.uChromaticEdgeStrength, controls.chromaticEdgeStrength);
    gl.uniform1f(this.uniforms.uChromaticEdgeWidth, controls.chromaticEdgeWidth);
    gl.uniform1f(this.uniforms.uChromaticBoundaryStrength, controls.chromaticBoundaryStrength);
    gl.uniform1f(this.uniforms.uChromaticBoundaryWidth, controls.chromaticBoundaryWidth);
    gl.uniform1i(this.uniforms.uInnerShadeEnabled, Number(controls.innerShadeEnabled));
    gl.uniform1i(this.uniforms.uGlassMilkEnabled, Number(controls.glassMilkEnabled));
    gl.uniform1i(this.uniforms.uTopWashEnabled, Number(controls.topWashEnabled));
    gl.uniform1i(this.uniforms.uRimEnabled, Number(controls.rimEnabled));
    gl.uniform1i(this.uniforms.uHardRimEnabled, Number(controls.hardRimEnabled));
    gl.uniform1i(this.uniforms.uCaRimEnabled, Number(controls.caRimEnabled));
    gl.uniform1i(this.uniforms.uSpecDebugEnabled, Number(controls.specDebugEnabled));
    gl.uniform3fv(this.uniforms.uSpecDebugColor, controls.specDebugColor === 'red' ? [1, 0, 0] : [0, 0, 0]);
    gl.uniform1f(this.uniforms.uSpecDebugOpacity, controls.specDebugOpacity);
    gl.uniform1i(this.uniforms.uOuterStrokeEnabled, Number(controls.outerStrokeEnabled));
    gl.uniform1i(this.uniforms.uShowElasticContacts, Number(controls.showElasticContacts));
    this.uploadElasticShape(frame.elasticShape);
    this.uploadCircles(frame.circles);
    this.uploadSpecs(frame.specs);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
