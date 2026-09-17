import GUI from 'lil-gui';
import { PebbleMotion, type Point } from './interaction';
import { fragmentSource, resolveSource, vertexSource } from './shader';

const canvas = document.querySelector<HTMLCanvasElement>('#artwork')!;
const error = document.querySelector<HTMLParagraphElement>('#error')!;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const defaults = {
  grain: 1.25,
  warmth: 0,
  specular: 1.1,
  rim: 1.25,
  cursorLight: 1.85,
  lightFollow: 1.25,
  frontAbsorption: 1,
  rearAbsorption: 1,
  absorptionWidth: 1,
  diffusion: 1,
  rearBlur: 1,
  edgeRoll: 1,
  shadowStrength: 1,
  shadowSpread: 1,
  saturation: 1.1,
  dragRange: 85,
  softness: 1.1,
  pressDepth: 1,
  recovery: 1,
  gripRotation: 1,
};
const settings = {
  ...defaults,
  resetLook,
  resetComposition,
  resetAll,
};
let gui: GUI;
let gl: WebGL2RenderingContext;
let program: WebGLProgram;
let resolveProgram: WebGLProgram;
let sceneTexture: WebGLTexture;
let sceneFramebuffer: WebGLFramebuffer;
let vao: WebGLVertexArrayObject;
let uniforms: Record<string, WebGLUniformLocation | null>;
let resolveUniforms: Record<string, WebGLUniformLocation | null>;
let width = 1, height = 1;
const motion = new PebbleMotion();
const homeLight = { x: 410, y: 360 };
let lightX = homeLight.x, lightY = homeLight.y;
let targetLightX = lightX, targetLightY = lightY;
let pointer: number | null = null;
let hoverPoint: Point | null = null;
let frame = 0, previous = 0, contextLost = false;
function compile(type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Cannot allocate shader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(message ?? 'Shader compile failed');
  }
  return shader;
}

function createProgram(source: string) {
  const vertex = compile(gl.VERTEX_SHADER, vertexSource);
  const fragment = compile(gl.FRAGMENT_SHADER, source);
  const nextProgram = gl.createProgram();
  if (!nextProgram) throw new Error('Cannot allocate program');
  gl.attachShader(nextProgram, vertex);
  gl.attachShader(nextProgram, fragment);
  gl.linkProgram(nextProgram);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(nextProgram, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(nextProgram);
    gl.deleteProgram(nextProgram);
    throw new Error(message ?? 'Link failed');
  }
  return nextProgram;
}

function initialize() {
  const context = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, powerPreference: 'low-power' });
  if (!context) throw new Error('WebGL 2 unavailable');
  gl = context;
  program = createProgram(fragmentSource);
  resolveProgram = createProgram(resolveSource);
  const texture = gl.createTexture(), framebuffer = gl.createFramebuffer();
  if (!texture || !framebuffer) throw new Error('Cannot allocate scene buffer');
  sceneTexture = texture;
  sceneFramebuffer = framebuffer;
  gl.bindTexture(gl.TEXTURE_2D, sceneTexture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  vao = gl.createVertexArray()!;
  uniforms = Object.fromEntries(['uResolution', 'uView', 'uOffset', 'uLight', 'uRotation', 'uContact', 'uPull', 'uCompression', 'uGrain', 'uWarmth', 'uSpecular', 'uRim', 'uCursorLight', 'uFrontAbsorption', 'uRearAbsorption', 'uAbsorptionWidth', 'uSaturation', 'uRearBlur', 'uEdgeRoll', 'uShadowStrength', 'uShadowSpread']
    .map(name => [name, gl.getUniformLocation(program, name)]));
  resolveUniforms = Object.fromEntries(['uScene', 'uResolution', 'uReferenceScale', 'uDiffusion']
    .map(name => [name, gl.getUniformLocation(resolveProgram, name)]));
  error.hidden = true;
  contextLost = false;
  resize();
}

function resize() {
  const bounds = canvas.getBoundingClientRect();
  width = Math.max(1, bounds.width);
  height = Math.max(1, bounds.height);
  const dpr = Math.min(devicePixelRatio || 1, 2, Math.sqrt(3_000_000/(width*height)));
  canvas.width = Math.round(width*dpr);
  canvas.height = Math.round(height*dpr);
  gl.bindTexture(gl.TEXTURE_2D, sceneTexture);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,canvas.width,canvas.height,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFramebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,sceneTexture,0);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error('Incomplete scene buffer');
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  wake();
}

