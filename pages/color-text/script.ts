import * as THREE from 'three';
import { createStepper } from '../../common/stepper';
import {
  ART_HEIGHT,
  ART_WIDTH,
  createColorTextParameters,
  FIELD_HEIGHT,
  FIELD_WIDTH,
  GLYPH_SLOT_COUNT,
  JFA_JUMPS,
  LINE_HEIGHT,
  LIQUID_PARTICLE_COUNT,
  MAX_GLYPH_HALF_WIDTH,
  readNumberParameter,
  SOLVER_LINK_COUNT,
  STROKE_SPREAD_PASSES,
  TEXTURE_SCALE,
} from './config';
import { LiquidSolver, type Point } from './liquid-solver';
import { bindParameterGui } from './parameter-gui';
import {
  deformedGlyphFragmentShader,
  fullScreenVertexShader,
  interactionFieldFragmentShader,
  strokeSpreadFragmentShader,
  jumpFloodFragmentShader,
  nearestSeedFragmentShader,
  surfaceSourceFragmentShader,
  surfaceBlurFragmentShader,
  surfaceSmoothFragmentShader,
  glyphSpringFragmentShader,
  finalFragmentShader,
  debugFragmentShader,
} from './shaders';
import { createTextAtlas } from './text-atlas';

// 1. URL mode와 작품 파라미터 -------------------------------------------------
const searchParams = new URLSearchParams(window.location.search);
const OG_PREVIEW_MODE = searchParams.has('og');
document.body.classList.toggle('og-preview', OG_PREVIEW_MODE);
const QA_MODE = searchParams.has('qa');
const QA_LABEL_MODE = searchParams.has('qaLabels');
const PROCESS_STEPS = [
  { id: 'solver', label: 'Solver', stage: 0 },
  { id: 'contact', label: 'Contact', stage: 1 },
  { id: 'contour', label: 'Contour', stage: 2 },
  { id: 'final', label: 'Final', stage: 3 },
] as const;
const PROCESS_STAGE_COUNT = PROCESS_STEPS.length;
const requestedProcessStageParam = searchParams.get('stage');
const requestedProcessStage = requestedProcessStageParam === null
  ? Number.NaN
  : Number(requestedProcessStageParam);
let processStage = Number.isFinite(requestedProcessStage)
  ? THREE.MathUtils.clamp(Math.round(requestedProcessStage), 0, PROCESS_STAGE_COUNT - 1)
  : PROCESS_STAGE_COUNT - 1;
const qaPointerX = Number(searchParams.get('qaX'));
const qaPointerY = Number(searchParams.get('qaY'));
const QA_POINTER_LOCKED = searchParams.has('qaX')
  && searchParams.has('qaY')
  && Number.isFinite(qaPointerX)
  && Number.isFinite(qaPointerY);

function qaNumber(name: string, fallback: number): number {
  return readNumberParameter(searchParams, name, fallback, QA_MODE);
}

const canvas = document.getElementById('artwork') as HTMLCanvasElement;
const error = document.getElementById('error') as HTMLParagraphElement;

const state = createColorTextParameters(searchParams, QA_MODE);
const qaDripAge = qaNumber('qaDripAge', 1.45);
const qaDripReleaseAge = qaNumber('qaDripReleaseAge', 0);
const qaDripEnergy = qaNumber('qaDrip', 1);
const qaHasDragged = searchParams.get('qaHasDragged') === '1';

// 2. CPU 입력 상태와 GPU에 전달할 고정 길이 배열 -----------------------------
const initialPointer = {
  x: QA_POINTER_LOCKED ? THREE.MathUtils.clamp(qaPointerX, 0, 1) : 0.37,
  y: QA_POINTER_LOCKED ? THREE.MathUtils.clamp(qaPointerY, 0, 1) : 0.52,
};
const pointerTarget: Point = { ...initialPointer };
const liquid = new LiquidSolver(state, initialPointer);
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
let artworkRect = { left: 0, top: 0, width: ART_WIDTH, height: ART_HEIGHT };
let startTime = performance.now();
let previousTime = startTime;
let reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// 3. 글자 atlas와 WebGL 기본 자원 ---------------------------------------------
const textAtlas = createTextAtlas();
const {
  glyphTextAtlasCanvas,
  glyphSpringCells,
  lineLayouts,
  glyphHomeData,
  glyphMetadataData,
} = textAtlas;

