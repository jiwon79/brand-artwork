import * as THREE from 'three';
import GUI from 'lil-gui';

const ART_WIDTH = 480;
const ART_HEIGHT = 600;
const TEXTURE_SCALE = 3;
const FIELD_WIDTH = ART_WIDTH;
const FIELD_HEIGHT = ART_HEIGHT;
const COLOR_BLUR_TAPS = 20;
const METABALL_SAMPLES = 192;
const METABALL_SMOOTH_TAPS = 5;
const STROKE_SPREAD_PASSES = 8;
// Jump flooding is retained only for the optional continuity core. The visible
// silhouette comes from the accumulated metaball field below.
const JFA_JUMPS = [16, 8, 4, 2, 1, 1];
const searchParams = new URLSearchParams(window.location.search);
const QA_MODE = searchParams.has('qa');
const QA_LABEL_MODE = searchParams.has('qaLabels');
const qaPointerX = Number(searchParams.get('qaX'));
const qaPointerY = Number(searchParams.get('qaY'));
const QA_POINTER_LOCKED = searchParams.has('qaX')
  && searchParams.has('qaY')
  && Number.isFinite(qaPointerX)
  && Number.isFinite(qaPointerY);

type InteractionMode = 'classic' | 'viscous' | 'thermal' | 'drip';

function interactionModeFromQuery(): InteractionMode {
  const requestedMode = searchParams.get('interaction');
  if (
    requestedMode === 'classic'
    || requestedMode === 'viscous'
    || requestedMode === 'thermal'
    || requestedMode === 'drip'
  ) return requestedMode;
  return 'viscous';
}

function qaNumber(name: string, fallback: number): number {
  if (!QA_MODE) return fallback;
  const rawValue = searchParams.get(name);
  if (rawValue === null) return fallback;
  const value = Number(rawValue);
  return Number.isFinite(value) ? value : fallback;
}

const canvas = document.getElementById('artwork') as HTMLCanvasElement;
const error = document.getElementById('error') as HTMLParagraphElement;

const state = {
  interactionMode: interactionModeFromQuery() as InteractionMode,
  radiusX: qaNumber('qaRadiusX', 107),
  radiusY: qaNumber('qaRadiusY', 80),
  radiusYBelow: qaNumber('qaRadiusYBelow', 160),
  taperAbove: qaNumber('qaTaperAbove', 0.55),
  taperBelow: qaNumber('qaTaperBelow', 0.55),
  taperStart: qaNumber('qaTaperStart', 0.25),
  taperEnd: qaNumber('qaTaperEnd', 0.85),
  lightFalloff: qaNumber('qaLightFalloff', 0.12),
  seedThreshold: qaNumber('qaSeedThreshold', 0.05),
  metaballInputThreshold: qaNumber('qaMetaballInput', 0.02),
  metaballInputSoftness: qaNumber('qaMetaballInputSoftness', 0.025),
  metaballBlurRadius: qaNumber('qaMetaballBlur', 30.0),
  metaballFalloffPower: qaNumber('qaMetaballPower', 3.2),
  metaballSourceGain: qaNumber('qaMetaballSourceGain', 0.55),
  metaballFieldGain: qaNumber('qaMetaballFieldGain', 2.2),
  metaballSmoothing: qaNumber('qaMetaballSmoothing', 1.8),
  coreRadius: qaNumber('qaCore', 1.2),
  coreRadiusMin: qaNumber('qaCoreMin', 0.4),
  coreRadiusExponent: qaNumber('qaCoreExponent', 0.25),
  coreMix: qaNumber('qaCoreMix', 0.0),
  surfaceThreshold: qaNumber('qaSurfaceThreshold', 0.07),
  surfaceSoftness: qaNumber('qaSurfaceSoftness', 0.012),
  colorSourceMode: qaNumber('qaColorSourceMode', 0),
  colorCenterRadiusX: qaNumber('qaColorCenterRadiusX', 9.0),
  colorCenterRadiusY: qaNumber('qaColorCenterRadiusY', 16.0),
  colorCenterVariation: qaNumber('qaColorCenterVariation', 1.0),
  colorGlyphInfluence: qaNumber('qaColorGlyphInfluence', 0.2),
  colorBlurSigma: qaNumber('qaColorBlurSigma', 2.5),
  colorBlurAspect: qaNumber('qaColorBlurAspect', 1.1),
  colorBlurStep: qaNumber('qaColorBlurStep', 1.0),
  colorFloor: qaNumber('qaColorFloor', 0.015),
  colorRange: qaNumber('qaColorRange', 0.48),
  hueBands: qaNumber('qaHueBands', 0.31),
  colorCycle: qaNumber('qaColorCycle', 8.0),
  pointerEase: 4.3,
  pointerMaxSpeed: 300,
  activationAttack: 0.055,
  activationRelease: 0.34,
  viscousWakeLength: qaNumber('qaViscousWakeLength', 96),
  viscousWakeWidth: qaNumber('qaViscousWakeWidth', 2.6),
  viscousWakeStrength: qaNumber('qaViscousWakeStrength', 0.65),
  viscousWakeRelease: qaNumber('qaViscousWakeRelease', 0.2),
  viscousBreakup: qaNumber('qaViscousBreakup', 0.46),
  thermalStretch: qaNumber('qaThermalStretch', 0.9),
  thermalStrength: qaNumber('qaThermalStrength', 0.82),
  thermalRadiusX: qaNumber('qaThermalRadiusX', 72),
  thermalRadiusY: qaNumber('qaThermalRadiusY', 110),
  dwellBuildTime: qaNumber('qaDwellBuildTime', 0.62),
  dwellReleaseTime: qaNumber('qaDwellReleaseTime', 0.2),
  dwellSpeedThreshold: qaNumber('qaDwellSpeedThreshold', 54),
  dripGravity: qaNumber('qaDripGravity', 78),
  dripStretch: qaNumber('qaDripStretch', 0.34),
  dripTurbulence: qaNumber('qaDripTurbulence', 0.72),
  dripStrength: qaNumber('qaDripStrength', 0.92),
  dripPinchTime: qaNumber('qaDripPinchTime', 1.45),
  dripLifetime: qaNumber('qaDripLifetime', 4.0),
};
const qaInteractionSpeed = qaNumber('qaInteractionSpeed', 0);
const qaVelocityX = qaNumber('qaVelocityX', 1);
const qaVelocityY = qaNumber('qaVelocityY', 0);
const qaDwellAmount = qaNumber('qaDwell', 0);
const qaDripAge = qaNumber('qaDripAge', 1.45);
const qaDripEnergy = qaNumber('qaDrip', 1);

const lines = [
  'COLOR',
  'CHANGES',
  'EVERYTHING',
  'DEPENDING',
  'ON',
  'THE LIGHT',
  'THAT',
  'TOUCHES',
  'IT',
];
const FIRST_LINE_Y = 132;
const LINE_HEIGHT = 42.2;
const CHARACTER_ADVANCE = 31.8;

type Pointer = { x: number; y: number };

const initialPointer = {
  x: QA_POINTER_LOCKED ? THREE.MathUtils.clamp(qaPointerX, 0, 1) : 0.37,
  y: QA_POINTER_LOCKED ? THREE.MathUtils.clamp(qaPointerY, 0, 1) : 0.52,
};
const pointer: Pointer = { ...initialPointer };
const pointerTarget: Pointer = { ...pointer };
const dripAnchor: Pointer = { ...pointer };
const velocityDirection: Pointer = { x: 1, y: 0 };
let smoothedVelocityX = 0;
let smoothedVelocityY = 0;
let interactionSpeed = 0;
let dwellAmount = 0;
let dripAge = Number.POSITIVE_INFINITY;
let dripEnergy = 0;
let artworkRect = { left: 0, top: 0, width: ART_WIDTH, height: ART_HEIGHT };
let startTime = performance.now();
let previousTime = startTime;
let reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const textCanvas = document.createElement('canvas');
textCanvas.width = ART_WIDTH * TEXTURE_SCALE;
textCanvas.height = ART_HEIGHT * TEXTURE_SCALE;
const textContext = textCanvas.getContext('2d', { alpha: true });
if (!textContext) throw new Error('Unable to create the text mask.');
const colorCenterCanvas = document.createElement('canvas');
colorCenterCanvas.width = ART_WIDTH * TEXTURE_SCALE;
colorCenterCanvas.height = ART_HEIGHT * TEXTURE_SCALE;
const colorCenterContext = colorCenterCanvas.getContext('2d', { alpha: true });
if (!colorCenterContext) throw new Error('Unable to create the color-center mask.');

function drawTrackedLine(
  context: CanvasRenderingContext2D,
  text: string,
  centerX: number,
  centerY: number,
  advance: number,
): void {
  const startX = centerX - ((text.length - 1) * advance) / 2;
  for (let index = 0; index < text.length; index += 1) {
    context.fillText(text[index], startX + index * advance, centerY);
  }
}

function bakeTextMask(): void {
  textContext.setTransform(TEXTURE_SCALE, 0, 0, TEXTURE_SCALE, 0, 0);
  textContext.clearRect(0, 0, ART_WIDTH, ART_HEIGHT);
  textContext.save();
  textContext.fillStyle = '#ffffff';
  textContext.font = '300 43px "Helvetica Neue", "Arial", sans-serif';
  textContext.textAlign = 'center';
  textContext.textBaseline = 'middle';
  lines.forEach((line, index) => {
    drawTrackedLine(
      textContext,
      line,
      ART_WIDTH / 2,
      FIRST_LINE_Y + index * LINE_HEIGHT,
      CHARACTER_ADVANCE,
    );
  });
  textContext.restore();
}

