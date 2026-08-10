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
const LIQUID_PARTICLE_COUNT = 32;
const SOLVER_LINK_COUNT = 16;
const DRAG_ACTIVATION_DISTANCE = 8;
const LIQUID_SOURCE_PACKET_MASS = 1;
const LIQUID_OFFSCREEN_MARGIN = 260;
const LIQUID_MAX_STEP = 1 / 60;
// Jump flooding is retained only for the optional continuity core. The visible
// silhouette comes from the accumulated metaball field below.
const JFA_JUMPS = [16, 8, 4, 2, 1, 1];
const searchParams = new URLSearchParams(window.location.search);
const OG_PREVIEW_MODE = searchParams.has('og');
document.body.classList.toggle('og-preview', OG_PREVIEW_MODE);
const QA_MODE = searchParams.has('qa');
const QA_LABEL_MODE = searchParams.has('qaLabels');
const DEBUG_STAGE_COUNT = 4;
const requestedDebugStageParam = searchParams.get('stage');
const requestedDebugStage = requestedDebugStageParam === null
  ? Number.NaN
  : Number(requestedDebugStageParam);
let debugStage = Number.isFinite(requestedDebugStage)
  ? THREE.MathUtils.clamp(Math.round(requestedDebugStage), 0, DEBUG_STAGE_COUNT - 1)
  : DEBUG_STAGE_COUNT - 1;
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
  dripAttack: qaNumber('qaDripAttack', 0.36),
  dripInitialSpeed: qaNumber('qaDripInitialSpeed', 18.0),
  dripViscosity: qaNumber('qaDripViscosity', 0.65),
  dripCohesion: qaNumber('qaDripCohesion', 0.9),
  dripCohesionRange: qaNumber('qaDripCohesionRange', 92.0),
  dripParticleBlend: qaNumber('qaDripParticleBlend', 0.08),
  dripFollowEase: qaNumber('qaDripFollowEase', 7.5),
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
  'PRESS',
  'AND HOLD',
  'THE SURFACE',
  'UNTIL',
  'THE WORDS',
  'BEGIN',
  'TO GIVE',
  'WAY',
  'BENEATH YOU',
];
const LINE_COUNT = lines.length;
const GLYPH_SLOT_COUNT = lines.reduce((total, line) => total + line.length, 0);
const FIRST_LINE_Y = 132;
const LINE_HEIGHT = 42.2;
const CHARACTER_ADVANCE = 31.8;
const TEXT_FONT = '300 43px "Helvetica Neue", "Arial", sans-serif';
const MAX_GLYPH_HALF_WIDTH = 32;
const GLYPH_ATLAS_COLUMNS = 8;
const GLYPH_ATLAS_ROWS = Math.ceil(GLYPH_SLOT_COUNT / GLYPH_ATLAS_COLUMNS);
const GLYPH_ATLAS_CELL_SIZE = 64;

type Pointer = { x: number; y: number };

const initialPointer = {
  x: QA_POINTER_LOCKED ? THREE.MathUtils.clamp(qaPointerX, 0, 1) : 0.37,
  y: QA_POINTER_LOCKED ? THREE.MathUtils.clamp(qaPointerY, 0, 1) : 0.52,
};
const pointerTarget: Pointer = { ...initialPointer };
const dripEmitter: Pointer = { ...initialPointer };
const dripLastPointer: Pointer = { ...initialPointer };
type LiquidParticle = {
  x: number;
  y: number;
  velocityX: number;
  velocityDown: number;
  age: number;
  mass: number;
  energy: number;
  growing: boolean;
  seed: number;
};
const liquidParticles: LiquidParticle[] = [];
const dripUniformOrigins = Array.from(
  { length: LIQUID_PARTICLE_COUNT },
  () => new THREE.Vector2(-2, -2),
);
const dripUniformAges = new Float32Array(LIQUID_PARTICLE_COUNT);
const dripUniformMasses = new Float32Array(LIQUID_PARTICLE_COUNT);
const dripUniformEnergies = new Float32Array(LIQUID_PARTICLE_COUNT);
const dripUniformGrowth = new Float32Array(LIQUID_PARTICLE_COUNT);
const dripUniformSeeds = new Float32Array(LIQUID_PARTICLE_COUNT);
const solverUniformParticles = Array.from(
  { length: LIQUID_PARTICLE_COUNT },
  () => new THREE.Vector4(-2, -2, 0, 0),
);
const solverUniformVelocityEnds = Array.from(
  { length: LIQUID_PARTICLE_COUNT },
  () => new THREE.Vector2(-2, -2),
);
const solverUniformLinks = Array.from(
  { length: SOLVER_LINK_COUNT },
  () => new THREE.Vector4(-2, -2, -2, -2),
);
const solverUniformLinkStrengths = new Float32Array(SOLVER_LINK_COUNT);
const solverSourceOrigin = new THREE.Vector2(-2, -2);
const liquidAccelerationX = new Float32Array(LIQUID_PARTICLE_COUNT);
const liquidAccelerationDown = new Float32Array(LIQUID_PARTICLE_COUNT);
let dripMassBudget = 0;
let dripHeld = false;
let dripHasDragged = false;
let dripSourceAge = 0;
let dripPointerTravel = 0;
let liquidParticleSequence = 0;
let liquidSourceParticle: LiquidParticle | null = null;
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
const glyphTextAtlasCanvas = document.createElement('canvas');
glyphTextAtlasCanvas.width = GLYPH_ATLAS_COLUMNS * GLYPH_ATLAS_CELL_SIZE * TEXTURE_SCALE;
glyphTextAtlasCanvas.height = GLYPH_ATLAS_ROWS * GLYPH_ATLAS_CELL_SIZE * TEXTURE_SCALE;
const glyphTextAtlasContext = glyphTextAtlasCanvas.getContext('2d', { alpha: true });
if (!glyphTextAtlasContext) throw new Error('Unable to create the glyph atlas.');
const glyphColorAtlasCanvas = document.createElement('canvas');
glyphColorAtlasCanvas.width = glyphTextAtlasCanvas.width;
glyphColorAtlasCanvas.height = glyphTextAtlasCanvas.height;
const glyphColorAtlasContext = glyphColorAtlasCanvas.getContext('2d', { alpha: true });
if (!glyphColorAtlasContext) throw new Error('Unable to create the glyph color atlas.');

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
  textContext.font = TEXT_FONT;
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

type ColorCenterShape = {
  offsetX: number;
  offsetY: number;
  radiusX: number;
  radiusY: number;
  opacity: number;
};

function getColorCenterShape(
  stats: GlyphCenterStats,
  minMass: number,
  maxMass: number,
): ColorCenterShape {
  const massRatio = (stats.inkMass - minMass) / Math.max(maxMass - minMass, 0.001);
  const widthRatio = THREE.MathUtils.clamp((stats.width - 4) / 27, 0, 1);
  const heightRatio = THREE.MathUtils.clamp((stats.height - 18) / 20, 0, 1);
  const widthSignal = massRatio * 0.35 + widthRatio * 0.65;
  const heightSignal = massRatio * 0.5 + heightRatio * 0.5;
  const variation = state.colorCenterVariation;
  const centroidMix = variation * 0.35;
  return {
    offsetX: (stats.centroidX - stats.centerX) * centroidMix,
    offsetY: (stats.centroidY - stats.centerY) * centroidMix,
    radiusX: state.colorCenterRadiusX * THREE.MathUtils.lerp(
      1,
      0.32 + widthSignal * 1.35,
      variation,
    ),
    radiusY: state.colorCenterRadiusY * THREE.MathUtils.lerp(
      1,
      0.42 + heightSignal * 1.3,
      variation,
    ),
    opacity: THREE.MathUtils.lerp(1, 0.45 + massRatio * 0.55, variation),
  };
}