const glyphHomeTexture = new THREE.DataTexture(
  glyphHomeData,
  GLYPH_SLOT_COUNT,
  1,
  THREE.RGBAFormat,
  THREE.FloatType,
);
glyphHomeTexture.colorSpace = THREE.NoColorSpace;
glyphHomeTexture.minFilter = THREE.NearestFilter;
glyphHomeTexture.magFilter = THREE.NearestFilter;
glyphHomeTexture.generateMipmaps = false;
glyphHomeTexture.needsUpdate = true;

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

const glyphTextAtlasTexture = new THREE.CanvasTexture(glyphTextAtlasCanvas);
glyphTextAtlasTexture.colorSpace = THREE.NoColorSpace;
glyphTextAtlasTexture.minFilter = THREE.LinearFilter;
glyphTextAtlasTexture.magFilter = THREE.LinearFilter;
glyphTextAtlasTexture.generateMipmaps = false;
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

// 4. 각 pass의 결과를 저장하는 GPU texture ------------------------------------
const interactionTarget = new THREE.WebGLRenderTarget(FIELD_WIDTH, FIELD_HEIGHT, linearTargetOptions);
const strokeSpreadTargetA = new THREE.WebGLRenderTarget(FIELD_WIDTH, FIELD_HEIGHT, linearTargetOptions);
const strokeSpreadTargetB = new THREE.WebGLRenderTarget(FIELD_WIDTH, FIELD_HEIGHT, linearTargetOptions);
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
// 5. shader 코드와 입력 uniform의 연결 ----------------------------------------
const deformedGlyphMaterial = new THREE.ShaderMaterial({
  vertexShader: fullScreenVertexShader,
  fragmentShader: deformedGlyphFragmentShader,
  uniforms: {
    uSource: { value: glyphTextAtlasTexture },
    uGlyphSprings: { value: glyphSpringTargetA.texture },
    uGlyphHomes: { value: glyphHomeTexture },
    uGlyphMetadata: { value: glyphMetadataTexture },
    uArtSize: { value: new THREE.Vector2(ART_WIDTH, ART_HEIGHT) },
    uLineLayouts: { value: lineLayouts },
    uLineHalfHeight: { value: LINE_HEIGHT * 0.5 },
    uMaxGlyphHalfWidth: { value: MAX_GLYPH_HALF_WIDTH },
  },
  depthTest: false,
  depthWrite: false,
});

