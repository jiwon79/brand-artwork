import GUI from 'lil-gui';
import {
  GuseulWebGLRenderer,
  type GpuGlassFrame,
} from './webgl-renderer';
import {
  ElasticContactField,
  type ElasticShapeFrame,
  type ElasticVec2,
} from './elastic-contact-field';
import {
  applyMatrix3,
  clamp,
  crossVec3,
  dotVec3,
  mix,
  multiplyMatrix3,
  normalizeVec3,
  projectOntoTangent,
  reflectVec3,
  rotationMatrixFromAxisAngle,
  smoothstep,
  type Matrix3,
  type Vec3,
} from './math';
import {
  layerControls,
  type LayerControls,
} from './settings';
import {
  presentationControls,
  setupReelPresentation,
  type PresentationControls,
} from './reel-presentation';

type MarbleCircle = {
  x: number;
  y: number;
  z: number;
  radius: number;
  color: string;
  artworkIndex: number;
  cropX: number;
  cropY: number;
  imageZoom: number;
};

type CircleArtwork = {
  image: HTMLImageElement;
  focalX: number;
  focalY: number;
  zoom: number;
};

type VisibleMarbleCircle = MarbleCircle & {
  cx: number;
  cy: number;
  dot: number;
  z: number;
  scale: number;
  fillAlpha: number;
  hazeAlpha: number;
  blur: number;
  saturation: number;
  brightness: number;
  back: boolean;
  strokeAlpha: number;
};

type View = {
  width: number;
  height: number;
  dpr: number;
  cx: number;
  cy: number;
  radius: number;
};

type Rgb = [number, number, number];

type SpecHighlight = {
  shape: 'rect' | 'circle';
  carrier: Vec3;
  halfWidth: number;
  halfHeight: number;
  softness: number;
  power: number;
  intensity: number;
};

type PreparedSpecHighlight = SpecHighlight & {
  sourceDirection: Vec3;
  axisX: Vec3;
  axisY: Vec3;
  visibility: number;
  intensityScale: number;
  softnessScale: number;
};

type PointerPosition = {
  x: number;
  y: number;
  startX: number;
  startY: number;
  stretchStartX?: number;
  stretchStartY?: number;
  contactStartX?: number;
  contactStartY?: number;
};

type GestureMode = 'idle' | 'pending' | 'rotate' | 'stretch';

type RenderParams = {
  view: View;
  controls: LayerControls;
  presentation: PresentationControls;
  orientation: Matrix3;
  specOrientation: Matrix3;
  elasticShape: ElasticShapeFrame;
};

const canvas = document.getElementById('artwork') as HTMLCanvasElement;
const stage = document.getElementById('stage');

function createCanvasContext(
  target: HTMLCanvasElement,
  options: CanvasRenderingContext2DSettings = {},
): CanvasRenderingContext2D {
  const context = target.getContext('2d', options);
  if (!context) throw new Error('2D canvas is not supported.');
  return context;
}

const ctx = createCanvasContext(canvas, { alpha: false });
const contentCanvas = document.createElement('canvas');
const contentCtx = createCanvasContext(contentCanvas, { alpha: false });

// Static source artwork and sphere-space highlight definitions.
const maxMarbleCircleCount = 10;
const marbleCirclePalette = [
  '#f15b2e',
  '#ffe25f',
  '#a51b4e',
  '#ff8d24',
  '#0c2241',
  '#76d650',
  '#ff6d2b',
  '#159b80',
  '#4b9fd1',
  '#153f6a',
  '#f66a7c',
  '#35c7d2',
];

const circleArtworkSources = [
  { src: new URL('./assets/photos/soft-glass.webp', import.meta.url).href, focalX: 0.54, focalY: 0.52, zoom: 1.04 },
  { src: new URL('./assets/photos/spectrum-flow.webp', import.meta.url).href, focalX: 0.5, focalY: 0.5, zoom: 1.02 },
  { src: new URL('./assets/photos/peach-gradient.webp', import.meta.url).href, focalX: 0.5, focalY: 0.5, zoom: 1.02 },
  { src: new URL('./assets/photos/blue-teal-gradient.webp', import.meta.url).href, focalX: 0.5, focalY: 0.5, zoom: 1.02 },
  { src: new URL('./assets/photos/teal-rings.webp', import.meta.url).href, focalX: 0.52, focalY: 0.5, zoom: 1.06 },
  { src: new URL('./assets/photos/pink-orange-light.webp', import.meta.url).href, focalX: 0.5, focalY: 0.48, zoom: 1.05 },
  { src: new URL('./assets/photos/pink-waves.webp', import.meta.url).href, focalX: 0.52, focalY: 0.64, zoom: 1.06 },
  { src: new URL('./assets/photos/green-yellow-gradient.webp', import.meta.url).href, focalX: 0.5, focalY: 0.5, zoom: 1.02 },
  { src: new URL('./assets/photos/orange-petals.webp', import.meta.url).href, focalX: 0.48, focalY: 0.22, zoom: 1.2 },
  { src: new URL('./assets/photos/green-leaf.webp', import.meta.url).href, focalX: 0.78, focalY: 0.54, zoom: 1.6 },
];

const circleArtworks: CircleArtwork[] = circleArtworkSources.map((source) => {
  const image = new Image();
  image.decoding = 'async';
  image.src = source.src;

  return {
    image,
    focalX: source.focalX,
    focalY: source.focalY,
    zoom: source.zoom,
  };
});