function drawColorCenter(
  context: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  radiusX: number,
  radiusY: number,
  opacity: number,
): void {
  context.save();
  context.translate(centerX, centerY);
  context.scale(radiusX, radiusY);
  context.globalAlpha = opacity;
  const gradient = context.createRadialGradient(0, 0, 0, 0, 0, 1);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
  gradient.addColorStop(0.42, 'rgba(255, 255, 255, 0.96)');
  gradient.addColorStop(0.74, 'rgba(255, 255, 255, 0.52)');
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
  context.fillStyle = gradient;
  context.beginPath();
  context.arc(0, 0, 1, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

type GlyphCenterStats = {
  centerX: number;
  centerY: number;
  centroidX: number;
  centroidY: number;
  inkMass: number;
  width: number;
  height: number;
};

function measureGlyphCenters(): GlyphCenterStats[] {
  const image = textContext.getImageData(0, 0, textCanvas.width, textCanvas.height);
  const stats: GlyphCenterStats[] = [];

  lines.forEach((line, lineIndex) => {
    const startX = ART_WIDTH / 2 - ((line.length - 1) * CHARACTER_ADVANCE) / 2;
    for (let characterIndex = 0; characterIndex < line.length; characterIndex += 1) {
      if (line[characterIndex] === ' ') continue;
      const centerX = startX + characterIndex * CHARACTER_ADVANCE;
      const centerY = FIRST_LINE_Y + lineIndex * LINE_HEIGHT;
      const minCellX = Math.max(0, Math.floor((centerX - CHARACTER_ADVANCE / 2) * TEXTURE_SCALE));
      const maxCellX = Math.min(
        textCanvas.width - 1,
        Math.ceil((centerX + CHARACTER_ADVANCE / 2) * TEXTURE_SCALE),
      );
      const minCellY = Math.max(0, Math.floor((centerY - LINE_HEIGHT / 2) * TEXTURE_SCALE));
      const maxCellY = Math.min(
        textCanvas.height - 1,
        Math.ceil((centerY + LINE_HEIGHT / 2) * TEXTURE_SCALE),
      );
      let inkMass = 0;
      let weightedX = 0;
      let weightedY = 0;
      let minInkX = maxCellX;
      let maxInkX = minCellX;
      let minInkY = maxCellY;
      let maxInkY = minCellY;

      for (let pixelY = minCellY; pixelY <= maxCellY; pixelY += 1) {
        for (let pixelX = minCellX; pixelX <= maxCellX; pixelX += 1) {
          const alpha = image.data[(pixelY * textCanvas.width + pixelX) * 4 + 3] / 255;
          if (alpha < 0.01) continue;
          inkMass += alpha;
          weightedX += (pixelX / TEXTURE_SCALE) * alpha;
          weightedY += (pixelY / TEXTURE_SCALE) * alpha;
          if (alpha > 0.08) {
            minInkX = Math.min(minInkX, pixelX);
            maxInkX = Math.max(maxInkX, pixelX);
            minInkY = Math.min(minInkY, pixelY);
            maxInkY = Math.max(maxInkY, pixelY);
          }
        }
      }

      const safeMass = Math.max(inkMass, 0.001);
      stats.push({
        centerX,
        centerY,
        centroidX: weightedX / safeMass,
        centroidY: weightedY / safeMass,
        inkMass: inkMass / (TEXTURE_SCALE * TEXTURE_SCALE),
        width: Math.max((maxInkX - minInkX + 1) / TEXTURE_SCALE, 1),
        height: Math.max((maxInkY - minInkY + 1) / TEXTURE_SCALE, 1),
      });
    }
  });

  return stats;
}

let glyphCenterStats: GlyphCenterStats[] = [];

function bakeColorCenterMask(): void {
  colorCenterContext.setTransform(TEXTURE_SCALE, 0, 0, TEXTURE_SCALE, 0, 0);
  colorCenterContext.clearRect(0, 0, ART_WIDTH, ART_HEIGHT);
  const masses = glyphCenterStats.map((stats) => stats.inkMass);
  const minMass = Math.min(...masses);
  const maxMass = Math.max(...masses);
  glyphCenterStats.forEach((stats) => {
    const massRatio = (stats.inkMass - minMass) / Math.max(maxMass - minMass, 0.001);
    const widthRatio = THREE.MathUtils.clamp((stats.width - 4) / 27, 0, 1);
    const heightRatio = THREE.MathUtils.clamp((stats.height - 18) / 20, 0, 1);
    const widthSignal = massRatio * 0.35 + widthRatio * 0.65;
    const heightSignal = massRatio * 0.5 + heightRatio * 0.5;
    const variation = state.colorCenterVariation;
    const radiusX = state.colorCenterRadiusX * THREE.MathUtils.lerp(
      1,
      0.32 + widthSignal * 1.35,
      variation,
    );
    const radiusY = state.colorCenterRadiusY * THREE.MathUtils.lerp(
      1,
      0.42 + heightSignal * 1.3,
      variation,
    );
    const centroidMix = variation * 0.35;
    const centerX = THREE.MathUtils.lerp(stats.centerX, stats.centroidX, centroidMix);
    const centerY = THREE.MathUtils.lerp(stats.centerY, stats.centroidY, centroidMix);
    const opacity = THREE.MathUtils.lerp(1, 0.45 + massRatio * 0.55, variation);
    drawColorCenter(colorCenterContext, centerX, centerY, radiusX, radiusY, opacity);
  });
}

bakeTextMask();
glyphCenterStats = measureGlyphCenters();
bakeColorCenterMask();

let renderer: THREE.WebGLRenderer;
try {
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    alpha: false,
    powerPreference: 'high-performance',
  });
} catch (caught) {
  error.classList.add('visible');
  throw caught;
}

renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(0xfbfbfa, 1);

const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const geometry = new THREE.PlaneGeometry(2, 2);

const vertexShader = `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`;

const textTexture = new THREE.CanvasTexture(textCanvas);
textTexture.colorSpace = THREE.NoColorSpace;
textTexture.minFilter = THREE.LinearFilter;
textTexture.magFilter = THREE.LinearFilter;
textTexture.generateMipmaps = false;
const colorCenterTexture = new THREE.CanvasTexture(colorCenterCanvas);
colorCenterTexture.colorSpace = THREE.NoColorSpace;
colorCenterTexture.minFilter = THREE.LinearFilter;
colorCenterTexture.magFilter = THREE.LinearFilter;
colorCenterTexture.generateMipmaps = false;

const linearTargetOptions: THREE.RenderTargetOptions = {
  depthBuffer: false,
  stencilBuffer: false,
  minFilter: THREE.LinearFilter,
  magFilter: THREE.LinearFilter,
  format: THREE.RGBAFormat,
  type: THREE.HalfFloatType,
  colorSpace: THREE.NoColorSpace,
};

const nearestTargetOptions: THREE.RenderTargetOptions = {
  ...linearTargetOptions,
  minFilter: THREE.NearestFilter,
  magFilter: THREE.NearestFilter,
};

const sourceTarget = new THREE.WebGLRenderTarget(FIELD_WIDTH, FIELD_HEIGHT, linearTargetOptions);
const historyTargetA = new THREE.WebGLRenderTarget(FIELD_WIDTH, FIELD_HEIGHT, linearTargetOptions);
const historyTargetB = new THREE.WebGLRenderTarget(FIELD_WIDTH, FIELD_HEIGHT, linearTargetOptions);
const interactionTargetA = new THREE.WebGLRenderTarget(FIELD_WIDTH, FIELD_HEIGHT, linearTargetOptions);
const interactionTargetB = new THREE.WebGLRenderTarget(FIELD_WIDTH, FIELD_HEIGHT, linearTargetOptions);
const strokeSpreadTargetA = new THREE.WebGLRenderTarget(FIELD_WIDTH, FIELD_HEIGHT, linearTargetOptions);
const strokeSpreadTargetB = new THREE.WebGLRenderTarget(FIELD_WIDTH, FIELD_HEIGHT, linearTargetOptions);
const colorHorizontalTarget = new THREE.WebGLRenderTarget(FIELD_WIDTH, FIELD_HEIGHT, linearTargetOptions);
const colorFieldTarget = new THREE.WebGLRenderTarget(FIELD_WIDTH, FIELD_HEIGHT, linearTargetOptions);
const nearestTargetA = new THREE.WebGLRenderTarget(FIELD_WIDTH, FIELD_HEIGHT, nearestTargetOptions);
const nearestTargetB = new THREE.WebGLRenderTarget(FIELD_WIDTH, FIELD_HEIGHT, nearestTargetOptions);
const surfaceSourceTarget = new THREE.WebGLRenderTarget(FIELD_WIDTH, FIELD_HEIGHT, linearTargetOptions);
const metaballRawTarget = new THREE.WebGLRenderTarget(FIELD_WIDTH, FIELD_HEIGHT, linearTargetOptions);
const surfaceHorizontalTarget = new THREE.WebGLRenderTarget(FIELD_WIDTH, FIELD_HEIGHT, linearTargetOptions);
const surfaceFieldTarget = new THREE.WebGLRenderTarget(FIELD_WIDTH, FIELD_HEIGHT, linearTargetOptions);

const sourceMaterial = new THREE.ShaderMaterial({
  vertexShader,
  fragmentShader: `
    precision highp float;

    varying vec2 vUv;
    uniform sampler2D uText;
    uniform sampler2D uColorCenters;
    uniform vec2 uPointer;
    uniform vec2 uArtSize;
    uniform vec2 uRadius;
    uniform float uRadiusYBelow;
    uniform float uFalloff;
    uniform float uTaperAbove;
    uniform float uTaperBelow;
    uniform float uTaperStart;
    uniform float uTaperEnd;

    void main() {
      float textMask = texture2D(uText, vUv).a;
      float colorCenterMask = texture2D(uColorCenters, vUv).a;
      vec2 delta = (vUv - uPointer) * uArtSize;
      float verticalRadius = delta.y < 0.0 ? uRadiusYBelow : uRadius.y;
      float verticalRatio = abs(delta.y) / max(verticalRadius, 0.001);
      float taperFloor = delta.y < 0.0 ? uTaperBelow : uTaperAbove;
      float horizontalTaper = mix(
        1.0,
        taperFloor,
        smoothstep(uTaperStart, uTaperEnd, verticalRatio)
      );
      vec2 effectiveRadius = vec2(uRadius.x * horizontalTaper, verticalRadius);
      float normalizedDistance = length(delta / max(effectiveRadius, vec2(0.001)));
      float light = 1.0 - smoothstep(uFalloff, 1.0, normalizedDistance);
      light *= smoothstep(1.04, 0.84, normalizedDistance);
      float excitedInk = textMask * pow(max(light, 0.0), 1.22);
      float excitedColorCenter = colorCenterMask * pow(max(light, 0.0), 1.12);
      gl_FragColor = vec4(excitedInk, textMask, excitedColorCenter, 1.0);
    }
  `,
  uniforms: {
    uText: { value: textTexture },
    uColorCenters: { value: colorCenterTexture },
    uPointer: { value: new THREE.Vector2(pointer.x, pointer.y) },
    uArtSize: { value: new THREE.Vector2(ART_WIDTH, ART_HEIGHT) },
    uRadius: { value: new THREE.Vector2(state.radiusX, state.radiusY) },
    uRadiusYBelow: { value: state.radiusYBelow },
    uFalloff: { value: state.lightFalloff },
    uTaperAbove: { value: state.taperAbove },
    uTaperBelow: { value: state.taperBelow },
    uTaperStart: { value: state.taperStart },
    uTaperEnd: { value: state.taperEnd },
  },
  depthTest: false,
  depthWrite: false,
});

