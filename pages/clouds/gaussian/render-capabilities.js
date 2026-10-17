export const RENDERING_MODES=Object.freeze([
  Object.freeze({id:'auto',label:'Automatic'}),
  Object.freeze({id:'shadow-half',label:'16-bit shadows'}),
  Object.freeze({id:'half',label:'16-bit rendering'}),
]);

function renderSupport(gl) {
  const floatColor=!!gl.getExtension('EXT_color_buffer_float');
  const halfColor=floatColor||!!gl.getExtension('EXT_color_buffer_half_float');
  const floatBlend=floatColor&&!!gl.getExtension('EXT_float_blend');
  return {floatColor,halfColor,floatBlend};
}

// A forced fallback can lower precision, never enable unsupported formats.
// Existing capability objects retain the physical support flags for reuse.
export function renderCapabilities(gl,mode='auto',available) {
  if(!RENDERING_MODES.some(option=>option.id===mode))throw new Error('Unknown rendering compatibility mode');
  const {floatColor,halfColor,floatBlend}=available??renderSupport(gl);
  if(!halfColor)throw new Error('This device cannot render the cloud’s lighting buffers. Try another browser or device with hardware graphics acceleration.');
  const image32=floatColor&&mode!=='half',shadow32=floatBlend&&mode==='auto';
  return Object.freeze({floatColor,halfColor,floatBlend,mode,
    imagePrecision:image32?32:16,shadowPrecision:shadow32?32:16,
    imageFormat:image32?gl.RGBA32F:gl.RGBA16F,
    imageType:image32?gl.FLOAT:gl.HALF_FLOAT,
    shadowFormat:shadow32?gl.RG32F:gl.RG16F});
}

export function renderingModeEnabled(mode,capabilities) {
  return mode==='auto'||(mode==='shadow-half'?capabilities.floatBlend:mode==='half'&&capabilities.floatColor);
}

export function renderingModeDescription(capabilities) {
  const mode=capabilities.imagePrecision===16?'16-bit rendering':capabilities.shadowPrecision===16?'16-bit shadows':null;
  return mode?`${mode} ${capabilities.imagePrecision===16?'is':'are'} ${capabilities.mode==='auto'?'already active on this device.':'active.'}`:'Full-precision rendering is active.';
}