const specCarrierPositions: Vec3[] = [
  [0.1039, 0.0024, 0.9946],
  [0.6834, -0.1646, 0.7113],
  [0.08, 0.86, 0.5],
  [-0.93, -0.12, 0.35],
  [-0.68, 0.35, 0.64],
  [-0.1302, -0.6955, 0.7066],
  [0.76, 0.18, -0.62],
  [0.08, -0.9, -0.42],
  [-0.2182, -0.3413, -0.9143],
  [-0.7706, -0.1155, -0.6268],
  [-0.18, 0.72, -0.67],
];

const largeWindowSpecs: SpecHighlight[] = [
  { shape: 'rect', carrier: specCarrierPositions[0], halfWidth: 0.42, halfHeight: 0.158, softness: 0.4, power: 1.5, intensity: 38 },
  { shape: 'rect', carrier: specCarrierPositions[4], halfWidth: 0.36, halfHeight: 0.135, softness: 0.44, power: 1.48, intensity: 34 },
  { shape: 'rect', carrier: specCarrierPositions[8], halfWidth: 0.39, halfHeight: 0.145, softness: 0.42, power: 1.49, intensity: 36 },
  { shape: 'circle', carrier: specCarrierPositions[1], halfWidth: 0.255, halfHeight: 0.255, softness: 0.54, power: 1.46, intensity: 32 },
  { shape: 'circle', carrier: specCarrierPositions[5], halfWidth: 0.24, halfHeight: 0.24, softness: 0.56, power: 1.44, intensity: 30 },
  { shape: 'circle', carrier: specCarrierPositions[9], halfWidth: 0.24, halfHeight: 0.24, softness: 0.56, power: 1.44, intensity: 30 },
];

const mediumWindowSpecs: SpecHighlight[] = [
  { shape: 'circle', carrier: specCarrierPositions[2], halfWidth: 0.18, halfHeight: 0.18, softness: 0.66, power: 1.34, intensity: 22 },
  { shape: 'circle', carrier: specCarrierPositions[3], halfWidth: 0.18, halfHeight: 0.18, softness: 0.68, power: 1.38, intensity: 21 },
  { shape: 'circle', carrier: specCarrierPositions[6], halfWidth: 0.18, halfHeight: 0.18, softness: 0.68, power: 1.4, intensity: 20 },
  { shape: 'circle', carrier: specCarrierPositions[7], halfWidth: 0.18, halfHeight: 0.18, softness: 0.68, power: 1.38, intensity: 21 },
  { shape: 'circle', carrier: specCarrierPositions[10], halfWidth: 0.18, halfHeight: 0.18, softness: 0.68, power: 1.4, intensity: 20 },
];

const elasticField = new ElasticContactField(layerControls);

// Builds the CPU source texture, renders the glass on the GPU, then composites it.
class SceneRenderer {
  private readonly glass = new GuseulWebGLRenderer();

  resize(params: RenderParams): void {
    resizeRenderTargets(params);
    this.glass.resize(canvas.width, canvas.height);
  }

  render(params: RenderParams): void {
    drawContentLayer(params);

    const preparedSpecs = prepareSpecHighlights(params);
    const background = backgroundSample(params.controls);
    const frame: GpuGlassFrame = {
      contentCanvas,
      viewportCss: [params.view.width, params.view.height],
      centerCss: [params.view.cx, params.view.cy],
      radiusCss: params.view.radius,
      elasticShape: params.elasticShape,
      circles: visibleCircles.map((circle) => ({
        centerX: circle.cx,
        centerY: circle.cy,
        radius: circle.radius * params.controls.circleSizeScale * circle.scale,
        alpha: circle.fillAlpha,
      })),
      specs: preparedSpecs.map((spec) => ({
        sourceDirection: spec.sourceDirection,
        axisX: spec.axisX,
        axisY: spec.axisY,
        halfWidth: spec.halfWidth,
        halfHeight: spec.halfHeight,
        softness: clamp(spec.softness * spec.softnessScale, 0.08, 1.8),
        shape: spec.shape,
        power: spec.power,
        intensity: spec.intensity * spec.intensityScale,
        visibility: spec.visibility,
      })),
      controls: {
        background: [background[0] / 255, background[1] / 255, background[2] / 255],
        debugView: params.presentation.debugView,
        showContactDebug: params.presentation.showContactDebug,
        showSourceLayer: params.presentation.showSourceLayer,
        showRefractionLayer: params.presentation.showRefractionLayer,
        showChromaticLayer: params.presentation.showChromaticLayer,
        showInnerShadeLayer: params.presentation.showInnerShadeLayer,
        showGlassMilkLayer: params.presentation.showGlassMilkLayer,
        showTopWashLayer: params.presentation.showTopWashLayer,
        showRimLayer: params.presentation.showRimLayer,
        showHardRimLayer: params.presentation.showHardRimLayer,
        showCaRimLayer: params.presentation.showCaRimLayer,
        showSpecLayer: params.presentation.showSpecLayer,
        showOuterStrokeLayer: params.presentation.showOuterStrokeLayer,
        contentOverscan: params.controls.contentOverscan,
        sourceFollow: params.controls.sourceFollow,
        bezelWidth: params.controls.bezelWidth,
        thickness: params.controls.thickness,
        displacementFactor: params.controls.displacementFactor,
        ior: params.controls.ior,
        dispersion: params.controls.dispersion,
        chromaticEdgeStrength: params.controls.chromaticEdgeStrength,
        chromaticEdgeWidth: params.controls.chromaticEdgeWidth,
        chromaticBoundaryStrength: params.controls.chromaticBoundaryStrength,
        chromaticBoundaryWidth: params.controls.chromaticBoundaryWidth,
      },
    };

    this.glass.render(frame);
    compositeScene(params, this.glass.canvas);
  }
}

