/**
 * Color Text의 고정 크기와 조절 가능한 파라미터.
 *
 * 이 파일에는 시간에 따라 변하는 값이 없다. 작품을 공부할 때는 먼저
 * 여기에서 "어떤 숫자를 바꿀 수 있는가"를 확인하고, 실제 상태 변화는
 * liquid-solver.ts와 script.ts의 renderFrame()에서 따라가면 된다.
 */

export const ART_WIDTH = 480;
export const ART_HEIGHT = 600;
export const TEXTURE_SCALE = 3;
export const FIELD_WIDTH = ART_WIDTH;
export const FIELD_HEIGHT = ART_HEIGHT;

export const METABALL_SAMPLES = 192;
export const METABALL_SMOOTH_TAPS = 5;
export const STROKE_SPREAD_PASSES = 8;

export const LIQUID_PARTICLE_COUNT = 32;
export const SOLVER_LINK_COUNT = 16;
export const DRAG_ACTIVATION_DISTANCE = 8;
export const LIQUID_SOURCE_PACKET_MASS = 1;
export const LIQUID_OFFSCREEN_MARGIN = 260;
export const LIQUID_MAX_STEP = 1 / 60;

// Jump flooding은 글자형 색 에너지에만 사용한다. 보이는 액체 외곽선은
// pixel metaball field가 만든다.
export const JFA_JUMPS = [16, 8, 4, 2, 1, 1] as const;

export const TEXT_LINES = [
  'PRESS',
  'AND HOLD',
  'THE SURFACE',
  'UNTIL',
  'THE WORDS',
  'BEGIN',
  'TO GIVE',
  'WAY',
  'BENEATH YOU',
] as const;

export const LINE_COUNT = TEXT_LINES.length;
export const GLYPH_SLOT_COUNT = TEXT_LINES.reduce(
  (total, line) => total + line.length,
  0,
);
export const FIRST_LINE_Y = 132;
export const LINE_HEIGHT = 42.2;
export const TEXT_LETTER_SPACING = 4;
export const TEXT_FONT = '300 43px "Helvetica Neue", "Arial", sans-serif';
export const MAX_GLYPH_HALF_WIDTH = 32;
export const GLYPH_ATLAS_COLUMNS = 8;
export const GLYPH_ATLAS_ROWS = Math.ceil(GLYPH_SLOT_COUNT / GLYPH_ATLAS_COLUMNS);
export const GLYPH_ATLAS_CELL_SIZE = 64;

export type ColorTextParameters = {
  radiusX: number;
  radiusY: number;
  radiusYBelow: number;
  taperAbove: number;
  taperBelow: number;
  taperStart: number;
  taperEnd: number;
  lightFalloff: number;
  seedThreshold: number;
  metaballInputThreshold: number;
  metaballInputSoftness: number;
  metaballBlurRadius: number;
  metaballFalloffPower: number;
  metaballSourceGain: number;
  metaballFieldGain: number;
  metaballSmoothing: number;
  surfaceThreshold: number;
  surfaceSoftness: number;
  colorGlyphShapeStrength: number;
  colorGlyphShapeRadius: number;
  colorGlyphShapeEdge: number;
  hueBands: number;
  colorSaturation: number;
  colorBrightness: number;
  colorPastelMix: number;
  colorCycle: number;
  dripGravity: number;
  dripStretch: number;
  dripTurbulence: number;
  dripFlutter: number;
  dripStrength: number;
  dripPinchTime: number;
  dripStreamWidth: number;
  dripAttack: number;
  dripInitialSpeed: number;
  dripViscosity: number;
  dripCohesion: number;
  dripCohesionRange: number;
  dripParticleBlend: number;
  dripFollowEase: number;
  dripEmissionInterval: number;
  textPushDistance: number;
  textSpringStiffness: number;
  textSpringDamping: number;
  textMaxRotation: number;
  textRotationStiffness: number;
  textRotationDamping: number;
};

