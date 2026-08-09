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
const DRIP_PARCEL_COUNT = 32;
const DRAG_EMISSION_DISTANCE = 8;
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
  colorEllipseInfluence: qaNumber('qaColorEllipseInfluence', 0.0),
  colorGlyphShapeStrength: qaNumber('qaColorGlyphShapeStrength', 0.68),
  colorGlyphShapeRadius: qaNumber('qaColorGlyphShapeRadius', 3.2),
  colorGlyphShapeEdge: qaNumber('qaColorGlyphShapeEdge', 1.0),
  colorBlurSigma: qaNumber('qaColorBlurSigma', 2.5),
  colorBlurAspect: qaNumber('qaColorBlurAspect', 1.1),
  colorBlurStep: qaNumber('qaColorBlurStep', 1.0),
  colorFloor: qaNumber('qaColorFloor', 0.015),
  colorRange: qaNumber('qaColorRange', 0.48),
  hueBands: qaNumber('qaHueBands', 0.31),
  colorSaturation: qaNumber('qaColorSaturation', 0.72),
  colorBrightness: qaNumber('qaColorBrightness', 0.96),
  colorPastelMix: qaNumber('qaColorPastelMix', 0.12),
  colorCycle: qaNumber('qaColorCycle', 8.0),
  dripGravity: qaNumber('qaDripGravity', 78),
  dripStretch: qaNumber('qaDripStretch', 0.34),
  dripTurbulence: qaNumber('qaDripTurbulence', 0.72),
  dripFlutter: qaNumber('qaDripFlutter', 0.3),
  dripStrength: qaNumber('qaDripStrength', 0.92),
  dripPinchTime: qaNumber('qaDripPinchTime', 1.45),
  dripStreamWidth: qaNumber('qaDripStreamWidth', 0.44),
  dripLifetime: qaNumber('qaDripLifetime', 4.0),
  dripAttack: qaNumber('qaDripAttack', 0.36),
  dripReleaseSpeed: qaNumber('qaDripReleaseSpeed', 2.0),
  dripHeadReleaseDuration: qaNumber('qaDripHeadReleaseDuration', 0.35),
  dripHeadStabilityDistance: qaNumber('qaDripHeadStabilityDistance', 34.0),
  dripParcelBlend: qaNumber('qaDripParcelBlend', 0.08),
  dripFollowEase: qaNumber('qaDripFollowEase', 13.0),
  dripEmissionInterval: qaNumber('qaDripEmissionInterval', 0.13),
  textPushDistance: qaNumber('qaTextPushDistance', 10.0),
  textSpringStiffness: qaNumber('qaTextSpringStiffness', 58.0),
  textSpringDamping: qaNumber('qaTextSpringDamping', 12.0),
  textContactPadding: qaNumber('qaTextContactPadding', 0.0),
  textMaxRotation: qaNumber('qaTextMaxRotation', 9.0),
  textRotationStiffness: qaNumber('qaTextRotationStiffness', 46.0),
  textRotationDamping: qaNumber('qaTextRotationDamping', 10.0),
};
const qaDripAge = qaNumber('qaDripAge', 1.45);
const qaDripReleaseAge = qaNumber('qaDripReleaseAge', 0);
const qaDripEnergy = qaNumber('qaDrip', 1);
const qaHasDragged = searchParams.get('qaHasDragged') === '1';

const lines = [
  'WHAT',
  'YOU TOUCH',
  'GROWS HEAVY',
  'FOR A MOMENT',
  'THEN',
  'THE LETTERS',
  'REMEMBER',
  'HOW TO',
  'FLOAT',
];
const LINE_COUNT = lines.length;
const GLYPH_SLOT_COUNT = lines.reduce((total, line) => total + line.length, 0);
const FIRST_LINE_Y = 132;
const LINE_HEIGHT = 42.2;
const CHARACTER_ADVANCE = 31.8;

type Pointer = { x: number; y: number };

const initialPointer = {
  x: QA_POINTER_LOCKED ? THREE.MathUtils.clamp(qaPointerX, 0, 1) : 0.37,
  y: QA_POINTER_LOCKED ? THREE.MathUtils.clamp(qaPointerY, 0, 1) : 0.52,
};
const pointerTarget: Pointer = { ...initialPointer };
const dripEmitter: Pointer = { ...initialPointer };
const dripDragEmission: Pointer = { ...initialPointer };
const dripHeadOrigin: Pointer = { ...initialPointer };
type DripParcel = {
  x: number;
  y: number;
  age: number;
  lifeAge: number;
  delayedBirth: boolean;
  released: boolean;
};
const dripParcels: DripParcel[] = [];
const dripUniformOrigins = Array.from(
  { length: DRIP_PARCEL_COUNT },
  () => new THREE.Vector2(-2, -2),
);
const dripUniformAges = new Float32Array(DRIP_PARCEL_COUNT);
const dripUniformLifeAges = new Float32Array(DRIP_PARCEL_COUNT);
const dripUniformInstantBirths = new Float32Array(DRIP_PARCEL_COUNT);
const dripUniformWeights = new Float32Array(DRIP_PARCEL_COUNT);
let dripEmissionElapsed = 0;
let dripHeld = false;
let dripHasDragged = false;
let dripHeadAge = 0;
let dripHeadReleaseAge = Number.POSITIVE_INFINITY;
let dripHeadReleaseStrength = 0;
let activeDripPointerId: number | null = null;
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

const glyphSpringCells: THREE.Vector4[] = [];
const lineLayouts: THREE.Vector4[] = [];
let measuredGlyphIndex = 0;
let glyphSlotOffset = 0;

lines.forEach((line, lineIndex) => {
  const startX = ART_WIDTH / 2 - ((line.length - 1) * CHARACTER_ADVANCE) / 2;
  const centerY = FIRST_LINE_Y + lineIndex * LINE_HEIGHT;
  lineLayouts.push(new THREE.Vector4(
    startX,
    1 - centerY / ART_HEIGHT,
    line.length,
    glyphSlotOffset,
  ));

  for (let characterIndex = 0; characterIndex < line.length; characterIndex += 1) {
    const centerX = startX + characterIndex * CHARACTER_ADVANCE;
    if (line[characterIndex] === ' ') {
      glyphSpringCells.push(new THREE.Vector4(
        centerX / ART_WIDTH,
        1 - centerY / ART_HEIGHT,
        0,
        0,
      ));
      continue;
    }

    const stats = glyphCenterStats[measuredGlyphIndex];
    measuredGlyphIndex += 1;
    glyphSpringCells.push(new THREE.Vector4(
      stats.centroidX / ART_WIDTH,
      1 - stats.centroidY / ART_HEIGHT,
      stats.width * 0.5 / ART_WIDTH,
      stats.height * 0.5 / ART_HEIGHT,
    ));
  }

  glyphSlotOffset += line.length;
});

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