function resetComposition() {
  motion.reset(reducedMotion.matches);
  clearCapture();
  updateHover();
  wake();
}

function clearCapture() {
  const released = pointer;
  pointer = null;
  if (released !== null && canvas.hasPointerCapture(released)) canvas.releasePointerCapture(released);
}

function resetLight() {
  targetLightX = homeLight.x;
  targetLightY = homeLight.y;
}

function resetLook() {
  Object.assign(settings,defaults);
  gui.controllersRecursive().forEach(controller => controller.updateDisplay());
  wake();
}

function resetAll() {
  resetLook();
  resetLight();
  resetComposition();
}

function wake() {
  if (!frame && !contextLost && !document.hidden) frame = requestAnimationFrame(render);
}

function render(now: number) {
  frame = 0;
  const dt = Math.min((now-previous)/1000 || 1/60, 1/30);
  previous = now;
  const ease = reducedMotion.matches ? 1 : 1-Math.exp(-dt*9*settings.lightFollow);
  const moving = motion.step(dt,settings.dragRange,settings.gripRotation,settings,reducedMotion.matches);
  lightX += (targetLightX-lightX)*ease;
  lightY += (targetLightY-lightY)*ease;
  gl.viewport(0,0,canvas.width,canvas.height);
  gl.bindFramebuffer(gl.FRAMEBUFFER,sceneFramebuffer);
  gl.useProgram(program);
  gl.bindVertexArray(vao);
  gl.uniform2f(uniforms.uResolution,canvas.width,canvas.height);
  gl.uniform2f(uniforms.uView,width,height);
  gl.uniform2f(uniforms.uOffset,motion.x,motion.y);
  gl.uniform2f(uniforms.uLight,lightX,lightY);
  gl.uniform1f(uniforms.uRotation,motion.angle);
  gl.uniform2f(uniforms.uContact,motion.contact.x,motion.contact.y);
  gl.uniform2f(uniforms.uPull,motion.pull.x,motion.pull.y);
  gl.uniform1f(uniforms.uCompression,motion.press);
  gl.uniform1f(uniforms.uGrain,settings.grain);
  gl.uniform1f(uniforms.uWarmth,settings.warmth);
  gl.uniform1f(uniforms.uSpecular,settings.specular);
  gl.uniform1f(uniforms.uRim,settings.rim);
  gl.uniform1f(uniforms.uCursorLight,settings.cursorLight);
  gl.uniform1f(uniforms.uFrontAbsorption,settings.frontAbsorption);
  gl.uniform1f(uniforms.uRearAbsorption,settings.rearAbsorption);
  gl.uniform1f(uniforms.uAbsorptionWidth,settings.absorptionWidth);
  gl.uniform1f(uniforms.uRearBlur,settings.rearBlur);
  gl.uniform1f(uniforms.uEdgeRoll,settings.edgeRoll);
  gl.uniform1f(uniforms.uShadowStrength,settings.shadowStrength);
  gl.uniform1f(uniforms.uShadowSpread,settings.shadowSpread);
  gl.uniform1f(uniforms.uSaturation,settings.saturation);
  gl.drawArrays(gl.TRIANGLES,0,3);
  gl.bindFramebuffer(gl.FRAMEBUFFER,null);
  gl.useProgram(resolveProgram);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D,sceneTexture);
  gl.uniform1i(resolveUniforms.uScene,0);
  gl.uniform2f(resolveUniforms.uResolution,canvas.width,canvas.height);
  gl.uniform1f(resolveUniforms.uReferenceScale,Math.min(width/590,height/1280)*canvas.width/width);
  gl.uniform1f(resolveUniforms.uDiffusion,settings.diffusion);
  gl.drawArrays(gl.TRIANGLES,0,3);
  canvas.dataset.interaction = motion.mode;
  updateHover();
  if (moving || Math.abs(targetLightX-lightX)+Math.abs(targetLightY-lightY) > .02) wake();
}

function scenePoint(event: PointerEvent): Point {
  const bounds = canvas.getBoundingClientRect();
  const scale = Math.min(width/590,height/1280);
  return { x: (event.clientX-bounds.left-width/2)/scale+295,
    y: (event.clientY-bounds.top-height/2)/scale+640 };
}

