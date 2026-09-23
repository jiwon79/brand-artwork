import { fragmentSource, resolveSource, vertexSource } from '../pages/rose-glass/shader';

const canvas = document.querySelector<HTMLCanvasElement>('#art')!;
const stageSelect = document.querySelector<HTMLSelectElement>('#stage')!;
const secondsInput = document.querySelector<HTMLInputElement>('#seconds')!;
const saveButton = document.querySelector<HTMLButtonElement>('#save')!;
const status = document.querySelector<HTMLOutputElement>('#status')!;
const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, preserveDrawingBuffer: true });
if (!gl) throw new Error('WebGL2 required for Rose Glass asset export');

function compile(type: number, source: string): WebGLShader {
  const shader = gl!.createShader(type)!;
  gl!.shaderSource(shader, source);
  gl!.compileShader(shader);
  if (!gl!.getShaderParameter(shader, gl!.COMPILE_STATUS)) throw new Error(gl!.getShaderInfoLog(shader) ?? 'Shader compile error');
  return shader;
}
function program(fragment: string): WebGLProgram {
  const next = gl!.createProgram()!;
  gl!.attachShader(next, compile(gl!.VERTEX_SHADER, vertexSource));
  gl!.attachShader(next, compile(gl!.FRAGMENT_SHADER, fragment));
  gl!.linkProgram(next);
  if (!gl!.getProgramParameter(next, gl!.LINK_STATUS)) throw new Error(gl!.getProgramInfoLog(next) ?? 'Program link error');
  return next;
}

const material = program(fragmentSource);
const resolve = program(resolveSource);
const texture = gl.createTexture()!;
const framebuffer = gl.createFramebuffer()!;
const vao = gl.createVertexArray()!;
gl.bindTexture(gl.TEXTURE_2D, texture);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, canvas.width, canvas.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Incomplete material framebuffer');
gl.bindFramebuffer(gl.FRAMEBUFFER, null);

function uniform(name: string): WebGLUniformLocation | null { return gl!.getUniformLocation(material, name); }
function draw(): void {
  const stage = Number(stageSelect.value);
  const seconds = Number(secondsInput.value) || 0;
  const lightTime = seconds * .65 * .35;
  const lightX = 410 + Math.sin(lightTime) * 310;
  const lightY = 360 + (Math.cos(lightTime * .73) - 1) * 190 + Math.sin(lightTime * .51) * 260;
  gl!.bindVertexArray(vao);
  gl!.bindFramebuffer(gl!.FRAMEBUFFER, framebuffer);
  gl!.viewport(0, 0, canvas.width, canvas.height);
  gl!.useProgram(material);
  gl!.uniform2f(uniform('uResolution'), canvas.width, canvas.height);
  // A 9:16 viewport shows extra backdrop at the sides of the 590x1280
  // material space, exactly like the live artwork's fit calculation.
  gl!.uniform2f(uniform('uView'), 720, 1280);
  gl!.uniform2fv(uniform('uOffsets[0]'), new Float32Array(6));
  gl!.uniform1fv(uniform('uRotations[0]'), new Float32Array(3));
  gl!.uniform2f(uniform('uLight'), lightX, lightY);
  gl!.uniform2iv(uniform('uDeformationRanges[0]'), new Int32Array(6));
  gl!.uniform4fv(uniform('uDeformationFields[0]'), new Float32Array(80));
  gl!.uniform2fv(uniform('uDeformationMeta[0]'), new Float32Array(40));
  const values: Record<string, number> = {
    uGrain: 1.25, uWarmth: 0, uSpecular: 1.1, uRim: 1.25,
    uLightIntensity: 1.85, uForegroundAbsorption: 1, uRearAbsorption: 1,
    uAbsorptionWidth: 1, uSaturation: 1.1, uRearBlur: 1, uEdgeRoll: 1,
    uShadowStrength: 1, uShadowSpread: 1,
  };
  for (const [name, value] of Object.entries(values)) gl!.uniform1f(uniform(name), value);
  for (const [name, value] of Object.entries({
    uUpperGlass: stage >= 1, uLowerGlass: stage >= 2, uForegroundGlass: stage >= 3,
    uShadows: true, uShading: true, uEdgeOptics: true, uLighting: true,
  })) gl!.uniform1i(uniform(name), Number(value));
  gl!.drawArrays(gl!.TRIANGLES, 0, 3);

  gl!.bindFramebuffer(gl!.FRAMEBUFFER, null);
  gl!.viewport(0, 0, canvas.width, canvas.height);
  gl!.useProgram(resolve);
  gl!.activeTexture(gl!.TEXTURE0);
  gl!.bindTexture(gl!.TEXTURE_2D, texture);
  const ru = (name: string) => gl!.getUniformLocation(resolve, name);
  gl!.uniform1i(ru('uMaterialTexture'), 0);
  gl!.uniform2f(ru('uResolution'), canvas.width, canvas.height);
  gl!.uniform2f(ru('uOutputResolution'), canvas.width, canvas.height);
  gl!.uniform1f(ru('uReferenceScale'), canvas.height / 1280);
  gl!.uniform1f(ru('uDiffusion'), 1);
  gl!.drawArrays(gl!.TRIANGLES, 0, 3);
  const error = gl!.getError();
  status.value = error === gl!.NO_ERROR ? `Rendered stage ${stage} at ${seconds}s` : `WebGL error ${error}`;
}

stageSelect.addEventListener('change', draw);
secondsInput.addEventListener('change', draw);
saveButton.addEventListener('click', () => {
  draw();
  const stage = stageSelect.value;
  const seconds = secondsInput.value;
  canvas.toBlob(blob => {
    if (!blob) { status.value = 'PNG export failed'; return; }
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `rose-glass-stage-${stage}-${seconds}s.png`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }, 'image/png');
});
draw();