const interactionTarget = new THREE.WebGLRenderTarget(FIELD_WIDTH, FIELD_HEIGHT, linearTargetOptions);
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
const glyphSpringTargetA = new THREE.WebGLRenderTarget(
  GLYPH_SLOT_COUNT,
  1,
  nearestTargetOptions,
);
const glyphSpringTargetB = new THREE.WebGLRenderTarget(
  GLYPH_SLOT_COUNT,
  1,
  nearestTargetOptions,
);
const deformedTextTarget = new THREE.WebGLRenderTarget(
  ART_WIDTH * TEXTURE_SCALE,
  ART_HEIGHT * TEXTURE_SCALE,
  {
    ...linearTargetOptions,
    type: THREE.UnsignedByteType,
  },
);
const deformedColorCenterTarget = new THREE.WebGLRenderTarget(
  FIELD_WIDTH,
  FIELD_HEIGHT,
  linearTargetOptions,
);

const deformedGlyphMaterial = new THREE.ShaderMaterial({
  vertexShader,
  fragmentShader: `
    precision highp float;

    varying vec2 vUv;
    uniform sampler2D uSource;
    uniform sampler2D uGlyphSprings;
    uniform vec2 uArtSize;
    uniform vec4 uLineLayouts[${LINE_COUNT}];
    uniform float uCharacterAdvance;
    uniform float uLineHalfHeight;

    vec2 rotateVector(vec2 value, float angle) {
      float cosine = cos(angle);
      float sine = sin(angle);
      return vec2(
        value.x * cosine - value.y * sine,
        value.x * sine + value.y * cosine
      );
    }

    void main() {
      float deformedMask = 0.0;
      float outputX = vUv.x * uArtSize.x;

      for (int lineIndex = 0; lineIndex < ${LINE_COUNT}; lineIndex += 1) {
        vec4 lineLayout = uLineLayouts[lineIndex];
        float characterPosition = floor(
          (outputX - lineLayout.x) / uCharacterAdvance + 0.5
        );
        float validCharacter = step(0.0, characterPosition)
          * step(characterPosition, lineLayout.z - 1.0);
        float safeCharacter = clamp(
          characterPosition,
          0.0,
          lineLayout.z - 1.0
        );
        float glyphSlot = lineLayout.w + safeCharacter;
        vec4 springState = texture2D(
          uGlyphSprings,
          vec2((glyphSlot + 0.5) / ${GLYPH_SLOT_COUNT}.0, 0.5)
        );
        vec2 originalCenter = vec2(
          (lineLayout.x + safeCharacter * uCharacterAdvance) / uArtSize.x,
          lineLayout.y
        );
        vec2 movedCenter = originalCenter
          - vec2(0.0, springState.r / uArtSize.y);
        vec2 outputDelta = (vUv - movedCenter) * uArtSize;
        vec2 sourceDelta = rotateVector(outputDelta, -springState.b);
        vec2 sourceUv = originalCenter + sourceDelta / uArtSize;

        float horizontalGate = 1.0 - smoothstep(
          uCharacterAdvance * 0.5 - 0.75,
          uCharacterAdvance * 0.5 + 0.75,
          abs(sourceDelta.x)
        );
        float verticalGate = 1.0 - smoothstep(
          uLineHalfHeight - 0.75,
          uLineHalfHeight + 0.75,
          abs(sourceDelta.y)
        );
        float sourceMask = texture2D(
          uSource,
          clamp(sourceUv, vec2(0.0), vec2(1.0))
        ).a;
        deformedMask = max(
          deformedMask,
          sourceMask * validCharacter * horizontalGate * verticalGate
        );
      }

      gl_FragColor = vec4(deformedMask);
    }
  `,
  uniforms: {
    uSource: { value: textTexture },
    uGlyphSprings: { value: glyphSpringTargetA.texture },
    uArtSize: { value: new THREE.Vector2(ART_WIDTH, ART_HEIGHT) },
    uLineLayouts: { value: lineLayouts },
    uCharacterAdvance: { value: CHARACTER_ADVANCE },
    uLineHalfHeight: { value: LINE_HEIGHT * 0.5 },
  },
  depthTest: false,
  depthWrite: false,
});