let visibleCircles: VisibleMarbleCircle[] = [];
let view: View = {
  width: 1,
  height: 1,
  dpr: 1,
  cx: 0,
  cy: 0,
  radius: 1,
};

function createInitialOrientation(): Matrix3 {
  return multiplyMatrix3(
    rotationMatrixFromAxisAngle([0, 1, 0], 0.14),
    rotationMatrixFromAxisAngle([1, 0, 0], -0.1),
  );
}

let sphereOrientation = createInitialOrientation();
let specOrientation = createInitialOrientation();
let spinAxis: Vec3 = [0, 0, 0];
let spinVelocity = 0;
const activePointers = new Map<number, PointerPosition>();
const elasticPointerContacts = new Map<number, number>();
let gestureMode: GestureMode = 'idle';
let longPressTimer: number | null = null;
let pointerId: number | null = null;
let lastPointerX = 0;
let lastPointerY = 0;
let lastPointerTime = 0;
let lastFrame = 0;
let idleResumeAt = 0;
const renderer = new SceneRenderer();
canvas.dataset.renderer = 'webgl2';
canvas.dataset.gestureMode = gestureMode;

function getRenderParams(): RenderParams {
  return {
    view,
    controls: layerControls,
    presentation: presentationControls,
    orientation: sphereOrientation,
    specOrientation,
    elasticShape: elasticField.getFrame(),
  };
}

function pseudoRandom(index: number, salt: number): number {
  const value = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;

  return value - Math.floor(value);
}

function createMarbleCircles(count: number, controls: LayerControls = layerControls): MarbleCircle[] {
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));

  return Array.from({ length: count }, (_, index) => {
    const y = 1 - (2 * (index + 0.5)) / count;
    const radial = Math.sqrt(Math.max(1 - y * y, 0));
    const theta = index * goldenAngle + pseudoRandom(index, 1) * 0.42;
    const baseSize = 0.25;
    const variance = (pseudoRandom(index, 2) - 0.5) * 0.16 * controls.circleSizeVariance;
    const size = clamp(baseSize + variance, 0.05, 0.5);
    const artworkIndex = (index * 7) % circleArtworks.length;
    const artwork = circleArtworks[artworkIndex];

    return {
      x: Math.cos(theta) * radial,
      y,
      z: Math.sin(theta) * radial,
      radius: size,
      color: marbleCirclePalette[Math.floor(pseudoRandom(index, 3) * marbleCirclePalette.length)],
      artworkIndex,
      cropX: clamp(artwork.focalX + (pseudoRandom(index, 4) - 0.5) * 0.12, 0.08, 0.92),
      cropY: clamp(artwork.focalY + (pseudoRandom(index, 5) - 0.5) * 0.12, 0.08, 0.92),
      imageZoom: artwork.zoom * mix(0.94, 1.12, pseudoRandom(index, 6)),
    };
  });
}

function backgroundSample(controls: LayerControls = layerControls): Rgb {
  const hex = controls.backgroundColor.trim();
  const normalized = /^#[0-9a-f]{6}$/i.test(hex) ? hex.slice(1) : 'fffefb';

  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16),
  ];
}

function getContentOverscan(controls: LayerControls): number {
  return Math.max(controls.contentOverscan, 0);
}

function getContentSize(params: RenderParams): number {
  return params.view.radius * 2 * (1 + getContentOverscan(params.controls) * 2);
}

function getContentCenter(params: RenderParams): number {
  return params.view.radius * (1 + getContentOverscan(params.controls));
}

function reflectionDerivative(carrier: Vec3, tangent: Vec3): Vec3 {
  const carrierZ = carrier[2];
  const tangentZ = tangent[2];

  return [
    2 * (tangentZ * carrier[0] + carrierZ * tangent[0]),
    2 * (tangentZ * carrier[1] + carrierZ * tangent[1]),
    2 * (tangentZ * carrier[2] + carrierZ * tangent[2]),
  ];
}

function applySpecEdgeDwell(carrier: Vec3, power: number): Vec3 {
  const xyLength = Math.hypot(carrier[0], carrier[1]);

  if (xyLength <= 0.000001) {
    return carrier;
  }

  const z = Math.sign(carrier[2]) * Math.abs(carrier[2]) ** power;
  const xyScale = Math.sqrt(Math.max(1 - z * z, 0)) / xyLength;

  return [carrier[0] * xyScale, carrier[1] * xyScale, z];
}