const temporalMaterial = new THREE.ShaderMaterial({
  vertexShader,
  fragmentShader: `
    precision highp float;

    varying vec2 vUv;
    uniform sampler2D uCurrent;
    uniform sampler2D uHistory;
    uniform float uAttackBlend;
    uniform float uReleaseBlend;

    void main() {
      float currentInk = texture2D(uCurrent, vUv).r;
      float currentColorCenter = texture2D(uCurrent, vUv).b;
      vec4 history = texture2D(uHistory, vUv);
      float blendAmount = currentInk > history.r ? uAttackBlend : uReleaseBlend;
      float activation = mix(history.r, currentInk, blendAmount);
      float colorBlendAmount = currentColorCenter > history.b ? uAttackBlend : uReleaseBlend;
      float colorCenter = mix(history.b, currentColorCenter, colorBlendAmount);
      float textMask = texture2D(uCurrent, vUv).g;
      gl_FragColor = vec4(
        activation * step(0.001, textMask),
        textMask,
        colorCenter,
        1.0
      );
    }
  `,
  uniforms: {
    uCurrent: { value: sourceTarget.texture },
    uHistory: { value: historyTargetA.texture },
    uAttackBlend: { value: 1 },
    uReleaseBlend: { value: 1 },
  },
  depthTest: false,
  depthWrite: false,
});

const interactionFieldMaterial = new THREE.ShaderMaterial({
  vertexShader,
  fragmentShader: `
    precision highp float;

    varying vec2 vUv;
    uniform sampler2D uHistory;
    uniform sampler2D uPrevious;
    uniform sampler2D uText;
    uniform sampler2D uColorCenters;
    uniform vec2 uArtSize;
    uniform vec2 uPointer;
    uniform vec2 uVelocityDirection;
    uniform float uMode;
    uniform float uSpeed;
    uniform float uDwell;
    uniform float uWakeLength;
    uniform float uWakeWidth;
    uniform float uWakeStrength;
    uniform float uTrailRetention;
    uniform float uBreakup;
    uniform float uThermalStretch;
    uniform float uThermalStrength;
    uniform vec2 uThermalRadius;
    uniform vec2 uDripAnchor;
    uniform float uDripAge;
    uniform float uDripEnergy;
    uniform float uDripGravity;
    uniform float uDripStretch;
    uniform float uDripTurbulence;
    uniform float uDripStrength;
    uniform float uDripPinchTime;
    uniform vec2 uLightRadius;
    uniform float uLightRadiusYBelow;
    uniform float uLightFalloff;
    uniform float uLightTaperAbove;
    uniform float uLightTaperBelow;
    uniform float uLightTaperStart;
    uniform float uLightTaperEnd;
    uniform float uTime;

    void main() {
      vec4 history = texture2D(uHistory, vUv);
      float surfaceActivation = history.r;
      float colorActivation = history.b;
      float trail = 0.0;

      if (uMode > 0.5 && uMode < 1.5) {
        float anchorInk = texture2D(uHistory, uPointer).r;
        float anchorColor = texture2D(uHistory, uPointer).b;
        vec2 nearX = vec2(16.0 / uArtSize.x, 0.0);
        vec2 nearY = vec2(0.0, 16.0 / uArtSize.y);
        anchorInk = max(anchorInk, texture2D(uHistory, uPointer + nearX).r);
        anchorInk = max(anchorInk, texture2D(uHistory, uPointer - nearX).r);
        anchorInk = max(anchorInk, texture2D(uHistory, uPointer + nearY).r);
        anchorInk = max(anchorInk, texture2D(uHistory, uPointer - nearY).r);
        anchorColor = max(anchorColor, texture2D(uHistory, uPointer + nearX).b);
        anchorColor = max(anchorColor, texture2D(uHistory, uPointer - nearX).b);
        anchorColor = max(anchorColor, texture2D(uHistory, uPointer + nearY).b);
        anchorColor = max(anchorColor, texture2D(uHistory, uPointer - nearY).b);

        vec2 deltaPixels = (vUv - uPointer) * uArtSize;
        vec2 behindDirection = -uVelocityDirection;
        float alongTrail = dot(deltaPixels, behindDirection);
        float signedAcrossTrail =
          deltaPixels.x * behindDirection.y - deltaPixels.y * behindDirection.x;
        float acrossTrail = abs(signedAcrossTrail);
        float trailRatio = clamp(alongTrail / max(uWakeLength, 1.0), 0.0, 1.0);
        float surfaceTensionBulge = sin(trailRatio * 3.14159265);
        float taperedWidth = uWakeWidth * mix(0.34, 1.0, surfaceTensionBulge);
        float neckPulse = 0.76 + 0.24 * cos(trailRatio * 12.5663706);
        taperedWidth *= mix(1.0, neckPulse, uBreakup);
        float trailBody = 1.0 - smoothstep(taperedWidth, taperedWidth + 1.2, acrossTrail);
        trailBody *= smoothstep(-2.0, 2.0, alongTrail);
        trailBody *= 1.0 - smoothstep(uWakeLength * 0.74, uWakeLength, alongTrail);

        float curvedOffset = sin(trailRatio * 1.2) * uWakeWidth * 7.0;
        float secondaryAcross = abs(signedAcrossTrail - curvedOffset);
        float secondaryWidth = uWakeWidth * 0.42 * mix(0.3, 1.0, surfaceTensionBulge);
        float secondaryTrail = 1.0 - smoothstep(
          secondaryWidth,
          secondaryWidth + 1.0,
          secondaryAcross
        );
        secondaryTrail *= smoothstep(3.0, 8.0, alongTrail);
        secondaryTrail *= 1.0 - smoothstep(uWakeLength * 0.54, uWakeLength * 0.72, alongTrail);

        float tertiaryAcross = abs(signedAcrossTrail + curvedOffset * 0.78);
        float tertiaryWidth = uWakeWidth * 0.34 * mix(0.28, 1.0, surfaceTensionBulge);
        float tertiaryTrail = 1.0 - smoothstep(
          tertiaryWidth,
          tertiaryWidth + 0.9,
          tertiaryAcross
        );
        tertiaryTrail *= smoothstep(5.0, 10.0, alongTrail);
        tertiaryTrail *= 1.0 - smoothstep(uWakeLength * 0.68, uWakeLength * 0.9, alongTrail);

        vec2 firstDropCenter = behindDirection * uWakeLength * 1.2;
        vec2 secondDropCenter = behindDirection * uWakeLength * 1.52
          + vec2(-behindDirection.y, behindDirection.x) * uWakeWidth * 1.3;
        float firstDrop = 1.0 - smoothstep(
          uWakeWidth * 0.62,
          uWakeWidth * 0.62 + 1.0,
          length(deltaPixels - firstDropCenter)
        );
        float secondDrop = 1.0 - smoothstep(
          uWakeWidth * 0.44,
          uWakeWidth * 0.44 + 1.0,
          length(deltaPixels - secondDropCenter)
        );
        float satelliteDrops = max(firstDrop, secondDrop) * uBreakup;
        float liquidWake = max(
          max(max(trailBody, secondaryTrail * 1.35), tertiaryTrail * 1.25),
          satelliteDrops * 2.35
        );
        float analyticTrail = liquidWake * anchorInk;
        float analyticColor = liquidWake * max(anchorColor, anchorInk * 0.55);

        vec2 advectPixels = uVelocityDirection * min(uWakeLength * 0.08, 2.8);
        vec4 previous = texture2D(uPrevious, vUv + advectPixels / uArtSize);
        float persistentTrail = previous.a * uTrailRetention;
        trail = max(analyticTrail * uSpeed, persistentTrail);

        float alongWake = dot((vUv - uPointer) * uArtSize, uVelocityDirection);
        float neckPattern = 0.78 + 0.22 * cos(alongWake * 0.38);
        trail *= mix(1.0, neckPattern, uBreakup * uSpeed);

        float wakeColorField = max(analyticColor * uSpeed, persistentTrail * anchorColor);
        colorActivation = max(colorActivation, wakeColorField * uWakeStrength);
      } else if (uMode > 1.5 && uMode < 2.5) {
        vec2 deltaPixels = (vUv - uPointer) * uArtSize;
        vec2 normalizedDelta = deltaPixels / max(uThermalRadius, vec2(1.0));
        float localGate = exp(-dot(normalizedDelta, normalizedDelta) * 1.45);
        float thermalPulse = 1.0 + sin(uTime * 3.1) * 0.065 * uDwell;
        float thermalMix = clamp(uDwell * localGate * thermalPulse, 0.0, 1.0);
        float stretch = 1.0 + uThermalStretch * thermalMix;
        float upwardLift = 8.0 * uThermalStrength * thermalMix;
        vec2 warpedDelta = vec2(
          deltaPixels.x,
          (deltaPixels.y - upwardLift) / max(stretch, 1.0)
        );
        vec4 warped = texture2D(uHistory, uPointer + warpedDelta / uArtSize);
        float surfaceGain = 1.0 + uThermalStrength * uDwell * 0.34;
        float colorGain = 1.0 + uThermalStrength * uDwell * 1.15;
        surfaceActivation = mix(
          surfaceActivation,
          max(surfaceActivation, warped.r * surfaceGain),
          thermalMix
        );
        colorActivation = mix(
          colorActivation,
          max(colorActivation, warped.b * colorGain),
          thermalMix
        );
      } else if (uMode > 2.5) {
        float age = max(uDripAge, 0.0);
        float fallDistance = min(
          18.0 * age + 0.5 * uDripGravity * age * age,
          uArtSize.y * 0.62
        );
        float localX = (vUv.x - uDripAnchor.x) * uArtSize.x;
        float broadLane = 0.5 + 0.5 * sin(localX * 0.052 + uDripAnchor.x * 19.7);
        float fineLane = 0.5 + 0.5 * sin(localX * 0.137 - uDripAnchor.y * 23.1);
        float laneNoise = mix(broadLane, fineLane, 0.34);
        float breakup = smoothstep(
          uDripPinchTime - 0.16,
          uDripPinchTime + 0.72,
          age
        );
        float laneSpeed = mix(1.0, mix(0.78, 1.16, laneNoise), uDripTurbulence);
        laneSpeed += sin(localX * 0.11 + age * 0.58)
          * 0.08 * uDripTurbulence * breakup;

        float outputDown = (uDripAnchor.y - vUv.y) * uArtSize.y;
        float verticalStretch = 1.0 + age * uDripStretch
          * mix(0.78, 1.16, broadLane);
        float sourceDown = (
          outputDown - fallDistance * laneSpeed
        ) / max(verticalStretch, 1.0);
        float lateralWarp = (
          sin(sourceDown * 0.035 + localX * 0.018 + age * 1.08)
          - sin(localX * 0.018 + age * 1.08)
        ) * 3.4 * uDripTurbulence
          * smoothstep(0.05, max(uDripPinchTime, 0.06), age);

        vec2 sourceUv = vec2(
          vUv.x - lateralWarp / uArtSize.x,
          uDripAnchor.y - sourceDown / uArtSize.y
        );

        vec2 falloffDelta = (sourceUv - uDripAnchor) * uArtSize;
        float verticalRadius = falloffDelta.y < 0.0
          ? uLightRadiusYBelow
          : uLightRadius.y;
        float verticalRatio = abs(falloffDelta.y) / max(verticalRadius, 0.001);
        float taperFloor = falloffDelta.y < 0.0
          ? uLightTaperBelow
          : uLightTaperAbove;
        float horizontalTaper = mix(
          1.0,
          taperFloor,
          smoothstep(uLightTaperStart, uLightTaperEnd, verticalRatio)
        );
        vec2 effectiveRadius = vec2(
          uLightRadius.x * horizontalTaper,
          verticalRadius
        );
        float normalizedDistance = length(
          falloffDelta / max(effectiveRadius, vec2(0.001))
        );
        float flowedLight = 1.0 - smoothstep(
          uLightFalloff,
          1.0,
          normalizedDistance
        );
        flowedLight *= smoothstep(1.04, 0.84, normalizedDistance);

        float textMask = texture2D(uText, vUv).a;
        float colorCenterMask = texture2D(uColorCenters, vUv).a;

        float densityPulse = 1.0 - breakup * uDripTurbulence * 0.12
          * (0.5 + 0.5 * sin(outputDown * 0.071 + localX * 0.043));
        float movedSurface = textMask
          * pow(max(flowedLight, 0.0), 1.22)
          * uDripStrength
          * densityPulse;
        float movedColor = colorCenterMask
          * pow(max(flowedLight, 0.0), 1.12)
          * densityPulse;
        float dripMix = clamp(uDripEnergy, 0.0, 1.0);
        surfaceActivation = mix(surfaceActivation, movedSurface, dripMix);
        colorActivation = mix(colorActivation, movedColor, dripMix);
        trail = 0.0;
      }

      gl_FragColor = vec4(
        surfaceActivation,
        history.g,
        colorActivation,
        trail
      );
    }
  `,
  uniforms: {
    uHistory: { value: historyTargetA.texture },
    uPrevious: { value: interactionTargetA.texture },
    uText: { value: textTexture },
    uColorCenters: { value: colorCenterTexture },
    uArtSize: { value: new THREE.Vector2(ART_WIDTH, ART_HEIGHT) },
    uPointer: { value: new THREE.Vector2(pointer.x, pointer.y) },
    uVelocityDirection: { value: new THREE.Vector2(1, 0) },
    uMode: { value: 1 },
    uSpeed: { value: 0 },
    uDwell: { value: 0 },
    uWakeLength: { value: state.viscousWakeLength },
    uWakeWidth: { value: state.viscousWakeWidth },
    uWakeStrength: { value: state.viscousWakeStrength },
    uTrailRetention: { value: 0 },
    uBreakup: { value: state.viscousBreakup },
    uThermalStretch: { value: state.thermalStretch },
    uThermalStrength: { value: state.thermalStrength },
    uThermalRadius: { value: new THREE.Vector2(state.thermalRadiusX, state.thermalRadiusY) },
    uDripAnchor: { value: new THREE.Vector2(dripAnchor.x, dripAnchor.y) },
    uDripAge: { value: 0 },
    uDripEnergy: { value: 0 },
    uDripGravity: { value: state.dripGravity },
    uDripStretch: { value: state.dripStretch },
    uDripTurbulence: { value: state.dripTurbulence },
    uDripStrength: { value: state.dripStrength },
    uDripPinchTime: { value: state.dripPinchTime },
    uLightRadius: { value: new THREE.Vector2(state.radiusX, state.radiusY) },
    uLightRadiusYBelow: { value: state.radiusYBelow },
    uLightFalloff: { value: state.lightFalloff },
    uLightTaperAbove: { value: state.taperAbove },
    uLightTaperBelow: { value: state.taperBelow },
    uLightTaperStart: { value: state.taperStart },
    uLightTaperEnd: { value: state.taperEnd },
    uTime: { value: 0 },
  },
  depthTest: false,
  depthWrite: false,
});