const interactionFieldMaterial = new THREE.ShaderMaterial({
  vertexShader,
  fragmentShader: `
    precision highp float;

    varying vec2 vUv;
    uniform sampler2D uText;
    uniform sampler2D uColorCenters;
    uniform vec2 uArtSize;
    uniform vec2 uDripOrigins[${DRIP_PARCEL_COUNT}];
    uniform float uDripAges[${DRIP_PARCEL_COUNT}];
    uniform float uDripLifeAges[${DRIP_PARCEL_COUNT}];
    uniform float uDripInstantBirths[${DRIP_PARCEL_COUNT}];
    uniform float uDripWeights[${DRIP_PARCEL_COUNT}];
    uniform vec2 uDripHeadOrigin;
    uniform float uDripHeadWeight;
    uniform float uDripHeadStabilityDistance;
    uniform float uDripParcelBlend;
    uniform float uDripGravity;
    uniform float uDripStretch;
    uniform float uDripTurbulence;
    uniform float uDripFlutter;
    uniform float uDripStrength;
    uniform float uDripPinchTime;
    uniform float uDripStreamWidth;
    uniform float uDripLifetime;
    uniform float uDripAttack;
    uniform vec2 uLightRadius;
    uniform float uLightRadiusYBelow;
    uniform float uLightFalloff;
    uniform float uLightTaperAbove;
    uniform float uLightTaperBelow;
    uniform float uLightTaperStart;
    uniform float uLightTaperEnd;
    uniform float uTime;

    float flowedFalloffAtAge(
      vec2 outputUv,
      float parcelAge,
      float parcelLifeAge,
      vec2 parcelOrigin,
      float parcelWeight,
      float parcelInstantBirth
    ) {
      float fallDistance = min(
        18.0 * parcelAge + 0.5 * uDripGravity * parcelAge * parcelAge,
        uArtSize.y * 0.82
      );
      float localX = (outputUv.x - parcelOrigin.x) * uArtSize.x;
      float broadLane = 0.5 + 0.5 * sin(
        localX * 0.052 + parcelOrigin.x * 19.7
      );
      float fineLane = 0.5 + 0.5 * sin(
        localX * 0.137 - parcelOrigin.y * 23.1
      );
      float laneNoise = mix(broadLane, fineLane, 0.34);
      float formation = smoothstep(
        uDripPinchTime * 0.12,
        max(uDripPinchTime, 0.16),
        parcelAge
      );
      float flutter = clamp(uDripFlutter, 0.0, 1.5);
      float laneSpeed = mix(
        1.0,
        mix(0.78, 1.16, laneNoise),
        uDripTurbulence * formation
      );
      laneSpeed += sin(localX * 0.11 + parcelAge * 0.58)
        * 0.08 * uDripTurbulence * formation * flutter;

      float outputDown = (parcelOrigin.y - outputUv.y) * uArtSize.y;
      float verticalStretch = 1.0 + parcelAge * uDripStretch
        * mix(0.78, 1.16, broadLane);
      float sourceDown = (
        outputDown - fallDistance * laneSpeed
      ) / max(verticalStretch, 1.0);
      float lateralWarp = (
        sin(
          sourceDown * 0.035
          + localX * 0.018
          + parcelAge * 1.08
          + uTime * 0.22
        )
        - sin(localX * 0.018 + parcelAge * 1.08 + uTime * 0.22)
      ) * 4.2 * uDripTurbulence * formation
        * mix(0.6, 1.0, min(flutter, 1.0));
      float centerMeander = (
        sin(parcelAge * 1.76 + parcelOrigin.x * 11.3)
        + 0.42 * flutter * sin(parcelAge * 4.15 - uTime * 0.55)
      ) * 7.5 * uDripTurbulence * formation;

      vec2 sourceUv = vec2(
        outputUv.x - (lateralWarp + centerMeander) / uArtSize.x,
        parcelOrigin.y - sourceDown / uArtSize.y
      );
      vec2 falloffDelta = (sourceUv - parcelOrigin) * uArtSize;
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

      float travelingNeck = 0.89 + 0.11 * flutter
        * sin(parcelAge * 7.1 - uTime * 3.4 + localX * 0.015);
      float normalizedAge = parcelAge / max(uDripLifetime, 0.001);
      float headBulge = 1.0 + 0.38 * smoothstep(0.68, 0.96, normalizedAge);
      float streamWidth = mix(
        1.0,
        uDripStreamWidth * travelingNeck * headBulge,
        formation
      );
      vec2 effectiveRadius = vec2(
        uLightRadius.x * horizontalTaper * streamWidth,
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
      float flowGate = smoothstep(
        max(uDripHeadStabilityDistance * 0.25, 1.0),
        max(uDripHeadStabilityDistance, 2.0),
        outputDown
      );
      float lifeFade = 1.0 - smoothstep(
        max(uDripLifetime - 0.9, 0.0),
        uDripLifetime,
        parcelLifeAge
      );
      float birthEnergy = 1.0 - exp(
        -parcelAge / max(uDripAttack, 0.001)
      );
      float birthFade = mix(
        birthEnergy * birthEnergy,
        1.0,
        step(0.5, parcelInstantBirth)
      );
      float flowMaturity = smoothstep(
        uDripPinchTime - 0.16,
        uDripPinchTime + 0.72,
        parcelAge
      );
      float densityOscillation = max(
        1.0
          + flutter
          * sin(outputDown * 0.071 + localX * 0.043 - uTime * 2.6),
        0.0
      );
      float densityPulse = 1.0 - flowMaturity * uDripTurbulence * 0.08
        * densityOscillation;
      return flowedLight
        * flowGate
        * lifeFade
        * birthFade
        * densityPulse
        * clamp(parcelWeight, 0.0, 1.0)
        * step(parcelLifeAge, uDripLifetime);
    }

    float stationaryHeadFalloff(vec2 outputUv) {
      vec2 falloffDelta = (outputUv - uDripHeadOrigin) * uArtSize;
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
      float headLight = 1.0 - smoothstep(
        uLightFalloff,
        1.0,
        normalizedDistance
      );
      headLight *= smoothstep(1.04, 0.84, normalizedDistance);
      return headLight * clamp(uDripHeadWeight, 0.0, 1.0);
    }

    void main() {
      float strongestLight = stationaryHeadFalloff(vUv);
      float secondLight = 0.0;
      for (int sampleIndex = 0; sampleIndex < ${DRIP_PARCEL_COUNT}; sampleIndex += 1) {
        float parcelLight = flowedFalloffAtAge(
          vUv,
          uDripAges[sampleIndex],
          uDripLifeAges[sampleIndex],
          uDripOrigins[sampleIndex],
          uDripWeights[sampleIndex],
          uDripInstantBirths[sampleIndex]
        );
        if (parcelLight > strongestLight) {
          secondLight = strongestLight;
          strongestLight = parcelLight;
        } else {
          secondLight = max(secondLight, parcelLight);
        }
      }
      float winnerGap = strongestLight - secondLight;
      float winnerBlend = smoothstep(
        0.0,
        max(uDripParcelBlend, 0.001),
        winnerGap
      );
      float streamLight = strongestLight;
      if (secondLight > 0.0001) {
        streamLight = mix(
          (strongestLight + secondLight) * 0.5,
          strongestLight,
          winnerBlend
        );
      }

      float textMask = texture2D(uText, vUv).a;
      float colorCenterMask = texture2D(uColorCenters, vUv).a;

      float surfaceActivation = textMask
        * pow(max(streamLight, 0.0), 1.22)
        * uDripStrength;
      float colorActivation = colorCenterMask
        * pow(max(streamLight, 0.0), 1.12);

      gl_FragColor = vec4(
        surfaceActivation,
        textMask,
        colorActivation,
        1.0
      );
    }
  `,
  uniforms: {
    uText: { value: deformedTextTarget.texture },
    uColorCenters: { value: deformedColorCenterTarget.texture },
    uArtSize: { value: new THREE.Vector2(ART_WIDTH, ART_HEIGHT) },
    uDripOrigins: { value: dripUniformOrigins },
    uDripAges: { value: dripUniformAges },
    uDripLifeAges: { value: dripUniformLifeAges },
    uDripInstantBirths: { value: dripUniformInstantBirths },
    uDripWeights: { value: dripUniformWeights },
    uDripHeadOrigin: { value: new THREE.Vector2(initialPointer.x, initialPointer.y) },
    uDripHeadWeight: { value: 0 },
    uDripHeadStabilityDistance: { value: state.dripHeadStabilityDistance },
    uDripParcelBlend: { value: state.dripParcelBlend },
    uDripGravity: { value: state.dripGravity },
    uDripStretch: { value: state.dripStretch },
    uDripTurbulence: { value: state.dripTurbulence },
    uDripFlutter: { value: state.dripFlutter },
    uDripStrength: { value: state.dripStrength },
    uDripPinchTime: { value: state.dripPinchTime },
    uDripStreamWidth: { value: state.dripStreamWidth },
    uDripLifetime: { value: state.dripLifetime },
    uDripAttack: { value: state.dripAttack },
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
    uInput: { value: interactionTarget.texture },
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
    uInput: { value: interactionTarget.texture },
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
    uActivation: { value: interactionTarget.texture },
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
      // The touch-drip stage is already zero outside the text mask.
      float sourceAlpha = activation.r * detected;
      gl_FragColor = vec4(sourceAlpha, activation.g, 0.0, 1.0);
    }
  `,
  uniforms: {
    uActivation: { value: interactionTarget.texture },
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

const glyphSpringMaterial = new THREE.ShaderMaterial({
  vertexShader,
  fragmentShader: `
    precision highp float;

    varying vec2 vUv;
    uniform sampler2D uPrevious;
    uniform sampler2D uSurfaceField;
    uniform sampler2D uText;
    uniform vec4 uGlyphCells[${GLYPH_SLOT_COUNT}];
    uniform vec2 uArtSize;
    uniform float uDelta;
    uniform float uSurfaceThreshold;
    uniform float uSurfaceSoftness;
    uniform float uMaxDistance;
    uniform float uStiffness;
    uniform float uDamping;
    uniform float uContactPadding;
    uniform float uMaxRotation;
    uniform float uRotationStiffness;
    uniform float uRotationDamping;
    uniform float uQaMode;

    float contactAt(vec2 uv) {
      vec2 safeUv = clamp(uv, vec2(0.0), vec2(1.0));
      float surfaceField = texture2D(
        uSurfaceField,
        safeUv
      ).r;
      float textMask = texture2D(uText, safeUv).a;
      float visibleSurface = smoothstep(
        uSurfaceThreshold,
        uSurfaceThreshold + max(uSurfaceSoftness, 0.002),
        surfaceField
      );
      float visibleInk = smoothstep(0.08, 0.32, textMask);
      return visibleSurface * visibleInk;
    }

    vec2 rotateVector(vec2 value, float angle) {
      float cosine = cos(angle);
      float sine = sin(angle);
      return vec2(
        value.x * cosine - value.y * sine,
        value.x * sine + value.y * cosine
      );
    }

    void main() {
      float slotIndex = floor(vUv.x * ${GLYPH_SLOT_COUNT}.0);
      vec4 cell = vec4(0.0);
      for (int index = 0; index < ${GLYPH_SLOT_COUNT}; index += 1) {
        float selected = 1.0 - step(
          0.5,
          abs(slotIndex - float(index))
        );
        cell += uGlyphCells[index] * selected;
      }

      vec4 previous = texture2D(uPrevious, vUv);
      float offset = previous.r;
      float velocity = previous.g;
      float angle = previous.b;
      float angularVelocity = previous.a;
      float glyphPresent = step(0.00001, cell.z);
      vec2 padding = vec2(uContactPadding) / uArtSize;
      vec2 halfSize = cell.zw + padding;
      vec2 center = cell.xy - vec2(0.0, offset / uArtSize.y);
      float contact = 0.0;
      float leftContact = 0.0;
      float rightContact = 0.0;

      for (int gridY = 0; gridY < 9; gridY += 1) {
        for (int gridX = 0; gridX < 9; gridX += 1) {
          vec2 gridPosition = vec2(
            float(gridX) / 8.0 * 2.0 - 1.0,
            float(gridY) / 8.0 * 2.0 - 1.0
          ) * 0.92;
          vec2 localSample = gridPosition * halfSize;
          vec2 sampleUv = center + rotateVector(localSample, angle);
          float sampleContact = contactAt(sampleUv) * glyphPresent;
          contact = max(contact, sampleContact);
          if (gridX < 4) {
            leftContact = max(leftContact, sampleContact);
          }
          if (gridX > 4) {
            rightContact = max(rightContact, sampleContact);
          }
        }
      }

      float sideContact = max(leftContact, rightContact);
      float pressureDifference = clamp(
        (leftContact - rightContact) / max(sideContact, 0.001),
        -1.0,
        1.0
      );
      float targetAngle = pressureDifference * sideContact * uMaxRotation;

      if (uQaMode > 0.5) {
        offset = contact * uMaxDistance;
        velocity = 0.0;
        angle = targetAngle;
        angularVelocity = 0.0;
      } else {
        float timeStep = min(max(uDelta, 0.0), 1.0 / 30.0);
        float targetOffset = contact * uMaxDistance;
        float acceleration = (targetOffset - offset) * uStiffness
          - velocity * uDamping;
        velocity += acceleration * timeStep;
        offset += velocity * timeStep;
        float angularAcceleration = (targetAngle - angle) * uRotationStiffness
          - angularVelocity * uRotationDamping;
        angularVelocity += angularAcceleration * timeStep;
        angle += angularVelocity * timeStep;

        float minimumOffset = -uMaxDistance * 0.14;
        float maximumOffset = uMaxDistance * 1.16;
        if (offset < minimumOffset) {
          offset = minimumOffset;
          velocity = max(velocity, 0.0);
        }
        if (offset > maximumOffset) {
          offset = maximumOffset;
          velocity = min(velocity, 0.0);
        }
        float maximumAngle = uMaxRotation * 1.18;
        if (angle < -maximumAngle) {
          angle = -maximumAngle;
          angularVelocity = max(angularVelocity, 0.0);
        }
        if (angle > maximumAngle) {
          angle = maximumAngle;
          angularVelocity = min(angularVelocity, 0.0);
        }
      }

      gl_FragColor = vec4(offset, velocity, angle, angularVelocity);
    }
  `,
  uniforms: {
    uPrevious: { value: glyphSpringTargetA.texture },
    uSurfaceField: { value: surfaceFieldTarget.texture },
    uText: { value: deformedTextTarget.texture },
    uGlyphCells: { value: glyphSpringCells },
    uArtSize: { value: new THREE.Vector2(ART_WIDTH, ART_HEIGHT) },
    uDelta: { value: 0 },
    uSurfaceThreshold: { value: state.surfaceThreshold },
    uSurfaceSoftness: { value: state.surfaceSoftness },
    uMaxDistance: { value: state.textPushDistance },
    uStiffness: { value: state.textSpringStiffness },
    uDamping: { value: state.textSpringDamping },
    uContactPadding: { value: state.textContactPadding },
    uMaxRotation: { value: THREE.MathUtils.degToRad(state.textMaxRotation) },
    uRotationStiffness: { value: state.textRotationStiffness },
    uRotationDamping: { value: state.textRotationDamping },
    uQaMode: { value: QA_MODE ? 1 : 0 },
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
    uniform float uColorSaturation;
    uniform float uColorBrightness;
    uniform float uColorPastelMix;
    uniform float uColorEllipseInfluence;
    uniform float uColorGlyphShapeStrength;
    uniform float uColorGlyphShapeRadius;
    uniform float uColorGlyphShapeEdge;
    uniform float uTime;
    uniform float uColorCycle;
    uniform float uLabelMode;

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

      vec4 nearest = texture2D(uNearest, artUv);
      float surfaceField = texture2D(uSurfaceField, artUv).r;
      float surfaceEdge = max(uSurfaceSoftness, fwidth(surfaceField) * 1.2);
      float coverage = smoothstep(
        uSurfaceThreshold - surfaceEdge,
        uSurfaceThreshold + surfaceEdge,
        surfaceField
      );
      float distanceToStroke = 16.0;
      float activeStrokeStrength = 0.0;

      if (nearest.a > 0.5) {
        distanceToStroke = length((artUv - nearest.xy) * uArtSize);
        float coreStrength = smoothstep(uSeedThreshold, 0.56, nearest.z);
        activeStrokeStrength = smoothstep(
          uSeedThreshold,
          uSeedThreshold + 0.10,
          nearest.z
        );
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

      float textMask = texture2D(uText, artUv).a;

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
      float glyphRadius = max(uColorGlyphShapeRadius, 0.1);
      float glyphEdge = min(
        max(uColorGlyphShapeEdge, 0.05),
        glyphRadius * 0.9
      );
      float glyphShapeEnergy = (
        1.0 - smoothstep(
          glyphRadius - glyphEdge,
          glyphRadius + glyphEdge,
          distanceToStroke
        )
      ) * activeStrokeStrength;
      float shapedEllipseEnergy = normalizedEnergy * clamp(
        uColorEllipseInfluence,
        0.0,
        1.0
      );
      normalizedEnergy = max(
        shapedEllipseEnergy,
        glyphShapeEnergy * uColorGlyphShapeStrength
      );
      float contourEnergy = normalizedEnergy;
      float saturation = clamp(uColorSaturation, 0.0, 1.4);
      float brightness = clamp(uColorBrightness, 0.5, 1.1);
      vec3 edgeRose = hsvToRgb(vec3(
        fract(palettePhase + 0.095),
        0.80 * saturation,
        0.76 * brightness
      ));
      vec3 bodyRose = hsvToRgb(vec3(
        fract(palettePhase + 0.105),
        0.62 * saturation,
        0.96 * brightness
      ));
      vec3 pinkMist = hsvToRgb(vec3(
        fract(palettePhase + 0.115),
        0.22 * saturation,
        min(1.0, brightness)
      ));
      vec3 hotColor = hsvToRgb(vec3(
        fract(palettePhase + uHueBands),
        0.86 * saturation,
        min(1.0, brightness)
      ));
      float bodyBlend = smoothstep(0.0, 0.48, contourEnergy);
      float mistBlend = smoothstep(0.16, 0.78, contourEnergy);
      float hotBlend = smoothstep(0.48, 0.98, contourEnergy);
      vec3 goo = mix(edgeRose, bodyRose, bodyBlend);
      goo = mix(goo, pinkMist, mistBlend);
      goo = mix(goo, hotColor, hotBlend);
      float pastelAmount = clamp(uColorPastelMix, 0.0, 0.5)
        * mix(0.65, 1.0, hotBlend);
      goo = mix(goo, vec3(1.0, 0.955, 0.935), pastelAmount);

      vec3 result = mix(base, goo, coverage);
      float dither = (interleavedGradientNoise(fragment) - 0.5) / 255.0;
      result += vec3(dither * coverage * 0.3);

      gl_FragColor = vec4(result, 1.0);
    }
  `,
  uniforms: {
    uText: { value: deformedTextTarget.texture },
    uNearest: { value: nearestTargetA.texture },
    uColorField: { value: colorFieldTarget.texture },
    uSurfaceField: { value: surfaceFieldTarget.texture },
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
    uColorSaturation: { value: state.colorSaturation },
    uColorBrightness: { value: state.colorBrightness },
    uColorPastelMix: { value: state.colorPastelMix },
    uColorEllipseInfluence: { value: state.colorEllipseInfluence },
    uColorGlyphShapeStrength: { value: state.colorGlyphShapeStrength },
    uColorGlyphShapeRadius: { value: state.colorGlyphShapeRadius },
    uColorGlyphShapeEdge: { value: state.colorGlyphShapeEdge },
    uTime: { value: 0 },
    uColorCycle: { value: state.colorCycle },
    uLabelMode: { value: QA_LABEL_MODE ? 1 : 0 },
  },
  depthTest: false,
  depthWrite: false,
});