const interactionFieldMaterial = new THREE.ShaderMaterial({
  vertexShader: fullScreenVertexShader,
  fragmentShader: interactionFieldFragmentShader,
  uniforms: {
    uText: { value: deformedTextTarget.texture },
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
  vertexShader: fullScreenVertexShader,
  fragmentShader: strokeSpreadFragmentShader,
  uniforms: {
    uInput: { value: interactionTarget.texture },
    uTexel: { value: new THREE.Vector2(1 / FIELD_WIDTH, 1 / FIELD_HEIGHT) },
  },
  depthTest: false,
  depthWrite: false,
});

const nearestSeedMaterial = new THREE.ShaderMaterial({
  vertexShader: fullScreenVertexShader,
  fragmentShader: nearestSeedFragmentShader,
  uniforms: {
    uActivation: { value: interactionTarget.texture },
    uSeedThreshold: { value: state.seedThreshold },
  },
  depthTest: false,
  depthWrite: false,
});

const jumpFloodMaterial = new THREE.ShaderMaterial({
  vertexShader: fullScreenVertexShader,
  fragmentShader: jumpFloodFragmentShader,
  uniforms: {
    uNearest: { value: nearestTargetA.texture },
    uFieldSize: { value: new THREE.Vector2(FIELD_WIDTH, FIELD_HEIGHT) },
    uJump: { value: JFA_JUMPS[0] },
  },
  depthTest: false,
  depthWrite: false,
});

const surfaceSourceMaterial = new THREE.ShaderMaterial({
  vertexShader: fullScreenVertexShader,
  fragmentShader: surfaceSourceFragmentShader,
  uniforms: {
    uActivation: { value: interactionTarget.texture },
    uInputThreshold: { value: state.metaballInputThreshold },
    uInputSoftness: { value: state.metaballInputSoftness },
  },
  depthTest: false,
  depthWrite: false,
});

const surfaceBlurMaterial = new THREE.ShaderMaterial({
  vertexShader: fullScreenVertexShader,
  fragmentShader: surfaceBlurFragmentShader,
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
  vertexShader: fullScreenVertexShader,
  fragmentShader: surfaceSmoothFragmentShader,
  uniforms: {
    uInput: { value: metaballRawTarget.texture },
    uDirection: { value: new THREE.Vector2(1 / FIELD_WIDTH, 0) },
    uSigma: { value: state.metaballSmoothing },
  },
  depthTest: false,
  depthWrite: false,
});

const glyphSpringMaterial = new THREE.ShaderMaterial({
  vertexShader: fullScreenVertexShader,
  fragmentShader: glyphSpringFragmentShader,
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
    uMaxRotation: { value: THREE.MathUtils.degToRad(state.textMaxRotation) },
    uRotationStiffness: { value: state.textRotationStiffness },
    uRotationDamping: { value: state.textRotationDamping },
    uQaMode: { value: QA_MODE ? 1 : 0 },
  },
  depthTest: false,
  depthWrite: false,
});