const strokeSpreadMaterial = new THREE.ShaderMaterial({
  vertexShader,
  fragmentShader: `
    precision highp float;

    varying vec2 vUv;
    uniform sampler2D uInput;
    uniform vec2 uTexel;

    void main() {
      vec4 center = texture2D(uInput, vUv);
      float textMask = center.g;
      if (textMask < 0.02) {
        gl_FragColor = vec4(0.0, textMask, 0.0, 1.0);
        return;
      }

      vec2 stepOffset = uTexel * 2.0;
      float spread = center.r;
      spread = max(spread, texture2D(uInput, vUv + vec2(stepOffset.x, 0.0)).r * 0.96);
      spread = max(spread, texture2D(uInput, vUv - vec2(stepOffset.x, 0.0)).r * 0.96);
      spread = max(spread, texture2D(uInput, vUv + vec2(0.0, stepOffset.y)).r * 0.96);
      spread = max(spread, texture2D(uInput, vUv - vec2(0.0, stepOffset.y)).r * 0.96);
      spread = max(spread, texture2D(uInput, vUv + stepOffset).r * 0.955);
      spread = max(spread, texture2D(uInput, vUv - stepOffset).r * 0.955);
      spread = max(spread, texture2D(uInput, vUv + vec2(stepOffset.x, -stepOffset.y)).r * 0.955);
      spread = max(spread, texture2D(uInput, vUv + vec2(-stepOffset.x, stepOffset.y)).r * 0.955);
      spread = max(spread, texture2D(uInput, vUv + uTexel * vec2(2.0, 1.0)).r * 0.955);
      spread = max(spread, texture2D(uInput, vUv + uTexel * vec2(2.0, -1.0)).r * 0.955);
      spread = max(spread, texture2D(uInput, vUv + uTexel * vec2(-2.0, 1.0)).r * 0.955);
      spread = max(spread, texture2D(uInput, vUv + uTexel * vec2(-2.0, -1.0)).r * 0.955);
      spread = max(spread, texture2D(uInput, vUv + uTexel * vec2(1.0, 2.0)).r * 0.955);
      spread = max(spread, texture2D(uInput, vUv + uTexel * vec2(-1.0, 2.0)).r * 0.955);
      spread = max(spread, texture2D(uInput, vUv + uTexel * vec2(1.0, -2.0)).r * 0.955);
      spread = max(spread, texture2D(uInput, vUv + uTexel * vec2(-1.0, -2.0)).r * 0.955);

      gl_FragColor = vec4(spread, textMask, 0.0, 1.0);
    }
  `,
  uniforms: {
    uInput: { value: historyTargetA.texture },
    uTexel: { value: new THREE.Vector2(1 / FIELD_WIDTH, 1 / FIELD_HEIGHT) },
  },
  depthTest: false,
  depthWrite: false,
});

const colorBlurMaterial = new THREE.ShaderMaterial({
  vertexShader,
  fragmentShader: `
    precision highp float;

    varying vec2 vUv;
    uniform sampler2D uInput;
    uniform vec2 uDirection;
    uniform float uSigma;
    uniform float uStep;
    uniform vec4 uChannel;

    void main() {
      float sigmaSquared = max(uSigma * uSigma, 0.001);
      float totalWeight = 0.0;
      float colorField = 0.0;

      for (int index = -${COLOR_BLUR_TAPS}; index <= ${COLOR_BLUR_TAPS}; index++) {
        float offsetIndex = float(index);
        float sampleDistance = offsetIndex * uStep;
        float weight = exp(-0.5 * sampleDistance * sampleDistance / sigmaSquared);
        float sampleValue = dot(
          texture2D(uInput, vUv + uDirection * sampleDistance),
          uChannel
        );
        colorField += sampleValue * weight;
        totalWeight += weight;
      }

      colorField /= max(totalWeight, 0.001);
      gl_FragColor = vec4(colorField, 0.0, 0.0, 1.0);
    }
  `,
  uniforms: {
    uInput: { value: sourceTarget.texture },
    uDirection: { value: new THREE.Vector2(1 / ART_WIDTH, 0) },
    uSigma: { value: state.colorBlurSigma },
    uStep: { value: state.colorBlurStep },
    uChannel: { value: new THREE.Vector4(0, 0, 1, 0) },
  },
  depthTest: false,
  depthWrite: false,
});