function prepareSpecHighlight(
  spec: SpecHighlight,
  orientation: Matrix3,
  controls: LayerControls,
  intensityScale: number,
  softnessScale: number,
): PreparedSpecHighlight {
  // The carrier owns the orbit; its reflected source and tangent frame preserve the glass distortion.
  const baseCarrier = normalizeVec3(spec.carrier);
  const baseAxisX = projectOntoTangent([1, 0, 0], baseCarrier);
  const baseAxisY = normalizeVec3(crossVec3(baseCarrier, baseAxisX));
  const orbitCarrier = normalizeVec3(applyMatrix3(orientation, baseCarrier));
  const carrier = applySpecEdgeDwell(orbitCarrier, controls.specEdgeDwell);
  const carrierAxisX = projectOntoTangent(applyMatrix3(orientation, baseAxisX), carrier);
  const carrierAxisY = projectOntoTangent(applyMatrix3(orientation, baseAxisY), carrier);
  const sourceDirection = normalizeVec3(reflectVec3([0, 0, -1], carrier));
  const axisX = projectOntoTangent(reflectionDerivative(carrier, carrierAxisX), sourceDirection);
  const rawAxisY = projectOntoTangent(reflectionDerivative(carrier, carrierAxisY), sourceDirection);
  const axisY = normalizeVec3(crossVec3(sourceDirection, axisX));

  if (dotVec3(axisY, rawAxisY) < 0) {
    axisY[0] *= -1;
    axisY[1] *= -1;
    axisY[2] *= -1;
  }

  return {
    ...spec,
    sourceDirection,
    axisX,
    axisY,
    visibility: orbitCarrier[2] <= 0 ? 0 : smoothstep(0, controls.specEdgeFade, orbitCarrier[2]),
    intensityScale,
    softnessScale,
  };
}

function prepareSpecHighlights(params: RenderParams): PreparedSpecHighlight[] {
  const specs: PreparedSpecHighlight[] = [];
  const groups = [
    {
      items: largeWindowSpecs,
      intensity: params.controls.specLargeIntensity,
      softness: params.controls.specLargeSoftness,
    },
    {
      items: mediumWindowSpecs,
      intensity: params.controls.specMediumIntensity,
      softness: params.controls.specMediumSoftness,
    },
  ];

  for (const group of groups) {
    for (const spec of group.items) {
      const prepared = prepareSpecHighlight(
        spec,
        params.specOrientation,
        params.controls,
        group.intensity,
        group.softness,
      );

      if (prepared.visibility > 0) {
        specs.push(prepared);
      }
    }
  }

  return specs;
}

function applyScreenAxisRotation(axis: Vec3, angle: number): void {
  sphereOrientation = multiplyMatrix3(
    rotationMatrixFromAxisAngle(axis, angle),
    sphereOrientation,
  );
  specOrientation = multiplyMatrix3(
    rotationMatrixFromAxisAngle(axis, angle * layerControls.specRotationGain),
    specOrientation,
  );
}

function applyContentAxisRotation(axis: Vec3, angle: number): void {
  sphereOrientation = multiplyMatrix3(
    rotationMatrixFromAxisAngle(axis, angle),
    sphereOrientation,
  );
}

function applyBackgroundColor(): void {
  document.documentElement.style.backgroundColor = layerControls.backgroundColor;
  document.body.style.backgroundColor = layerControls.backgroundColor;
  canvas.style.backgroundColor = layerControls.backgroundColor;
  stage?.style.setProperty('background', layerControls.backgroundColor);
}

function rotateSpherePoint(orientation: Matrix3, x: number, y: number, z: number): Vec3 {
  return applyMatrix3(orientation, normalizeVec3([x, y, z]));
}

function projectMarbleCircle(circle: MarbleCircle, params: RenderParams): VisibleMarbleCircle {
  const [x, y, z] = rotateSpherePoint(params.orientation, circle.x, circle.y, circle.z);
  const transitionWidth = Math.max(params.controls.backTransitionWidth, 0.001);
  const edgeScaleFloor = params.controls.edgeScaleFloor;
  const displayDepth = clamp(z, 0, 1);
  const backDepth = smoothstep(0, 1, Math.max(-z, 0));
  const backBlend = smoothstep(0, transitionWidth, -z);
  const frontDepth = smoothstep(0, 0.86, displayDepth);
  const frontScale = mix(edgeScaleFloor, 1.04, displayDepth ** 1.7);
  const backScale = mix(
    edgeScaleFloor * 0.9,
    Math.max(0.52, edgeScaleFloor),
    backDepth ** 0.58,
  );

  return {
    ...circle,
    cx: x,
    cy: y,
    dot: mix(displayDepth, backDepth, backBlend),
    z: mix(displayDepth, -backDepth, backBlend),
    scale: mix(frontScale, backScale, backBlend),
    fillAlpha: mix(
      mix(0.94, 1, frontDepth),
      mix(0.86, 0.84, backDepth),
      backBlend,
    ),
    hazeAlpha: mix(
      mix(0.035, 0, frontDepth),
      mix(0.01, 0.02, backDepth),
      backBlend,
    ),
    blur: mix(0, mix(0.18, 0.55, backDepth), backBlend),
    saturation: mix(1, mix(0.88, 0.76, backDepth), backBlend),
    brightness: mix(1, mix(0.9, 0.8, backDepth), backBlend),
    back: z < 0,
    strokeAlpha: mix(params.controls.circleStrokeBackAlpha, 1, frontDepth),
  };
}