const passScene = new THREE.Scene();
const passQuad = new THREE.Mesh(geometry, interactionFieldMaterial);
passScene.add(passQuad);
let strokeSpreadRead = strokeSpreadTargetA;
let strokeSpreadWrite = strokeSpreadTargetB;
let nearestRead = nearestTargetA;
let nearestWrite = nearestTargetB;
let glyphSpringRead = glyphSpringTargetA;
let glyphSpringWrite = glyphSpringTargetB;

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

function clearSpringTarget(target: THREE.WebGLRenderTarget): void {
  renderer.setRenderTarget(target);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
}

clearTarget(interactionTarget);
clearTarget(strokeSpreadTargetA);
clearTarget(strokeSpreadTargetB);
clearTarget(nearestTargetA);
clearTarget(nearestTargetB);
clearSpringTarget(glyphSpringTargetA);
clearSpringTarget(glyphSpringTargetB);
clearTarget(deformedTextTarget);
clearTarget(deformedColorCenterTarget);
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

function emitDripParcel(
  x: number,
  y: number,
  age = 0,
  delayedBirth = false,
): void {
  if (dripParcels.length >= DRIP_PARCEL_COUNT) dripParcels.shift();
  dripParcels.push({
    x,
    y,
    age,
    lifeAge: age,
    delayedBirth,
    released: false,
  });
}