const nearestSeedMaterial = new THREE.ShaderMaterial({
  vertexShader,
  fragmentShader: `
    precision highp float;

    varying vec2 vUv;
    uniform sampler2D uActivation;
    uniform float uSeedThreshold;

    void main() {
      vec2 field = texture2D(uActivation, vUv).rg;
      float valid = step(uSeedThreshold, field.r) * step(0.18, field.g);
      gl_FragColor = valid > 0.5
        ? vec4(vUv, field.r, 1.0)
        : vec4(0.0);
    }
  `,
  uniforms: {
    uActivation: { value: historyTargetA.texture },
    uSeedThreshold: { value: state.seedThreshold },
  },
  depthTest: false,
  depthWrite: false,
});

const jumpFloodMaterial = new THREE.ShaderMaterial({
  vertexShader,
  fragmentShader: `
    precision highp float;

    varying vec2 vUv;
    uniform sampler2D uNearest;
    uniform vec2 uFieldSize;
    uniform float uJump;

    void main() {
      vec4 best = texture2D(uNearest, vUv);
      float bestDistance = best.a > 0.5
        ? dot((best.xy - vUv) * uFieldSize, (best.xy - vUv) * uFieldSize)
        : 1.0e20;

      for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
          vec2 sampleUv = vUv + vec2(float(x), float(y)) * uJump / uFieldSize;
          if (sampleUv.x >= 0.0 && sampleUv.x <= 1.0 && sampleUv.y >= 0.0 && sampleUv.y <= 1.0) {
            vec4 candidate = texture2D(uNearest, sampleUv);
            vec2 delta = (candidate.xy - vUv) * uFieldSize;
            float candidateDistance = dot(delta, delta);
            if (candidate.a > 0.5 && candidateDistance < bestDistance) {
              best = candidate;
              bestDistance = candidateDistance;
            }
          }
        }
      }

      gl_FragColor = best;
    }
  `,
  uniforms: {
    uNearest: { value: nearestTargetA.texture },
    uFieldSize: { value: new THREE.Vector2(FIELD_WIDTH, FIELD_HEIGHT) },
    uJump: { value: JFA_JUMPS[0] },
  },
  depthTest: false,
  depthWrite: false,
});

const surfaceSourceMaterial = new THREE.ShaderMaterial({
  vertexShader,
  fragmentShader: `
    precision highp float;

    varying vec2 vUv;
    uniform sampler2D uActivation;
    uniform float uInputThreshold;
    uniform float uInputSoftness;

    void main() {
      vec2 activation = texture2D(uActivation, vUv).rg;
      float detected = smoothstep(
        uInputThreshold,
        uInputThreshold + uInputSoftness,
        activation.r
      );
      // The base mode is already zero outside the text. Interaction modes may
      // deliberately stretch that activation beyond the glyph pixels.
      float sourceAlpha = activation.r * detected;
      gl_FragColor = vec4(sourceAlpha, activation.g, 0.0, 1.0);
    }
  `,
  uniforms: {
    uActivation: { value: historyTargetA.texture },
    uInputThreshold: { value: state.metaballInputThreshold },
    uInputSoftness: { value: state.metaballInputSoftness },
  },
  depthTest: false,
  depthWrite: false,
});

const surfaceBlurMaterial = new THREE.ShaderMaterial({
  vertexShader,
  fragmentShader: `
    precision highp float;

    varying vec2 vUv;
    uniform sampler2D uInput;
    uniform vec2 uArtSize;
    uniform float uBlurRadius;
    uniform float uFalloffPower;
    uniform float uSourceGain;
    uniform float uFieldGain;

    void main() {
      const float goldenAngle = 2.39996323;
      float sourceAlpha = texture2D(uInput, vUv).r;
      float weightedField = sourceAlpha;
      float totalWeight = 1.0;

      for (int index = 0; index < ${METABALL_SAMPLES}; index++) {
        float sampleRatio = (float(index) + 0.5) / float(${METABALL_SAMPLES});
        float radiusRatio = sqrt(sampleRatio);
        float angle = float(index) * goldenAngle;
        float sampleRadius = radiusRatio * uBlurRadius;
        vec2 offsetPixels = vec2(cos(angle), sin(angle)) * sampleRadius;
        vec2 sampleUv = vUv + offsetPixels / uArtSize;
        float radialWeight = pow(max(1.0 - radiusRatio, 0.0), uFalloffPower);
        weightedField += texture2D(uInput, sampleUv).r * radialWeight;
        totalWeight += radialWeight;
      }

      float metaballField = sourceAlpha * uSourceGain
        + weightedField / max(totalWeight, 0.001) * uFieldGain;
      gl_FragColor = vec4(metaballField, 0.0, 0.0, 1.0);
    }
  `,
  uniforms: {
    uInput: { value: surfaceSourceTarget.texture },
    uArtSize: { value: new THREE.Vector2(ART_WIDTH, ART_HEIGHT) },
    uBlurRadius: { value: state.metaballBlurRadius },
    uFalloffPower: { value: state.metaballFalloffPower },
    uSourceGain: { value: state.metaballSourceGain },
    uFieldGain: { value: state.metaballFieldGain },
  },
  depthTest: false,
  depthWrite: false,
});

const surfaceSmoothMaterial = new THREE.ShaderMaterial({
  vertexShader,
  fragmentShader: `
    precision highp float;

    varying vec2 vUv;
    uniform sampler2D uInput;
    uniform vec2 uDirection;
    uniform float uSigma;

    void main() {
      float sigmaSquared = max(uSigma * uSigma, 0.001);
      float totalWeight = 0.0;
      float smoothedField = 0.0;

      for (int index = -${METABALL_SMOOTH_TAPS}; index <= ${METABALL_SMOOTH_TAPS}; index++) {
        float distancePixels = float(index);
        float weight = exp(-0.5 * distancePixels * distancePixels / sigmaSquared);
        smoothedField += texture2D(
          uInput,
          vUv + uDirection * distancePixels
        ).r * weight;
        totalWeight += weight;
      }

      gl_FragColor = vec4(smoothedField / max(totalWeight, 0.001), 0.0, 0.0, 1.0);
    }
  `,
  uniforms: {
    uInput: { value: metaballRawTarget.texture },
    uDirection: { value: new THREE.Vector2(1 / FIELD_WIDTH, 0) },
    uSigma: { value: state.metaballSmoothing },
  },
  depthTest: false,
  depthWrite: false,
});