function setupGui(): void {
  const gui = new GUI({ title: 'Guseul layers' });
  gui.domElement.addEventListener('pointerdown', (event) => {
    event.stopPropagation();
  });

  const scene = gui.addFolder('1 scene');
  scene.addColor(layerControls, 'backgroundColor').name('background').onChange(applyBackgroundColor);
  scene.add(layerControls, 'marbleScale', 0.7, 1.8, 0.01).name('marble scale').onChange(resize);
  scene.add(layerControls, 'dragSensitivity', 0.4, 1.8, 0.01).name('drag sensitivity');

  const idleMotion = scene.addFolder('auto rotation');
  idleMotion.add(layerControls, 'idleSpeed', 0, 1, 0.001).name('speed');
  idleMotion.add(layerControls, 'idleAxisDrift', 0, 2, 0.01).name('axis drift');
  idleMotion.add(layerControls, 'idleResumeDelay', 0, 10, 0.05).name('resume delay');
  idleMotion.add(layerControls, 'idleHandoffDuration', 0, 5, 0.05).name('handoff duration');
  idleMotion.add(layerControls, 'inertiaDamping', 0.2, 15, 0.1).name('inertia damping');

  const elastic = gui.addFolder('2 elastic shape');
  const elasticActions = {
    resetContacts: () => {
      elasticField.clear();
      elasticPointerContacts.clear();
      clearLongPressTimer();
      setGestureMode('idle');
      idleResumeAt = performance.now() + layerControls.idleResumeDelay * 1000;
    },
  };
  elastic.add(layerControls, 'sourceFollow', 0, 1, 0.01).name('source follow');
  elastic.add(elasticActions, 'resetContacts').name('reset contacts');

  const gestureInput = elastic.addFolder('gesture input');
  gestureInput.add(layerControls, 'longPressDuration', 0.15, 0.8, 0.01)
    .name('long press');
  gestureInput.add(layerControls, 'longPressMoveThreshold', 2, 30, 1)
    .name('move threshold');

  const contactField = elastic.addFolder('contact field');
  contactField.add(layerControls, 'seedRadiusScale', 0.25, 1, 0.01).name('seed radius');
  contactField.add(layerControls, 'bridgeRadiusRatio', 0.005, 0.8, 0.005).name('center bridge / seed');
  contactField.add(layerControls, 'contactRadiusShrinkStart', 0, 3, 0.01).name('shrink start');
  contactField.add(layerControls, 'contactRadiusShrinkEnd', 0.05, 6, 0.01).name('shrink end');
  contactField.add(layerControls, 'contactRadiusMinScale', 0.02, 1, 0.01).name('minimum radius');
  contactField.add(layerControls, 'contactBlendDuration', 0, 3, 0.01).name('contact blend');

  const contactMembrane = elastic.addFolder('contact membrane');
  contactMembrane.add(layerControls, 'membraneBridgeRadiusRatio', 0.005, 0.8, 0.005)
    .name('bridge / seed');
  contactMembrane.add(layerControls, 'membraneFanThreshold', 0, 0.25, 0.001)
    .name('fan threshold');
  contactMembrane.add(layerControls, 'contactFill', 0, 1, 0.01).name('contact fill');
  contactMembrane.add(layerControls, 'edgeConcavity', -1, 2.5, 0.01).name('edge concavity');
  contactMembrane.add(layerControls, 'fieldSmoothness', 0.001, 1.5, 0.001)
    .name('smooth union');

  const areaPressure = elastic.addFolder('area pressure');
  areaPressure.add(layerControls, 'areaPreservation', 0, 1, 0.01).name('preservation');
  areaPressure.add(layerControls, 'minimumNeckWidth', 0.04, 0.5, 0.01).name('minimum neck');
  areaPressure.add(layerControls, 'pressureResponse', 1, 40, 0.5).name('response');

  const releaseSpring = elastic.addFolder('release spring');
  releaseSpring.add(layerControls, 'springFrequency', 0.5, 10, 0.1).name('frequency');
  releaseSpring.add(layerControls, 'releaseHoldDuration', 0, 0.25, 0.01).name('contact hold');
  releaseSpring.add(layerControls, 'releaseLifetime', 0.08, 0.6, 0.01).name('contact lifetime');

  const source = gui.addFolder('3 source circles');
  source.add(layerControls, 'contentOverscan', 0.1, 0.9, 0.01).name('overscan').onChange(resize);
  source.add(layerControls, 'circleCount', 4, maxMarbleCircleCount, 1).name('count');
  source.add(layerControls, 'circleSizeScale', 0.45, 2.6, 0.01).name('size');
  source.add(layerControls, 'circleSizeVariance', 0, 2.5, 0.01).name('size variance');
  source.add(layerControls, 'circleStrokeBackAlpha', 0, 1, 0.01).name('back stroke alpha');
  source.add(layerControls, 'circleStrokeScale', 0, 2, 0.01).name('stroke scale');

  const depthProjection = source.addFolder('depth projection');
  depthProjection.add(layerControls, 'edgeScaleFloor', 0.08, 0.8, 0.01).name('edge min size');
  depthProjection.add(layerControls, 'backTransitionWidth', 0.01, 0.3, 0.01)
    .name('back transition');

  const glass = gui.addFolder('4 glass refraction');
  glass.add(layerControls, 'bezelWidth', 0.04, 0.55, 0.01).name('bezel width');
  glass.add(layerControls, 'thickness', 0, 0.9, 0.01).name('thickness');
  glass.add(layerControls, 'displacementFactor', 0, 2, 0.01).name('displace factor');
  glass.add(layerControls, 'ior', 1.01, 2.4, 0.01).name('ior');
  glass.add(layerControls, 'dispersion', 0, 0.5, 0.001).name('dispersion');
  glass.add(layerControls, 'chromaticEdgeStrength', 0, 4, 0.01).name('edge chroma');
  glass.add(layerControls, 'chromaticEdgeWidth', 0, 12, 0.1).name('edge width');
  glass.add(layerControls, 'chromaticBoundaryStrength', 0, 3, 0.01).name('source edge');
  glass.add(layerControls, 'chromaticBoundaryWidth', 0.5, 14, 0.1).name('source feather');

  const spec = gui.addFolder('5 specular highlights');
  spec.add(layerControls, 'specRotationGain', 0.5, 2.5, 0.01).name('rotation gain');
  spec.add(layerControls, 'specEdgeDwell', 1, 3, 0.01).name('edge dwell');
  spec.add(layerControls, 'specEdgeFade', 0.02, 0.4, 0.01).name('edge fade');
  spec.add(layerControls, 'specBoundarySamples', 16, 64, 4).name('boundary samples');

  const largeSpec = spec.addFolder('large');
  largeSpec.add(layerControls, 'specLargeIntensity', 0, 8, 0.0025).name('intensity');
  largeSpec.add(layerControls, 'specLargeSoftness', 0.45, 2.2, 0.01).name('softness');

  const mediumSpec = spec.addFolder('medium');
  mediumSpec.add(layerControls, 'specMediumIntensity', 0, 8, 0.0025).name('intensity');
  mediumSpec.add(layerControls, 'specMediumSoftness', 0.45, 2.2, 0.01).name('softness');

  contactField.close();
  contactMembrane.close();
  areaPressure.close();
  releaseSpring.close();
  elastic.close();
  idleMotion.close();
  depthProjection.close();
  largeSpec.close();
  mediumSpec.close();
  spec.close();
  scene.close();
  source.close();
  glass.close();
}