function updateHover() {
  const grabbable = pointer !== null || (hoverPoint !== null && motion.hitTest(hoverPoint));
  canvas.dataset.grabbable = String(grabbable);
}

function aimLight(event: PointerEvent) {
  const point = scenePoint(event);
  targetLightX = point.x; targetLightY = point.y;
  hoverPoint = point;
  updateHover();
  wake();
  return point;
}

canvas.addEventListener('pointerdown', event => {
  if (pointer !== null || event.button !== 0 || !event.isPrimary) return;
  const point = aimLight(event);
  if (!motion.grab(point,event.pressure)) return;
  pointer = event.pointerId;
  canvas.setPointerCapture(pointer);
  wake();
});
canvas.addEventListener('pointermove', event => {
  if (!event.isPrimary || (pointer !== null && pointer !== event.pointerId)) return;
  const point = aimLight(event);
  if (pointer === event.pointerId) {
    motion.move(point,event.pressure);
  }
  wake();
});
for (const name of ['pointerup','pointercancel','lostpointercapture'] as const) {
  canvas.addEventListener(name, event => {
    if (event.pointerId !== pointer) return;
    if (name === 'pointerup') motion.release(reducedMotion.matches);
    else motion.reset(reducedMotion.matches);
    clearCapture();
    if (event.pointerType !== 'mouse') { hoverPoint = null; resetLight(); }
    updateHover();
    wake();
  });
}
canvas.addEventListener('pointerenter', event => { if (event.isPrimary && pointer === null) aimLight(event); });
canvas.addEventListener('pointerleave', event => {
  hoverPoint = null; updateHover();
  // Entering the controls should not reset the light; only leaving the view.
  if (pointer === null && event.relatedTarget === null) { resetLight(); wake(); }
});
canvas.addEventListener('keydown', event => {
  if (event.key === 'Escape') { event.preventDefault(); resetComposition(); return; }
  const directions: Record<string, [number, number]> = {
    ArrowLeft: [-15,0], ArrowRight: [15,0], ArrowUp: [0,-15], ArrowDown: [0,15],
  };
  const direction = directions[event.key];
  if (!direction) return;
  event.preventDefault();
  motion.nudge(direction[0],direction[1],settings.dragRange);
  wake();
});
window.addEventListener('blur', () => { hoverPoint = null; resetLight(); resetComposition(); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    cancelAnimationFrame(frame); frame = 0;
    hoverPoint = null; resetLight(); resetComposition();
  }
  else { previous = performance.now(); wake(); }
});
canvas.addEventListener('webglcontextlost', event => {
  event.preventDefault(); contextLost = true;
  cancelAnimationFrame(frame); frame = 0;
  error.hidden = false;
});
canvas.addEventListener('webglcontextrestored', start);
function showError(cause: unknown) {
  contextLost = true;
  cancelAnimationFrame(frame); frame = 0;
  error.hidden = false;
  console.error(cause);
}
function start() {
  try { initialize(); }
  catch (cause) { showError(cause); }
}
start();
new ResizeObserver(() => {
  if (contextLost) return;
  try { resize(); }
  catch (cause) { showError(cause); }
}).observe(canvas);
gui = new GUI({ title: 'Rose Glass Controls' });
function describe<T extends { domElement: HTMLElement }>(controller: T, description: string): T {
  controller.domElement.title = description;
  return controller;
}
const surfaceFolder = gui.addFolder('Surface');
describe(surfaceFolder.add(settings,'grain',0,2,.01).name('Frost grain').onChange(wake),
  '표면의 서리 입자, 작은 요철과 반짝임의 강도');
describe(surfaceFolder.add(settings,'warmth',-1,1,.01).name('Warmth').onChange(wake),
  '전체 색감을 차갑게 또는 따뜻하게 이동');
describe(surfaceFolder.add(settings,'saturation',.8,1.4,.01).name('Saturation').onChange(wake),
  '장밋빛과 살구빛의 채도');

const lightingFolder = gui.addFolder('Lighting');
describe(lightingFolder.add(settings,'specular',0,2,.01).name('White reflection').onChange(wake),
  '곡면을 따라 번지는 넓은 흰 반사광의 밝기');