const finalMaterial = new THREE.ShaderMaterial({
  vertexShader,
  fragmentShader: `
    precision highp float;

    varying vec2 vUv;
    uniform sampler2D uText;
    uniform sampler2D uNearest;
    uniform sampler2D uColorField;
    uniform sampler2D uSurfaceField;
    uniform sampler2D uInteractionField;
    uniform vec2 uResolution;
    uniform vec2 uPosterOffset;
    uniform vec2 uPosterSize;
    uniform vec2 uArtSize;
    uniform float uSurfaceThreshold;
    uniform float uSurfaceSoftness;
    uniform float uSeedThreshold;
    uniform float uCoreRadius;
    uniform float uCoreRadiusMin;
    uniform float uCoreRadiusExponent;
    uniform float uCoreMix;
    uniform float uColorFloor;
    uniform float uColorRange;
    uniform float uHueBands;
    uniform float uTime;
    uniform float uColorCycle;
    uniform float uLabelMode;
    uniform float uInteractionMode;
    uniform float uTrailStrength;

    vec3 hsvToRgb(vec3 hsv) {
      vec3 rgb = clamp(abs(mod(hsv.x * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
      rgb = rgb * rgb * (3.0 - 2.0 * rgb);
      return hsv.z * mix(vec3(1.0), rgb, hsv.y);
    }

    float interleavedGradientNoise(vec2 pixel) {
      return fract(52.9829189 * fract(dot(pixel, vec2(0.06711056, 0.00583715))));
    }

    void main() {
      vec2 fragment = vUv * uResolution;
      vec2 artUv = (fragment - uPosterOffset) / uPosterSize;
      vec3 background = vec3(0.9843, 0.9843, 0.9804);

      if (artUv.x < 0.0 || artUv.x > 1.0 || artUv.y < 0.0 || artUv.y > 1.0) {
        gl_FragColor = vec4(background, 1.0);
        return;
      }

      float textMask = texture2D(uText, artUv).a;
      vec4 nearest = texture2D(uNearest, artUv);
      float surfaceField = texture2D(uSurfaceField, artUv).r;
      float surfaceEdge = max(uSurfaceSoftness, fwidth(surfaceField) * 1.2);
      float coverage = smoothstep(
        uSurfaceThreshold - surfaceEdge,
        uSurfaceThreshold + surfaceEdge,
        surfaceField
      );
      float directTrail = texture2D(uInteractionField, artUv).a * uTrailStrength;
      float trailEdge = max(0.018, fwidth(directTrail) * 1.15);
      float trailCoverage = smoothstep(0.045 - trailEdge, 0.115 + trailEdge, directTrail);
      float viscousMode = 1.0 - step(0.5, abs(uInteractionMode - 1.0));
      coverage = max(coverage, trailCoverage * viscousMode);
      float distanceToStroke = 16.0;

      if (nearest.a > 0.5) {
        distanceToStroke = length((artUv - nearest.xy) * uArtSize);
        float coreStrength = smoothstep(uSeedThreshold, 0.56, nearest.z);
        float coreRadius = mix(
          uCoreRadiusMin,
          uCoreRadius,
          pow(coreStrength, uCoreRadiusExponent)
        );
        float coreEdge = max(0.55, fwidth(distanceToStroke) * 0.85);
        float strokeCore = 1.0 - smoothstep(
          coreRadius - coreEdge,
          coreRadius + coreEdge,
          distanceToStroke
        );
        float coreGate = smoothstep(
          uSeedThreshold,
          uSeedThreshold + 0.015,
          nearest.z
        );
        strokeCore *= coreGate;
        coverage = max(coverage, strokeCore * uCoreMix);
      }

      if (uLabelMode > 0.5) {
        // Match the first visibly chromatic pixel, not only the 50% alpha core.
        float effectLabel = step(0.001, coverage);
        float textLabel = step(0.22, textMask) * (1.0 - effectLabel);
        vec3 semanticLabel = mix(vec3(1.0), vec3(0.5), textLabel);
        semanticLabel = mix(semanticLabel, vec3(0.0), effectLabel);
        gl_FragColor = vec4(semanticLabel, 1.0);
        return;
      }

      float visibleText = textMask * 0.92 * (1.0 - coverage);
      vec3 base = mix(background, vec3(0.155, 0.153, 0.148), visibleText);

      float cycle = max(uColorCycle, 0.1);
      float palettePhase = fract(0.84 + uTime / cycle);
      float colorField = texture2D(uColorField, artUv).r;
      float normalizedEnergy = clamp(
        (colorField - uColorFloor) / max(uColorRange, 0.001),
        0.0,
        1.0
      );
      float contourEnergy = normalizedEnergy;
      vec3 edgeRose = hsvToRgb(vec3(fract(palettePhase + 0.095), 0.80, 0.76));
      vec3 bodyRose = hsvToRgb(vec3(fract(palettePhase + 0.105), 0.62, 0.96));
      vec3 pinkMist = hsvToRgb(vec3(fract(palettePhase + 0.115), 0.22, 1.0));
      vec3 hotColor = hsvToRgb(vec3(fract(palettePhase + uHueBands), 0.86, 1.0));
      float bodyBlend = smoothstep(0.0, 0.48, contourEnergy);
      float mistBlend = smoothstep(0.16, 0.78, contourEnergy);
      float hotBlend = smoothstep(0.48, 0.98, contourEnergy);
      vec3 goo = mix(edgeRose, bodyRose, bodyBlend);
      goo = mix(goo, pinkMist, mistBlend);
      goo = mix(goo, hotColor, hotBlend);

      vec3 result = mix(base, goo, coverage);
      float dither = (interleavedGradientNoise(fragment) - 0.5) / 255.0;
      result += vec3(dither * coverage * 0.3);

      gl_FragColor = vec4(result, 1.0);
    }
  `,
  uniforms: {
    uText: { value: textTexture },
    uNearest: { value: nearestTargetA.texture },
    uColorField: { value: colorFieldTarget.texture },
    uSurfaceField: { value: surfaceFieldTarget.texture },
    uInteractionField: { value: interactionTargetA.texture },
    uResolution: { value: new THREE.Vector2(ART_WIDTH, ART_HEIGHT) },
    uPosterOffset: { value: new THREE.Vector2(0, 0) },
    uPosterSize: { value: new THREE.Vector2(ART_WIDTH, ART_HEIGHT) },
    uArtSize: { value: new THREE.Vector2(ART_WIDTH, ART_HEIGHT) },
    uSurfaceThreshold: { value: state.surfaceThreshold },
    uSurfaceSoftness: { value: state.surfaceSoftness },
    uSeedThreshold: { value: state.seedThreshold },
    uCoreRadius: { value: state.coreRadius },
    uCoreRadiusMin: { value: state.coreRadiusMin },
    uCoreRadiusExponent: { value: state.coreRadiusExponent },
    uCoreMix: { value: state.coreMix },
    uColorFloor: { value: state.colorFloor },
    uColorRange: { value: state.colorRange },
    uHueBands: { value: state.hueBands },
    uTime: { value: 0 },
    uColorCycle: { value: state.colorCycle },
    uLabelMode: { value: QA_LABEL_MODE ? 1 : 0 },
    uInteractionMode: { value: interactionModeCode(state.interactionMode) },
    uTrailStrength: { value: state.viscousWakeStrength },
  },
  depthTest: false,
  depthWrite: false,
});

const passScene = new THREE.Scene();
const passQuad = new THREE.Mesh(geometry, sourceMaterial);
passScene.add(passQuad);
let historyRead = historyTargetA;
let historyWrite = historyTargetB;
let interactionRead = interactionTargetA;
let interactionWrite = interactionTargetB;
let strokeSpreadRead = strokeSpreadTargetA;
let strokeSpreadWrite = strokeSpreadTargetB;
let nearestRead = nearestTargetA;
let nearestWrite = nearestTargetB;

function renderPass(material: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null): void {
  passQuad.material = material;
  renderer.setRenderTarget(target);
  renderer.render(passScene, camera);
}

function clearTarget(target: THREE.WebGLRenderTarget): void {
  renderer.setRenderTarget(target);
  renderer.setClearColor(0x000000, 1);
  renderer.clear();
}

clearTarget(historyTargetA);
clearTarget(historyTargetB);
clearTarget(interactionTargetA);
clearTarget(interactionTargetB);
clearTarget(strokeSpreadTargetA);
clearTarget(strokeSpreadTargetB);
clearTarget(nearestTargetA);
clearTarget(nearestTargetB);
renderer.setClearColor(0xfbfbfa, 1);
renderer.setRenderTarget(null);

function updateLayout(): void {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(width, height, false);

  const cssScale = Math.min(width / ART_WIDTH, height / ART_HEIGHT);
  const cssWidth = ART_WIDTH * cssScale;
  const cssHeight = ART_HEIGHT * cssScale;
  artworkRect = {
    left: (width - cssWidth) / 2,
    top: (height - cssHeight) / 2,
    width: cssWidth,
    height: cssHeight,
  };

  const drawingSize = new THREE.Vector2();
  renderer.getDrawingBufferSize(drawingSize);
  const drawingScale = Math.min(drawingSize.x / ART_WIDTH, drawingSize.y / ART_HEIGHT);
  const posterWidth = ART_WIDTH * drawingScale;
  const posterHeight = ART_HEIGHT * drawingScale;
  finalMaterial.uniforms.uResolution.value.set(drawingSize.x, drawingSize.y);
  finalMaterial.uniforms.uPosterOffset.value.set(
    (drawingSize.x - posterWidth) / 2,
    (drawingSize.y - posterHeight) / 2,
  );
  finalMaterial.uniforms.uPosterSize.value.set(posterWidth, posterHeight);
}

function setPointerFromClient(clientX: number, clientY: number): void {
  const x = THREE.MathUtils.clamp((clientX - artworkRect.left) / artworkRect.width, 0, 1);
  const yFromTop = THREE.MathUtils.clamp((clientY - artworkRect.top) / artworkRect.height, 0, 1);
  pointerTarget.x = x;
  pointerTarget.y = 1 - yFromTop;
}

function startDrip(): void {
  dripAnchor.x = pointerTarget.x;
  dripAnchor.y = pointerTarget.y;
  dripAge = 0;
  dripEnergy = 1;
}

if (!QA_POINTER_LOCKED) {
  window.addEventListener('pointermove', (event) => {
    setPointerFromClient(event.clientX, event.clientY);
  }, { passive: true });

  window.addEventListener('pointerdown', (event) => {
    if (event.target instanceof Element && event.target.closest('.lil-gui')) return;
    setPointerFromClient(event.clientX, event.clientY);
    if (state.interactionMode === 'drip') startDrip();
  }, { passive: true });
}

window.addEventListener('resize', updateLayout);
window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', (event) => {
  reduceMotion = event.matches;
});

function interactionModeCode(mode: InteractionMode): number {
  if (mode === 'viscous') return 1;
  if (mode === 'thermal') return 2;
  if (mode === 'drip') return 3;
  return 0;
}

function resetInteractionField(): void {
  clearTarget(interactionTargetA);
  clearTarget(interactionTargetB);
  interactionRead = interactionTargetA;
  interactionWrite = interactionTargetB;
  dwellAmount = 0;
  dripAge = Number.POSITIVE_INFINITY;
  dripEnergy = 0;
  renderer.setClearColor(0xfbfbfa, 1);
  renderer.setRenderTarget(null);
}

