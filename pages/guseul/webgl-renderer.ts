export const maxGpuCircles = 10;
export const maxGpuSpecs = 11;

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
  deformationAxis: [number, number];
  deformationScales: [number, number];
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
};

export type GpuGlassFrame = {
  contentCanvas: HTMLCanvasElement;
  surfaceField: Float32Array;
  surfaceWidth: number;
  surfaceHeight: number;
  surfaceSignature: string;
  radiusCss: number;
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

in vec2 vUv;
out vec4 outputColor;

uniform sampler2D uContent;
uniform sampler2D uSurface;
uniform vec2 uSurfaceSize;
uniform float uRadiusCss;
uniform vec3 uBackground;
uniform float uOverscan;
uniform vec2 uDeformationAxis;
uniform vec2 uDeformationScales;
uniform float uSourceFollow;
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

vec4 fetchSurface(ivec2 point) {
  ivec2 size = ivec2(uSurfaceSize);
  return texelFetch(uSurface, clamp(point, ivec2(0), size - 1), 0);
}

vec4 sampleSurfaceTexture(vec2 point) {
  vec2 position = (point + 1.0) * uSurfaceSize * 0.5 - 0.5;
  vec2 bounded = clamp(position, vec2(0.0), uSurfaceSize - 1.001);
  ivec2 base = ivec2(floor(bounded));
  ivec2 next = min(base + 1, ivec2(uSurfaceSize) - 1);
  vec2 amount = fract(bounded);
  vec4 top = mix(fetchSurface(base), fetchSurface(ivec2(next.x, base.y)), amount.x);
  vec4 bottom = mix(fetchSurface(ivec2(base.x, next.y)), fetchSurface(next), amount.x);
  return mix(top, bottom, amount.y);
}

vec3 surfaceSample(vec2 point, float radial) {
  if (uDisplacementEnabled == 0) {
    return vec3(0.0);
  }

  vec4 field = sampleSurfaceTexture(point);
  float fill = field.z;
  vec2 slope = fill > 0.0001 ? field.xy / fill : vec2(0.0);
  float inwardDistance = max(1.0 - radial, 0.0);
  float bezelWidth = max(uBezelWidth, 0.001);
  float progress = clamp(inwardDistance / bezelWidth, 0.0, 1.0);
  float profileHeight = surfaceProfile(progress).x;
  float flatHeight = surfaceProfile(1.0).x;
  float bevelHeight = (inwardDistance > bezelWidth ? flatHeight : profileHeight) * bezelWidth;
  float height = (uThickness + bevelHeight) * uDisplacementFactor;

  return vec3(slope, height);
}

float rimInfluence(float radial) {
  return 1.0 - smoothRange(0.0, max(uBezelWidth, 0.001), max(1.0 - radial, 0.0));
}

float displacementEdgeFade(float radial) {
  if (uEdgeFadeWidth <= 0.0001) {
    return 1.0;
  }
  return smoothRange(0.0, uEdgeFadeWidth, max(1.0 - radial, 0.0));
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

vec2 transformSourcePoint(vec2 point) {
  vec2 axis = normalize(uDeformationAxis);
  vec2 perpendicular = vec2(-axis.y, axis.x);
  vec2 deformed =
    axis * dot(point, axis) * uDeformationScales.x +
    perpendicular * dot(point, perpendicular) * uDeformationScales.y;

  return mix(deformed, point, clamp(uSourceFollow, 0.0, 1.0));
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

vec3 sampleLiquidGlass(vec2 point, float radial, vec3 surface, float rim) {
  if (uRefractionEnabled == 0) {
    return sampleContent(transformSourcePoint(point)).rgb;
  }

  float height = surface.z * displacementEdgeFade(radial);
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
  vec2 point = vec2(vUv.x * 2.0 - 1.0, 1.0 - vUv.y * 2.0);
  float radialSquared = dot(point, point);
  if (radialSquared > 1.0) {
    outputColor = vec4(0.0);
    return;
  }

  float radial = sqrt(radialSquared);
  float nz = sqrt(max(1.0 - radialSquared, 0.0));
  vec3 surface = surfaceSample(point, radial);
  float rimField = uDisplacementEnabled == 1 ? rimInfluence(radial) : 0.0;
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
    sampleColor = sampleLiquidGlass(point, radial, surface, rimField);
  }

  float edgeT = smoothRange(0.68, 1.0, radial);
  float directionalLight = max(0.0, point.x * -0.36 + point.y * -0.48 + nz * 0.88);
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
  vec3 normal = vec3(point, nz);
  vec3 reflection = normalize(reflect(vec3(0.0, 0.0, -1.0), normal));
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

  float alpha = smoothRange(1.0, 0.982, radial);
  outputColor = vec4(clamp(color, 0.0, 1.0), alpha);
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
  private readonly surfaceTexture: WebGLTexture;
  private readonly uniforms: UniformMap;
  private contentWidth = 0;
  private contentHeight = 0;
  private uploadedSurfaceSignature = '';
  private packedSurface = new Float32Array();

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
    this.surfaceTexture = createTexture(gl);
    this.uniforms = getUniforms(gl, program, [
      'uContent', 'uSurface', 'uSurfaceSize', 'uRadiusCss', 'uBackground', 'uOverscan',
      'uDeformationAxis', 'uDeformationScales', 'uSourceFollow',
      'uDisplacementEnabled', 'uSurfacePreviewEnabled', 'uSurfaceProfile', 'uBezelWidth',
      'uThickness', 'uDisplacementFactor', 'uEdgeFadeWidth', 'uIor', 'uRefractionEnabled',
      'uChromaticEnabled', 'uDispersion', 'uChromaticEdgeStrength', 'uChromaticEdgeWidth',
      'uChromaticBoundaryStrength', 'uChromaticBoundaryWidth', 'uInnerShadeEnabled',
      'uGlassMilkEnabled', 'uTopWashEnabled', 'uRimEnabled', 'uHardRimEnabled',
      'uCaRimEnabled', 'uSpecDebugEnabled', 'uSpecDebugColor', 'uSpecDebugOpacity',
      'uCircleCount', 'uCircles[0]', 'uSpecCount', 'uSpecSource[0]', 'uSpecAxisX[0]',
      'uSpecAxisY[0]', 'uSpecShape[0]', 'uSpecRender[0]',
    ]);

    gl.useProgram(program);
    gl.uniform1i(this.uniforms.uContent, 0);
    gl.uniform1i(this.uniforms.uSurface, 1);
    gl.bindVertexArray(vertexArray);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.contentTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.surfaceTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  resize(pixelSize: number): void {
    if (this.canvas.width === pixelSize && this.canvas.height === pixelSize) {
      return;
    }

    this.canvas.width = pixelSize;
    this.canvas.height = pixelSize;
    this.uploadedSurfaceSignature = '';
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

  private uploadSurface(frame: GpuGlassFrame): void {
    if (frame.surfaceSignature === this.uploadedSurfaceSignature) {
      return;
    }

    const pixelCount = frame.surfaceWidth * frame.surfaceHeight;
    if (this.packedSurface.length !== pixelCount * 4) {
      this.packedSurface = new Float32Array(pixelCount * 4);
    }

    for (let pixel = 0; pixel < pixelCount; pixel += 1) {
      const source = pixel * 3;
      const target = pixel * 4;
      this.packedSurface[target] = frame.surfaceField[source];
      this.packedSurface[target + 1] = frame.surfaceField[source + 1];
      this.packedSurface[target + 2] = frame.surfaceField[source + 2];
      this.packedSurface[target + 3] = 1;
    }

    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.surfaceTexture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA32F,
      frame.surfaceWidth,
      frame.surfaceHeight,
      0,
      gl.RGBA,
      gl.FLOAT,
      this.packedSurface,
    );
    this.uploadedSurfaceSignature = frame.surfaceSignature;
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
    this.uploadSurface(frame);

    const gl = this.gl;
    const controls = frame.controls;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.disable(gl.BLEND);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vertexArray);
    gl.uniform2f(this.uniforms.uSurfaceSize, frame.surfaceWidth, frame.surfaceHeight);
    gl.uniform1f(this.uniforms.uRadiusCss, frame.radiusCss);
    gl.uniform3fv(this.uniforms.uBackground, controls.background);
    gl.uniform1f(this.uniforms.uOverscan, controls.contentOverscan);
    gl.uniform2fv(this.uniforms.uDeformationAxis, controls.deformationAxis);
    gl.uniform2fv(this.uniforms.uDeformationScales, controls.deformationScales);
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
    this.uploadCircles(frame.circles);
    this.uploadSpecs(frame.specs);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