function bakeGlyphAtlases(): void {
  glyphTextAtlasContext.setTransform(1, 0, 0, 1, 0, 0);
  glyphTextAtlasContext.clearRect(
    0,
    0,
    glyphTextAtlasCanvas.width,
    glyphTextAtlasCanvas.height,
  );
  glyphColorAtlasContext.setTransform(1, 0, 0, 1, 0, 0);
  glyphColorAtlasContext.clearRect(
    0,
    0,
    glyphColorAtlasCanvas.width,
    glyphColorAtlasCanvas.height,
  );
  glyphTextAtlasContext.setTransform(TEXTURE_SCALE, 0, 0, TEXTURE_SCALE, 0, 0);
  glyphColorAtlasContext.setTransform(TEXTURE_SCALE, 0, 0, TEXTURE_SCALE, 0, 0);

  const masses = glyphCenterStats.map((stats) => stats.inkMass);
  const minMass = Math.min(...masses);
  const maxMass = Math.max(...masses);

  glyphTextAtlasContext.save();
  glyphTextAtlasContext.fillStyle = '#ffffff';
  glyphTextAtlasContext.font = TEXT_FONT;
  glyphTextAtlasContext.textAlign = 'center';
  glyphTextAtlasContext.textBaseline = 'middle';

  let glyphSlot = 0;
  let statsIndex = 0;
  for (const line of lines) {
    for (const character of line) {
      if (character !== ' ') {
        const column = glyphSlot % GLYPH_ATLAS_COLUMNS;
        const row = Math.floor(glyphSlot / GLYPH_ATLAS_COLUMNS);
        const cellCenterX = (column + 0.5) * GLYPH_ATLAS_CELL_SIZE;
        const cellCenterY = (row + 0.5) * GLYPH_ATLAS_CELL_SIZE;
        glyphTextAtlasContext.fillText(character, cellCenterX, cellCenterY);

        const shape = getColorCenterShape(
          glyphCenterStats[statsIndex],
          minMass,
          maxMass,
        );
        drawColorCenter(
          glyphColorAtlasContext,
          cellCenterX + shape.offsetX,
          cellCenterY + shape.offsetY,
          shape.radiusX,
          shape.radiusY,
          shape.opacity,
        );
        statsIndex += 1;
      }
      glyphSlot += 1;
    }
  }
  glyphTextAtlasContext.restore();
}

bakeTextMask();
glyphCenterStats = measureGlyphCenters();
bakeGlyphAtlases();

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

// The deformation pass must be able to inspect a wide glyph even after its
// pixels move outside the fixed tracking cell. R stores its real half-width;
// G distinguishes ink glyphs from spaces.
const glyphMetadataData = new Uint8Array(GLYPH_SLOT_COUNT * 4);
let glyphMetadataSlot = 0;
textContext.save();
textContext.font = TEXT_FONT;
for (const line of lines) {
  for (const character of line) {
    if (character !== ' ') {
      const metrics = textContext.measureText(character);
      const measuredHalfWidth = Math.max(
        metrics.actualBoundingBoxLeft || metrics.width * 0.5,
        metrics.actualBoundingBoxRight || metrics.width * 0.5,
        CHARACTER_ADVANCE * 0.5,
      ) + 1.5;
      glyphMetadataData[glyphMetadataSlot * 4] = Math.round(
        THREE.MathUtils.clamp(measuredHalfWidth / MAX_GLYPH_HALF_WIDTH, 0, 1) * 255,
      );
      glyphMetadataData[glyphMetadataSlot * 4 + 1] = 255;
    }
    glyphMetadataSlot += 1;
  }
}
textContext.restore();

const glyphMetadataTexture = new THREE.DataTexture(
  glyphMetadataData,
  GLYPH_SLOT_COUNT,
  1,
  THREE.RGBAFormat,
  THREE.UnsignedByteType,
);
glyphMetadataTexture.colorSpace = THREE.NoColorSpace;
glyphMetadataTexture.minFilter = THREE.NearestFilter;
glyphMetadataTexture.magFilter = THREE.NearestFilter;
glyphMetadataTexture.generateMipmaps = false;
glyphMetadataTexture.needsUpdate = true;

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

