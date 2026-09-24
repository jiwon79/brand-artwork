import { fragmentSource, resolveSource, vertexSource } from '../pages/rose-glass/shader';
import { GlassBodyMotion } from '../pages/rose-glass/interaction';
import { maxDeformationFields, type GlassBodyId } from '../pages/rose-glass/deformation';

const canvas = document.querySelector<HTMLCanvasElement>('#art')!;
const stageSelect = document.querySelector<HTMLSelectElement>('#stage')!;
const scenarioSelect = document.querySelector<HTMLSelectElement>('#scenario')!;
const secondsInput = document.querySelector<HTMLInputElement>('#seconds')!;
const saveButton = document.querySelector<HTMLButtonElement>('#save')!;
const saveSheetButton = document.querySelector<HTMLButtonElement>('#save-sheet')!;
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
type GripScenario = { body: GlassBodyId; start: [number, number]; move: [number, number] };
const scenarioGrips: Record<string, GripScenario[]> = {
  idle: [],
  foreground: [{ body: 2, start: [298, 645], move: [130, 80] }],
  upper: [{ body: 0, start: [321, 180], move: [-90, 60] }],
  lower: [{ body: 1, start: [274, 1090], move: [100, -70] }],
  'upper-lower': [
    { body: 0, start: [321, 180], move: [-90, 60] },
    { body: 1, start: [274, 1090], move: [100, -70] },
  ],
  'foreground-two': [
    { body: 2, start: [170, 645], move: [-90, 0] },
    { body: 2, start: [425, 645], move: [90, 0] },
  ],
  five: [
    { body: 0, start: [321, 145], move: [-70, 45] },
    { body: 1, start: [274, 1120], move: [80, -45] },
    { body: 2, start: [155, 600], move: [-75, -25] },
    { body: 2, start: [298, 700], move: [0, 85] },
    { body: 2, start: [435, 610], move: [80, -20] },
  ],
};
function motionState() {
  const selected = scenarioSelect.value;
  const grips = selected.startsWith('release-') ? scenarioGrips.foreground : scenarioGrips[selected];
  const motions = [new GlassBodyMotion(0), new GlassBodyMotion(1), new GlassBodyMotion(2)];
  const material = { softness: 1.1, indentationDepth: 1, recovery: 1, stretchLimit: 430 };
  grips.forEach((grip, i) => {
    const start = { x: grip.start[0], y: grip.start[1] };
    if (!motions[grip.body].grab(i + 1, start)) throw new Error(`Cannot grab ${selected} grip ${i + 1}`);
    motions[grip.body].move(i + 1, { x: start.x + grip.move[0], y: start.y + grip.move[1] });
  });
  for (let i = 0; i < 30; i++) motions.forEach(motion => motion.step(1 / 60, 85, 1, material, false));
  if (selected.startsWith('release-')) {
    grips.forEach((grip, i) => motions[grip.body].release(i + 1, false));
    const frames = Number(selected.slice('release-'.length));
    for (let i = 0; i < frames; i++) motions.forEach(motion => motion.step(1 / 60, 85, 1, material, false));
  }
  const ranges = new Int32Array(6), fields = new Float32Array(maxDeformationFields * 4);
  const meta = new Float32Array(maxDeformationFields * 2), offsets = new Float32Array(6);
  const rotations = new Float32Array(3);
  let count = 0;
  motions.forEach((motion, body) => {
    offsets[body * 2] = motion.x; offsets[body * 2 + 1] = motion.y;
    rotations[body] = motion.angle;
    ranges[body * 2] = count;
    for (const field of motion.deformationFields) {
      if (count >= maxDeformationFields) throw new Error('Deformation field budget exceeded');
      fields.set([field.center.x, field.center.y, field.displacement.x, field.displacement.y], count * 4);
      const radius = 210 + .25 * Math.hypot(field.displacement.x, field.displacement.y);
      meta.set([field.indentation, 1 / (radius * radius)], count * 2);
      count++;
    }
    ranges[body * 2 + 1] = count;
  });
  return { ranges, fields, meta, offsets, rotations, count, gripCount: grips.length };
}
function draw(): void {
  const scenario = scenarioSelect.value;
  const stage = scenario === 'idle' ? Number(stageSelect.value) : 3;
  const motion = motionState();
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
  gl!.uniform2fv(uniform('uOffsets[0]'), motion.offsets);
  gl!.uniform1fv(uniform('uRotations[0]'), motion.rotations);
  gl!.uniform2f(uniform('uLight'), lightX, lightY);
  gl!.uniform2iv(uniform('uDeformationRanges[0]'), motion.ranges);
  gl!.uniform4fv(uniform('uDeformationFields[0]'), motion.fields);
  gl!.uniform2fv(uniform('uDeformationMeta[0]'), motion.meta);
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
  status.value = error === gl!.NO_ERROR ? `Rendered ${scenario}: ${motion.gripCount} grips, ${motion.count} fields at ${seconds}s` : `WebGL error ${error}`;
}

stageSelect.addEventListener('change', draw);
scenarioSelect.addEventListener('change', draw);
secondsInput.addEventListener('change', draw);
saveButton.addEventListener('click', () => {
  draw();
  const stage = scenarioSelect.value === 'idle' ? stageSelect.value : scenarioSelect.value;
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
saveSheetButton.addEventListener('click', () => {
  const scenarios = ['idle', 'upper', 'lower', 'foreground', 'upper-lower',
    'foreground-two', 'five', 'release-10', 'release-30', 'release-90'];
  const selected = scenarioSelect.value, stage = stageSelect.value;
  const sheet = document.createElement('canvas');
  sheet.width = canvas.width * 2;
  sheet.height = canvas.height * 5;
  const context = sheet.getContext('2d', { alpha: false })!;
  stageSelect.value = '3';
  scenarios.forEach((scenario, index) => {
    scenarioSelect.value = scenario;
    draw();
    context.drawImage(canvas, (index % 2) * canvas.width, Math.floor(index / 2) * canvas.height);
  });
  scenarioSelect.value = selected;
  stageSelect.value = stage;
  draw();
  sheet.toBlob(blob => {
    if (!blob) { status.value = 'Contact sheet export failed'; return; }
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'rose-glass-drag-reference-sheet-2160x9600.png';
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }, 'image/png');
});
draw();