function getDripHeadAttackStrength(age: number, instant: boolean): number {
  if (instant) return 1;
  const energy = 1 - Math.exp(-age / Math.max(state.dripAttack, 0.001));
  return energy * energy;
}

function startDrip(pointerId: number): void {
  dripEmitter.x = pointerTarget.x;
  dripEmitter.y = pointerTarget.y;
  dripDragEmission.x = pointerTarget.x;
  dripDragEmission.y = pointerTarget.y;
  dripHeadOrigin.x = pointerTarget.x;
  dripHeadOrigin.y = pointerTarget.y;
  dripEmissionElapsed = 0;
  dripHeld = true;
  dripHasDragged = false;
  dripHeadAge = 0;
  dripHeadReleaseAge = 0;
  dripHeadReleaseStrength = 0;
  activeDripPointerId = pointerId;
  emitDripParcel(dripEmitter.x, dripEmitter.y, 0, true);
}

function stopDrip(pointerId: number): void {
  if (pointerId !== activeDripPointerId) return;
  const latestParcel = dripParcels[dripParcels.length - 1];
  const finalTravel = latestParcel
    ? Math.hypot(
      (pointerTarget.x - latestParcel.x) * ART_WIDTH,
      (pointerTarget.y - latestParcel.y) * ART_HEIGHT,
    )
    : Number.POSITIVE_INFINITY;
  if (finalTravel > 6) {
    emitDripParcel(pointerTarget.x, pointerTarget.y, 0, !dripHasDragged);
  }
  dripHeadReleaseStrength = getDripHeadAttackStrength(
    dripHeadAge,
    dripHasDragged,
  );
  dripHeadReleaseAge = 0;
  for (const parcel of dripParcels) parcel.released = true;
  dripHeld = false;
  dripEmissionElapsed = 0;
  activeDripPointerId = null;
}

