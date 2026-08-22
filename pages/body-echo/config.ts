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
export const BASE_CONTACT_WAVE_DURATION = 2.48;
export const BASE_CONTACT_GATHER_DURATION = 0.92;
export const BASE_CONTACT_DENSITY_DURATION = 0.52;
export const DEFAULT_PULL_SPEED = 2.15;
export const DEFAULT_WAVE_SPEED = 1.35;

export const ACTIVE_FIGURE: FigureMode = 'Lines';
export const ACTIVE_INTERACTION: InteractionMode = 'NameDrop Wave';
export const ACTIVE_GATHER_STYLE: ContactGatherStyle = 'Rope Pull';
export const ACTIVE_RELEASE_STYLE: ContactReleaseStyle = 'Current · Density';

export const settings = {
  echoes: 6,
  rgbOffset: 7,
  rgbOffsetStep: -0.8,
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
  contactGatherDuration: BASE_CONTACT_GATHER_DURATION / DEFAULT_PULL_SPEED,
  contactDensityDuration: BASE_CONTACT_DENSITY_DURATION / DEFAULT_PULL_SPEED,
  contactCompression: 0.18,
  contactRopePull: 200,
  contactRopeReach: 88,
  contactRopeSlack: 3.2,
  contactWaveDuration: BASE_CONTACT_WAVE_DURATION / DEFAULT_WAVE_SPEED,
  contactWaveBandWidth: 60,
  contactWaveBrightness: 0.08,
  contactLineFadeDuration: 0.1,
  contactDiffusionDuration: 1.65,
  contactParticleFadeDuration: 0.9,
  contactParticleDensity: 3,
  contactParticleSize: 1.2,
  contactForce: 45,
  contactSpread: 6,
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

export function chromaticOffsetForEcho(echoIndex: number): number {
  return settings.rgbOffset + settings.rgbOffsetStep * echoIndex;
}

export const defaultTiming = {
  gatherDuration: BASE_CONTACT_GATHER_DURATION,
  densityDuration: BASE_CONTACT_DENSITY_DURATION,
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
