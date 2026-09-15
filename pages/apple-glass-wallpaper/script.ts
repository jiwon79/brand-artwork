import GUI from 'lil-gui';
import { fragmentSource, resolveSource, vertexSource } from './shader';

const canvas = document.querySelector<HTMLCanvasElement>('#artwork')!;
const error = document.querySelector<HTMLParagraphElement>('#error')!;
const cursorHalo = document.querySelector<HTMLElement>('#cursor-halo')!;
const cursorDot = document.querySelector<HTMLElement>('#cursor-dot')!;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const finePointer = matchMedia('(hover: hover) and (pointer: fine)');
const defaults = {
  grain: 1.25,
  warmth: 0,
  specular: 1.1,
  rim: 1.25,
  cursorLight: 1.15,
  lightFollow: 1,
  frontAbsorption: 1,
  rearAbsorption: 1,
  absorptionWidth: 1,
  diffusion: 1,
  saturation: 1.1,
  response: 1,
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
let x = 0, y = 0, vx = 0, vy = 0, targetX = 0, targetY = 0;
let lightX = 0, lightY = 0, targetLightX = 0, targetLightY = 0;
let pressure = 0, pointer: number | null = null, startX = 0, startY = 0;
let frame = 0, previous = 0, contextLost = false;
let cursorFrame = 0, cursorX = -100, cursorY = -100, cursorTargetX = -100, cursorTargetY = -100;

function positionCursor(element: HTMLElement, nextX: number, nextY: number) {
  element.style.setProperty('--cursor-x', `${nextX}px`);
  element.style.setProperty('--cursor-y', `${nextY}px`);
}

function animateCursor() {
  cursorFrame = 0;
  const follow = reducedMotion.matches ? 1 : .24;
  cursorX += (cursorTargetX-cursorX)*follow;
  cursorY += (cursorTargetY-cursorY)*follow;
  positionCursor(cursorHalo,cursorX,cursorY);
  if (Math.abs(cursorTargetX-cursorX)+Math.abs(cursorTargetY-cursorY) > .1) {
    cursorFrame = requestAnimationFrame(animateCursor);
  }
}

function updateCursor(event: PointerEvent) {
  if (!finePointer.matches || event.pointerType !== 'mouse') return;
  cursorTargetX = event.clientX;
  cursorTargetY = event.clientY;
  positionCursor(cursorDot,cursorTargetX,cursorTargetY);
  if (document.body.dataset.roseCursor !== 'visible' && document.body.dataset.roseCursor !== 'pressed') {
    cursorX = cursorTargetX;
    cursorY = cursorTargetY;
    positionCursor(cursorHalo,cursorX,cursorY);
  }
  document.body.dataset.roseCursor = pointer === null ? 'visible' : 'pressed';
  if (!cursorFrame) cursorFrame = requestAnimationFrame(animateCursor);
}

function hideCursor() {
  delete document.body.dataset.roseCursor;
  if (cursorFrame) cancelAnimationFrame(cursorFrame);
  cursorFrame = 0;
}

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
  uniforms = Object.fromEntries(['uResolution', 'uView', 'uOffset', 'uLight', 'uPress', 'uGrain', 'uWarmth', 'uSpecular', 'uRim', 'uCursorLight', 'uFrontAbsorption', 'uRearAbsorption', 'uAbsorptionWidth', 'uSaturation']
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
  targetX = targetY = targetLightX = targetLightY = 0;
  if (pointer !== null && canvas.hasPointerCapture(pointer)) canvas.releasePointerCapture(pointer);
  pointer = null;
  canvas.dataset.interaction = 'returning';
  wake();
}

function resetLook() {
  Object.assign(settings,defaults);
  gui.controllersRecursive().forEach(controller => controller.updateDisplay());
  wake();
}

function resetAll() {
  resetLook();
  resetComposition();
}

function wake() {
  if (!frame && !contextLost && !document.hidden) frame = requestAnimationFrame(render);
}

function render(now: number) {
  frame = 0;
  const dt = Math.min((now-previous)/1000 || 1/60, 1/30);
  previous = now;
  const ease = 1-Math.exp(-dt*9*settings.lightFollow);
  if (reducedMotion.matches) {
    x = targetX; y = targetY; vx = vy = 0;
  } else {
    vx += ((targetX-x)*120-vx*17)*dt;
    vy += ((targetY-y)*120-vy*17)*dt;
    x += vx*dt; y += vy*dt;
  }
  lightX += (targetLightX-lightX)*ease;
  lightY += (targetLightY-lightY)*ease;
  pressure += ((pointer !== null ? 1 : 0)-pressure)*ease;
  gl.viewport(0,0,canvas.width,canvas.height);
  gl.bindFramebuffer(gl.FRAMEBUFFER,sceneFramebuffer);
  gl.useProgram(program);
  gl.bindVertexArray(vao);
  gl.uniform2f(uniforms.uResolution,canvas.width,canvas.height);
  gl.uniform2f(uniforms.uView,width,height);
  gl.uniform2f(uniforms.uOffset,x,y);
  gl.uniform2f(uniforms.uLight,lightX,lightY);
  gl.uniform1f(uniforms.uPress,pressure);
  gl.uniform1f(uniforms.uGrain,settings.grain);
  gl.uniform1f(uniforms.uWarmth,settings.warmth);
  gl.uniform1f(uniforms.uSpecular,settings.specular);
  gl.uniform1f(uniforms.uRim,settings.rim);
  gl.uniform1f(uniforms.uCursorLight,settings.cursorLight);
  gl.uniform1f(uniforms.uFrontAbsorption,settings.frontAbsorption);
  gl.uniform1f(uniforms.uRearAbsorption,settings.rearAbsorption);
  gl.uniform1f(uniforms.uAbsorptionWidth,settings.absorptionWidth);
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
  const active = Math.abs(targetX-x)+Math.abs(targetY-y)+Math.abs(vx)+Math.abs(vy)
    +Math.abs(targetLightX-lightX)+Math.abs(targetLightY-lightY)
    +Math.abs((pointer !== null ? 1 : 0)-pressure) > .001;
  canvas.dataset.interaction = pointer !== null ? 'dragging' : active ? 'returning' : 'idle';
  if (active) wake();
}

canvas.addEventListener('pointerdown', event => {
  if (pointer !== null || event.button !== 0) return;
  pointer = event.pointerId;
  startX = event.clientX; startY = event.clientY;
  canvas.setPointerCapture(pointer);
  if (event.pointerType === 'mouse') document.body.dataset.roseCursor = 'pressed';
  wake();
});
canvas.addEventListener('pointermove', event => {
  updateCursor(event);
  const bounds = canvas.getBoundingClientRect();
  targetLightX = (event.clientX-bounds.left)/width-.5;
  targetLightY = (event.clientY-bounds.top)/height-.5;
  if (pointer === event.pointerId) {
    const scale = Math.min(width/590,height/1280);
    targetX = Math.tanh((event.clientX-startX)/scale/180)*85*settings.response;
    targetY = Math.tanh((event.clientY-startY)/scale/220)*100*settings.response;
  }
  wake();
});
for (const name of ['pointerup','pointercancel','lostpointercapture'] as const) {
  canvas.addEventListener(name, event => {
    if (event.pointerId !== pointer) return;
    resetComposition();
    if (event.pointerType === 'mouse') document.body.dataset.roseCursor = 'visible';
  });
}
canvas.addEventListener('pointerenter', event => updateCursor(event));
canvas.addEventListener('pointerleave', () => { hideCursor(); if (pointer === null) resetComposition(); });
canvas.addEventListener('keydown', event => {
  if (event.key === 'Escape') { event.preventDefault(); resetComposition(); return; }
  const directions: Record<string, [number, number]> = {
    ArrowLeft: [-15,0], ArrowRight: [15,0], ArrowUp: [0,-15], ArrowDown: [0,15],
  };
  const direction = directions[event.key];
  if (!direction) return;
  event.preventDefault();
  targetX = Math.max(-85, Math.min(85,targetX+direction[0]));
  targetY = Math.max(-100, Math.min(100,targetY+direction[1]));
  wake();
});
window.addEventListener('blur', () => { hideCursor(); resetComposition(); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { cancelAnimationFrame(frame); frame = 0; resetComposition(); }
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
describe(lightingFolder.add(settings,'cursorLight',0,2,.01).name('Cursor light').onChange(wake),
  '커서 위치를 따라 움직이는 넓은 확산광과 작은 반사광의 강도');
describe(lightingFolder.add(settings,'lightFollow',.15,2.5,.01).name('Light follow').onChange(wake),
  '가상 조명이 커서 위치를 따라가는 속도');

const edgeFolder = gui.addFolder('Progressive edge');
describe(edgeFolder.add(settings,'frontAbsorption',0,2,.01).name('Front darkness').onChange(wake),
  '중앙 분홍 조약돌의 두꺼운 외곽이 빛을 흡수하는 정도');
describe(edgeFolder.add(settings,'rearAbsorption',0,2,.01).name('Rear darkness').onChange(wake),
  '뒤쪽 두 조약돌의 두꺼운 외곽이 빛을 흡수하는 정도');
describe(edgeFolder.add(settings,'absorptionWidth',.2,2,.01).name('Darkness width').onChange(wake),
  '어두운 외곽이 밝은 내부로 풀리는 거리');
describe(edgeFolder.add(settings,'diffusion',0,2,.01).name('Blur amount').onChange(wake),
  '외곽 색과 질감이 점진적으로 흐려지는 정도');

const motionFolder = gui.addFolder('Interaction');
describe(motionFolder.add(settings,'response',.1,1.5,.01).name('Drag response'),
  '드래그 거리에 대한 조약돌 이동량');
describe(motionFolder.add(settings,'resetComposition').name('Reset position'),
  '조약돌과 가상 조명을 초기 위치로 복원');

describe(gui.add(settings,'resetLook').name('Reset appearance'),
  '표면, 조명, 외곽 파라미터를 기본값으로 복원');
describe(gui.add(settings,'resetAll').name('Reset everything'),
  '외형과 조약돌 위치를 모두 기본값으로 복원');
if (matchMedia('(max-width: 700px)').matches) gui.close();