describe(lightingFolder.add(settings,'rim',0,2,.01).name('Optical rim').onChange(wake),
  '가장자리를 스치는 밝은 반사광의 강도');
describe(lightingFolder.add(settings,'cursorLight',0,3,.01).name('Cursor light').onChange(wake),
  '세 조약돌이 공유하는 조명의 밝기. 표면의 방향과 광원까지의 거리에 따라 반사광과 그림자가 함께 달라짐');
describe(lightingFolder.add(settings,'lightFollow',.15,2.5,.01).name('Light follow').onChange(wake),
  '가상 조명이 커서 위치를 따라가는 속도');

const edgeFolder = gui.addFolder('Progressive edge');
describe(edgeFolder.add(settings,'edgeRoll',0,2,.01).name('Edge roll').onChange(wake),
  '배경이 비치는 얇은 외피에서 짙은 어깨로 전환되는 폭. 높이면 경계가 넓고 부드럽게 풀림');
describe(edgeFolder.add(settings,'frontAbsorption',0,2,.01).name('Front darkness').onChange(wake),
  '중앙 분홍 조약돌의 두꺼운 외곽이 빛을 흡수하는 정도');
describe(edgeFolder.add(settings,'rearAbsorption',0,2,.01).name('Rear darkness').onChange(wake),
  '뒤쪽 두 조약돌의 두꺼운 외곽이 빛을 흡수하는 정도');
describe(edgeFolder.add(settings,'absorptionWidth',.2,2,.01).name('Darkness width').onChange(wake),
  '어두운 외곽이 밝은 내부로 풀리는 거리');
describe(edgeFolder.add(settings,'diffusion',0,2,.01).name('Blur amount').onChange(wake),
  '외곽 색과 질감이 점진적으로 흐려지는 정도');
describe(edgeFolder.add(settings,'rearBlur',0,2,.01).name('Rear blur').onChange(wake),
  '뒤쪽 위·아래 형태의 외곽 흐림. Blur amount와 함께 적용되며 내부 질감은 유지');

const shadowFolder = gui.addFolder('Shadows');
describe(shadowFolder.add(settings,'shadowStrength',0,2,.01).name('Shadow strength').onChange(wake),
  '각 형태가 배경과 뒤쪽 형태에 드리우는 그림자의 진하기');
describe(shadowFolder.add(settings,'shadowSpread',.4,2,.01).name('Shadow spread').onChange(wake),
  '실루엣 바깥으로 그림자가 부드럽게 퍼지는 거리');

const motionFolder = gui.addFolder('Interaction');
describe(motionFolder.add(settings,'softness',0,1.5,.01).name('Softness').onChange(wake),
  '재료의 말랑함. 높이면 잡은 주변이 더 늘어나고 눌림. 0이면 변형되지 않는 단단한 재료');
describe(motionFolder.add(settings,'pressDepth',0,1.5,.01).name('Press depth').onChange(wake),
  '가만히 누를 때 생기는 국소적인 홈의 깊이와 주변 부풀음. 반사광과 표면 방향도 함께 변함');
describe(motionFolder.add(settings,'recovery',.4,2,.01).name('Shape recovery').onChange(wake),
  '놓은 뒤 원래 형태로 복원되는 속도. 낮으면 점성 있는 레진처럼 느리게, 높으면 탄성 있게 빠르게 복원');
describe(motionFolder.add(settings,'dragRange',40,160,1).name('Body travel').onChange(wake),
  '당길 때 조약돌 전체가 따라오는 작은 이동의 범위. 대부분의 드래그는 위치 이동 대신 형태 변형으로 전달');
describe(motionFolder.add(settings,'gripRotation',0,1.5,.01).name('Grip rotation'),
  '중심에서 떨어진 곳을 당길 때 전체에 전달되는 작은 회전');
describe(motionFolder.add(settings,'resetComposition').name('Reset position'),
  '중앙 조약돌의 위치와 변형을 복원. 조명은 현재 커서 위치 유지');

describe(gui.add(settings,'resetLook').name('Reset appearance'),
  '표면, 조명, 외곽 파라미터를 기본값으로 복원');
describe(gui.add(settings,'resetAll').name('Reset everything'),
  '외형, 조약돌 위치와 조명을 모두 기본값으로 복원');
if (matchMedia('(max-width: 700px)').matches) gui.close();
