export const GAUSSIAN_SUPPORT = 4;
export const FULL_RAY_SIGMA = 8;
export const SHADOW_RESOLUTION = [512, 384, 65];
export const SAMPLING_DEFAULTS = { samplesPerFrame: 1, maxSamples: 128, shadowReuse: 4 };
export const APPEARANCE_DEFAULTS = { boundaryStrength: 1.0, boundaryPower: 0.65, depthStrength: 0.6, skyStrength: 0.65, localShadowStrength: .65, fineShadingStrength: .70 };
export const DETAIL_SHADING_MODES = {
  both: {localShadowStrength:APPEARANCE_DEFAULTS.localShadowStrength,fineShadingStrength:APPEARANCE_DEFAULTS.fineShadingStrength},
  local: {localShadowStrength:APPEARANCE_DEFAULTS.localShadowStrength,fineShadingStrength:0},
  fine: {localShadowStrength:0,fineShadingStrength:APPEARANCE_DEFAULTS.fineShadingStrength},
  off: {localShadowStrength:0,fineShadingStrength:0},
};
export const SHADOW_SLAB_SUPPORT = 6;
export const CAMERA_DEFAULTS = { glare: 0.32, vignette: 0.18, aberration: 0.15, detailCrispness: 0 };
export const TRANSMITTANCE_CUTOFF = 0.001;
export const OPACITY_BATCHES = 16;
export const MIN_SPLAT_ALPHA = 0.0005;