const finalMaterial = new THREE.ShaderMaterial({
  vertexShader: fullScreenVertexShader,
  fragmentShader: finalFragmentShader,
  uniforms: {
    uText: { value: deformedTextTarget.texture },
    uNearest: { value: nearestTargetA.texture },
    uSurfaceField: { value: surfaceFieldTarget.texture },
    uResolution: { value: new THREE.Vector2(ART_WIDTH, ART_HEIGHT) },
    uPosterOffset: { value: new THREE.Vector2(0, 0) },
    uPosterSize: { value: new THREE.Vector2(ART_WIDTH, ART_HEIGHT) },
    uArtSize: { value: new THREE.Vector2(ART_WIDTH, ART_HEIGHT) },
    uSurfaceThreshold: { value: state.surfaceThreshold },
    uSurfaceSoftness: { value: state.surfaceSoftness },
    uSeedThreshold: { value: state.seedThreshold },
    uHueBands: { value: state.hueBands },
    uColorSaturation: { value: state.colorSaturation },
    uColorBrightness: { value: state.colorBrightness },
    uColorPastelMix: { value: state.colorPastelMix },
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
  vertexShader: fullScreenVertexShader,
  fragmentShader: debugFragmentShader,
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
    uMode: { value: processStage },
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

// 6. 모든 pass가 공유하는 fullscreen quad와 ping-pong 상태 -------------------
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

// 7. pointer event를 artwork UV로 바꾸고 LiquidSolver에 전달 -----------------
function setPointerFromClient(clientX: number, clientY: number): void {
  const x = THREE.MathUtils.clamp((clientX - artworkRect.left) / artworkRect.width, 0, 1);
  const yFromTop = THREE.MathUtils.clamp((clientY - artworkRect.top) / artworkRect.height, 0, 1);
  pointerTarget.x = x;
  pointerTarget.y = 1 - yFromTop;
}

if (!QA_POINTER_LOCKED) {
  canvas.addEventListener('pointermove', (event) => {
    if (!event.isPrimary) return;
    if (liquid.activePointerId !== null && event.pointerId !== liquid.activePointerId) return;
    if (liquid.activePointerId !== null) event.preventDefault();
    setPointerFromClient(event.clientX, event.clientY);
    if (liquid.activePointerId !== null) liquid.trackPointer(pointerTarget);
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
    liquid.start(event.pointerId, pointerTarget);
  }, { passive: false });

  canvas.addEventListener('pointerup', (event) => {
    if (event.pointerId === liquid.activePointerId) event.preventDefault();
    liquid.stop(event.pointerId);
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  }, { passive: false });

  canvas.addEventListener('pointercancel', (event) => {
    liquid.stop(event.pointerId);
  }, { passive: true });

  canvas.addEventListener('lostpointercapture', (event) => {
    liquid.stop(event.pointerId);
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

// 8. Process View와 제작용 GUI ------------------------------------------------
function setProcessStage(nextStage: number): void {
  processStage = THREE.MathUtils.clamp(
    Math.round(nextStage),
    0,
    PROCESS_STAGE_COUNT - 1,
  );
  debugMaterial.uniforms.uMode.value = processStage === 0
    ? 2
    : processStage === 1
      ? 1
      : 3;
}

function bindProcessStepper(): void {
  createStepper({
    ariaLabel: 'Rendering stages',
    steps: PROCESS_STEPS,
    initialStep: PROCESS_STEPS[processStage].id,
    onChange: (stepId) => {
      const step = PROCESS_STEPS.find((candidate) => candidate.id === stepId);
      if (step) setProcessStage(step.stage);
    },
  });
}

bindProcessStepper();
bindParameterGui({
  state,
  surfaceSourceMaterial,
  surfaceBlurMaterial,
  surfaceSmoothMaterial,
  nearestSeedMaterial,
  finalMaterial,
});
updateLayout();

// 9. Solver Process View용 보조 선과 속도 화살표 ------------------------------
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
    if (!QA_MODE && index < liquid.particles.length) {
      const particle = liquid.particles[index];
      const isAttachedSource = liquid.isHeld && particle === liquid.sourceParticle;
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
  const hasAttachedSource = !QA_MODE && liquid.isHeld && liquid.sourceParticle !== null;
  if (hasAttachedSource && liquid.sourceParticle) {
    solverSourceOrigin.set(liquid.sourceParticle.x, liquid.sourceParticle.y);
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
  const sourceIndex = hasAttachedSource && liquid.sourceParticle
    ? liquid.particles.indexOf(liquid.sourceParticle)
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

// 10. 한 프레임의 GPU pass ----------------------------------------------------
/** CPU packet 상태를 shader uniform 배열에 복사한다. */
function uploadLiquidState(): void {
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
    for (let index = 0; index < liquid.particles.length; index += 1) {
      const particle = liquid.particles[index];
      dripUniformOrigins[index].set(particle.x, particle.y);
      dripUniformAges[index] = particle.age;
      dripUniformMasses[index] = particle.mass;
      dripUniformEnergies[index] = particle.energy;
      dripUniformGrowth[index] = particle.growing ? 1 : 0;
      dripUniformSeeds[index] = particle.seed;
    }
  }

  if (processStage === 0) updateSolverDebugData();
  else debugMaterial.uniforms.uSourceActive.value = 0;
}

/** 이전 spring 상태로 현재 글자 mask를 다시 그린다. */
function renderDeformedGlyphPass(): void {
  deformedGlyphMaterial.uniforms.uGlyphSprings.value = glyphSpringRead.texture;
  deformedGlyphMaterial.uniforms.uSource.value = glyphTextAtlasTexture;
  renderPass(deformedGlyphMaterial, deformedTextTarget);
}

/** 현재 글자 픽셀과 물 packet을 RGBA interaction field 하나로 합친다. */
function renderInteractionPass(elapsed: number): void {
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
}

/** 글자 중심 seed가 끊기지 않도록 8번에 걸쳐 한 픽셀씩 확장한다. */
function renderStrokeSpreadPasses(): void {
  strokeSpreadRead = strokeSpreadTargetA;
  strokeSpreadWrite = strokeSpreadTargetB;
  strokeSpreadMaterial.uniforms.uInput.value = interactionTarget.texture;
  renderPass(strokeSpreadMaterial, strokeSpreadRead);
  for (let pass = 1; pass < STROKE_SPREAD_PASSES; pass += 1) {
    strokeSpreadMaterial.uniforms.uInput.value = strokeSpreadRead.texture;
    renderPass(strokeSpreadMaterial, strokeSpreadWrite);
    [strokeSpreadRead, strokeSpreadWrite] = [strokeSpreadWrite, strokeSpreadRead];
  }
}

/** seed 좌표를 큰 jump에서 작은 jump로 전달해 가까운 색 중심을 찾는다. */
function renderNearestSeedPasses(): void {
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
}

/** 활성 글자 픽셀을 주변에서 누적하고 두 방향으로 smoothing해 액체 표면을 만든다. */
function renderMetaballSurfacePasses(): void {
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
}

/** 현재 접촉으로 다음 프레임에서 사용할 글자 이동·회전 spring을 계산한다. */
function renderGlyphSpringPass(delta: number): void {
  glyphSpringMaterial.uniforms.uPrevious.value = glyphSpringRead.texture;
  glyphSpringMaterial.uniforms.uSurfaceField.value = surfaceFieldTarget.texture;
  glyphSpringMaterial.uniforms.uText.value = deformedTextTarget.texture;
  glyphSpringMaterial.uniforms.uDelta.value = delta;
  glyphSpringMaterial.uniforms.uSurfaceThreshold.value = state.surfaceThreshold;
  glyphSpringMaterial.uniforms.uSurfaceSoftness.value = state.surfaceSoftness;
  glyphSpringMaterial.uniforms.uMaxDistance.value = state.textPushDistance;
  glyphSpringMaterial.uniforms.uStiffness.value = state.textSpringStiffness;
  glyphSpringMaterial.uniforms.uDamping.value = state.textSpringDamping;
  glyphSpringMaterial.uniforms.uMaxRotation.value = THREE.MathUtils.degToRad(
    state.textMaxRotation,
  );
  glyphSpringMaterial.uniforms.uRotationStiffness.value = state.textRotationStiffness;
  glyphSpringMaterial.uniforms.uRotationDamping.value = state.textRotationDamping;
  renderPass(glyphSpringMaterial, glyphSpringWrite);
  [glyphSpringRead, glyphSpringWrite] = [glyphSpringWrite, glyphSpringRead];
}

/** 같은 중간 texture를 Process View 또는 최종 색상으로 화면에 출력한다. */
function renderOutputPass(elapsed: number): void {
  finalMaterial.uniforms.uTime.value = elapsed;
  finalMaterial.uniforms.uNearest.value = nearestRead.texture;
  finalMaterial.uniforms.uSurfaceField.value = surfaceFieldTarget.texture;
  finalMaterial.uniforms.uColorSaturation.value = state.colorSaturation;
  finalMaterial.uniforms.uColorBrightness.value = state.colorBrightness;
  finalMaterial.uniforms.uColorPastelMix.value = state.colorPastelMix;
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

  const outputMaterial = processStage < PROCESS_STAGE_COUNT - 1
    ? debugMaterial
    : finalMaterial;
  renderPass(outputMaterial, null);
}

/**
 * 한 프레임의 전체 순서.
 *
 * CPU 물 상태 → 글자 변형 → interaction → seed → metaball → spring → 출력
 */
function renderFrame(now: number): void {
  const delta = Math.min((now - previousTime) / 1000, 0.1);
  const elapsed = reduceMotion || QA_MODE ? 0 : (now - startTime) / 1000;
  previousTime = now;

  if (!QA_MODE) liquid.update(delta, pointerTarget);
  uploadLiquidState();
  renderDeformedGlyphPass();
  renderInteractionPass(elapsed);
  renderStrokeSpreadPasses();
  renderNearestSeedPasses();
  renderMetaballSurfacePasses();
  renderGlyphSpringPass(delta);
  renderOutputPass(elapsed);

  requestAnimationFrame(renderFrame);
}

requestAnimationFrame(renderFrame);