function resizeRenderTargets(params: RenderParams): void {
  const renderView = params.view;

  canvas.width = Math.round(renderView.width * renderView.dpr);
  canvas.height = Math.round(renderView.height * renderView.dpr);
  ctx.setTransform(renderView.dpr, 0, 0, renderView.dpr, 0, 0);

  const contentSize = Math.max(2, Math.round(getContentSize(params) * renderView.dpr));
  contentCanvas.width = contentSize;
  contentCanvas.height = contentSize;
}

function resize(): void {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const baseRadius = clamp(Math.min(width, height) * 0.18, 82, 148);
  const maxRadius = Math.max(82, Math.min(width, height) * 0.34);
  const radius = clamp(baseRadius * layerControls.marbleScale, 82, maxRadius);

  view = {
    width,
    height,
    dpr,
    cx: width / 2,
    cy: height / 2,
    radius,
  };

  renderer.resize(getRenderParams());
}

function drawCircleArtwork(circle: VisibleMarbleCircle, centerX: number, centerY: number, size: number): void {
  const artwork = circleArtworks[circle.artworkIndex];
  const image = artwork.image;

  if (!image.complete || image.naturalWidth <= 0 || image.naturalHeight <= 0) {
    return;
  }

  const diameter = size * 2;
  const coverScale = Math.max(diameter / image.naturalWidth, diameter / image.naturalHeight) * circle.imageZoom;
  const sourceWidth = Math.min(image.naturalWidth, diameter / coverScale);
  const sourceHeight = Math.min(image.naturalHeight, diameter / coverScale);
  const sourceX = clamp(circle.cropX * image.naturalWidth - sourceWidth * 0.5, 0, image.naturalWidth - sourceWidth);
  const sourceY = clamp(circle.cropY * image.naturalHeight - sourceHeight * 0.5, 0, image.naturalHeight - sourceHeight);

  contentCtx.drawImage(
    image,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    centerX - size,
    centerY - size,
    diameter,
    diameter,
  );
}

function drawContentCircle(circle: VisibleMarbleCircle, params: RenderParams): void {
  const radius = params.view.radius;
  const center = getContentCenter(params);
  const size = circle.radius * params.controls.circleSizeScale * radius * circle.scale;
  const centerX = center + circle.cx * radius;
  const centerY = center + circle.cy * radius;
  const strokeWidth = Math.min(size * 0.34, clamp(radius * 0.048, 4, 8))
    * params.controls.circleStrokeScale;

  contentCtx.save();
  contentCtx.filter = `blur(${circle.blur}px) saturate(${circle.saturation}) brightness(${circle.brightness})`;
  contentCtx.beginPath();
  contentCtx.arc(centerX, centerY, size, 0, Math.PI * 2);
  contentCtx.clip();
  contentCtx.globalAlpha = circle.fillAlpha;
  contentCtx.fillStyle = circle.color;
  contentCtx.fillRect(centerX - size, centerY - size, size * 2, size * 2);
  drawCircleArtwork(circle, centerX, centerY, size);
  if (circle.hazeAlpha > 0) {
    contentCtx.globalAlpha = circle.hazeAlpha;
    contentCtx.fillStyle = params.controls.backgroundColor;
    contentCtx.fillRect(centerX - size, centerY - size, size * 2, size * 2);
  }
  contentCtx.restore();

  if (
    params.presentation.showCircleStrokeLayer
    && strokeWidth > 0
    && circle.strokeAlpha > 0
  ) {
    contentCtx.save();
    contentCtx.globalAlpha = circle.fillAlpha * circle.strokeAlpha;
    contentCtx.lineWidth = strokeWidth;
    contentCtx.strokeStyle = '#ffffff';
    contentCtx.beginPath();
    contentCtx.arc(centerX, centerY, size, 0, Math.PI * 2);
    contentCtx.stroke();
    contentCtx.restore();
  }
}

