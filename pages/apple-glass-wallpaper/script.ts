import GUI from 'lil-gui';
import { exposeGuiInDebugMode } from '../../common/debug';
import { maxFields, substeps } from './deformation';
import { createPresentation, layers } from './presentation';
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
  lightIntensity: 1.85,
  lightSpeed: .65,
  lightOrbit: 1,
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
  stretchLimit: 430,
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
let sceneWidth = 0, sceneHeight = 0;
const motions = [0,1,2].map(id => new PebbleMotion(id));
let selectedPebble = 2;
const visible = (id: number) => layers[(['upper','lower','front'] as const)[id]];
function pick(point: Point) { return [2,1,0].find(id => visible(id) && motions[id].hitTest(point)); }
const allFields = () => motions.flatMap(motion => motion.fields);
const homeLight = { x: 410, y: 360 };
let lightX = homeLight.x, lightY = homeLight.y;
let lightTime = 0;
const pointers = new Map<number, number>();
const offsets = new Float32Array(6), rotations = new Float32Array(3);
const fieldRanges = new Int32Array(6);
const contactData = new Float32Array(maxFields*4);
const fieldMeta = new Float32Array(maxFields*2);
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
  sceneWidth = sceneHeight = 0;
  gl.bindTexture(gl.TEXTURE_2D, sceneTexture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  vao = gl.createVertexArray()!;
  uniforms = Object.fromEntries(['uResolution', 'uView', 'uOffsets[0]', 'uLight', 'uRotations[0]', 'uFieldRanges[0]', 'uContacts[0]', 'uFieldMeta[0]', 'uGrain', 'uWarmth', 'uSpecular', 'uRim', 'uLightIntensity', 'uFrontAbsorption', 'uRearAbsorption', 'uAbsorptionWidth', 'uSaturation', 'uRearBlur', 'uEdgeRoll', 'uShadowStrength', 'uShadowSpread']
    .concat(['uUpper','uLower','uFront','uShadows','uMaterial','uEdges','uLighting'])
    .map(name => [name, gl.getUniformLocation(program, name)]));
  resolveUniforms = Object.fromEntries(['uScene', 'uResolution', 'uOutputResolution', 'uReferenceScale', 'uDiffusion']
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
  sizeScene(allFields().length);
  wake();
}

function sizeScene(fieldCount: number) {
  // Keep UI/output at native resolution. Only the expensive material pass
  // uses fewer samples while multiple grips (including their release) deform.
  const grips = fieldCount/substeps;
  const quality = 1/Math.sqrt(1+Math.max(0,grips-1)*.4);
  const nextWidth = Math.max(1,Math.round(canvas.width*quality));
  const nextHeight = Math.max(1,Math.round(canvas.height*quality));
  if (nextWidth === sceneWidth && nextHeight === sceneHeight) return;
  sceneWidth = nextWidth; sceneHeight = nextHeight;
  gl.bindTexture(gl.TEXTURE_2D, sceneTexture);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,sceneWidth,sceneHeight,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFramebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,sceneTexture,0);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error('Incomplete scene buffer');
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

function resetComposition() {
  motions.forEach(motion => motion.reset(reducedMotion.matches));
  clearCapture();
  updateHover();
  wake();
}

function clearCapture() {
  const released = [...pointers.keys()];
  pointers.clear();
  for (const id of released) if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
}

function resetLight() {
  lightTime = 0;
  lightX = homeLight.x; lightY = homeLight.y;
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
  const moving = motions.map(motion => motion.step(dt,settings.dragRange,settings.gripRotation,settings,reducedMotion.matches)).some(Boolean);
  if (!reducedMotion.matches) lightTime += dt*settings.lightSpeed*.35;
  const orbit = reducedMotion.matches ? 0 : settings.lightOrbit;
  lightX = homeLight.x+Math.sin(lightTime)*310*orbit;
  lightY = homeLight.y+(Math.cos(lightTime*.73)-1)*190*orbit+Math.sin(lightTime*.51)*260*orbit;
  const fields = allFields();
  sizeScene(fields.length);
  gl.viewport(0,0,sceneWidth,sceneHeight);
  gl.bindFramebuffer(gl.FRAMEBUFFER,sceneFramebuffer);
  gl.useProgram(program);
  gl.bindVertexArray(vao);
  gl.uniform2f(uniforms.uResolution,sceneWidth,sceneHeight);
  gl.uniform2f(uniforms.uView,width,height);
  let fieldStart = 0;
  motions.forEach((motion,id) => {
    offsets[id*2] = motion.x; offsets[id*2+1] = motion.y; rotations[id] = motion.angle;
    fieldRanges[id*2] = fieldStart; fieldStart += motion.fields.length; fieldRanges[id*2+1] = fieldStart;
  });
  gl.uniform2fv(uniforms['uOffsets[0]'],offsets);
  gl.uniform1fv(uniforms['uRotations[0]'],rotations);
  gl.uniform2f(uniforms.uLight,lightX,lightY);
  fields.forEach((field,i) => {
    const index = i*4;
    contactData[index] = field.contact.x; contactData[index+1] = field.contact.y;
    contactData[index+2] = field.pull.x; contactData[index+3] = field.pull.y;
    const radius = 210+.25*Math.hypot(field.pull.x,field.pull.y);
    fieldMeta[i*2] = field.press;
    fieldMeta[i*2+1] = 1/(radius*radius);
  });
  gl.uniform2iv(uniforms['uFieldRanges[0]'],fieldRanges);
  gl.uniform4fv(uniforms['uContacts[0]'],contactData);
  gl.uniform2fv(uniforms['uFieldMeta[0]'],fieldMeta);
  gl.uniform1f(uniforms.uGrain,layers.grain ? settings.grain : 0);
  for (const key of ['upper','lower','front','shadows','material','edges','lighting'] as const) {
    gl.uniform1i(uniforms['u'+key[0].toUpperCase()+key.slice(1)],Number(layers[key]));
  }
  gl.uniform1f(uniforms.uWarmth,settings.warmth);
  gl.uniform1f(uniforms.uSpecular,settings.specular);
  gl.uniform1f(uniforms.uRim,settings.rim);
  gl.uniform1f(uniforms.uLightIntensity,settings.lightIntensity);
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
  gl.viewport(0,0,canvas.width,canvas.height);
  gl.useProgram(resolveProgram);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D,sceneTexture);
  gl.uniform1i(resolveUniforms.uScene,0);
  gl.uniform2f(resolveUniforms.uResolution,sceneWidth,sceneHeight);
  gl.uniform2f(resolveUniforms.uOutputResolution,canvas.width,canvas.height);
  gl.uniform1f(resolveUniforms.uReferenceScale,Math.min(width/590,height/1280)*sceneWidth/width);
  gl.uniform1f(resolveUniforms.uDiffusion,layers.blur ? settings.diffusion : 0);
  gl.drawArrays(gl.TRIANGLES,0,3);
  canvas.dataset.interaction = pointers.size ? 'dragging' : motions.some(motion => motion.mode === 'returning') ? 'returning' : 'idle';
  canvas.dataset.pebblePointers = motions.map(motion => motion.activeCount).join(',');
  updateHover();
  canvas.dataset.activePointers = String(pointers.size);
  if (moving || (!reducedMotion.matches && settings.lightSpeed > 0 && settings.lightOrbit > 0)) wake();
}