const glyphTextAtlasTexture = new THREE.CanvasTexture(glyphTextAtlasCanvas);
glyphTextAtlasTexture.colorSpace = THREE.NoColorSpace;
glyphTextAtlasTexture.minFilter = THREE.LinearFilter;
glyphTextAtlasTexture.magFilter = THREE.LinearFilter;
glyphTextAtlasTexture.generateMipmaps = false;
const glyphColorAtlasTexture = new THREE.CanvasTexture(glyphColorAtlasCanvas);
glyphColorAtlasTexture.colorSpace = THREE.NoColorSpace;
glyphColorAtlasTexture.minFilter = THREE.LinearFilter;
glyphColorAtlasTexture.magFilter = THREE.LinearFilter;
glyphColorAtlasTexture.generateMipmaps = false;

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
    uniform sampler2D uGlyphMetadata;
    uniform vec2 uArtSize;
    uniform vec4 uLineLayouts[${LINE_COUNT}];
    uniform float uCharacterAdvance;
    uniform float uLineHalfHeight;
    uniform float uMaxGlyphHalfWidth;

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
        float nearestCharacter = floor(
          (outputX - lineLayout.x) / uCharacterAdvance + 0.5
        );

        // A moving or rotating W can extend well beyond its nominal tracking
        // cell. Inspect the nearest cell and both neighbours, then crop each
        // candidate by its measured glyph width instead of a universal width.
        for (int neighbourOffset = -1; neighbourOffset <= 1; neighbourOffset += 1) {
          float characterPosition = nearestCharacter + float(neighbourOffset);
          float validCharacter = step(0.0, characterPosition)
            * step(characterPosition, lineLayout.z - 1.0);
          float safeCharacter = clamp(
            characterPosition,
            0.0,
            lineLayout.z - 1.0
          );
          float glyphSlot = lineLayout.w + safeCharacter;
          vec2 glyphLookup = vec2(
            (glyphSlot + 0.5) / ${GLYPH_SLOT_COUNT}.0,
            0.5
          );
          vec4 glyphMetadata = texture2D(uGlyphMetadata, glyphLookup);
          validCharacter *= step(0.5, glyphMetadata.g);

          vec4 springState = texture2D(uGlyphSprings, glyphLookup);
          vec2 originalCenter = vec2(
            (lineLayout.x + safeCharacter * uCharacterAdvance) / uArtSize.x,
            lineLayout.y
          );
          vec2 movedCenter = originalCenter
            - vec2(0.0, springState.r / uArtSize.y);
          vec2 outputDelta = (vUv - movedCenter) * uArtSize;
          vec2 sourceDelta = rotateVector(outputDelta, -springState.b);
          float atlasColumn = mod(glyphSlot, ${GLYPH_ATLAS_COLUMNS}.0);
          float atlasRow = floor(glyphSlot / ${GLYPH_ATLAS_COLUMNS}.0);
          vec2 atlasCenterUv = vec2(
            (atlasColumn + 0.5) / ${GLYPH_ATLAS_COLUMNS}.0,
            1.0 - (atlasRow + 0.5) / ${GLYPH_ATLAS_ROWS}.0
          );
          vec2 sourceUv = atlasCenterUv + sourceDelta / vec2(
            ${(GLYPH_ATLAS_COLUMNS * GLYPH_ATLAS_CELL_SIZE).toFixed(1)},
            ${(GLYPH_ATLAS_ROWS * GLYPH_ATLAS_CELL_SIZE).toFixed(1)}
          );
          float glyphHalfWidth = max(
            glyphMetadata.r * uMaxGlyphHalfWidth,
            uCharacterAdvance * 0.5
          );

          float horizontalGate = 1.0 - smoothstep(
            glyphHalfWidth - 0.75,
            glyphHalfWidth + 0.75,
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
      }

      gl_FragColor = vec4(deformedMask);
    }
  `,
  uniforms: {
    uSource: { value: glyphTextAtlasTexture },
    uGlyphSprings: { value: glyphSpringTargetA.texture },
    uGlyphMetadata: { value: glyphMetadataTexture },
    uArtSize: { value: new THREE.Vector2(ART_WIDTH, ART_HEIGHT) },
    uLineLayouts: { value: lineLayouts },
    uCharacterAdvance: { value: CHARACTER_ADVANCE },
    uLineHalfHeight: { value: LINE_HEIGHT * 0.5 },
    uMaxGlyphHalfWidth: { value: MAX_GLYPH_HALF_WIDTH },
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
    uniform vec2 uDripOrigins[${LIQUID_PARTICLE_COUNT}];
    uniform float uDripAges[${LIQUID_PARTICLE_COUNT}];
    uniform float uDripMasses[${LIQUID_PARTICLE_COUNT}];
    uniform float uDripEnergies[${LIQUID_PARTICLE_COUNT}];
    uniform float uDripGrowth[${LIQUID_PARTICLE_COUNT}];
    uniform float uDripSeeds[${LIQUID_PARTICLE_COUNT}];
    uniform float uDripParticleBlend;
    uniform float uDripStretch;
    uniform float uDripTurbulence;
    uniform float uDripFlutter;
    uniform float uDripStrength;
    uniform float uDripPinchTime;
    uniform float uDripStreamWidth;
    uniform float uDripAttack;
    uniform vec2 uLightRadius;
    uniform float uLightRadiusYBelow;
    uniform float uLightFalloff;
    uniform float uLightTaperAbove;
    uniform float uLightTaperBelow;
    uniform float uLightTaperStart;
    uniform float uLightTaperEnd;
    uniform float uTime;

    float liquidParticleFalloff(
      vec2 outputUv,
      float particleAge,
      vec2 particleOrigin,
      float particleMass,
      float particleEnergy,
      float particleGrowth,
      float particleSeed
    ) {
      if (particleMass <= 0.0 || particleEnergy <= 0.0) return 0.0;

      vec2 falloffDelta = (outputUv - particleOrigin) * uArtSize;
      float localX = falloffDelta.x;
      float formation = smoothstep(
        uDripPinchTime * 0.12,
        max(uDripPinchTime, 0.16),
        particleAge
      );
      float flutter = clamp(uDripFlutter, 0.0, 1.5);
      float seedPhase = particleSeed * 6.28318530718;
      float lateralWarp = (
        sin(falloffDelta.y * 0.028 + seedPhase + uTime * 0.18)
        - sin(seedPhase + uTime * 0.18)
      ) * 3.2 * uDripTurbulence * formation;
      falloffDelta.x -= lateralWarp;

      // Source packets fill continuously from zero mass. Keeping a non-zero
      // radius floor would still pop a small Falloff into existence.
      float massScale = sqrt(max(particleMass, 0.0));
      float verticalStretch = 1.0 + min(
        particleAge * uDripStretch * 0.38,
        0.78
      );
      float verticalRadius = falloffDelta.y < 0.0
        ? uLightRadiusYBelow
        : uLightRadius.y;
      verticalRadius *= verticalStretch * massScale;
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
        * sin(particleAge * 2.1 - uTime * 0.7 + seedPhase + localX * 0.015);
      float streamWidth = mix(
        1.0,
        uDripStreamWidth * travelingNeck,
        formation
      );
      vec2 effectiveRadius = vec2(
        uLightRadius.x * horizontalTaper * streamWidth * massScale,
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
      float birthEnergy = 1.0 - exp(
        -particleAge / max(uDripAttack, 0.001)
      );
      float birthFade = mix(
        1.0,
        birthEnergy * birthEnergy,
        clamp(particleGrowth, 0.0, 1.0)
      );
      float flowMaturity = smoothstep(
        uDripPinchTime - 0.16,
        uDripPinchTime + 0.72,
        particleAge
      );
      float densityOscillation = max(
        1.0
          + flutter
          * sin(falloffDelta.y * 0.071 + localX * 0.043 + seedPhase - uTime * 0.7),
        0.0
      );
      float densityPulse = 1.0 - flowMaturity * uDripTurbulence * 0.08
        * densityOscillation;
      return flowedLight
        * birthFade
        * densityPulse
        * max(particleEnergy, 0.0);
    }

    void main() {
      float strongestLight = 0.0;
      float secondLight = 0.0;
      for (int sampleIndex = 0; sampleIndex < ${LIQUID_PARTICLE_COUNT}; sampleIndex += 1) {
        float particleLight = liquidParticleFalloff(
          vUv,
          uDripAges[sampleIndex],
          uDripOrigins[sampleIndex],
          uDripMasses[sampleIndex],
          uDripEnergies[sampleIndex],
          uDripGrowth[sampleIndex],
          uDripSeeds[sampleIndex]
        );
        if (particleLight > strongestLight) {
          secondLight = strongestLight;
          strongestLight = particleLight;
        } else {
          secondLight = max(secondLight, particleLight);
        }
      }
      // This smooth union is monotonic across neighboring liquid particles:
      // overlap can gently add volume, but can never lower either contributor.
      float unionWidth = max(uDripParticleBlend, 0.001);
      float unionAmount = max(
        unionWidth - abs(strongestLight - secondLight),
        0.0
      ) / unionWidth;
      float streamLight = strongestLight
        + unionAmount * unionAmount * unionWidth * 0.25;

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
        streamLight
      );
    }
  `,
  uniforms: {
    uText: { value: deformedTextTarget.texture },
    uColorCenters: { value: deformedColorCenterTarget.texture },
    uArtSize: { value: new THREE.Vector2(ART_WIDTH, ART_HEIGHT) },
    uDripOrigins: { value: dripUniformOrigins },
    uDripAges: { value: dripUniformAges },
    uDripMasses: { value: dripUniformMasses },
    uDripEnergies: { value: dripUniformEnergies },
    uDripGrowth: { value: dripUniformGrowth },
    uDripSeeds: { value: dripUniformSeeds },
    uDripParticleBlend: { value: state.dripParticleBlend },
    uDripStretch: { value: state.dripStretch },
    uDripTurbulence: { value: state.dripTurbulence },
    uDripFlutter: { value: state.dripFlutter },
    uDripStrength: { value: state.dripStrength },
    uDripPinchTime: { value: state.dripPinchTime },
    uDripStreamWidth: { value: state.dripStreamWidth },
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

      if (
        artUv.x <= 0.001 || artUv.x >= 0.999
        || artUv.y <= 0.001 || artUv.y >= 0.999
      ) {
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

const debugMaterial = new THREE.ShaderMaterial({
  vertexShader,
  fragmentShader: `
    precision highp float;

    varying vec2 vUv;
    uniform sampler2D uText;
    uniform sampler2D uInteraction;
    uniform sampler2D uSurfaceSource;
    uniform sampler2D uSurfaceField;
    uniform vec2 uResolution;
    uniform vec2 uPosterOffset;
    uniform vec2 uPosterSize;
    uniform float uSurfaceThreshold;
    uniform float uSurfaceSoftness;
    uniform float uMode;
    uniform vec2 uArtSize;
    uniform vec4 uSolverParticles[${LIQUID_PARTICLE_COUNT}];
    uniform vec2 uSolverVelocityEnds[${LIQUID_PARTICLE_COUNT}];
    uniform vec4 uSolverLinks[${SOLVER_LINK_COUNT}];
    uniform float uSolverLinkStrengths[${SOLVER_LINK_COUNT}];
    uniform vec2 uSourceOrigin;
    uniform float uSourceActive;
    uniform vec2 uSolverRadius;
    uniform float uSolverRadiusBelow;
    uniform float uSolverStretch;
    uniform float uSolverPinchTime;
    uniform float uSolverStreamWidth;

    float segmentDistance(vec2 point, vec2 start, vec2 end) {
      vec2 segment = end - start;
      float lengthSquared = max(dot(segment, segment), 0.0001);
      float progress = clamp(dot(point - start, segment) / lengthSquared, 0.0, 1.0);
      return length(point - (start + segment * progress));
    }

    float lineMask(float distanceToLine, float thickness) {
      float antialias = max(fwidth(distanceToLine) * 0.9, 0.28);
      return 1.0 - smoothstep(
        max(thickness - antialias, 0.0),
        thickness + antialias,
        distanceToLine
      );
    }

    float isoLine(float value, float level, float width) {
      float antialias = max(fwidth(value) * 0.9, width * 0.18);
      return 1.0 - smoothstep(
        max(width - antialias, 0.0),
        width + antialias,
        abs(value - level)
      );
    }

    float smoothCoverage(float value, float threshold) {
      float antialias = max(fwidth(value) * 0.8, 0.012);
      return smoothstep(
        threshold - antialias,
        threshold + antialias,
        value
      );
    }

    float repeatingIsoLine(float value, float bands) {
      float scaledValue = value * bands;
      float distanceToBand = abs(fract(scaledValue) - 0.5);
      float antialias = max(fwidth(scaledValue) * 0.72, 0.007);
      return 1.0 - smoothstep(
        antialias,
        antialias * 2.05,
        distanceToBand
      );
    }

    void main() {
      vec2 fragment = vUv * uResolution;
      vec2 artUv = (fragment - uPosterOffset) / uPosterSize;
      vec3 background = vec3(0.9843, 0.9843, 0.9804);

      if (
        artUv.x <= 0.001 || artUv.x >= 0.999
        || artUv.y <= 0.001 || artUv.y >= 0.999
      ) {
        gl_FragColor = vec4(background, 1.0);
        return;
      }

      vec4 interaction = texture2D(uInteraction, artUv);
      float textMask = texture2D(uText, artUv).a;
      float rawFalloff = interaction.a;
      float activePixels = interaction.r;
      float detectedPixels = texture2D(uSurfaceSource, artUv).r;
      float surfaceField = texture2D(uSurfaceField, artUv).r;
      vec3 charcoal = vec3(0.15, 0.145, 0.14);
      vec3 cobalt = vec3(0.10, 0.25, 0.62);
      vec3 cyan = vec3(0.30, 0.76, 0.91);
      vec3 result = background;

      if (uMode < 0.5) {
        float influence = smoothstep(0.002, 0.12, rawFalloff);
        vec3 cool = vec3(0.22, 0.55, 0.92);
        vec3 warm = vec3(0.90, 0.48, 0.88);
        vec3 influenceColor = mix(cool, warm, smoothstep(0.18, 0.9, rawFalloff));
        result = mix(result, charcoal, textMask * 0.13);
        result = mix(
          result,
          influenceColor,
          influence * (0.24 + rawFalloff * 0.62)
        );
        float contour = repeatingIsoLine(rawFalloff, 4.0);
        result = mix(result, vec3(0.08, 0.13, 0.34), contour * influence * 0.78);
      } else if (uMode < 1.5) {
        // CONTACT: the exact text pixels accepted by the touch Falloff.
        float activation = smoothstep(0.001, 0.28, activePixels);
        float acceptedCoverage = smoothstep(0.01, 0.12, detectedPixels);
        float contactEnergy = pow(max(rawFalloff, 0.0), 1.22);
        float highResolutionInk = smoothCoverage(textMask, 0.20);
        float contactGate = smoothCoverage(contactEnergy, 0.022);
        float contactCoverage = highResolutionInk * contactGate;
        float acceptedEnergy = max(activation, acceptedCoverage);
        vec3 contactColor = mix(
          vec3(0.16, 0.40, 0.68),
          vec3(0.32, 0.72, 0.86),
          smoothstep(0.06, 0.78, acceptedEnergy)
        );
        result = mix(result, charcoal, textMask * 0.14);
        result = mix(
          result,
          contactColor,
          contactCoverage * (0.86 + acceptedEnergy * 0.12)
        );

        float falloffInfluence = smoothstep(0.002, 0.12, rawFalloff);
        float falloffContour = repeatingIsoLine(rawFalloff, 4.0);
        result = mix(
          result,
          vec3(0.24, 0.43, 0.68),
          falloffContour * falloffInfluence * 0.28
        );
      } else if (uMode < 2.5) {
        // SOLVER: source, packet envelopes, cohesion graph, and velocities.
        vec2 artPixel = artUv * uArtSize;
        float rawVolume = smoothstep(0.003, 0.24, rawFalloff);
        result = mix(result, charcoal, textMask * 0.055);
        result = mix(result, vec3(0.80, 0.91, 0.98), rawVolume * 0.16);

        float linkHalo = 0.0;
        float linkInk = 0.0;
        for (int linkIndex = 0; linkIndex < ${SOLVER_LINK_COUNT}; linkIndex += 1) {
          vec4 link = uSolverLinks[linkIndex];
          float strength = uSolverLinkStrengths[linkIndex];
          vec2 linkStart = link.xy * uArtSize;
          vec2 linkEnd = link.zw * uArtSize;
          float linkDistance = segmentDistance(artPixel, linkStart, linkEnd);
          linkHalo = max(linkHalo, lineMask(linkDistance, 1.55) * strength);
          linkInk = max(linkInk, lineMask(linkDistance, 0.68) * strength);
        }
        result = mix(result, vec3(0.58, 0.83, 0.90), linkHalo * 0.17);
        result = mix(result, vec3(0.15, 0.50, 0.62), linkInk * 0.58);

        float packetFill = 0.0;
        float packetHalo = 0.0;
        float packetRing = 0.0;
        float centerInk = 0.0;
        float velocityInk = 0.0;
        float velocityHead = 0.0;
        for (int particleIndex = 0; particleIndex < ${LIQUID_PARTICLE_COUNT}; particleIndex += 1) {
          vec4 particle = uSolverParticles[particleIndex];
          float particleMass = particle.z;
          if (particleMass <= 0.0001) continue;

          vec2 particleOrigin = particle.xy;
          float particleAge = particle.w;
          vec2 delta = (artUv - particleOrigin) * uArtSize;
          float massScale = sqrt(max(particleMass, 0.0));
          float maturity = smoothstep(
            uSolverPinchTime * 0.12,
            max(uSolverPinchTime, 0.16),
            particleAge
          );
          float verticalStretch = 1.0 + min(
            particleAge * uSolverStretch * 0.38,
            0.78
          );
          float horizontalRadius = uSolverRadius.x
            * mix(1.0, uSolverStreamWidth, maturity)
            * massScale
            * 0.34;
          float verticalRadius = (delta.y < 0.0
            ? uSolverRadiusBelow
            : uSolverRadius.y)
            * verticalStretch
            * massScale
            * 0.34;
          float packetDistance = length(
            delta / max(vec2(horizontalRadius, verticalRadius), vec2(0.001))
          );
          float packetAntialias = max(fwidth(packetDistance) * 0.82, 0.0035);
          float packetWidth = max(fwidth(packetDistance) * 1.38, 0.007);
          packetFill = max(
            packetFill,
            (1.0 - smoothstep(
              1.0 - packetAntialias,
              1.0 + packetAntialias,
              packetDistance
            )) * 0.20
          );
          packetHalo = max(
            packetHalo,
            1.0 - smoothstep(
              packetWidth * 2.2,
              packetWidth * 2.2 + packetAntialias * 1.4,
              abs(packetDistance - 1.0)
            )
          );
          packetRing = max(
            packetRing,
            1.0 - smoothstep(
              max(packetWidth - packetAntialias, 0.0),
              packetWidth + packetAntialias,
              abs(packetDistance - 1.0)
            )
          );

          vec2 center = particleOrigin * uArtSize;
          centerInk = max(centerInk, 1.0 - smoothstep(2.2, 3.8, length(artPixel - center)));
          vec2 velocityEnd = uSolverVelocityEnds[particleIndex] * uArtSize;
          velocityInk = max(
            velocityInk,
            lineMask(segmentDistance(artPixel, center, velocityEnd), 0.82)
          );
          velocityHead = max(
            velocityHead,
            1.0 - smoothstep(2.0, 3.5, length(artPixel - velocityEnd))
          );
        }
        result = mix(result, vec3(0.73, 0.88, 0.94), packetFill);
        result = mix(result, vec3(0.66, 0.80, 0.91), packetHalo * 0.13);
        result = mix(result, vec3(0.15, 0.33, 0.58), packetRing * 0.58);
        result = mix(result, vec3(0.10, 0.48, 0.43), velocityInk * 0.70);
        result = mix(result, vec3(0.06, 0.34, 0.32), velocityHead * 0.88);
        result = mix(result, vec3(0.07, 0.16, 0.29), centerInk * 0.92);

        vec2 sourceDelta = (artUv - uSourceOrigin) * uArtSize;
        float sourceDistance = length(sourceDelta);
        float sourceRing = isoLine(sourceDistance, 7.0, 1.0)
          + isoLine(sourceDistance, 12.0, 1.0);
        float sourceCross = lineMask(abs(sourceDelta.x), 0.65)
          * (1.0 - smoothstep(8.0, 14.0, abs(sourceDelta.y)));
        sourceCross += lineMask(abs(sourceDelta.y), 0.65)
          * (1.0 - smoothstep(8.0, 14.0, abs(sourceDelta.x)));
        result = mix(
          result,
          vec3(0.03, 0.09, 0.24),
          clamp(sourceRing + sourceCross, 0.0, 1.0) * uSourceActive
        );
      } else {
        // CONTOUR: final geometry without color, one step before FINAL.
        float fieldWidth = max(fwidth(surfaceField) * 1.4, uSurfaceSoftness * 0.24);
        float thresholdContour = isoLine(
          surfaceField,
          uSurfaceThreshold,
          max(fieldWidth, uSurfaceSoftness * 0.55)
        );
        float contourHalo = isoLine(
          surfaceField,
          uSurfaceThreshold,
          max(fieldWidth * 2.8, uSurfaceSoftness * 1.15)
        );
        result = mix(result, charcoal, textMask * 0.88);
        result = mix(result, vec3(0.56, 0.72, 0.86), contourHalo * 0.24);
        result = mix(result, vec3(0.04, 0.10, 0.27), thresholdContour * 0.96);
      }

      gl_FragColor = vec4(result, 1.0);
    }
  `,
  uniforms: {
    uText: { value: deformedTextTarget.texture },
    uInteraction: { value: interactionTarget.texture },
    uSurfaceSource: { value: surfaceSourceTarget.texture },
    uSurfaceField: { value: surfaceFieldTarget.texture },
    uResolution: { value: new THREE.Vector2(ART_WIDTH, ART_HEIGHT) },
    uPosterOffset: { value: new THREE.Vector2(0, 0) },
    uPosterSize: { value: new THREE.Vector2(ART_WIDTH, ART_HEIGHT) },
    uSurfaceThreshold: { value: state.surfaceThreshold },
    uSurfaceSoftness: { value: state.surfaceSoftness },
    uMode: { value: debugStage },
    uArtSize: { value: new THREE.Vector2(ART_WIDTH, ART_HEIGHT) },
    uSolverParticles: { value: solverUniformParticles },
    uSolverVelocityEnds: { value: solverUniformVelocityEnds },
    uSolverLinks: { value: solverUniformLinks },
    uSolverLinkStrengths: { value: solverUniformLinkStrengths },
    uSourceOrigin: { value: solverSourceOrigin },
    uSourceActive: { value: 0 },
    uSolverRadius: { value: new THREE.Vector2(state.radiusX, state.radiusY) },
    uSolverRadiusBelow: { value: state.radiusYBelow },
    uSolverStretch: { value: state.dripStretch },
    uSolverPinchTime: { value: state.dripPinchTime },
    uSolverStreamWidth: { value: state.dripStreamWidth },
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
  const drawingScale = Math.min(
    drawingSize.x / ART_WIDTH,
    drawingSize.y / ART_HEIGHT,
  ) * (OG_PREVIEW_MODE ? 1.28 : 1);
  const posterWidth = ART_WIDTH * drawingScale;
  const posterHeight = ART_HEIGHT * drawingScale;
  finalMaterial.uniforms.uResolution.value.set(drawingSize.x, drawingSize.y);
  finalMaterial.uniforms.uPosterOffset.value.set(
    (drawingSize.x - posterWidth) / 2,
    (drawingSize.y - posterHeight) / 2,
  );
  finalMaterial.uniforms.uPosterSize.value.set(posterWidth, posterHeight);
  debugMaterial.uniforms.uResolution.value.copy(finalMaterial.uniforms.uResolution.value);
  debugMaterial.uniforms.uPosterOffset.value.copy(finalMaterial.uniforms.uPosterOffset.value);
  debugMaterial.uniforms.uPosterSize.value.copy(finalMaterial.uniforms.uPosterSize.value);
}

function setPointerFromClient(clientX: number, clientY: number): void {
  const x = THREE.MathUtils.clamp((clientX - artworkRect.left) / artworkRect.width, 0, 1);
  const yFromTop = THREE.MathUtils.clamp((clientY - artworkRect.top) / artworkRect.height, 0, 1);
  pointerTarget.x = x;
  pointerTarget.y = 1 - yFromTop;
}

function getParticleBirthEnergy(age: number): number {
  const energy = 1 - Math.exp(-age / Math.max(state.dripAttack, 0.001));
  return energy * energy;
}

function compactClosestLiquidParticles(): void {
  if (liquidParticles.length < 2) return;

  let firstIndex = -1;
  let secondIndex = -1;
  let closestDistanceSquared = Number.POSITIVE_INFINITY;
  for (let first = 0; first < liquidParticles.length - 1; first += 1) {
    if (liquidParticles[first] === liquidSourceParticle) continue;
    for (let second = first + 1; second < liquidParticles.length; second += 1) {
      if (liquidParticles[second] === liquidSourceParticle) continue;
      const deltaX = (liquidParticles[first].x - liquidParticles[second].x) * ART_WIDTH;
      const deltaY = (liquidParticles[first].y - liquidParticles[second].y) * ART_HEIGHT;
      const distanceSquared = deltaX * deltaX + deltaY * deltaY;
      if (distanceSquared < closestDistanceSquared) {
        closestDistanceSquared = distanceSquared;
        firstIndex = first;
        secondIndex = second;
      }
    }
  }
  if (firstIndex < 0 || secondIndex < 0) return;

  const first = liquidParticles[firstIndex];
  const second = liquidParticles[secondIndex];
  const totalMass = first.mass + second.mass;
  const firstShare = first.mass / Math.max(totalMass, 0.0001);
  const secondShare = second.mass / Math.max(totalMass, 0.0001);
  const firstVisibleEnergy = first.energy * (
    first.growing ? getParticleBirthEnergy(first.age) : 1
  );
  const secondVisibleEnergy = second.energy * (
    second.growing ? getParticleBirthEnergy(second.age) : 1
  );
  liquidParticles[firstIndex] = {
    x: first.x * firstShare + second.x * secondShare,
    y: first.y * firstShare + second.y * secondShare,
    velocityX: first.velocityX * firstShare + second.velocityX * secondShare,
    velocityDown: first.velocityDown * firstShare + second.velocityDown * secondShare,
    age: first.age * firstShare + second.age * secondShare,
    // The field uses mass as its radius. Adding the two masses here made two
    // overlapping packets suddenly become sqrt(2) times wider at capacity.
    // Keep the larger visible envelope while still using weighted motion.
    mass: Math.max(first.mass, second.mass),
    energy: (
      firstVisibleEnergy * first.mass + secondVisibleEnergy * second.mass
    ) / Math.max(totalMass, 0.0001),
    growing: false,
    seed: first.seed * firstShare + second.seed * secondShare,
  };
  liquidParticles.splice(secondIndex, 1);
}

function emitLiquidParticle(
  x: number,
  y: number,
  growing = false,
  energy = 1,
  mass = 1,
): LiquidParticle {
  if (liquidParticles.length >= LIQUID_PARTICLE_COUNT) compactClosestLiquidParticles();
  const seed = (liquidParticleSequence * 0.61803398875) % 1;
  liquidParticleSequence += 1;
  const particle: LiquidParticle = {
    x,
    y,
    // Pointer motion positions the source but is not physical momentum. Once a
    // packet leaves the source, it begins with a stable downward flow so a
    // circular gesture cannot keep rotating the detached liquid.
    velocityX: 0,
    velocityDown: state.dripInitialSpeed,
    age: 0,
    mass,
    energy,
    growing,
    seed,
  };
  liquidParticles.push(particle);
  return particle;
}

function ensureLiquidSourceParticle(energy: number): LiquidParticle {
  if (!liquidSourceParticle) {
    liquidSourceParticle = emitLiquidParticle(
      pointerTarget.x,
      pointerTarget.y,
      false,
      energy,
      0,
    );
  }
  return liquidSourceParticle;
}

function placeLiquidSourceSample(x: number, y: number, energy: number): void {
  const particle = ensureLiquidSourceParticle(energy);
  particle.x = x;
  particle.y = y;
  particle.velocityX = 0;
  particle.velocityDown = state.dripInitialSpeed;
  particle.energy = energy;
}

function supplyLiquidMass(suppliedMass: number, energy: number): void {
  dripMassBudget += Math.max(suppliedMass, 0);
  let particle = ensureLiquidSourceParticle(energy);
  placeLiquidSourceSample(dripEmitter.x, dripEmitter.y, energy);

  if (particle.mass < LIQUID_SOURCE_PACKET_MASS) {
    const capacity = Math.max(LIQUID_SOURCE_PACKET_MASS - particle.mass, 0);
    const transferredMass = Math.min(dripMassBudget, capacity);
    particle.mass += transferredMass;
    dripMassBudget -= transferredMass;
    if (particle.mass >= LIQUID_SOURCE_PACKET_MASS - 0.000001) {
      particle.mass = LIQUID_SOURCE_PACKET_MASS;
    }
  }

  // Once the first source packet is full, move that full-size surface with the
  // eased emitter. A replacement is prepared by elapsed supply time and only
  // swaps in when it is also complete. The outgoing full packet then falls,
  // so drag motion never needs a chain of tiny path samples.
  while (
    particle.mass >= LIQUID_SOURCE_PACKET_MASS - 0.000001
    && dripMassBudget >= LIQUID_SOURCE_PACKET_MASS
  ) {
    dripMassBudget -= LIQUID_SOURCE_PACKET_MASS;
    liquidSourceParticle = null;
    particle = emitLiquidParticle(
      dripEmitter.x,
      dripEmitter.y,
      false,
      energy,
      LIQUID_SOURCE_PACKET_MASS,
    );
    liquidSourceParticle = particle;
    placeLiquidSourceSample(dripEmitter.x, dripEmitter.y, energy);
  }
}

function simulateLiquidParticles(delta: number): void {
  const stepCount = Math.max(1, Math.ceil(delta / LIQUID_MAX_STEP));
  const step = delta / stepCount;

  for (let substep = 0; substep < stepCount; substep += 1) {
    if (dripHeld && liquidSourceParticle) {
      liquidSourceParticle.x = dripEmitter.x;
      liquidSourceParticle.y = dripEmitter.y;
    }
    liquidAccelerationX.fill(0, 0, liquidParticles.length);
    liquidAccelerationDown.fill(0, 0, liquidParticles.length);
    const cohesionRange = Math.max(state.dripCohesionRange, 1);

    for (let firstIndex = 0; firstIndex < liquidParticles.length - 1; firstIndex += 1) {
      const first = liquidParticles[firstIndex];
      for (let secondIndex = firstIndex + 1; secondIndex < liquidParticles.length; secondIndex += 1) {
        const second = liquidParticles[secondIndex];
        // The packet still attached to the pointer is a source reservoir, not
        // a moving body. Letting it join cohesion would pull older falling
        // packets sideways when the finger drags.
        if (
          dripHeld
          && (first === liquidSourceParticle || second === liquidSourceParticle)
        ) continue;
        const deltaX = (second.x - first.x) * ART_WIDTH;
        const deltaDown = (first.y - second.y) * ART_HEIGHT;
        const distance = Math.hypot(deltaX, deltaDown);
        if (distance <= 0.001 || distance >= cohesionRange) continue;

        const influence = 1 - distance / cohesionRange;
        const restDistance = 18 * Math.sqrt((first.mass + second.mass) * 0.5);
        // The metaball surface already resolves overlap. Cohesion only pulls
        // separating particles back together; turning compression into a
        // repulsive spring launches a freshly emitted cluster off-screen.
        const stretch = Math.max(distance - restDistance, 0);
        const force = state.dripCohesion * stretch * influence * influence;
        const directionX = deltaX / distance;
        const directionDown = deltaDown / distance;
        liquidAccelerationX[firstIndex] += force * directionX / Math.max(first.mass, 0.05);
        liquidAccelerationDown[firstIndex] += force * directionDown / Math.max(first.mass, 0.05);
        liquidAccelerationX[secondIndex] -= force * directionX / Math.max(second.mass, 0.05);
        liquidAccelerationDown[secondIndex] -= force * directionDown / Math.max(second.mass, 0.05);
      }
    }

    const horizontalDamping = Math.exp(-state.dripViscosity * 1.35 * step);
    const verticalDamping = Math.exp(-state.dripViscosity * 0.22 * step);
    for (let index = 0; index < liquidParticles.length; index += 1) {
      const particle = liquidParticles[index];
      if (dripHeld && particle === liquidSourceParticle) {
        // The source surface must not pinch or stretch while it is attached.
        // Its flow age begins only after the packet leaves the pointer.
        particle.age = 0;
        continue;
      }
      const turbulence = Math.sin(
        particle.seed * Math.PI * 2 + particle.age * 1.1,
      ) * state.dripTurbulence * 2.2;
      particle.velocityX += (liquidAccelerationX[index] + turbulence) * step;
      particle.velocityDown += (state.dripGravity + liquidAccelerationDown[index]) * step;
      particle.velocityX *= horizontalDamping;
      particle.velocityDown *= verticalDamping;
      particle.x += particle.velocityX * step / ART_WIDTH;
      particle.y -= particle.velocityDown * step / ART_HEIGHT;
      particle.age += step;
    }
  }

  for (let index = liquidParticles.length - 1; index >= 0; index -= 1) {
    const particle = liquidParticles[index];
    const removalMargin = LIQUID_OFFSCREEN_MARGIN * Math.sqrt(particle.mass);
    if (particle.y * ART_HEIGHT < -removalMargin) liquidParticles.splice(index, 1);
  }
}

function startDrip(pointerId: number): void {
  dripEmitter.x = pointerTarget.x;
  dripEmitter.y = pointerTarget.y;
  dripLastPointer.x = pointerTarget.x;
  dripLastPointer.y = pointerTarget.y;
  dripMassBudget = 0;
  dripHeld = true;
  dripHasDragged = false;
  dripSourceAge = 0;
  dripPointerTravel = 0;
  activeDripPointerId = pointerId;
  liquidSourceParticle = emitLiquidParticle(
    dripEmitter.x,
    dripEmitter.y,
    false,
    0,
    0,
  );
}

function stopDrip(pointerId: number): void {
  if (pointerId !== activeDripPointerId) return;
  const sourceWasDragged = dripHasDragged
    || dripPointerTravel >= DRAG_ACTIVATION_DISTANCE;
  const sourceEnergy = sourceWasDragged ? 1 : getParticleBirthEnergy(dripSourceAge);
  if (liquidSourceParticle) {
    if (liquidSourceParticle.mass <= 0.000001) {
      const emptySourceIndex = liquidParticles.indexOf(liquidSourceParticle);
      if (emptySourceIndex >= 0) liquidParticles.splice(emptySourceIndex, 1);
    } else {
      placeLiquidSourceSample(dripEmitter.x, dripEmitter.y, sourceEnergy);
    }
  }
  liquidSourceParticle = null;
  dripHeld = false;
  dripMassBudget = 0;
  activeDripPointerId = null;
}

if (!QA_POINTER_LOCKED) {
  canvas.addEventListener('pointermove', (event) => {
    if (!event.isPrimary) return;
    if (activeDripPointerId !== null && event.pointerId !== activeDripPointerId) return;
    if (activeDripPointerId !== null) event.preventDefault();
    setPointerFromClient(event.clientX, event.clientY);
    if (activeDripPointerId !== null) {
      dripPointerTravel += Math.hypot(
        (pointerTarget.x - dripLastPointer.x) * ART_WIDTH,
        (pointerTarget.y - dripLastPointer.y) * ART_HEIGHT,
      );
      dripLastPointer.x = pointerTarget.x;
      dripLastPointer.y = pointerTarget.y;
      if (dripPointerTravel >= DRAG_ACTIVATION_DISTANCE) dripHasDragged = true;
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
  const preventNativeTouchGesture = (event: TouchEvent): void => {
    if (event.cancelable) event.preventDefault();
  };
  canvas.addEventListener('contextmenu', preventNativeTouchAction);
  canvas.addEventListener('selectstart', preventNativeTouchAction);
  canvas.addEventListener('dragstart', preventNativeTouchAction);
  canvas.addEventListener('dblclick', preventNativeTouchAction);
  canvas.addEventListener('touchstart', preventNativeTouchGesture, { passive: false });
  canvas.addEventListener('touchmove', preventNativeTouchGesture, { passive: false });
  canvas.addEventListener('touchend', preventNativeTouchGesture, { passive: false });
  canvas.addEventListener('touchcancel', preventNativeTouchGesture, { passive: false });
}

window.addEventListener('resize', updateLayout);
window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', (event) => {
  reduceMotion = event.matches;
});

function setDebugStage(nextStage: number): void {
  debugStage = THREE.MathUtils.clamp(
    Math.round(nextStage),
    0,
    DEBUG_STAGE_COUNT - 1,
  );
  debugMaterial.uniforms.uMode.value = debugStage === 0
    ? 2
    : debugStage === 1
      ? 1
      : 3;

  document.querySelectorAll<HTMLButtonElement>('[data-debug-stage]').forEach((button) => {
    const selected = Number(button.dataset.debugStage) === debugStage;
    button.classList.toggle('active', selected);
    if (selected) button.setAttribute('aria-current', 'step');
    else button.removeAttribute('aria-current');
  });
}

function bindDebugControls(): void {
  document.querySelectorAll<HTMLButtonElement>('[data-debug-stage]').forEach((button) => {
    const selectStage = (): void => {
      setDebugStage(Number(button.dataset.debugStage));
    };
    // A second touch must be able to switch process views while the primary
    // pointer remains captured by the canvas and keeps emitting liquid.
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      selectStage();
    });
    button.addEventListener('click', (event) => {
      // Pointer input was already handled at pointerdown. Keep click for
      // keyboard and assistive-technology activation.
      if (event.detail === 0) selectStage();
    });
  });
  window.addEventListener('keydown', (event) => {
    if (event.target instanceof HTMLInputElement) return;
    if (/^[1-4]$/.test(event.key)) setDebugStage(Number(event.key) - 1);
    if (event.key === 'ArrowLeft') setDebugStage(debugStage - 1);
    if (event.key === 'ArrowRight') setDebugStage(debugStage + 1);
  });
  setDebugStage(debugStage);
}

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
  interactionFolder.add(state, 'dripAttack', 0.05, 0.6, 0.01).name('터치 시작 시간');
  interactionFolder.add(state, 'dripInitialSpeed', 0, 80, 1).name('초기 낙하 속도');
  interactionFolder.add(state, 'dripViscosity', 0, 2.5, 0.05).name('점성 감쇠');
  interactionFolder.add(state, 'dripCohesion', 0, 3, 0.05).name('입자 응집력');
  interactionFolder.add(state, 'dripCohesionRange', 24, 180, 1).name('응집 거리');
  interactionFolder.add(state, 'dripParticleBlend', 0.005, 0.25, 0.005)
    .name('입자 표면 결합');
  interactionFolder.add(state, 'dripFollowEase', 3, 30, 0.5).name('source 추종 속도');
  interactionFolder.add(state, 'dripEmissionInterval', 0.04, 0.35, 0.01).name('source 교대 시간');

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
    bakeGlyphAtlases();
    glyphColorAtlasTexture.needsUpdate = true;
  });
  colorFolder.add(state, 'colorCenterRadiusY', 6, 28, 0.5).name('기준 타원 세로 반경').onChange(() => {
    bakeGlyphAtlases();
    glyphColorAtlasTexture.needsUpdate = true;
  });
  colorFolder.add(state, 'colorCenterVariation', 0, 1, 0.01).name('글자별 크기 차이').onChange(() => {
    bakeGlyphAtlases();
    glyphColorAtlasTexture.needsUpdate = true;
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

  gui.hide();

  window.addEventListener('keydown', (event) => {
    if (event.target instanceof HTMLInputElement) return;
    if (event.key.toLowerCase() === 'g') gui.show(gui.domElement.style.display === 'none');
  });
}

bindDebugControls();
bindGui();
updateLayout();

function updateSolverDebugData(): void {
  for (let index = 0; index < LIQUID_PARTICLE_COUNT; index += 1) {
    const origin = dripUniformOrigins[index];
    const mass = dripUniformMasses[index];
    const age = dripUniformAges[index];
    solverUniformParticles[index].set(origin.x, origin.y, mass, age);

    if (mass <= 0.0001) {
      solverUniformVelocityEnds[index].set(-2, -2);
      continue;
    }

    let velocityX = 0;
    let velocityDown = state.dripInitialSpeed + state.dripGravity * age;
    if (!QA_MODE && index < liquidParticles.length) {
      const particle = liquidParticles[index];
      const isAttachedSource = dripHeld && particle === liquidSourceParticle;
      velocityX = isAttachedSource ? 0 : particle.velocityX;
      velocityDown = isAttachedSource ? 0 : particle.velocityDown;
    }

    const arrowX = THREE.MathUtils.clamp(velocityX * 0.18, -34, 34);
    const arrowDown = THREE.MathUtils.clamp(velocityDown * 0.18, -42, 54);
    solverUniformVelocityEnds[index].set(
      origin.x + arrowX / ART_WIDTH,
      origin.y - arrowDown / ART_HEIGHT,
    );
  }

  solverSourceOrigin.set(-2, -2);
  const hasAttachedSource = !QA_MODE && dripHeld && liquidSourceParticle !== null;
  if (hasAttachedSource && liquidSourceParticle) {
    solverSourceOrigin.set(liquidSourceParticle.x, liquidSourceParticle.y);
  }
  debugMaterial.uniforms.uSourceActive.value = hasAttachedSource ? 1 : 0;

  for (let index = 0; index < SOLVER_LINK_COUNT; index += 1) {
    solverUniformLinks[index].set(-2, -2, -2, -2);
    solverUniformLinkStrengths[index] = 0;
  }

  const linkCandidates: Array<{
    firstIndex: number;
    secondIndex: number;
    strength: number;
  }> = [];
  const cohesionRange = Math.max(state.dripCohesionRange, 1);
  const sourceIndex = hasAttachedSource && liquidSourceParticle
    ? liquidParticles.indexOf(liquidSourceParticle)
    : -1;
  for (let firstIndex = 0; firstIndex < LIQUID_PARTICLE_COUNT - 1; firstIndex += 1) {
    if (dripUniformMasses[firstIndex] <= 0.0001 || firstIndex === sourceIndex) continue;
    for (
      let secondIndex = firstIndex + 1;
      secondIndex < LIQUID_PARTICLE_COUNT;
      secondIndex += 1
    ) {
      if (dripUniformMasses[secondIndex] <= 0.0001 || secondIndex === sourceIndex) continue;
      const deltaX = (
        dripUniformOrigins[secondIndex].x - dripUniformOrigins[firstIndex].x
      ) * ART_WIDTH;
      const deltaY = (
        dripUniformOrigins[secondIndex].y - dripUniformOrigins[firstIndex].y
      ) * ART_HEIGHT;
      const distance = Math.hypot(deltaX, deltaY);
      if (distance <= 0.001 || distance >= cohesionRange) continue;

      const firstMass = dripUniformMasses[firstIndex];
      const secondMass = dripUniformMasses[secondIndex];
      const restDistance = 18 * Math.sqrt((firstMass + secondMass) * 0.5);
      const stretch = Math.max(distance - restDistance, 0);
      const influence = 1 - distance / cohesionRange;
      const strength = THREE.MathUtils.clamp(
        0.16 + influence * 0.52 + Math.min(stretch / 48, 0.28),
        0.16,
        0.92,
      );
      linkCandidates.push({ firstIndex, secondIndex, strength });
    }
  }
  linkCandidates.sort((first, second) => second.strength - first.strength);

  const visibleLinkCount = Math.min(linkCandidates.length, SOLVER_LINK_COUNT);
  for (let index = 0; index < visibleLinkCount; index += 1) {
    const link = linkCandidates[index];
    const first = dripUniformOrigins[link.firstIndex];
    const second = dripUniformOrigins[link.secondIndex];
    solverUniformLinks[index].set(first.x, first.y, second.x, second.y);
    solverUniformLinkStrengths[index] = link.strength;
  }
}

function animate(now: number): void {
  const delta = Math.min((now - previousTime) / 1000, 0.1);
  const elapsed = reduceMotion || QA_MODE ? 0 : (now - startTime) / 1000;
  previousTime = now;

  if (!QA_MODE) {
    simulateLiquidParticles(delta);
    if (dripHeld) {
      dripSourceAge += delta;
      const emitterBlend = 1 - Math.exp(-state.dripFollowEase * delta);
      dripEmitter.x += (pointerTarget.x - dripEmitter.x) * emitterBlend;
      dripEmitter.y += (pointerTarget.y - dripEmitter.y) * emitterBlend;
      const emissionInterval = Math.max(state.dripEmissionInterval, 0.01);
      const sourceEnergy = dripHasDragged ? 1 : getParticleBirthEnergy(dripSourceAge);
      supplyLiquidMass(delta / emissionInterval, sourceEnergy);
    }
  }

  for (let index = 0; index < LIQUID_PARTICLE_COUNT; index += 1) {
    dripUniformOrigins[index].set(-2, -2);
    dripUniformAges[index] = 0;
    dripUniformMasses[index] = 0;
    dripUniformEnergies[index] = 0;
    dripUniformGrowth[index] = 0;
    dripUniformSeeds[index] = 0;
  }

  if (QA_MODE) {
    const qaWeight = THREE.MathUtils.clamp(qaDripEnergy, 0, 1);
    const qaReleaseTime = Math.max(qaDripReleaseAge, 0);
    const qaParticleCount = Math.min(
      LIQUID_PARTICLE_COUNT,
      Math.max(1, Math.floor(qaDripAge / Math.max(state.dripEmissionInterval, 0.01)) + 1),
    );
    for (let index = 0; index < qaParticleCount; index += 1) {
      const streamPosition = qaParticleCount <= 1 ? 0 : index / (qaParticleCount - 1);
      const flowAge = qaReleaseTime + qaDripAge * streamPosition;
      const fallDistance = state.dripInitialSpeed * flowAge
        + 0.5 * state.dripGravity * flowAge * flowAge;
      const lateralOffset = Math.sin(index * 2.3999632297) * state.dripTurbulence * 2.5;
      dripUniformOrigins[index].set(
        initialPointer.x + lateralOffset / ART_WIDTH,
        initialPointer.y - fallDistance / ART_HEIGHT,
      );
      dripUniformAges[index] = flowAge;
      dripUniformMasses[index] = 1;
      dripUniformEnergies[index] = qaWeight;
      dripUniformGrowth[index] = qaHasDragged || qaReleaseTime > 0 ? 0 : 1;
      dripUniformSeeds[index] = (index * 0.61803398875) % 1;
    }
  } else {
    for (let index = 0; index < liquidParticles.length; index += 1) {
      const particle = liquidParticles[index];
      dripUniformOrigins[index].set(particle.x, particle.y);
      dripUniformAges[index] = particle.age;
      dripUniformMasses[index] = particle.mass;
      dripUniformEnergies[index] = particle.energy;
      dripUniformGrowth[index] = particle.growing ? 1 : 0;
      dripUniformSeeds[index] = particle.seed;
    }
  }
  if (debugStage === 0) updateSolverDebugData();
  else debugMaterial.uniforms.uSourceActive.value = 0;

  deformedGlyphMaterial.uniforms.uGlyphSprings.value = glyphSpringRead.texture;
  deformedGlyphMaterial.uniforms.uSource.value = glyphTextAtlasTexture;
  renderPass(deformedGlyphMaterial, deformedTextTarget);
  deformedGlyphMaterial.uniforms.uSource.value = glyphColorAtlasTexture;
  renderPass(deformedGlyphMaterial, deformedColorCenterTarget);

  interactionFieldMaterial.uniforms.uDripStretch.value = state.dripStretch;
  interactionFieldMaterial.uniforms.uDripTurbulence.value = state.dripTurbulence;
  interactionFieldMaterial.uniforms.uDripFlutter.value = state.dripFlutter;
  interactionFieldMaterial.uniforms.uDripStrength.value = state.dripStrength;
  interactionFieldMaterial.uniforms.uDripPinchTime.value = state.dripPinchTime;
  interactionFieldMaterial.uniforms.uDripStreamWidth.value = state.dripStreamWidth;
  interactionFieldMaterial.uniforms.uDripAttack.value = state.dripAttack;
  interactionFieldMaterial.uniforms.uDripParticleBlend.value = state.dripParticleBlend;
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
  debugMaterial.uniforms.uText.value = deformedTextTarget.texture;
  debugMaterial.uniforms.uInteraction.value = interactionTarget.texture;
  debugMaterial.uniforms.uSurfaceSource.value = surfaceSourceTarget.texture;
  debugMaterial.uniforms.uSurfaceField.value = surfaceFieldTarget.texture;
  debugMaterial.uniforms.uSurfaceThreshold.value = state.surfaceThreshold;
  debugMaterial.uniforms.uSurfaceSoftness.value = state.surfaceSoftness;
  debugMaterial.uniforms.uSolverRadius.value.set(state.radiusX, state.radiusY);
  debugMaterial.uniforms.uSolverRadiusBelow.value = state.radiusYBelow;
  debugMaterial.uniforms.uSolverStretch.value = state.dripStretch;
  debugMaterial.uniforms.uSolverPinchTime.value = state.dripPinchTime;
  debugMaterial.uniforms.uSolverStreamWidth.value = state.dripStreamWidth;
  const outputMaterial = debugStage < DEBUG_STAGE_COUNT - 1
    ? debugMaterial
    : finalMaterial;
  renderPass(outputMaterial, null);

  requestAnimationFrame(animate);
}

requestAnimationFrame(animate);