function collectVisibleCircles(params: RenderParams): VisibleMarbleCircle[] {
  const items: VisibleMarbleCircle[] = [];
  const count = clamp(Math.round(params.controls.circleCount), 1, maxMarbleCircleCount);
  const circles = createMarbleCircles(count, params.controls);

  for (const circle of circles) {
    items.push(projectMarbleCircle(circle, params));
  }

  return items.sort((a, b) => {
    if (a.back !== b.back) {
      return a.back ? -1 : 1;
    }

    return a.dot - b.dot;
  });
}

function drawContentLayer(params: RenderParams): void {
  const size = getContentSize(params);

  contentCtx.setTransform(1, 0, 0, 1, 0, 0);
  contentCtx.clearRect(0, 0, contentCanvas.width, contentCanvas.height);
  contentCtx.setTransform(params.view.dpr, 0, 0, params.view.dpr, 0, 0);

  contentCtx.fillStyle = params.controls.backgroundColor;
  contentCtx.fillRect(0, 0, size, size);

  visibleCircles = collectVisibleCircles(params);

  for (const item of visibleCircles) {
    drawContentCircle(item, params);
  }
}

function compositeScene(
  params: RenderParams,
  glassCanvas: CanvasImageSource,
): void {
  const renderView = params.view;

  ctx.clearRect(0, 0, renderView.width, renderView.height);
  ctx.fillStyle = params.controls.backgroundColor;
  ctx.fillRect(0, 0, renderView.width, renderView.height);

  ctx.save();
  if (params.presentation.showShadowLayer) {
    ctx.shadowColor = 'rgba(20, 34, 35, 0.2)';
    ctx.shadowBlur = renderView.radius * 0.16;
    ctx.shadowOffsetY = renderView.radius * 0.08;
  }
  ctx.drawImage(glassCanvas, 0, 0, renderView.width, renderView.height);
  ctx.restore();
}

function tick(now: number): void {
  const dt = Math.min(0.05, Math.max(0.001, (now - lastFrame) / 1000 || 0.016));
  lastFrame = now;
  elasticField.update(dt);
  const idleMotionAllowed = activePointers.size === 0
    || gestureMode === 'pending'
    || gestureMode === 'stretch';
  if (idleMotionAllowed) {
    const autoRotationReady = now >= idleResumeAt;
    const handoffDurationMs = layerControls.idleHandoffDuration * 1000;
    const handoffProgress = autoRotationReady
      ? handoffDurationMs <= 0
        ? 1
        : smoothstep(
          0,
          1,
          (now - idleResumeAt) / handoffDurationMs,
        )
      : 0;
    const inertiaWeight = 1 - handoffProgress;

    if (spinVelocity > 0 && inertiaWeight > 0) {
      applyScreenAxisRotation(
        spinAxis,
        spinVelocity * inertiaWeight * dt,
      );
    }

    if (autoRotationReady && handoffProgress > 0) {
      const phase = now * 0.00009;
      const drift = layerControls.idleAxisDrift;
      const idleAxis = normalizeVec3([
        Math.sin(phase) * drift,
        1,
        Math.cos(phase * 0.83) * drift * 0.55,
      ]);

      applyContentAxisRotation(
        idleAxis,
        layerControls.idleSpeed * handoffProgress * dt,
      );
    }

    if (spinVelocity > 0) {
      spinVelocity *= Math.exp(-layerControls.inertiaDamping * dt);
      if (spinVelocity < 0.01 || handoffProgress >= 1) {
        spinVelocity = 0;
      }
    }
  }

  renderer.render(getRenderParams());

  requestAnimationFrame(tick);
}

function normalizedElasticPoint(clientX: number, clientY: number): ElasticVec2 {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (clientX - rect.left - view.cx) / view.radius,
    y: (clientY - rect.top - view.cy) / view.radius,
  };
}

function setGestureMode(nextMode: GestureMode): void {
  gestureMode = nextMode;
  canvas.dataset.gestureMode = nextMode;
  if (nextMode === 'rotate' || nextMode === 'stretch') {
    canvas.dataset.lastGesture = nextMode;
  }
  document.documentElement.classList.toggle(
    'guseul-stretch-active',
    nextMode === 'stretch',
  );
}

function clearLongPressTimer(): void {
  if (longPressTimer === null) return;
  window.clearTimeout(longPressTimer);
  longPressTimer = null;
}

function activateStretchGesture(): boolean {
  clearLongPressTimer();
  let contactCount = 0;

  for (const [activePointerId, pointer] of activePointers) {
    if (elasticPointerContacts.has(activePointerId)) {
      contactCount += 1;
      continue;
    }

    const currentPosition = normalizedElasticPoint(pointer.x, pointer.y);
    const startPosition = normalizedElasticPoint(pointer.startX, pointer.startY);
    const contactPosition = elasticField.contains(currentPosition)
      ? currentPosition
      : startPosition;
    if (elasticField.addContact(activePointerId, contactPosition)) {
      pointer.stretchStartX = pointer.x;
      pointer.stretchStartY = pointer.y;
      pointer.contactStartX = contactPosition.x;
      pointer.contactStartY = contactPosition.y;
      elasticPointerContacts.set(activePointerId, activePointerId);
      contactCount += 1;
    }
  }

  if (contactCount === 0) return false;

  pointerId = null;
  setGestureMode('stretch');
  return true;
}