if (!QA_POINTER_LOCKED) {
  canvas.addEventListener('pointermove', (event) => {
    if (!event.isPrimary) return;
    if (activeDripPointerId !== null && event.pointerId !== activeDripPointerId) return;
    if (activeDripPointerId !== null) event.preventDefault();
    setPointerFromClient(event.clientX, event.clientY);
    if (activeDripPointerId !== null) {
      dripHeadOrigin.x = pointerTarget.x;
      dripHeadOrigin.y = pointerTarget.y;
      const dragTravel = Math.hypot(
        (pointerTarget.x - dripDragEmission.x) * ART_WIDTH,
        (pointerTarget.y - dripDragEmission.y) * ART_HEIGHT,
      );
      if (dragTravel >= DRAG_EMISSION_DISTANCE) {
        dripHasDragged = true;
        emitDripParcel(pointerTarget.x, pointerTarget.y);
        dripDragEmission.x = pointerTarget.x;
        dripDragEmission.y = pointerTarget.y;
      }
    }
  }, { passive: false });

  canvas.addEventListener('pointerdown', (event) => {
    if (!event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    setPointerFromClient(event.clientX, event.clientY);
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      // Some synthetic or embedded pointer surfaces cannot grant capture.
      // The drip should still start and keep working while events arrive.
    }
    startDrip(event.pointerId);
  }, { passive: false });

  canvas.addEventListener('pointerup', (event) => {
    if (event.pointerId === activeDripPointerId) event.preventDefault();
    stopDrip(event.pointerId);
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  }, { passive: false });

  canvas.addEventListener('pointercancel', (event) => {
    stopDrip(event.pointerId);
  }, { passive: true });

  canvas.addEventListener('lostpointercapture', (event) => {
    stopDrip(event.pointerId);
  }, { passive: true });

  const preventNativeTouchAction = (event: Event): void => event.preventDefault();
  canvas.addEventListener('contextmenu', preventNativeTouchAction);
  canvas.addEventListener('selectstart', preventNativeTouchAction);
  canvas.addEventListener('dragstart', preventNativeTouchAction);
}

window.addEventListener('resize', updateLayout);
window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', (event) => {
  reduceMotion = event.matches;
});

