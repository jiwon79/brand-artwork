import type {
  ContactGatherStyle,
  ContactReleaseStyle,
  FigureMode,
  InteractionMode,
} from './types';

export const DESIGN_WIDTH = 480;
export const DESIGN_HEIGHT = 270;
export const SOURCE_X_LIMIT = 61;
export const SVG_TO_DESIGN = 0.32;
export const SVG_SAMPLE_STEP = 3.2;
export const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
export const BASE_CONTACT_WAVE_DURATION = 2.48;
export const DEFAULT_WAVE_SPEED = 1.35;

export const ACTIVE_FIGURE: FigureMode = 'Lines';
export const ACTIVE_INTERACTION: InteractionMode = 'NameDrop Wave';
export const ACTIVE_GATHER_STYLE: ContactGatherStyle = 'Rope Pull';
export const ACTIVE_RELEASE_STYLE: ContactReleaseStyle = 'Current · Density';

export const settings = {
  echoes: 6,
  rgbOffset: 3.4,
  lineThickness: 1,
  idleMotion: 0.34,
  hold: 0.72,
  sweepDuration: 3.25,
  sweepJitter: 0.34,
  drift: 27,
  spread: 9.5,
  turbulence: 2.6,
  particleLife: 3.35,
  particleSize: 1.15,
  contactGatherDuration: 0.92,
  contactDensityDuration: 0.52,
  contactCompression: 0.18,
  contactRopePull: 90,
  contactRopeReach: 88,
  contactRopeSlack: 3.2,
  contactWaveDuration: BASE_CONTACT_WAVE_DURATION / DEFAULT_WAVE_SPEED,
  contactWaveBandWidth: 52,
  contactWaveBrightness: 0.58,
  contactLineFadeDuration: 0.3,
  contactDiffusionDuration: 1.65,
  contactParticleFadeDuration: 0.9,
  contactParticleDensity: 3,
  contactParticleSize: 1.2,
  contactForce: 45,
  contactSpread: 6,
  contactReleaseSpread: 0.025,
  contactReleaseSpeed: 1.45,
  dragRadius: 18,
  dragConnectorRadius: 4,
  dragConnectorWidth: 0.8,
  dragParticleSize: 0.55,
  dragForce: 48,
  dragSpread: 18,
  dragParticleLife: 1.35,
  dragRestoreDelay: 0.8,
  glow: 0.26,
  scanlines: 0.08,
};

export const defaultTiming = {
  gatherDuration: settings.contactGatherDuration,
  densityDuration: settings.contactDensityDuration,
  waveDuration: BASE_CONTACT_WAVE_DURATION,
};

export const channelColors = ['#ff2924', '#59ff50', '#2795ff'] as const;
export const channelX = [-1, 0, 1] as const;
export const channelY = [0.55, 0, -0.55] as const;
export const echoCenters = [99, 187, 255, 312, 362, 408];
export const lineEchoYCenters = [137, 142, 146, 149, 153, 157];
export const solidEchoYCenters = [142, 146, 149, 152, 155, 156];
export const solidEchoYScales = [1.79, 1.52, 1.32, 1.16, 1.03, 0.93];
export const solidEchoXScales = solidEchoYScales.map((scale) => scale * 1.28);
export const lineAssetUrls = [
  new URL('./assets/sori/figure-1.svg', import.meta.url).href,
  new URL('./assets/sori/figure-2.svg', import.meta.url).href,
  new URL('./assets/sori/figure-3.svg', import.meta.url).href,
  new URL('./assets/sori/figure-4.svg', import.meta.url).href,
  new URL('./assets/sori/figure-5.svg', import.meta.url).href,
  new URL('./assets/sori/figure-6.svg', import.meta.url).href,
];