function bindGui(): void {
  const gui = new GUI({ title: 'Color Text controls', width: 320 });

  const interactionFolder = gui.addFolder('확장 인터랙션');
  interactionFolder.add(state, 'interactionMode', {
    '기본 작품': 'classic',
    '1 · 점성 꼬리': 'viscous',
    '2 · 체류 열꽃': 'thermal',
    '3 · 터치 드립': 'drip',
  }).name('독립 모드').onChange(resetInteractionField);
  interactionFolder.add(state, 'viscousWakeLength', 16, 120, 1).name('꼬리 길이');
  interactionFolder.add(state, 'viscousWakeWidth', 1.5, 10, 0.1).name('꼬리 폭');
  interactionFolder.add(state, 'viscousWakeStrength', 0, 1.4, 0.01).name('꼬리 장력');
  interactionFolder.add(state, 'viscousWakeRelease', 0.06, 0.8, 0.01).name('꼬리 복원 시간');
  interactionFolder.add(state, 'viscousBreakup', 0, 1, 0.01).name('방울 분리');
  interactionFolder.add(state, 'thermalStretch', 0, 1.8, 0.01).name('열꽃 세로 팽창');
  interactionFolder.add(state, 'thermalStrength', 0, 1.5, 0.01).name('열꽃 에너지');
  interactionFolder.add(state, 'dwellBuildTime', 0.1, 2, 0.01).name('열 축적 시간');
  interactionFolder.add(state, 'dwellReleaseTime', 0.05, 1, 0.01).name('열 냉각 시간');
  interactionFolder.add(state, 'dripGravity', 20, 150, 1).name('드립 중력');
  interactionFolder.add(state, 'dripStretch', 0, 1.2, 0.01).name('영역 세로 신장');
  interactionFolder.add(state, 'dripTurbulence', 0, 1.5, 0.01).name('흐름 속도 차이');
  interactionFolder.add(state, 'dripStrength', 0, 1.4, 0.01).name('Metaball 입력량');
  interactionFolder.add(state, 'dripPinchTime', 0.4, 3, 0.05).name('영역 분리 시점');
  interactionFolder.add(state, 'dripLifetime', 1.5, 7, 0.1).name('드립 수명');

  const lightFolder = gui.addFolder('광원 / Falloff');
  lightFolder.add(state, 'radiusX', 40, 260, 1).name('가로 반경').onChange((value: number) => {
    sourceMaterial.uniforms.uRadius.value.x = value;
  });
  lightFolder.add(state, 'radiusY', 40, 260, 1).name('위쪽 반경').onChange((value: number) => {
    sourceMaterial.uniforms.uRadius.value.y = value;
  });
  lightFolder.add(state, 'radiusYBelow', 40, 320, 1).name('아래쪽 반경').onChange((value: number) => {
    sourceMaterial.uniforms.uRadiusYBelow.value = value;
  });
  lightFolder.add(state, 'lightFalloff', 0.02, 0.95, 0.01).name('Falloff 시작').onChange((value: number) => {
    sourceMaterial.uniforms.uFalloff.value = value;
  });
  lightFolder.add(state, 'taperAbove', 0.15, 1, 0.01).name('위쪽 폭 비율').onChange((value: number) => {
    sourceMaterial.uniforms.uTaperAbove.value = value;
  });
  lightFolder.add(state, 'taperBelow', 0.15, 1, 0.01).name('아래쪽 폭 비율').onChange((value: number) => {
    sourceMaterial.uniforms.uTaperBelow.value = value;
  });
  lightFolder.add(state, 'taperStart', 0, 0.8, 0.01).name('폭 축소 시작').onChange((value: number) => {
    sourceMaterial.uniforms.uTaperStart.value = value;
  });
  lightFolder.add(state, 'taperEnd', 0.2, 1, 0.01).name('폭 축소 끝').onChange((value: number) => {
    sourceMaterial.uniforms.uTaperEnd.value = value;
  });

  const surfaceFolder = gui.addFolder('액체 실루엣');
  surfaceFolder.add(state, 'metaballInputThreshold', 0, 0.12, 0.0025)
    .name('입력 임계값')
    .onChange((value: number) => {
      surfaceSourceMaterial.uniforms.uInputThreshold.value = value;
    });
  surfaceFolder.add(state, 'metaballInputSoftness', 0.005, 0.12, 0.0025)
    .name('입력 부드러움')
    .onChange((value: number) => {
      surfaceSourceMaterial.uniforms.uInputSoftness.value = value;
    });
  surfaceFolder.add(state, 'metaballBlurRadius', 4, 60, 0.5)
    .name('주변 조사 반경')
    .onChange((value: number) => {
      surfaceBlurMaterial.uniforms.uBlurRadius.value = value;
    });
  surfaceFolder.add(state, 'metaballFalloffPower', 0.5, 8, 0.1)
    .name('거리 감쇠 지수')
    .onChange((value: number) => {
      surfaceBlurMaterial.uniforms.uFalloffPower.value = value;
    });
  surfaceFolder.add(state, 'metaballSourceGain', 0, 2, 0.02)
    .name('중심 픽셀 비율')
    .onChange((value: number) => {
      surfaceBlurMaterial.uniforms.uSourceGain.value = value;
    });
  surfaceFolder.add(state, 'metaballFieldGain', 0.5, 4, 0.05)
    .name('주변 field 비율')
    .onChange((value: number) => {
      surfaceBlurMaterial.uniforms.uFieldGain.value = value;
    });
  surfaceFolder.add(state, 'metaballSmoothing', 0.5, 4, 0.1)
    .name('Field smoothing')
    .onChange((value: number) => {
      surfaceSmoothMaterial.uniforms.uSigma.value = value;
    });
  surfaceFolder.add(state, 'surfaceThreshold', 0.01, 0.3, 0.0025)
    .name('실루엣 임계값')
    .onChange((value: number) => {
      finalMaterial.uniforms.uSurfaceThreshold.value = value;
    });
  surfaceFolder.add(state, 'surfaceSoftness', 0.002, 0.08, 0.002)
    .name('경계 부드러움')
    .onChange((value: number) => {
      finalMaterial.uniforms.uSurfaceSoftness.value = value;
    });

  const motionFolder = gui.addFolder('움직임 / 시간 기억');
  motionFolder.add(state, 'pointerEase', 1, 16, 0.1).name('광원 추종 속도');
  motionFolder.add(state, 'pointerMaxSpeed', 80, 720, 10).name('광원 최대 속도');
  motionFolder.add(state, 'activationAttack', 0.01, 0.3, 0.005).name('활성 Attack');
  motionFolder.add(state, 'activationRelease', 0.08, 1.2, 0.01).name('활성 Release');

  const colorFolder = gui.addFolder('색상');
  colorFolder.add(state, 'colorCenterRadiusX', 3, 20, 0.5).name('기준 타원 가로 반경').onChange(() => {
    bakeColorCenterMask();
    colorCenterTexture.needsUpdate = true;
  });
  colorFolder.add(state, 'colorCenterRadiusY', 6, 28, 0.5).name('기준 타원 세로 반경').onChange(() => {
    bakeColorCenterMask();
    colorCenterTexture.needsUpdate = true;
  });
  colorFolder.add(state, 'colorCenterVariation', 0, 1, 0.01).name('글자별 크기 차이').onChange(() => {
    bakeColorCenterMask();
    colorCenterTexture.needsUpdate = true;
  });
  colorFolder.add(state, 'colorGlyphInfluence', 0, 0.6, 0.01).name('글자 픽셀 변형');
  colorFolder.add(state, 'colorBlurSigma', 0.5, 16, 0.1).name('중심 타원 가로 blur');
  colorFolder.add(state, 'colorBlurAspect', 0.2, 3, 0.01).name('중심 타원 세로 비율');
  colorFolder.add(state, 'colorBlurStep', 0.5, 2, 0.05).name('색 blur 간격').onChange((value: number) => {
    colorBlurMaterial.uniforms.uStep.value = value;
  });
  colorFolder.add(state, 'colorFloor', 0, 0.3, 0.005).name('색 에너지 시작').onChange((value: number) => {
    finalMaterial.uniforms.uColorFloor.value = value;
  });
  colorFolder.add(state, 'colorRange', 0.1, 1, 0.01).name('색 에너지 범위').onChange((value: number) => {
    finalMaterial.uniforms.uColorRange.value = value;
  });
  colorFolder.add(state, 'hueBands', 0.1, 0.8, 0.01).name('고온 색상 간격').onChange((value: number) => {
    finalMaterial.uniforms.uHueBands.value = value;
  });
  colorFolder.add(state, 'colorCycle', 2, 20, 0.1).name('색 순환 시간').onChange((value: number) => {
    finalMaterial.uniforms.uColorCycle.value = value;
  });

  const advancedFolder = gui.addFolder('고급 설정');
  advancedFolder.add(state, 'seedThreshold', 0.01, 0.30, 0.005).name('Seed 임계값').onChange((value: number) => {
    nearestSeedMaterial.uniforms.uSeedThreshold.value = value;
    finalMaterial.uniforms.uSeedThreshold.value = value;
  });
  advancedFolder.add(state, 'coreRadius', 0.1, 8, 0.1).name('Core 반경').onChange((value: number) => {
    finalMaterial.uniforms.uCoreRadius.value = value;
  });
  advancedFolder.add(state, 'coreRadiusMin', 0.1, 5, 0.1).name('Core 최소 반경').onChange((value: number) => {
    finalMaterial.uniforms.uCoreRadiusMin.value = value;
  });
  advancedFolder.add(state, 'coreRadiusExponent', 0.1, 1.5, 0.05).name('Core 강도 지수').onChange((value: number) => {
    finalMaterial.uniforms.uCoreRadiusExponent.value = value;
  });
  advancedFolder.add(state, 'coreMix', 0, 1, 0.01).name('Core 혼합').onChange((value: number) => {
    finalMaterial.uniforms.uCoreMix.value = value;
  });

  lightFolder.close();
  surfaceFolder.close();
  motionFolder.close();
  colorFolder.close();
  advancedFolder.close();

  if (QA_MODE) gui.hide();

  window.addEventListener('keydown', (event) => {
    if (event.target instanceof HTMLInputElement) return;
    if (event.key === '1') {
      state.interactionMode = 'viscous';
      resetInteractionField();
      gui.controllersRecursive().forEach((controller) => controller.updateDisplay());
    }
    if (event.key === '2') {
      state.interactionMode = 'thermal';
      resetInteractionField();
      gui.controllersRecursive().forEach((controller) => controller.updateDisplay());
    }
    if (event.key === '3') {
      state.interactionMode = 'drip';
      resetInteractionField();
      gui.controllersRecursive().forEach((controller) => controller.updateDisplay());
    }
    if (event.key.toLowerCase() === 'g') gui.show(gui.domElement.style.display === 'none');
  });
}

bindGui();
updateLayout();