function bindGui(): void {
  const gui = new GUI({ title: 'Color Text controls', width: 320 });

  const interactionFolder = gui.addFolder('터치 드립');
  interactionFolder.add(state, 'dripGravity', 20, 150, 1).name('드립 중력');
  interactionFolder.add(state, 'dripStretch', 0, 1.2, 0.01).name('영역 세로 신장');
  interactionFolder.add(state, 'dripTurbulence', 0, 1.5, 0.01).name('흐름 속도 차이');
  interactionFolder.add(state, 'dripFlutter', 0, 1.5, 0.01).name('하단 잔물결 양');
  interactionFolder.add(state, 'dripStrength', 0, 1.4, 0.01).name('Metaball 입력량');
  interactionFolder.add(state, 'dripPinchTime', 0.4, 3, 0.05).name('흐름 형성 시간');
  interactionFolder.add(state, 'dripStreamWidth', 0.18, 1, 0.01).name('흐르는 영역 폭');
  interactionFolder.add(state, 'dripLifetime', 1.5, 7, 0.1).name('방출 조각 수명');
  interactionFolder.add(state, 'dripAttack', 0.05, 0.6, 0.01).name('터치 시작 시간');
  interactionFolder.add(state, 'dripReleaseSpeed', 1, 4, 0.1).name('릴리즈 소멸 배속');
  interactionFolder.add(state, 'dripHeadReleaseDuration', 0.05, 1, 0.01)
    .name('고정 머리 소멸 시간');
  interactionFolder.add(state, 'dripHeadStabilityDistance', 8, 80, 1)
    .name('고정 머리 보호 거리');
  interactionFolder.add(state, 'dripParcelBlend', 0.005, 0.25, 0.005)
    .name('조각 전환 부드러움');
  interactionFolder.add(state, 'dripFollowEase', 3, 30, 0.5).name('드래그 따라가기');
  interactionFolder.add(state, 'dripEmissionInterval', 0.04, 0.35, 0.01).name('방출 간격');

  const textMotionFolder = gui.addFolder('텍스트 밀림');
  textMotionFolder.add(state, 'textPushDistance', 0, 24, 0.5)
    .name('최대 하강 거리');
  textMotionFolder.add(state, 'textSpringStiffness', 10, 120, 1)
    .name('스프링 강성');
  textMotionFolder.add(state, 'textSpringDamping', 2, 30, 0.5)
    .name('스프링 감쇠');
  textMotionFolder.add(state, 'textContactPadding', 0, 12, 0.5)
    .name('접촉 감지 여유');
  textMotionFolder.add(state, 'textMaxRotation', 0, 20, 0.5)
    .name('최대 회전 각도');
  textMotionFolder.add(state, 'textRotationStiffness', 10, 120, 1)
    .name('회전 스프링 강성');
  textMotionFolder.add(state, 'textRotationDamping', 2, 30, 0.5)
    .name('회전 스프링 감쇠');

  const lightFolder = gui.addFolder('광원 / Falloff');
  lightFolder.add(state, 'radiusX', 40, 260, 1).name('가로 반경');
  lightFolder.add(state, 'radiusY', 40, 260, 1).name('위쪽 반경');
  lightFolder.add(state, 'radiusYBelow', 40, 320, 1).name('아래쪽 반경');
  lightFolder.add(state, 'lightFalloff', 0.02, 0.95, 0.01).name('Falloff 시작');
  lightFolder.add(state, 'taperAbove', 0.15, 1, 0.01).name('위쪽 폭 비율');
  lightFolder.add(state, 'taperBelow', 0.15, 1, 0.01).name('아래쪽 폭 비율');
  lightFolder.add(state, 'taperStart', 0, 0.8, 0.01).name('폭 축소 시작');
  lightFolder.add(state, 'taperEnd', 0.2, 1, 0.01).name('폭 축소 끝');

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
  colorFolder.add(state, 'colorEllipseInfluence', 0, 1, 0.01)
    .name('타원 중심 혼합')
    .onChange((value: number) => {
      finalMaterial.uniforms.uColorEllipseInfluence.value = value;
    });
  colorFolder.add(state, 'colorGlyphShapeStrength', 0, 1, 0.01)
    .name('글자형 중심 강도')
    .onChange((value: number) => {
      finalMaterial.uniforms.uColorGlyphShapeStrength.value = value;
    });
  colorFolder.add(state, 'colorGlyphShapeRadius', 1, 10, 0.1)
    .name('글자형 중심 두께')
    .onChange((value: number) => {
      finalMaterial.uniforms.uColorGlyphShapeRadius.value = value;
    });
  colorFolder.add(state, 'colorGlyphShapeEdge', 0.1, 3, 0.05)
    .name('글자형 경계 부드러움')
    .onChange((value: number) => {
      finalMaterial.uniforms.uColorGlyphShapeEdge.value = value;
    });
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
  colorFolder.add(state, 'colorSaturation', 0, 1.2, 0.01)
    .name('전체 채도')
    .onChange((value: number) => {
      finalMaterial.uniforms.uColorSaturation.value = value;
    });
  colorFolder.add(state, 'colorBrightness', 0.7, 1.05, 0.01)
    .name('전체 밝기')
    .onChange((value: number) => {
      finalMaterial.uniforms.uColorBrightness.value = value;
    });
  colorFolder.add(state, 'colorPastelMix', 0, 0.35, 0.01)
    .name('파스텔 혼합')
    .onChange((value: number) => {
      finalMaterial.uniforms.uColorPastelMix.value = value;
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
  textMotionFolder.close();
  surfaceFolder.close();
  colorFolder.close();
  advancedFolder.close();

  if (QA_MODE) gui.hide();

  window.addEventListener('keydown', (event) => {
    if (event.target instanceof HTMLInputElement) return;
    if (event.key.toLowerCase() === 'g') gui.show(gui.domElement.style.display === 'none');
  });
}

bindGui();
updateLayout();

function animate(now: number): void {
  const delta = Math.min((now - previousTime) / 1000, 0.1);
  const elapsed = reduceMotion || QA_MODE ? 0 : (now - startTime) / 1000;
  previousTime = now;

  if (!QA_MODE) {
    if (dripHeld) {
      dripHeadAge += delta;
      dripHeadOrigin.x = pointerTarget.x;
      dripHeadOrigin.y = pointerTarget.y;
    } else if (Number.isFinite(dripHeadReleaseAge)) {
      dripHeadReleaseAge += delta;
    }

    for (const parcel of dripParcels) {
      parcel.age += delta;
      parcel.lifeAge += delta * (parcel.released ? state.dripReleaseSpeed : 1);
    }
    while (dripParcels[0]?.lifeAge > state.dripLifetime) dripParcels.shift();

    if (dripHeld) {
      const emitterBlend = 1 - Math.exp(-state.dripFollowEase * delta);
      dripEmitter.x += (pointerTarget.x - dripEmitter.x) * emitterBlend;
      dripEmitter.y += (pointerTarget.y - dripEmitter.y) * emitterBlend;
      dripEmissionElapsed += delta;

      const emissionInterval = Math.max(state.dripEmissionInterval, 0.01);
      while (dripEmissionElapsed >= emissionInterval) {
        dripEmissionElapsed -= emissionInterval;
        emitDripParcel(dripEmitter.x, dripEmitter.y, 0, !dripHasDragged);
      }
    }
  }

  for (let index = 0; index < DRIP_PARCEL_COUNT; index += 1) {
    dripUniformOrigins[index].set(-2, -2);
    dripUniformAges[index] = state.dripLifetime + 1;
    dripUniformLifeAges[index] = state.dripLifetime + 1;
    dripUniformInstantBirths[index] = 1;
    dripUniformWeights[index] = 0;
  }

  if (QA_MODE) {
    const youngestAge = Math.max(qaDripReleaseAge, 0);
    const oldestAge = Math.min(youngestAge + qaDripAge, state.dripLifetime);
    const qaWeight = THREE.MathUtils.clamp(qaDripEnergy, 0, 1);
    for (let index = 0; index < DRIP_PARCEL_COUNT; index += 1) {
      const streamPosition = index / (DRIP_PARCEL_COUNT - 1);
      dripUniformOrigins[index].set(initialPointer.x, initialPointer.y);
      const flowAge = THREE.MathUtils.lerp(
        youngestAge,
        oldestAge,
        streamPosition,
      );
      dripUniformAges[index] = flowAge;
      dripUniformLifeAges[index] = flowAge
        + qaDripReleaseAge * (state.dripReleaseSpeed - 1);
      dripUniformInstantBirths[index] = qaHasDragged
        && index !== DRIP_PARCEL_COUNT - 1
        ? 1
        : 0;
      dripUniformWeights[index] = qaWeight;
    }
  } else {
    for (let index = 0; index < dripParcels.length; index += 1) {
      const parcel = dripParcels[index];
      dripUniformOrigins[index].set(parcel.x, parcel.y);
      dripUniformAges[index] = parcel.age;
      dripUniformLifeAges[index] = parcel.lifeAge;
      dripUniformInstantBirths[index] = parcel.delayedBirth ? 0 : 1;
      dripUniformWeights[index] = 1;
    }
  }

  let dripHeadWeight = 0;
  if (QA_MODE) {
    const qaHeadAttack = getDripHeadAttackStrength(qaDripAge, qaHasDragged);
    const qaHeadRelease = 1 - THREE.MathUtils.smoothstep(
      qaDripReleaseAge,
      0,
      Math.max(state.dripHeadReleaseDuration, 0.001),
    );
    dripHeadWeight = qaHeadAttack * qaHeadRelease
      * THREE.MathUtils.clamp(qaDripEnergy, 0, 1);
  } else if (dripHeld) {
    dripHeadWeight = getDripHeadAttackStrength(dripHeadAge, dripHasDragged);
  } else if (Number.isFinite(dripHeadReleaseAge)) {
    const releaseFade = 1 - THREE.MathUtils.smoothstep(
      dripHeadReleaseAge,
      0,
      Math.max(state.dripHeadReleaseDuration, 0.001),
    );
    dripHeadWeight = dripHeadReleaseStrength * releaseFade;
  }

  deformedGlyphMaterial.uniforms.uGlyphSprings.value = glyphSpringRead.texture;
  deformedGlyphMaterial.uniforms.uSource.value = textTexture;
  renderPass(deformedGlyphMaterial, deformedTextTarget);
  deformedGlyphMaterial.uniforms.uSource.value = colorCenterTexture;
  renderPass(deformedGlyphMaterial, deformedColorCenterTarget);

  interactionFieldMaterial.uniforms.uDripGravity.value = state.dripGravity;
  interactionFieldMaterial.uniforms.uDripStretch.value = state.dripStretch;
  interactionFieldMaterial.uniforms.uDripTurbulence.value = state.dripTurbulence;
  interactionFieldMaterial.uniforms.uDripFlutter.value = state.dripFlutter;
  interactionFieldMaterial.uniforms.uDripStrength.value = state.dripStrength;
  interactionFieldMaterial.uniforms.uDripPinchTime.value = state.dripPinchTime;
  interactionFieldMaterial.uniforms.uDripStreamWidth.value = state.dripStreamWidth;
  interactionFieldMaterial.uniforms.uDripLifetime.value = state.dripLifetime;
  interactionFieldMaterial.uniforms.uDripAttack.value = state.dripAttack;
  interactionFieldMaterial.uniforms.uDripHeadOrigin.value.set(
    QA_MODE ? initialPointer.x : dripHeadOrigin.x,
    QA_MODE ? initialPointer.y : dripHeadOrigin.y,
  );
  interactionFieldMaterial.uniforms.uDripHeadWeight.value = dripHeadWeight;
  interactionFieldMaterial.uniforms.uDripHeadStabilityDistance.value = (
    state.dripHeadStabilityDistance
  );
  interactionFieldMaterial.uniforms.uDripParcelBlend.value = state.dripParcelBlend;
  interactionFieldMaterial.uniforms.uLightRadius.value.set(state.radiusX, state.radiusY);
  interactionFieldMaterial.uniforms.uLightRadiusYBelow.value = state.radiusYBelow;
  interactionFieldMaterial.uniforms.uLightFalloff.value = state.lightFalloff;
  interactionFieldMaterial.uniforms.uLightTaperAbove.value = state.taperAbove;
  interactionFieldMaterial.uniforms.uLightTaperBelow.value = state.taperBelow;
  interactionFieldMaterial.uniforms.uLightTaperStart.value = state.taperStart;
  interactionFieldMaterial.uniforms.uLightTaperEnd.value = state.taperEnd;
  interactionFieldMaterial.uniforms.uTime.value = elapsed;
  renderPass(interactionFieldMaterial, interactionTarget);

  strokeSpreadRead = strokeSpreadTargetA;
  strokeSpreadWrite = strokeSpreadTargetB;
  strokeSpreadMaterial.uniforms.uInput.value = interactionTarget.texture;
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

  surfaceSourceMaterial.uniforms.uActivation.value = interactionTarget.texture;
  renderPass(surfaceSourceMaterial, surfaceSourceTarget);
  surfaceBlurMaterial.uniforms.uInput.value = surfaceSourceTarget.texture;
  renderPass(surfaceBlurMaterial, metaballRawTarget);
  surfaceSmoothMaterial.uniforms.uInput.value = metaballRawTarget.texture;
  surfaceSmoothMaterial.uniforms.uDirection.value.set(1 / FIELD_WIDTH, 0);
  renderPass(surfaceSmoothMaterial, surfaceHorizontalTarget);
  surfaceSmoothMaterial.uniforms.uInput.value = surfaceHorizontalTarget.texture;
  surfaceSmoothMaterial.uniforms.uDirection.value.set(0, 1 / FIELD_HEIGHT);
  renderPass(surfaceSmoothMaterial, surfaceFieldTarget);

  glyphSpringMaterial.uniforms.uPrevious.value = glyphSpringRead.texture;
  glyphSpringMaterial.uniforms.uSurfaceField.value = surfaceFieldTarget.texture;
  glyphSpringMaterial.uniforms.uText.value = deformedTextTarget.texture;
  glyphSpringMaterial.uniforms.uDelta.value = delta;
  glyphSpringMaterial.uniforms.uSurfaceThreshold.value = state.surfaceThreshold;
  glyphSpringMaterial.uniforms.uSurfaceSoftness.value = state.surfaceSoftness;
  glyphSpringMaterial.uniforms.uMaxDistance.value = state.textPushDistance;
  glyphSpringMaterial.uniforms.uStiffness.value = state.textSpringStiffness;
  glyphSpringMaterial.uniforms.uDamping.value = state.textSpringDamping;
  glyphSpringMaterial.uniforms.uContactPadding.value = state.textContactPadding;
  glyphSpringMaterial.uniforms.uMaxRotation.value = THREE.MathUtils.degToRad(
    state.textMaxRotation,
  );
  glyphSpringMaterial.uniforms.uRotationStiffness.value = state.textRotationStiffness;
  glyphSpringMaterial.uniforms.uRotationDamping.value = state.textRotationDamping;
  renderPass(glyphSpringMaterial, glyphSpringWrite);
  [glyphSpringRead, glyphSpringWrite] = [glyphSpringWrite, glyphSpringRead];

  const colorUsesSurfaceField = state.colorSourceMode === 2;
  colorBlurMaterial.uniforms.uInput.value = colorUsesSurfaceField
    ? surfaceFieldTarget.texture
    : interactionTarget.texture;
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
  finalMaterial.uniforms.uColorSaturation.value = state.colorSaturation;
  finalMaterial.uniforms.uColorBrightness.value = state.colorBrightness;
  finalMaterial.uniforms.uColorPastelMix.value = state.colorPastelMix;
  finalMaterial.uniforms.uColorEllipseInfluence.value = state.colorEllipseInfluence;
  finalMaterial.uniforms.uColorGlyphShapeStrength.value = state.colorGlyphShapeStrength;
  finalMaterial.uniforms.uColorGlyphShapeRadius.value = state.colorGlyphShapeRadius;
  finalMaterial.uniforms.uColorGlyphShapeEdge.value = state.colorGlyphShapeEdge;
  renderPass(finalMaterial, null);

  requestAnimationFrame(animate);
}

requestAnimationFrame(animate);