/** URL의 QA override를 읽되 잘못된 숫자는 작품 기본값으로 되돌린다. */
export function readNumberParameter(
  searchParams: URLSearchParams,
  name: string,
  fallback: number,
  allowOverride = true,
): number {
  if (!allowOverride) return fallback;
  const rawValue = searchParams.get(name);
  if (rawValue === null) return fallback;
  const value = Number(rawValue);
  return Number.isFinite(value) ? value : fallback;
}

/** lil-gui와 모든 렌더 패스가 공유하는 하나의 파라미터 객체를 만든다. */
export function createColorTextParameters(
  searchParams: URLSearchParams,
  allowQaOverrides: boolean,
): ColorTextParameters {
  const number = (name: string, fallback: number): number => (
    readNumberParameter(searchParams, name, fallback, allowQaOverrides)
  );

  return {
    radiusX: number('qaRadiusX', 107),
    radiusY: number('qaRadiusY', 80),
    radiusYBelow: number('qaRadiusYBelow', 160),
    taperAbove: number('qaTaperAbove', 0.55),
    taperBelow: number('qaTaperBelow', 0.55),
    taperStart: number('qaTaperStart', 0.25),
    taperEnd: number('qaTaperEnd', 0.85),
    lightFalloff: number('qaLightFalloff', 0.12),
    seedThreshold: number('qaSeedThreshold', 0.05),
    metaballInputThreshold: number('qaMetaballInput', 0.02),
    metaballInputSoftness: number('qaMetaballInputSoftness', 0.025),
    metaballBlurRadius: number('qaMetaballBlur', 30.0),
    metaballFalloffPower: number('qaMetaballPower', 3.2),
    metaballSourceGain: number('qaMetaballSourceGain', 0.55),
    metaballFieldGain: number('qaMetaballFieldGain', 2.2),
    metaballSmoothing: number('qaMetaballSmoothing', 1.8),
    surfaceThreshold: number('qaSurfaceThreshold', 0.07),
    surfaceSoftness: number('qaSurfaceSoftness', 0.012),
    colorGlyphShapeStrength: number('qaColorGlyphShapeStrength', 0.68),
    colorGlyphShapeRadius: number('qaColorGlyphShapeRadius', 3.2),
    colorGlyphShapeEdge: number('qaColorGlyphShapeEdge', 1.0),
    hueBands: number('qaHueBands', 0.31),
    colorSaturation: number('qaColorSaturation', 0.72),
    colorBrightness: number('qaColorBrightness', 0.96),
    colorPastelMix: number('qaColorPastelMix', 0.12),
    colorCycle: number('qaColorCycle', 8.0),
    dripGravity: number('qaDripGravity', 78),
    dripStretch: number('qaDripStretch', 0.34),
    dripTurbulence: number('qaDripTurbulence', 0.72),
    dripFlutter: number('qaDripFlutter', 0.3),
    dripStrength: number('qaDripStrength', 0.92),
    dripPinchTime: number('qaDripPinchTime', 1.45),
    dripStreamWidth: number('qaDripStreamWidth', 0.44),
    dripAttack: number('qaDripAttack', 0.36),
    dripInitialSpeed: number('qaDripInitialSpeed', 18.0),
    dripViscosity: number('qaDripViscosity', 0.65),
    dripCohesion: number('qaDripCohesion', 0.9),
    dripCohesionRange: number('qaDripCohesionRange', 92.0),
    dripParticleBlend: number('qaDripParticleBlend', 0.08),
    dripFollowEase: number('qaDripFollowEase', 7.5),
    dripEmissionInterval: number('qaDripEmissionInterval', 0.13),
    textPushDistance: number('qaTextPushDistance', 10.0),
    textSpringStiffness: number('qaTextSpringStiffness', 58.0),
    textSpringDamping: number('qaTextSpringDamping', 12.0),
    textMaxRotation: number('qaTextMaxRotation', 9.0),
    textRotationStiffness: number('qaTextRotationStiffness', 46.0),
    textRotationDamping: number('qaTextRotationDamping', 10.0),
  };
}
