// These are the final artwork values. The GUI mutates this object at runtime so
// each stage can be studied without keeping alternate rendering implementations.
export const layerControls = {
  reelStep: '11 final' as ReelStep,
  debugView: 'final' as DebugView,
  showContactDebug: false,
  showSourceLayer: true,
  showCircleStrokeLayer: true,
  showRefractionLayer: true,
  showChromaticLayer: true,
  showInnerShadeLayer: true,
  showGlassMilkLayer: true,
  showTopWashLayer: true,
  showRimLayer: true,
  showHardRimLayer: true,
  showCaRimLayer: true,
  showSpecLayer: true,
  showOuterStrokeLayer: true,
  showShadowLayer: true,

  backgroundColor: '#fffefb',
  marbleScale: 1.22,
  dragSensitivity: 1,
  longPressDuration: 0.35,
  longPressMoveThreshold: 10,
  sourceFollow: 0.3,

  seedRadiusScale: 0.74,
  bridgeRadiusRatio: 0.8,
  membraneBridgeRadiusRatio: 0.12,
  membraneFanThreshold: 0.015,
  contactRadiusShrinkStart: 0.47,
  contactRadiusShrinkEnd: 3.6,
  contactRadiusMinScale: 0.58,
  contactFill: 1,
  edgeConcavity: -0.08,
  fieldSmoothness: 0.7,
  contactBlendDuration: 0.12,
  areaPreservation: 0.92,
  minimumNeckWidth: 0.18,
  pressureResponse: 18.5,
  releaseHoldDuration: 0.02,
  releaseLifetime: 0.42,
  springFrequency: 3.8,

  idleSpeed: 0.5,
  idleAxisDrift: 0.16,
  idleResumeDelay: 0.9,
  idleHandoffDuration: 0.8,
  inertiaDamping: 5,

  contentOverscan: 0.46,
  circleCount: 10,
  circleSizeScale: 2,
  circleSizeVariance: 0,
  edgeScaleFloor: 0.32,
  backTransitionWidth: 0.06,
  circleStrokeBackAlpha: 0.65,
  circleStrokeScale: 1,

  bezelWidth: 0.2,
  thickness: 0.4,
  displacementFactor: 0.75,
  ior: 1.65,
  dispersion: 0.24,
  chromaticEdgeStrength: 2,
  chromaticEdgeWidth: 9.5,
  chromaticBoundaryStrength: 1.5,
  chromaticBoundaryWidth: 6,

  specRotationGain: 1.8,
  specEdgeDwell: 1.55,
  specEdgeFade: 0.18,
  specBoundarySamples: 48,
  specLargeIntensity: 3.5,
  specLargeSoftness: 2 / 3,
  specMediumIntensity: 4,
  specMediumSoftness: 2 / 3,
};

export type ReelStep =
  | '00 clear'
  | '01 source'
  | '02 source strokes'
  | '03 refraction'
  | '04 chromatic'
  | '05 inner shade'
  | '06 glass milk'
  | '07 top wash'
  | '08 rim'
  | '09 hard / CA rim'
  | '10 specular'
  | '11 final'
  | 'custom';

export type DebugView = 'final' | 'contact field' | 'surface normals' | 'spec mask';
export type LayerControls = typeof layerControls;