function animate(now: number): void {
  const delta = Math.min((now - previousTime) / 1000, 0.1);
  const elapsed = reduceMotion || QA_MODE ? 0 : (now - startTime) / 1000;
  previousTime = now;
  const previousPointerX = pointer.x;
  const previousPointerY = pointer.y;
  const ease = 1 - Math.exp(-state.pointerEase * delta);
  const pointerDeltaX = pointerTarget.x - pointer.x;
  const pointerDeltaY = pointerTarget.y - pointer.y;
  const distanceInArtworkPixels = Math.hypot(
    pointerDeltaX * ART_WIDTH,
    pointerDeltaY * ART_HEIGHT,
  );
  if (distanceInArtworkPixels > 0.001) {
    const easedDistance = distanceInArtworkPixels * ease;
    const cappedDistance = Math.min(easedDistance, state.pointerMaxSpeed * delta);
    const pointerStep = cappedDistance / distanceInArtworkPixels;
    pointer.x += pointerDeltaX * pointerStep;
    pointer.y += pointerDeltaY * pointerStep;
  }

  const safeDelta = Math.max(delta, 0.001);
  const frameVelocityX = (pointer.x - previousPointerX) * ART_WIDTH / safeDelta;
  const frameVelocityY = (pointer.y - previousPointerY) * ART_HEIGHT / safeDelta;
  const velocityBlend = 1 - Math.exp(-12 * delta);
  smoothedVelocityX = THREE.MathUtils.lerp(smoothedVelocityX, frameVelocityX, velocityBlend);
  smoothedVelocityY = THREE.MathUtils.lerp(smoothedVelocityY, frameVelocityY, velocityBlend);
  const speedPixels = Math.hypot(smoothedVelocityX, smoothedVelocityY);
  if (speedPixels > 0.5) {
    velocityDirection.x = smoothedVelocityX / speedPixels;
    velocityDirection.y = smoothedVelocityY / speedPixels;
  }
  interactionSpeed = THREE.MathUtils.clamp(
    speedPixels / Math.max(state.pointerMaxSpeed * 0.72, 1),
    0,
    1,
  );
  const dwellTarget = speedPixels < state.dwellSpeedThreshold ? 1 : 0;
  const dwellTime = dwellTarget > dwellAmount ? state.dwellBuildTime : state.dwellReleaseTime;
  const dwellBlend = 1 - Math.exp(-delta / Math.max(dwellTime, 0.001));
  dwellAmount = THREE.MathUtils.lerp(dwellAmount, dwellTarget, dwellBlend);

  if (QA_MODE) {
    interactionSpeed = THREE.MathUtils.clamp(qaInteractionSpeed, 0, 1);
    dwellAmount = THREE.MathUtils.clamp(qaDwellAmount, 0, 1);
    const qaVelocityLength = Math.hypot(qaVelocityX, qaVelocityY);
    if (qaVelocityLength > 0.001) {
      velocityDirection.x = qaVelocityX / qaVelocityLength;
      velocityDirection.y = qaVelocityY / qaVelocityLength;
    }
  }

  if (!QA_MODE && dripEnergy > 0) {
    dripAge += delta;
    const fadeStart = Math.max(state.dripLifetime - 0.9, 0);
    dripEnergy = 1 - THREE.MathUtils.smoothstep(
      dripAge,
      fadeStart,
      state.dripLifetime,
    );
    if (dripAge >= state.dripLifetime) dripEnergy = 0;
  }

  sourceMaterial.uniforms.uPointer.value.set(pointer.x, pointer.y);

  renderPass(sourceMaterial, sourceTarget);
  temporalMaterial.uniforms.uCurrent.value = sourceTarget.texture;
  temporalMaterial.uniforms.uHistory.value = historyRead.texture;
  temporalMaterial.uniforms.uAttackBlend.value = 1 - Math.exp(-delta / state.activationAttack);
  temporalMaterial.uniforms.uReleaseBlend.value = 1 - Math.exp(-delta / state.activationRelease);
  renderPass(temporalMaterial, historyWrite);
  [historyRead, historyWrite] = [historyWrite, historyRead];

  const renderedDripAge = QA_MODE ? qaDripAge : dripAge;
  const renderedDripEnergy = QA_MODE
    ? THREE.MathUtils.clamp(qaDripEnergy, 0, 1)
    : dripEnergy;

  interactionFieldMaterial.uniforms.uHistory.value = historyRead.texture;
  interactionFieldMaterial.uniforms.uPrevious.value = interactionRead.texture;
  interactionFieldMaterial.uniforms.uPointer.value.set(pointer.x, pointer.y);
  interactionFieldMaterial.uniforms.uVelocityDirection.value.set(
    velocityDirection.x,
    velocityDirection.y,
  );
  interactionFieldMaterial.uniforms.uMode.value = interactionModeCode(state.interactionMode);
  interactionFieldMaterial.uniforms.uSpeed.value = interactionSpeed;
  interactionFieldMaterial.uniforms.uDwell.value = dwellAmount;
  interactionFieldMaterial.uniforms.uWakeLength.value = state.viscousWakeLength;
  interactionFieldMaterial.uniforms.uWakeWidth.value = state.viscousWakeWidth;
  interactionFieldMaterial.uniforms.uWakeStrength.value = state.viscousWakeStrength;
  interactionFieldMaterial.uniforms.uTrailRetention.value = Math.exp(
    -delta / Math.max(state.viscousWakeRelease, 0.001),
  );
  interactionFieldMaterial.uniforms.uBreakup.value = state.viscousBreakup;
  interactionFieldMaterial.uniforms.uThermalStretch.value = state.thermalStretch;
  interactionFieldMaterial.uniforms.uThermalStrength.value = state.thermalStrength;
  interactionFieldMaterial.uniforms.uThermalRadius.value.set(
    state.thermalRadiusX,
    state.thermalRadiusY,
  );
  interactionFieldMaterial.uniforms.uDripAnchor.value.set(dripAnchor.x, dripAnchor.y);
  interactionFieldMaterial.uniforms.uDripAge.value = renderedDripAge;
  interactionFieldMaterial.uniforms.uDripEnergy.value = renderedDripEnergy;
  interactionFieldMaterial.uniforms.uDripGravity.value = state.dripGravity;
  interactionFieldMaterial.uniforms.uDripStretch.value = state.dripStretch;
  interactionFieldMaterial.uniforms.uDripTurbulence.value = state.dripTurbulence;
  interactionFieldMaterial.uniforms.uDripStrength.value = state.dripStrength;
  interactionFieldMaterial.uniforms.uDripPinchTime.value = state.dripPinchTime;
  interactionFieldMaterial.uniforms.uLightRadius.value.set(state.radiusX, state.radiusY);
  interactionFieldMaterial.uniforms.uLightRadiusYBelow.value = state.radiusYBelow;
  interactionFieldMaterial.uniforms.uLightFalloff.value = state.lightFalloff;
  interactionFieldMaterial.uniforms.uLightTaperAbove.value = state.taperAbove;
  interactionFieldMaterial.uniforms.uLightTaperBelow.value = state.taperBelow;
  interactionFieldMaterial.uniforms.uLightTaperStart.value = state.taperStart;
  interactionFieldMaterial.uniforms.uLightTaperEnd.value = state.taperEnd;
  interactionFieldMaterial.uniforms.uTime.value = elapsed;
  renderPass(interactionFieldMaterial, interactionWrite);
  [interactionRead, interactionWrite] = [interactionWrite, interactionRead];

  strokeSpreadRead = strokeSpreadTargetA;
  strokeSpreadWrite = strokeSpreadTargetB;
  strokeSpreadMaterial.uniforms.uInput.value = historyRead.texture;
  renderPass(strokeSpreadMaterial, strokeSpreadRead);
  for (let pass = 1; pass < STROKE_SPREAD_PASSES; pass += 1) {
    strokeSpreadMaterial.uniforms.uInput.value = strokeSpreadRead.texture;
    renderPass(strokeSpreadMaterial, strokeSpreadWrite);
    [strokeSpreadRead, strokeSpreadWrite] = [strokeSpreadWrite, strokeSpreadRead];
  }

  nearestSeedMaterial.uniforms.uActivation.value = strokeSpreadRead.texture;
  renderPass(nearestSeedMaterial, nearestTargetA);
  nearestRead = nearestTargetA;
  nearestWrite = nearestTargetB;
  for (const jump of JFA_JUMPS) {
    jumpFloodMaterial.uniforms.uNearest.value = nearestRead.texture;
    jumpFloodMaterial.uniforms.uJump.value = jump;
    renderPass(jumpFloodMaterial, nearestWrite);
    [nearestRead, nearestWrite] = [nearestWrite, nearestRead];
  }

  surfaceSourceMaterial.uniforms.uActivation.value = interactionRead.texture;
  renderPass(surfaceSourceMaterial, surfaceSourceTarget);
  surfaceBlurMaterial.uniforms.uInput.value = surfaceSourceTarget.texture;
  renderPass(surfaceBlurMaterial, metaballRawTarget);
  surfaceSmoothMaterial.uniforms.uInput.value = metaballRawTarget.texture;
  surfaceSmoothMaterial.uniforms.uDirection.value.set(1 / FIELD_WIDTH, 0);
  renderPass(surfaceSmoothMaterial, surfaceHorizontalTarget);
  surfaceSmoothMaterial.uniforms.uInput.value = surfaceHorizontalTarget.texture;
  surfaceSmoothMaterial.uniforms.uDirection.value.set(0, 1 / FIELD_HEIGHT);
  renderPass(surfaceSmoothMaterial, surfaceFieldTarget);

  const colorUsesSurfaceField = state.colorSourceMode === 2;
  colorBlurMaterial.uniforms.uInput.value = colorUsesSurfaceField
    ? surfaceFieldTarget.texture
    : interactionRead.texture;
  colorBlurMaterial.uniforms.uSigma.value = state.colorBlurSigma;
  const glyphInfluence = state.colorSourceMode === 0 ? state.colorGlyphInfluence : 0;
  colorBlurMaterial.uniforms.uChannel.value.set(
    state.colorSourceMode === 0 ? glyphInfluence : 1,
    0,
    state.colorSourceMode === 0 ? 1 - glyphInfluence : 0,
    0,
  );
  colorBlurMaterial.uniforms.uDirection.value.set(1 / FIELD_WIDTH, 0);
  renderPass(colorBlurMaterial, colorHorizontalTarget);
  colorBlurMaterial.uniforms.uInput.value = colorHorizontalTarget.texture;
  colorBlurMaterial.uniforms.uSigma.value = state.colorBlurSigma * state.colorBlurAspect;
  colorBlurMaterial.uniforms.uChannel.value.set(1, 0, 0, 0);
  colorBlurMaterial.uniforms.uDirection.value.set(0, 1 / FIELD_HEIGHT);
  renderPass(colorBlurMaterial, colorFieldTarget);

  finalMaterial.uniforms.uTime.value = elapsed;
  finalMaterial.uniforms.uNearest.value = nearestRead.texture;
  finalMaterial.uniforms.uColorField.value = colorFieldTarget.texture;
  finalMaterial.uniforms.uSurfaceField.value = surfaceFieldTarget.texture;
  finalMaterial.uniforms.uInteractionField.value = interactionRead.texture;
  finalMaterial.uniforms.uInteractionMode.value = interactionModeCode(state.interactionMode);
  finalMaterial.uniforms.uTrailStrength.value = state.viscousWakeStrength;
  renderPass(finalMaterial, null);

  requestAnimationFrame(animate);
}

requestAnimationFrame(animate);