function scenePoint(event: PointerEvent): Point {
  const bounds = canvas.getBoundingClientRect();
  const scale = Math.min(width/590,height/1280);
  return { x: (event.clientX-bounds.left-width/2)/scale+295,
    y: (event.clientY-bounds.top-height/2)/scale+640 };
}

function updateHover() {
  const grabbable = pointers.size > 0 || (hoverPoint !== null && pick(hoverPoint) !== undefined);
  canvas.dataset.grabbable = String(grabbable);
}

function trackPointer(event: PointerEvent) {
  const point = scenePoint(event);
  hoverPoint = point;
  wake();
  return point;
}

canvas.addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  const point = trackPointer(event);
  const id = pick(point);
  // Share the existing five-contact GPU budget across the three objects.
  if (id === undefined || allFields().length >= maxFields || pointers.has(event.pointerId)) return;
  if (!motions[id].grab(event.pointerId,point,event.pressure)) return;
  selectedPebble = id;
  pointers.set(event.pointerId,id);
  canvas.setPointerCapture(event.pointerId);
  wake();
});
canvas.addEventListener('pointermove', event => {
  const point = trackPointer(event);
  const id = pointers.get(event.pointerId);
  if (id !== undefined) motions[id].move(event.pointerId,point,event.pressure);
  wake();
});
for (const name of ['pointerup','pointercancel','lostpointercapture'] as const) {
  canvas.addEventListener(name, event => {
    const id = pointers.get(event.pointerId);
    if (id === undefined) return;
    pointers.delete(event.pointerId);
    motions[id].release(event.pointerId,reducedMotion.matches);
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    if (event.pointerType !== 'mouse') hoverPoint = null;
    updateHover();
    wake();
  });
}
canvas.addEventListener('pointerenter', trackPointer);
canvas.addEventListener('pointerleave', () => { hoverPoint = null; updateHover(); });
reducedMotion.addEventListener('change', () => { resetComposition(); wake(); });
canvas.addEventListener('keydown', event => {
  if (event.key === 'Escape') { event.preventDefault(); resetComposition(); return; }
  const directions: Record<string, [number, number]> = {
    ArrowLeft: [-15,0], ArrowRight: [15,0], ArrowUp: [0,-15], ArrowDown: [0,15],
  };
  const direction = directions[event.key];
  if (!direction) return;
  event.preventDefault();
  motions[selectedPebble].nudge(direction[0],direction[1],settings.dragRange);
  wake();
});
window.addEventListener('blur', () => { hoverPoint = null; resetComposition(); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    cancelAnimationFrame(frame); frame = 0;
    hoverPoint = null; resetComposition();
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
gui = exposeGuiInDebugMode(new GUI({ title: 'Rose Glass Controls' }));
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
describe(lightingFolder.add(settings,'lightIntensity',0,3,.01).name('Light intensity').onChange(wake),
  '세 조약돌이 공유하는 조명의 밝기. 표면의 방향과 광원까지의 거리에 따라 반사광과 그림자가 함께 달라짐');
describe(lightingFolder.add(settings,'lightSpeed',0,2,.01).name('Auto light speed').onChange(wake),
  '조명이 곡선을 따라 자동으로 이동하는 속도. 0이면 현재 위치에서 정지');
describe(lightingFolder.add(settings,'lightOrbit',0,1.5,.01).name('Light orbit').onChange(wake),
  '자동 조명의 이동 반경. 0이면 원래 조명 위치로 고정');

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
describe(motionFolder.add(settings,'stretchLimit',150,650,1).name('Stretch limit').onChange(wake),
  '각 손가락이 재료를 당길 수 있는 최대 거리. 기본 430으로 이전보다 약 3.3배 확대. 최대 다섯 포인터를 동시에 사용');
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
  '세 유리의 위치와 변형을 모두 복원. 최대 다섯 손가락의 잡기도 모두 해제');

describe(gui.add(settings,'resetLook').name('Reset appearance'),
  '표면, 조명, 외곽 파라미터를 기본값으로 복원');
describe(gui.add(settings,'resetAll').name('Reset everything'),
  '외형, 조약돌 위치와 조명을 모두 기본값으로 복원');
if (matchMedia('(max-width: 700px)').matches) gui.close();
createPresentation(wake);