function scheduleLongPress(): void {
  clearLongPressTimer();
  longPressTimer = window.setTimeout(() => {
    longPressTimer = null;
    if (gestureMode !== 'pending' || activePointers.size !== 1) return;

    for (const pointer of activePointers.values()) {
      const moved = Math.hypot(
        pointer.x - pointer.startX,
        pointer.y - pointer.startY,
      );
      if (moved <= layerControls.longPressMoveThreshold) {
        activateStretchGesture();
      }
      break;
    }
  }, layerControls.longPressDuration * 1000);
}

function trackPointer(event: PointerEvent): void {
  activePointers.set(event.pointerId, {
    x: event.clientX,
    y: event.clientY,
    startX: event.clientX,
    startY: event.clientY,
  });
  if (!canvas.hasPointerCapture(event.pointerId)) {
    canvas.setPointerCapture(event.pointerId);
  }
}

canvas.addEventListener('pointerdown', (event) => {
  const position = normalizedElasticPoint(event.clientX, event.clientY);
  if (!elasticField.contains(position)) return;

  event.preventDefault();
  trackPointer(event);

  if (activePointers.size >= 2 || gestureMode === 'stretch') {
    activateStretchGesture();
    return;
  }

  pointerId = event.pointerId;
  lastPointerX = event.clientX;
  lastPointerY = event.clientY;
  lastPointerTime = event.timeStamp || performance.now();
  setGestureMode('pending');
  scheduleLongPress();
});

canvas.addEventListener('pointermove', (event) => {
  const pointer = activePointers.get(event.pointerId);
  if (!pointer) return;

  event.preventDefault();
  pointer.x = event.clientX;
  pointer.y = event.clientY;
  const now = event.timeStamp || performance.now();

  const elasticContactId = elasticPointerContacts.get(event.pointerId);
  if (elasticContactId !== undefined) {
    const stretchStart = normalizedElasticPoint(
      pointer.stretchStartX ?? pointer.startX,
      pointer.stretchStartY ?? pointer.startY,
    );
    const currentPosition = normalizedElasticPoint(event.clientX, event.clientY);
    elasticField.moveContact(
      elasticContactId,
      {
        x: (pointer.contactStartX ?? stretchStart.x)
          + currentPosition.x - stretchStart.x,
        y: (pointer.contactStartY ?? stretchStart.y)
          + currentPosition.y - stretchStart.y,
      },
    );
    return;
  }

  if (gestureMode === 'pending') {
    const pendingDistance = Math.hypot(
      pointer.x - pointer.startX,
      pointer.y - pointer.startY,
    );
    if (pendingDistance <= layerControls.longPressMoveThreshold) return;

    clearLongPressTimer();
    spinVelocity = 0;
    idleResumeAt = Number.POSITIVE_INFINITY;
    pointerId = event.pointerId;
    lastPointerX = pointer.startX;
    lastPointerY = pointer.startY;
    setGestureMode('rotate');
  }

  if (gestureMode !== 'rotate' || pointerId !== event.pointerId) return;

  const dx = event.clientX - lastPointerX;
  const dy = event.clientY - lastPointerY;
  const distance = Math.hypot(dx, dy);

  if (distance > 0.001) {
    const normalizedAxis: Vec3 = [-dy / distance, dx / distance, 0];
    const angle = (distance / view.radius) * layerControls.dragSensitivity;
    const dt = Math.max((now - lastPointerTime) / 1000, 0.016);

    applyScreenAxisRotation(normalizedAxis, angle);
    spinAxis = normalizedAxis;
    spinVelocity = Math.min(angle / dt, 9);
    lastPointerTime = now;
  }

  lastPointerX = event.clientX;
  lastPointerY = event.clientY;
});

function releasePointer(event: PointerEvent): void {
  if (!activePointers.has(event.pointerId)) {
    return;
  }

  event.preventDefault();
  const now = event.timeStamp || performance.now();
  const releasedFromStretch = gestureMode === 'stretch';
  const preservesAutoRotation = releasedFromStretch
    || gestureMode === 'pending';
  const elasticContactId = elasticPointerContacts.get(event.pointerId);

  if (elasticContactId !== undefined) {
    elasticField.releaseContact(elasticContactId);
    elasticPointerContacts.delete(event.pointerId);
  } else if (pointerId === event.pointerId) {
    pointerId = null;
  }

  activePointers.delete(event.pointerId);

  if (canvas.hasPointerCapture(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }

  if (activePointers.size === 0) {
    clearLongPressTimer();
    setGestureMode('idle');
    if (!preservesAutoRotation) {
      idleResumeAt = now + layerControls.idleResumeDelay * 1000;
    }
  } else if (releasedFromStretch) {
    setGestureMode('stretch');
  }
}

canvas.addEventListener('pointerup', (event) => {
  releasePointer(event);
});

canvas.addEventListener('pointercancel', (event) => {
  releasePointer(event);
});

document.addEventListener('selectstart', (event) => {
  event.preventDefault();
});

document.addEventListener('dragstart', (event) => {
  event.preventDefault();
});

document.addEventListener('contextmenu', (event) => {
  event.preventDefault();
});

window.addEventListener('resize', resize);

setupReelPresentation();
setupGui();
applyBackgroundColor();
resize();
requestAnimationFrame(tick);
